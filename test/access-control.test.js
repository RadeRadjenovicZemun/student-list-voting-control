const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createAccessControl,
  isLoopbackAddress,
  isPrivateLanAddress,
  CODE_TTL_MS,
  SESSION_IDLE_TTL_MS,
  SESSION_MAX_AGE_MS,
  MAX_CODE_ATTEMPTS
} = require('../server/access-control');
const {
  canAccessVotingRecords,
  canApproveIrregularities,
  projectMediaIrregularities
} = require('../server/access-policy');

function createFixture() {
  let now = 1_000_000;
  let nextCode = 123456;
  let nextToken = 0;
  const access = createAccessControl({
    now: () => now,
    makeCode: () => String(nextCode),
    makeToken: () => `session-${++nextToken}`
  });
  return {
    access,
    advance: (duration) => { now += duration; },
    setCode: (code) => { nextCode = code; }
  };
}

test('LAN address checks accept private ranges and loopback only', () => {
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateLanAddress('192.168.0.10'), true);
  assert.equal(isPrivateLanAddress('10.1.2.3'), true);
  assert.equal(isPrivateLanAddress('172.20.1.1'), true);
  assert.equal(isPrivateLanAddress('fd00::1'), true);
  assert.equal(isPrivateLanAddress('8.8.8.8'), false);
});

test('approval code is IP-bound, one-time, and creates a renewable session', () => {
  const { access, advance } = createFixture();
  const requestId = access.createRequest('192.168.0.10', 'Test browser');
  const approval = access.approveRequest(requestId);
  assert.equal(approval.code, '123456');
  assert.equal(access.listRequests()[0].userAgent, 'Test browser');
  assert.equal(access.verifyCode(requestId, '192.168.0.11', approval.code).ok, false);

  const verified = access.verifyCode(requestId, '192.168.0.10', approval.code);
  assert.equal(verified.ok, true);
  assert.equal(access.listSessions()[0].userAgent, 'Test browser');
  assert.equal(access.listSessions()[0].role, 'lawyer');
  assert.equal(access.authenticate(verified.token, '192.168.0.10').role, 'lawyer');
  assert.ok(access.authenticate(verified.token, '192.168.0.10'));
  assert.equal(access.verifyCode(requestId, '192.168.0.10', approval.code).ok, false);

  for (let elapsed = 0; elapsed < SESSION_MAX_AGE_MS - 30_000; elapsed += 30_000) {
    advance(30_000);
    assert.ok(access.heartbeat(verified.token, '192.168.0.10'));
  }
  assert.equal(access.heartbeat(verified.token, '192.168.0.10').renewRequired, true);
  assert.ok(access.renewSession(verified.token, '192.168.0.10'));
  assert.equal(access.authenticate(verified.token, '192.168.0.10').renewRequired, false);
});

test('approved Media Team request preserves its role in the authenticated session', () => {
  const { access } = createFixture();
  const requestId = access.createRequest('192.168.0.15', 'Media browser');
  access.approveRequest(requestId, undefined, 'media');

  const verified = access.verifyCode(requestId, '192.168.0.15', '123456');
  assert.equal(verified.ok, true);
  assert.equal(access.authenticate(verified.token, '192.168.0.15').role, 'media');
  assert.equal(access.listSessions()[0].role, 'media');
});

test('approval rejects unknown remote roles', () => {
  const { access } = createFixture();
  const requestId = access.createRequest('192.168.0.16');
  assert.equal(access.approveRequest(requestId, undefined, 'admin'), null);
  assert.equal(access.getRequestStatus(requestId, '192.168.0.16').status, 'pending');
});

test('Media policy hides voting records and requires Lawyer approval remotely', () => {
  assert.equal(canAccessVotingRecords('media'), false);
  assert.equal(canAccessVotingRecords('lawyer'), true);
  assert.equal(canApproveIrregularities(true, 'media'), false);
  assert.equal(canApproveIrregularities(true, 'lawyer'), true);
  assert.equal(canApproveIrregularities(false, null), true);
});

test('Media irregularity projection reveals all location counts but only approved records', () => {
  const records = [
    { id: 'approved', approved: true, region: 'North', municipality: 'A', place: '1' },
    { id: 'pending-a', region: 'North', municipality: 'A', place: '1', explanation: 'private' },
    { id: 'pending-b', region: 'South', municipality: 'B', place: '2', sender: 'private' }
  ];
  const projection = projectMediaIrregularities(records);

  assert.deepEqual(projection.records.map((record) => record.id), ['approved']);
  assert.deepEqual(projection.counts, {
    all: 3,
    region: { North: 2, South: 1 },
    municipality: { A: 2, B: 1 },
    place: { '1': 2, '2': 1 }
  });
  assert.equal(JSON.stringify(projection).includes('private'), false);
});

test('reloading a waiting page reuses the same IP request', () => {
  const { access } = createFixture();
  const firstId = access.createRequest('192.168.0.10', 'Browser A');
  const secondId = access.createRequest('192.168.0.10', 'Browser A refreshed');
  assert.equal(secondId, firstId);
  assert.equal(access.listRequests().filter((request) => request.ip === '192.168.0.10').length, 1);
});

test('pending request and approval code expire', () => {
  const { access, advance } = createFixture();
  const requestId = access.createRequest('192.168.0.10');
  access.approveRequest(requestId);
  advance(CODE_TTL_MS + 1);
  assert.equal(access.getRequestStatus(requestId, '192.168.0.10').status, 'expired');
  assert.equal(access.verifyCode(requestId, '192.168.0.10', '123456').ok, false);
});

test('rejected request remains visible to the remote page after local queue refresh', () => {
  const { access } = createFixture();
  const requestId = access.createRequest('192.168.0.10');
  assert.equal(access.rejectRequest(requestId), true);
  assert.equal(access.listRequests().length, 0);
  assert.equal(access.getRequestStatus(requestId, '192.168.0.10').status, 'rejected');
});

test('code attempts are capped and sessions expire after heartbeat silence', () => {
  const { access, advance } = createFixture();
  const requestId = access.createRequest('192.168.0.10');
  access.approveRequest(requestId);
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    access.verifyCode(requestId, '192.168.0.10', '000000');
  }
  assert.equal(access.getRequestStatus(requestId, '192.168.0.10').status, 'locked');

  const secondRequestId = access.createRequest('192.168.0.12');
  access.approveRequest(secondRequestId);
  const verified = access.verifyCode(secondRequestId, '192.168.0.12', '123456');
  advance(SESSION_IDLE_TTL_MS + 1);
  assert.equal(access.authenticate(verified.token, '192.168.0.12'), null);
});

test('operator revocation invalidates the token and preserves a revoked marker', () => {
  const { access } = createFixture();
  const requestId = access.createRequest('192.168.0.10');
  access.approveRequest(requestId);
  const verified = access.verifyCode(requestId, '192.168.0.10', '123456');
  assert.equal(access.revokeSessionByRequestId(requestId), true);
  assert.equal(access.authenticate(verified.token, '192.168.0.10'), null);
  assert.equal(access.heartbeat(verified.token, '192.168.0.10'), null);
  assert.equal(access.isRevoked(verified.token, '192.168.0.10'), true);
  assert.equal(access.isRevoked(verified.token, '192.168.0.11'), false);
});
