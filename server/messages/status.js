const { getI18nUiString, fillTemplate } = require('../config');

const STATUS_CODE_MAP = { Akt: '1', Gls: '2', Prk: '3', Bro: '4', Prl: '5', Zap: '6' };

function normalizeStatusCode(code) {
  const raw = String(code || '').trim();
  if (!raw) return raw;
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function buildStatusAcceptedReply(senderCfg, statusCode, options = {}) {
  const prependRecipientName = Boolean(options.prependRecipientName);
  const recipientName = String(options.recipientName || '').trim();
  const template = getI18nUiString('sr', 'signalStatusAcceptedReply', 'Статус бирачког места {location} је промењен у: {statusLabel}.');
  const srUi = { signalStatusLabels: {} };
  const statusLabels = srUi.signalStatusLabels || {};
  const numericId = STATUS_CODE_MAP[statusCode] || statusCode;
  const statusLabel = statusLabels[numericId] || statusCode;
  const placeName = String(senderCfg.place || '').trim();
  const municipalityName = String(senderCfg.municipality || '').trim();
  const regionName = String(senderCfg.region || '').trim();
  const locationParts = [`"${placeName}"`];
  if (municipalityName && regionName) {
    if (municipalityName.toLocaleLowerCase('sr') === regionName.toLocaleLowerCase('sr')) {
      locationParts.push(`"${regionName}"`);
    } else {
      locationParts.push(`"${municipalityName}"`, `"${regionName}"`);
    }
  } else if (municipalityName) {
    locationParts.push(`"${municipalityName}"`);
  } else if (regionName) {
    locationParts.push(`"${regionName}"`);
  }

  const baseMessage = fillTemplate(template, { location: locationParts.join(', '), statusLabel });
  return prependRecipientName && recipientName ? `${recipientName}, ${baseMessage}` : baseMessage;
}

module.exports = {
  type: 'status',
  STATUS_CODE_MAP,
  normalizeStatusCode,
  buildStatusAcceptedReply
};
