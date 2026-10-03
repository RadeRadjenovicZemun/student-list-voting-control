const crypto = require('crypto');

const REQUEST_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;
const SESSION_IDLE_TTL_MS = 90 * 1000;
const SESSION_MAX_AGE_MS = 30 * 60 * 1000;
const SESSION_RENEW_PROMPT_MS = 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;

function normalizeIp(address) {
  const value = String(address || '').trim().toLowerCase();
  return value.startsWith('::ffff:') ? value.slice(7) : value;
}

function isLoopbackAddress(address) {
  const ip = normalizeIp(address);
  return ip === '::1' || ip === '127.0.0.1' || ip.startsWith('127.');
}

function isPrivateLanAddress(address) {
  const ip = normalizeIp(address);
  if (isLoopbackAddress(ip)) return true;
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true;

  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

function hashSecret(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function createAccessControl(options = {}) {
  const now = options.now || Date.now;
  const makeCode = options.makeCode || (() => String(crypto.randomInt(0, 1000000)).padStart(6, '0'));
  const makeToken = options.makeToken || (() => crypto.randomBytes(32).toString('base64url'));
  const requests = new Map();
  const sessions = new Map();
  const revokedTokens = new Map();

  function getRequest(id, ip) {
    const request = requests.get(String(id || ''));
    if (!request || (ip && request.ip !== normalizeIp(ip)) || request.expiresAt <= now()) {
      if (request && request.expiresAt <= now()) requests.delete(request.id);
      return null;
    }
    return request;
  }

  function getSession(token, ip) {
    if (!token) return null;
    const tokenHash = hashSecret(token);
    const session = sessions.get(tokenHash);
    if (!session || session.ip !== normalizeIp(ip)) return null;
    if (session.lastSeenAt + SESSION_IDLE_TTL_MS <= now() || session.maxExpiresAt <= now()) {
      sessions.delete(tokenHash);
      return null;
    }
    return { tokenHash, session };
  }

  function createRequest(ip, userAgent = '') {
    const normalizedIp = normalizeIp(ip);
    const existing = [...requests.values()].find((request) => request.ip === normalizedIp
      && ['pending', 'approved'].includes(request.status)
      && request.expiresAt > now());
    if (existing) {
      existing.userAgent = String(userAgent || existing.userAgent).slice(0, 240);
      return existing.id;
    }
    const requestId = crypto.randomBytes(24).toString('base64url');
    const requestedAt = now();
    const request = {
      id: requestId,
      ip: normalizedIp,
      userAgent: String(userAgent).slice(0, 240),
      requestedAt,
      expiresAt: requestedAt + REQUEST_TTL_MS,
      status: 'pending',
      codeHash: null,
      codeExpiresAt: null,
      failedAttempts: 0
    };
    requests.set(requestId, request);
    return requestId;
  }

  function listRequests() {
    const timestamp = now();
    for (const [id, request] of requests) {
      if (request.expiresAt <= timestamp || ['expired', 'verified'].includes(request.status)) {
        requests.delete(id);
      }
    }
    return [...requests.values()]
      .filter((request) => ['pending', 'approved'].includes(request.status))
      .map(({ id, ip, userAgent, requestedAt, status, codeExpiresAt }) => ({
      id,
      ip,
      userAgent,
      requestedAt: new Date(requestedAt).toISOString(),
      status,
      codeExpiresAt: codeExpiresAt ? new Date(codeExpiresAt).toISOString() : null
      }));
  }

  function approveRequest(id, ip) {
    const request = getRequest(id, ip);
    if (!request || request.status !== 'pending') return null;
    const code = makeCode();
    request.status = 'approved';
    request.codeHash = hashSecret(`${request.id}:${code}`);
    request.codeExpiresAt = now() + CODE_TTL_MS;
    return { code, ip: request.ip, codeExpiresAt: new Date(request.codeExpiresAt).toISOString() };
  }

  function rejectRequest(id, ip) {
    const request = getRequest(id, ip);
    if (!request || request.status !== 'pending') return false;
    request.status = 'rejected';
    return true;
  }

  function getRequestStatus(id, ip) {
    const request = getRequest(id, ip);
    if (!request) return { status: 'expired' };
    if (request.status === 'approved' && request.codeExpiresAt <= now()) {
      request.status = 'expired';
      return { status: 'expired' };
    }
    return { status: request.status };
  }

  function verifyCode(id, ip, code) {
    const request = getRequest(id, ip);
    if (!request || request.status !== 'approved' || request.codeExpiresAt <= now()) {
      if (request) request.status = 'expired';
      return { ok: false, reason: 'code-expired' };
    }
    if (request.failedAttempts >= MAX_CODE_ATTEMPTS) {
      request.status = 'locked';
      return { ok: false, reason: 'too-many-attempts' };
    }

    const expected = Buffer.from(request.codeHash, 'hex');
    const actual = Buffer.from(hashSecret(`${request.id}:${String(code || '')}`), 'hex');
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      request.failedAttempts += 1;
      if (request.failedAttempts >= MAX_CODE_ATTEMPTS) request.status = 'locked';
      return { ok: false, reason: request.status === 'locked' ? 'too-many-attempts' : 'invalid-code' };
    }

    request.status = 'verified';
    const token = makeToken();
    const timestamp = now();
    sessions.set(hashSecret(token), {
      ip: request.ip,
      userAgent: request.userAgent,
      requestId: request.id,
      createdAt: timestamp,
      lastSeenAt: timestamp,
      maxExpiresAt: timestamp + SESSION_MAX_AGE_MS
    });
    return { ok: true, token };
  }

  function authenticate(token, ip) {
    const found = getSession(token, ip);
    if (!found) return null;
    const { session } = found;
    return {
      expiresAt: Math.min(session.lastSeenAt + SESSION_IDLE_TTL_MS, session.maxExpiresAt),
      renewRequired: session.maxExpiresAt - now() <= SESSION_RENEW_PROMPT_MS
    };
  }

  function heartbeat(token, ip) {
    const found = getSession(token, ip);
    if (!found) return null;
    found.session.lastSeenAt = now();
    return authenticate(token, ip);
  }

  function renewSession(token, ip) {
    const found = getSession(token, ip);
    if (!found) return null;
    found.session.lastSeenAt = now();
    found.session.maxExpiresAt = now() + SESSION_MAX_AGE_MS;
    return authenticate(token, ip);
  }

  function revokeSession(token, ip) {
    const found = getSession(token, ip);
    if (!found) return false;
    sessions.delete(found.tokenHash);
    return true;
  }

  function isRevoked(token, ip) {
    if (!token) return false;
    const tokenHash = hashSecret(token);
    const revoked = revokedTokens.get(tokenHash);
    if (!revoked) return false;
    if (revoked.ip !== normalizeIp(ip) || revoked.expiresAt <= now()) {
      revokedTokens.delete(tokenHash);
      return false;
    }
    return true;
  }

  function listSessions() {
    const timestamp = now();
    for (const [tokenHash, session] of sessions) {
      if (session.lastSeenAt + SESSION_IDLE_TTL_MS <= timestamp || session.maxExpiresAt <= timestamp) {
        sessions.delete(tokenHash);
      }
    }
    return [...sessions.values()].map((session) => ({
      id: session.requestId,
      ip: session.ip,
      userAgent: session.userAgent || '',
      createdAt: new Date(session.createdAt).toISOString(),
      lastSeenAt: new Date(session.lastSeenAt).toISOString(),
      expiresAt: new Date(Math.min(session.lastSeenAt + SESSION_IDLE_TTL_MS, session.maxExpiresAt)).toISOString()
    }));
  }

  function revokeSessionByRequestId(requestId) {
    let removed = false;
    for (const [tokenHash, session] of sessions) {
      if (session.requestId === String(requestId)) {
        revokedTokens.set(tokenHash, {
          ip: session.ip,
          expiresAt: Math.min(session.maxExpiresAt, now() + SESSION_MAX_AGE_MS)
        });
        sessions.delete(tokenHash);
        removed = true;
      }
    }
    return removed;
  }

  return {
    createRequest,
    listRequests,
    approveRequest,
    rejectRequest,
    getRequestStatus,
    verifyCode,
    authenticate,
    heartbeat,
    renewSession,
    revokeSession,
    isRevoked,
    listSessions,
    revokeSessionByRequestId
  };
}

module.exports = {
  createAccessControl,
  isLoopbackAddress,
  isPrivateLanAddress,
  REQUEST_TTL_MS,
  CODE_TTL_MS,
  SESSION_IDLE_TTL_MS,
  SESSION_MAX_AGE_MS,
  SESSION_RENEW_PROMPT_MS,
  MAX_CODE_ATTEMPTS
};
