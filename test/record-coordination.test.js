const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CLAIM_TTL_MS, createRecordCoordination } = require('../server/record-coordination');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'record-coordination-'));
  let timestamp = 1_800_000_000_000;
  const coordination = createRecordCoordination(path.join(directory, 'coordination.json'), { now: () => timestamp });
  return {
    coordination,
    cleanup: () => fs.rmSync(directory, { recursive: true, force: true }),
    advance: (milliseconds) => { timestamp += milliseconds; }
  };
}

test('record claims are exclusive across clients, renewable by owner, and releasable', (t) => {
  const { coordination, cleanup } = fixture();
  t.after(cleanup);

  const acquired = coordination.claim({ type: 'irregularity', recordId: 'record-1', ownerId: 'client-a', ownerName: 'Lawyer One', role: 'lawyer' });
  assert.equal(acquired.ok, true);
  assert.equal(coordination.claim({ type: 'irregularity', recordId: 'record-1', ownerId: 'client-b', role: 'it' }).reason, 'record-already-claimed');
  assert.equal(coordination.claim({ type: 'irregularity', recordId: 'record-1', ownerId: 'client-a', role: 'lawyer' }).ok, true);
  assert.equal(coordination.release({ type: 'irregularity', recordId: 'record-1', ownerId: 'client-b' }), false);
  assert.equal(coordination.release({ type: 'irregularity', recordId: 'record-1', ownerId: 'client-a' }), true);
  assert.equal(coordination.list().claims.length, 0);
});

test('claims expire after a client stops renewing', (t) => {
  const { coordination, cleanup, advance } = fixture();
  t.after(cleanup);

  coordination.claim({ type: 'zap-record', recordId: 'record-2', ownerId: 'remote:session-a', role: 'lawyer' });
  advance(CLAIM_TTL_MS + 1);
  assert.equal(coordination.list().claims.length, 0);
  assert.equal(coordination.claim({ type: 'zap-record', recordId: 'record-2', ownerId: 'client-b' }).ok, true);
});

test('lawyer names are normalized, deduplicated, and returned as suggestions', (t) => {
  const { coordination, cleanup } = fixture();
  t.after(cleanup);

  assert.equal(coordination.assignLawyerName('  Alex   Smith ').name, 'Alex Smith');
  assert.equal(coordination.assignLawyerName('alex smith').name, 'Alex Smith');
  assert.deepEqual(coordination.list().lawyerNames, ['Alex Smith']);
});
