const { getI18nUiString, fillTemplate, normalizeNameForCompare, saveConfig } = require('../config');

function findVotingPlaceContextById(config, placeId) {
  const normalized = String(placeId || '').trim();
  if (!normalized) return null;

  const regions = Array.isArray(config.regions) ? config.regions : [];
  for (const region of regions) {
    const regionName = region && region.name ? String(region.name) : null;
    if (Array.isArray(region.municipalities)) {
      for (const mun of region.municipalities) {
        const municipalityName = mun && mun.name ? String(mun.name) : null;
        for (const place of mun.places || []) {
          if (String(place && place.id || '').trim() === normalized) {
            return { place, regionName, municipalityName, placeName: place && place.name ? String(place.name) : normalized };
          }
          for (const sub of place.subPlaces || []) {
            if (String(sub && sub.id || '').trim() === normalized) {
              return { place: sub, regionName, municipalityName, placeName: sub && sub.name ? String(sub.name) : normalized };
            }
          }
        }
      }
    }

    for (const place of region.places || []) {
      if (String(place && place.id || '').trim() === normalized) {
        return { place, regionName, municipalityName: null, placeName: place && place.name ? String(place.name) : normalized };
      }
      for (const sub of place.subPlaces || []) {
        if (String(sub && sub.id || '').trim() === normalized) {
          return { place: sub, regionName, municipalityName: null, placeName: sub && sub.name ? String(sub.name) : normalized };
        }
      }
    }
  }

  return null;
}

function findSenderRegistration(config, sender) {
  const normalizedSender = String(sender || '').trim().toLowerCase();
  if (!normalizedSender) return null;

  const getFromPlaces = (places, regionName, municipalityName) => {
    for (const place of places || []) {
      const senderEntry = Array.isArray(place.sender) ? place.sender[0] : null;
      if (senderEntry && String(senderEntry.signalUser || '').trim().toLowerCase() === normalizedSender) {
        return { placeId: String(place.id || ''), placeName: String(place.name || place.id || ''), regionName, municipalityName, registeredVoters: Number(place.registeredVoters) || 0 };
      }
      for (const sub of place.subPlaces || []) {
        const subEntry = Array.isArray(sub.sender) ? sub.sender[0] : null;
        if (subEntry && String(subEntry.signalUser || '').trim().toLowerCase() === normalizedSender) {
          return { placeId: String(sub.id || ''), placeName: String(sub.name || sub.id || ''), regionName, municipalityName, registeredVoters: Number(sub.registeredVoters) || 0 };
        }
      }
    }
    return null;
  };

  for (const region of Array.isArray(config.regions) ? config.regions : []) {
    const regionName = region && region.name ? String(region.name) : null;
    if (Array.isArray(region.municipalities)) {
      for (const mun of region.municipalities) {
        const municipalityName = mun && mun.name ? String(mun.name) : null;
        const found = getFromPlaces(mun.places, regionName, municipalityName);
        if (found) return found;
      }
    }
    const found = getFromPlaces(region.places, regionName, null);
    if (found) return found;
  }

  return null;
}

function applyRegistrationMessage(config, sender, placeId) {
  const context = findVotingPlaceContextById(config, placeId);
  if (!context || !context.place) {
    return { ok: false, reason: 'place-not-found' };
  }

  const place = context.place;
  const existingReg = findSenderRegistration(config, sender);
  if (existingReg) {
    return { ok: false, reason: 'sender-already-registered', existingReg };
  }

  const currentSenderEntry = Array.isArray(place.sender) ? place.sender[0] : null;
  const currentSignalUser = currentSenderEntry ? String(currentSenderEntry.signalUser || '').trim() : '';
  if (currentSignalUser && currentSignalUser !== 'TBD') {
    return {
      ok: false,
      reason: 'place-already-taken',
      existingReg: {
        placeId: String(place.id || ''),
        placeName: context.placeName,
        regionName: context.regionName || null,
        municipalityName: context.municipalityName || null
      }
    };
  }

  if (!Array.isArray(place.sender) || !place.sender.length) {
    place.sender = [{
      signalUser: 'TBD',
      displayName: 'TBD',
      name: 'TBD',
      surname: 'TBD',
      phone: 'TBD',
      email: 'TBD',
      keep_data: 'NO'
    }];
  }

  const senderEntry = place.sender[0];
  if (senderEntry && typeof senderEntry === 'object') {
    senderEntry.signalUser = String(sender || 'TBD');
  }
  place.senderStatus = '1';

  try {
    saveConfig(config);
    return {
      ok: true,
      placeId: String(placeId),
      sender: String(sender || 'TBD'),
      regionName: context.regionName || null,
      municipalityName: context.municipalityName || null,
      placeName: context.placeName || String(placeId),
      registeredVoters: Number(place.registeredVoters) || 0
    };
  } catch (err) {
    console.error('Failed to save config after registration message:', err.message);
    return { ok: false, reason: 'config-save-failed' };
  }
}

function buildRegistrationAcceptedReply(registration, options = {}) {
  const prependRecipientName = Boolean(options.prependRecipientName);
  const recipientName = String(options.recipientName || '').trim();
  const template = getI18nUiString('sr', 'signalRegistrationAcceptedReply', 'Регистровани сте као контролор на бирачком месту,\n"{placeName}".\nБрој регистрованих бирача је {registeredVoters}.');
  const placeName = String(registration.placeName || registration.placeId || 'N/A');
  const municipalityName = String(registration.municipalityName || '').trim();
  const regionName = String(registration.regionName || '').trim();

  const locationParts = [`"${placeName}"`];
  if (municipalityName && regionName) {
    if (normalizeNameForCompare(municipalityName) === normalizeNameForCompare(regionName)) {
      locationParts.push(`"${regionName}"`);
    } else {
      locationParts.push(`"${municipalityName}"`, `"${regionName}"`);
    }
  } else if (municipalityName) {
    locationParts.push(`"${municipalityName}"`);
  } else if (regionName) {
    locationParts.push(`"${regionName}"`);
  }

  const baseMessage = fillTemplate(template, {
    votingPlaceName: placeName,
    votingMunicipality: municipalityName,
    votingRegion: regionName,
    location: locationParts.join(', '),
    placeName,
    municipalityName,
    registeredVoters: String(Number(registration.registeredVoters) || 0)
  });

  return prependRecipientName && recipientName ? `${recipientName}, ${baseMessage}` : baseMessage;
}

function buildRegistrationQueryReply(registration, options = {}) {
  const prependRecipientName = Boolean(options.prependRecipientName);
  const recipientName = String(options.recipientName || '').trim();
  const template = getI18nUiString('sr', 'signalRegistrationQueryReply',
    'Регистровани сте као контролор на бирачком месту,\n"{placeName}".\nБрој регистрованих бирача је {registeredVoters}.');
  const baseMessage = fillTemplate(template, {
    placeName: String(registration && registration.placeName || registration && registration.placeId || 'N/A'),
    municipalityName: String(registration && registration.municipalityName || '').trim(),
    registeredVoters: String(Number(registration && registration.registeredVoters) || 0)
  });
  return prependRecipientName && recipientName ? `${recipientName}, ${baseMessage}` : baseMessage;
}

module.exports = {
  type: 'register-controller',
  applyRegistrationMessage,
  buildRegistrationAcceptedReply,
  buildRegistrationQueryReply,
  findSenderRegistration
};
