const { getI18nUiString, fillTemplate } = require('../config');

function normalizeNumeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function applyIzlaznostMessage(config, sender, count, homeCount = null) {
  const senderCfg = findSenderConfig(config, sender);
  if (!senderCfg) return { ok: false, reason: 'sender-not-found' };
  const place = senderCfg.place;
  if (!place) return { ok: false, reason: 'place-not-found' };

  const nextCount = normalizeNumeric(count, toNumberButNoImport(place.voted, 0));
  const nextHomeCount = homeCount === null || homeCount === undefined
    ? normalizeNumeric(place.votedFromHome, 0)
    : normalizeNumeric(homeCount, 0);

  place.voted = nextCount;
  place.totalVoted = nextCount;
  if (homeCount !== null && homeCount !== undefined) {
    place.votedFromHome = nextHomeCount;
    place.totalVotedFromHome = nextHomeCount;
  }
  return {
    ok: true,
    count: place.voted,
    votedFromHome: place.votedFromHome,
    placeId: String(place.id || ''),
    sender
  };
}

function toNumberButNoImport(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function findSenderConfig(config, sender) {
  const target = String(sender || '').trim();
  if (!target) return null;
  const walk = (node, regionName = null, municipalityName = null) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node.municipalities)) {
      for (const mun of node.municipalities) {
        const one = walk(mun, regionName, mun && mun.name ? String(mun.name) : municipalityName);
        if (one) return one;
      }
    }
    if (Array.isArray(node.places)) {
      for (const place of node.places) {
        const senders = Array.isArray(place.sender) ? place.sender : [];
        if (senders.some((entry) => String((entry && entry.signalUser) || '').trim() === target)) {
          return { place, region: regionName, municipality: municipalityName || null, sender: target };
        }
        if (Array.isArray(place.subPlaces)) {
          for (const sub of place.subPlaces) {
            const subSenders = Array.isArray(sub.sender) ? sub.sender : [];
            if (subSenders.some((entry) => String((entry && entry.signalUser) || '').trim() === target)) {
              return { place: sub, region: regionName, municipality: municipalityName || null, sender: target };
            }
          }
        }
      }
    }
    if (Array.isArray(node.regions)) {
      for (const region of node.regions) {
        const regionName2 = region && region.name ? String(region.name) : regionName;
        const res = walk(region, regionName2, municipalityName);
        if (res) return res;
      }
    }
    return null;
  };

  return walk(config);
}

function buildLocationText(placeName, municipalityName, regionName) {
  const locationParts = [`"${String(placeName || '').trim() || 'N/A'}"`];
  if (municipalityName && regionName) {
    const normalizedMunicipality = String(municipalityName).toLocaleLowerCase('sr');
    const normalizedRegion = String(regionName).toLocaleLowerCase('sr');
    if (normalizedMunicipality === normalizedRegion) {
      locationParts.push(`"${regionName}"`);
    } else {
      locationParts.push(`"${municipalityName}"`, `"${regionName}"`);
    }
  } else if (municipalityName) {
    locationParts.push(`"${municipalityName}"`);
  } else if (regionName) {
    locationParts.push(`"${regionName}"`);
  }
  return locationParts.join(', ');
}

function buildIzlaznostQueryReply(senderCfg, options = {}) {
  const prependRecipientName = Boolean(options.prependRecipientName);
  const recipientName = String(options.recipientName || '').trim();
  const place = senderCfg && senderCfg.place ? senderCfg.place : {};
  const placeName = String(
    typeof place === 'string'
      ? place
      : (place.name || place.id || senderCfg && senderCfg.placeName || '')
  ).trim();
  const municipalityName = String(senderCfg && senderCfg.municipality || '').trim();
  const regionName = String(senderCfg && senderCfg.region || '').trim();
  const template = getI18nUiString(
    'sr',
    'signalIzlaznostQueryReply',
    'Бирачко место {location}: у месту {count}, од куће {votedFromHome}.'
  );
  const baseMessage = fillTemplate(template, {
    location: buildLocationText(placeName, municipalityName, regionName),
    count: String(normalizeNumeric(options.count ?? place.voted ?? 0, 0)),
    votedFromHome: String(normalizeNumeric(options.homeCount ?? place.votedFromHome, 0))
  });
  return prependRecipientName && recipientName ? `${recipientName}, ${baseMessage}` : baseMessage;
}

function buildIzlaznostAcceptedReply(senderCfg, options = {}) {
  const prependRecipientName = Boolean(options.prependRecipientName);
  const recipientName = String(options.recipientName || '').trim();
  const place = senderCfg && senderCfg.place ? senderCfg.place : {};
  const placeName = String(
    typeof place === 'string'
      ? place
      : (place.name || place.id || senderCfg && senderCfg.placeName || '')
  ).trim();
  const municipalityName = String(senderCfg && senderCfg.municipality || '').trim();
  const regionName = String(senderCfg && senderCfg.region || '').trim();
  const template = getI18nUiString(
    'sr',
    'signalIzlaznostAcceptedReply',
    'Ажурирање излазности на бирачком месту {location} је прихваћено. У месту: {count}, од куће: {votedFromHome}.'
  );
  const baseMessage = fillTemplate(template, {
    location: buildLocationText(placeName, municipalityName, regionName),
    count: String(normalizeNumeric(options.count ?? place.voted ?? 0, 0)),
    votedFromHome: String(normalizeNumeric(options.homeCount ?? place.votedFromHome, 0))
  });
  return prependRecipientName && recipientName ? `${recipientName}, ${baseMessage}` : baseMessage;
}

module.exports = {
  type: 'izlaznost',
  applyIzlaznostMessage,
  buildIzlaznostQueryReply,
  buildIzlaznostAcceptedReply,
  findSenderConfig
};
