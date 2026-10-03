const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../data/config.json');
const { createTurnoutPdf, createPreliminaryResultsPdf, getCandidates, TURNOUT_COLUMNS } = require('../server/documents');

const context = {
  config,
  regionName: 'Београдски регион',
  municipalityName: 'Градска општина Барајево',
  placeName: '1 - МК "АРНАЈЕВО"',
  place: { registeredVoters: 624 }
};

test('turnout worksheet includes the specified column intervals and creates a PDF', async () => {
  const pdf = await createTurnoutPdf(context);

  assert.deepEqual(TURNOUT_COLUMNS, [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 1000);
});

test('preliminary results worksheet includes all configured candidates', async () => {
  const pdf = await createPreliminaryResultsPdf(context);

  assert.equal(getCandidates(config).length, config.result.candidateVotes.length);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 1000);
});