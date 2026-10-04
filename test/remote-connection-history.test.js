const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRemoteConnectionHistory } = require('../server/remote-connection-history');

function createFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-connection-history-'));
  const filePath = path.join(directory, 'history.json');
  let tick = 0;
  const history = createRemoteConnectionHistory(filePath, {
    now: () => new Date(Date.UTC(2026, 9, 4, 0, 0, tick++)).toISOString()
  });
  return { directory, filePath, history };
}

test('remote connection history persists a request through login and termination', (t) => {
  const { directory, filePath, history } = createFixture();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  history.recordRequest({ requestId: 'request-1', ip: '192.168.0.10', userAgent: 'Phone browser' });
  history.assignRole('request-1', 'media');
  history.startSession('request-1', 'media');
  history.endSession('request-1', 'revoked', 'Local operator');

  const restored = createRemoteConnectionHistory(filePath).list();
  assert.equal(restored.length, 1);
  assert.equal(restored[0].status, 'revoked');
  assert.equal(restored[0].ip, '192.168.0.10');
  assert.equal(restored[0].role, 'media');
  assert.equal(restored[0].startedBy, 'Remote user (one-time PIN)');
  assert.equal(restored[0].terminatedBy, 'Local operator');
  assert.ok(restored[0].requestedAt);
  assert.ok(restored[0].startedAt);
  assert.ok(restored[0].endedAt);
});

test('startup closes unfinished remote requests and active sessions', (t) => {
  const { directory, filePath, history } = createFixture();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  history.recordRequest({ requestId: 'pending', ip: '192.168.0.10', userAgent: 'Browser' });
  history.recordRequest({ requestId: 'active', ip: '192.168.0.11', userAgent: 'Browser' });
  history.startSession('active', 'lawyer');

  createRemoteConnectionHistory(filePath).closeOpenConnections();
  const rows = createRemoteConnectionHistory(filePath).list();
  assert.equal(rows.find((row) => row.requestId === 'pending').status, 'expired');
  assert.equal(rows.find((row) => row.requestId === 'active').status, 'interrupted');
  assert.equal(rows.find((row) => row.requestId === 'active').terminatedBy, 'Server restarted');
});

test('clearing history removes only audit rows', (t) => {
  const { directory, history } = createFixture();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  history.recordRequest({ requestId: 'request-1', ip: '192.168.0.10', userAgent: 'Browser' });
  assert.equal(history.clear(), 1);
  assert.deepEqual(history.list(), []);
});
