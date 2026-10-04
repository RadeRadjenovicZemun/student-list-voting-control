const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const registration = require('../server/messages/register-controller');

function createConfig() {
  return {
    regions: [{
      id: '1',
      name: 'Region',
      municipalities: [{
        id: '1.1',
        name: 'Municipality',
        places: [
          { id: '1.1.1.1', name: 'Place One', registeredVoters: 100, senderStatus: '0', sender: [{ signalUser: 'TBD' }] },
          { id: '1.1.1.2', name: 'Place Two', registeredVoters: 200, senderStatus: '0', sender: [{ signalUser: 'TBD' }] }
        ]
      }]
    }]
  };
}

const saveConfig = () => {};

test('Reg accepts controller registration and multiple MTMs at the same place', () => {
  const config = createConfig();
  const controllerResult = registration.applyRegistrationMessage(config, 'Controller', '1.1.1.1', { saveConfig });
  const firstMtm = registration.applyRegistrationMessage(config, 'MTM One', '1.1.1.1', { registrationType: 'mtm', saveConfig });
  const secondMtm = registration.applyRegistrationMessage(config, 'MTM Two', '1.1.1.1', { registrationType: 'mtm', saveConfig });

  assert.equal(controllerResult.ok, true);
  assert.equal(firstMtm.ok, true);
  assert.equal(secondMtm.ok, true);
  assert.equal(config.regions[0].municipalities[0].places[0].sender[0].signalUser, 'Controller');
  assert.equal(config.regions[0].municipalities[0].places[0].senderStatus, '0');
  assert.deepEqual(config.regions[0].municipalities[0].places[0].mobileTeamMembers.map((member) => member.signalUser), ['MTM One', 'MTM Two']);
  assert.equal(registration.findSenderRegistration(config, 'MTM One').registrationType, 'mtm');
});

test('MTM already registered at one place cannot register at another', () => {
  const config = createConfig();
  registration.applyRegistrationMessage(config, 'Mobile User', '1.1.1.1', { registrationType: 'mtm', saveConfig });

  const result = registration.applyRegistrationMessage(config, 'Mobile User', '1.1.1.2', { registrationType: 'mtm', saveConfig });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'sender-already-registered');
  assert.equal(result.existingReg.registrationType, 'mtm');
  assert.equal(result.existingReg.placeName, 'Place One');
});

test('Unr removes one MTM or clears controller registration and status', () => {
  const config = createConfig();
  registration.applyRegistrationMessage(config, 'Controller', '1.1.1.1', { saveConfig });
  registration.applyRegistrationMessage(config, 'MTM One', '1.1.1.1', { registrationType: 'mtm', saveConfig });
  registration.applyRegistrationMessage(config, 'MTM Two', '1.1.1.1', { registrationType: 'mtm', saveConfig });

  assert.equal(registration.unregisterSender(config, 'MTM One', { saveConfig }).ok, true);
  assert.deepEqual(config.regions[0].municipalities[0].places[0].mobileTeamMembers.map((member) => member.signalUser), ['MTM Two']);
  assert.equal(registration.unregisterSender(config, 'Controller', { saveConfig }).ok, true);
  assert.equal(config.regions[0].municipalities[0].places[0].sender[0].signalUser, 'TBD');
  assert.equal(config.regions[0].municipalities[0].places[0].senderStatus, '0');
  assert.equal(registration.unregisterSender(config, 'Nobody', { saveConfig }).reason, 'sender-not-registered');
});

test('Reg MTM and Unr templates parse and MTMs are limited to Nep', () => {
  const templates = JSON.parse(fs.readFileSync('data/templates.json', 'utf8')).templates;
  const reg = templates.find((item) => item.name === 'Reg');
  const unr = templates.find((item) => item.name === 'Unr');
  const mtmMatch = new RegExp(reg.regex, 'i').exec('Reg: 1.1.1.1 MTM');
  assert.ok(mtmMatch);
  assert.equal(mtmMatch[1], '1.1.1.1');
  assert.equal(mtmMatch[2].toUpperCase(), 'MTM');
  assert.match('Unr:', new RegExp(unr.regex, 'i'));
  assert.equal(registration.isMtmCommandAllowed('irregularity'), true);
  for (const commandType of ['status', 'izlaznost', 'rezultati', 'help', 'unknown']) {
    assert.equal(registration.isMtmCommandAllowed(commandType), false);
  }
});
