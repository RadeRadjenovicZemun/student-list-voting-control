const fs = require('fs');
const CLAIM_TTL_MS = 120 * 1000;
const RECORD_TYPES = new Set(['irregularity', 'zap-record']);

function createRecordCoordination(filePath, options = {}) {
  const now = options.now || Date.now;

  function load() {
    try {
      if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, JSON.stringify({ claims: [], lawyerNames: [] }, null, 2), 'utf8');
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return {
        claims: Array.isArray(parsed.claims) ? parsed.claims : [],
        lawyerNames: Array.isArray(parsed.lawyerNames) ? parsed.lawyerNames : []
      };
    } catch (error) {
      return { claims: [], lawyerNames: [] };
    }
  }

  function save(state) {
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');
  }

  function prune(state) {
    const timestamp = now();
    state.claims = state.claims.filter((claim) => Number(claim.expiresAt) > timestamp);
  }

  function list() {
    const state = load();
    prune(state);
    save(state);
    return state;
  }

  function claim({ type, recordId, ownerId, ownerName, role }) {
    if (!RECORD_TYPES.has(type) || !String(recordId || '').trim() || !String(ownerId || '').trim()) {
      return { ok: false, reason: 'invalid-claim' };
    }
    const state = load();
    prune(state);
    const key = `${type}:${recordId}`;
    const existing = state.claims.find((item) => item.key === key);
    if (existing && existing.ownerId !== ownerId) {
      save(state);
      return { ok: false, reason: 'record-already-claimed', claim: existing };
    }
    const timestamp = now();
    const next = {
      key,
      type,
      recordId: String(recordId),
      ownerId: String(ownerId),
      ownerName: String(ownerName || '').trim(),
      role: role || 'it',
      claimedAt: existing ? existing.claimedAt : timestamp,
      expiresAt: timestamp + CLAIM_TTL_MS
    };
    if (existing) Object.assign(existing, next);
    else state.claims.push(next);
    save(state);
    return { ok: true, claim: next };
  }

  function release({ type, recordId, ownerId }) {
    const state = load();
    const key = `${type}:${recordId}`;
    const index = state.claims.findIndex((item) => item.key === key && item.ownerId === ownerId);
    if (index < 0) return false;
    state.claims.splice(index, 1);
    save(state);
    return true;
  }

  function releaseOwner(ownerId) {
    const state = load();
    const before = state.claims.length;
    state.claims = state.claims.filter((item) => item.ownerId !== ownerId);
    if (state.claims.length !== before) save(state);
    return before - state.claims.length;
  }

  function assignLawyerName(name) {
    const normalized = String(name || '').trim().replace(/\s+/g, ' ');
    if (!normalized || normalized === '--New Name--') return { ok: false, reason: 'invalid-name' };
    const state = load();
    const existing = state.lawyerNames.find((value) => value.toLocaleLowerCase() === normalized.toLocaleLowerCase());
    if (!existing) state.lawyerNames.push(normalized);
    state.lawyerNames.sort((a, b) => a.localeCompare(b));
    save(state);
    return { ok: true, name: existing || normalized, lawyerNames: state.lawyerNames };
  }

  function clearLawyerNames() {
    const state = load();
    const removed = state.lawyerNames.length;
    state.lawyerNames = [];
    save(state);
    return removed;
  }

  return { assignLawyerName, claim, clearLawyerNames, list, release, releaseOwner };
}

module.exports = { CLAIM_TTL_MS, createRecordCoordination };
