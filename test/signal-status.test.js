const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const status = require('../server/messages/status');

test('Sta: Odl maps to a distinct postponed-start status', () => {
  const templates = JSON.parse(fs.readFileSync('data/templates.json', 'utf8'));
  const command = templates.templates.find((item) => item.name === 'Sta');
  const commandPattern = new RegExp(command.regex, 'i');
  const match = commandPattern.exec('Sta: Odl');
  assert.ok(match);
  assert.equal(status.STATUS_CODE_MAP[status.normalizeStatusCode(match[1])], '7');

  const i18n = JSON.parse(fs.readFileSync('data/multilang.json', 'utf8'));
  const postponedStatus = i18n.senderStatuses.find((item) => item.id === '7');
  assert.equal(postponedStatus.name, 'Одложен почетак гласања');
  assert.equal(i18n.multiLanguage.sr.ui.signalStatusLabels['7'], postponedStatus.name);
  assert.equal(i18n.multiLanguage.en.ui.signalStatusLabels['7'], 'Voting start postponed');
  assert.equal(i18n.multiLanguage.sr.ui.controllerStatus7, postponedStatus.name);
  assert.equal(i18n.multiLanguage.en.ui.controllerStatus7, 'Voting Start Postponed');
});

test('Odl status acknowledgement names the postponed voting start in Serbian', () => {
  const reply = status.buildStatusAcceptedReply({
    place: 'Бирачко место 1',
    municipality: 'Општина',
    region: 'Регион'
  }, 'Odl');

  assert.match(reply, /Одложен почетак гласања/);
});
