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

  const matchPlace = (place, regionName, municipalityName, parentPlace = null) => {
    if (!place || typeof place !== 'object') return null;
    const context = {
      placeId: String(place.id || ''),
      placeName: String(place.name || place.id || ''),
      regionName,
      municipalityName,
      parentPlace: parentPlace && parentPlace.name ? String(parentPlace.name) : null,
      registeredVoters: Number(place.registeredVoters) || 0
    };
    const controller = (Array.isArray(place.sender) ? place.sender : []).find((entry) =>
      String(entry && entry.signalUser || '').trim().toLowerCase() === normalizedSender
    );
    if (controller) return { ...context, sender: controller, registrationType: 'controller' };
    const mobileTeamMember = (Array.isArray(place.mobileTeamMembers) ? place.mobileTeamMembers : []).find((entry) =>
      String(entry && entry.signalUser || '').trim().toLowerCase() === normalizedSender
    );
    if (mobileTeamMember) return { ...context, sender: mobileTeamMember, registrationType: 'mtm' };
    return null;
  };

  for (const region of Array.isArray(config.regions) ? config.regions : []) {
    const regionName = region && region.name ? String(region.name) : null;
    if (Array.isArray(region.municipalities)) {
      for (const mun of region.municipalities) {
        const municipalityName = mun && mun.name ? String(mun.name) : null;
        for (const place of mun.places || []) {
          const found = matchPlace(place, regionName, municipalityName);
          if (found) return found;
          for (const sub of place.subPlaces || []) {
            const subFound = matchPlace(sub, regionName, municipalityName, place);
            if (subFound) return subFound;
          }
        }
      }
    }
    for (const place of region.places || []) {
      const found = matchPlace(place, regionName, null);
      if (found) return found;
      for (const sub of place.subPlaces || []) {
        const subFound = matchPlace(sub, regionName, null, place);
        if (subFound) return subFound;
      }
    }
  }

  return null;
}

function applyRegistrationMessage(config, sender, placeId, options = {}) {
  const registrationType = options.registrationType === 'mtm' ? 'mtm' : 'controller';
  const persist = options.saveConfig || saveConfig;
  const context = findVotingPlaceContextById(config, placeId);
  if (!context || !context.place) {
    return { ok: false, reason: 'place-not-found' };
  }

  const place = context.place;
  const existingReg = findSenderRegistration(config, sender);
  if (existingReg) {
    return { ok: false, reason: 'sender-already-registered', existingReg, registrationType: existingReg.registrationType };
  }

  const currentSenderEntry = Array.isArray(place.sender) ? place.sender[0] : null;
  const currentSignalUser = currentSenderEntry ? String(currentSenderEntry.signalUser || '').trim() : '';
  if (registrationType === 'controller' && currentSignalUser && currentSignalUser !== 'TBD') {
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

  if (registrationType === 'mtm') {
    if (!Array.isArray(place.mobileTeamMembers)) place.mobileTeamMembers = [];
    place.mobileTeamMembers.push({ signalUser: String(sender || 'TBD'), registrationType: 'mtm' });
  } else if (!Array.isArray(place.sender) || !place.sender.length) {
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

  if (registrationType === 'controller') {
    const senderEntry = place.sender[0];
    if (senderEntry && typeof senderEntry === 'object') {
      senderEntry.signalUser = String(sender || 'TBD');
    }
    place.senderStatus = '0';
  }

  try {
    persist(config);
    return {
      ok: true,
      registrationType,
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

function unregisterSender(config, sender, options = {}) {
  const persist = options.saveConfig || saveConfig;
  const registration = findSenderRegistration(config, sender);
  if (!registration) return { ok: false, reason: 'sender-not-registered' };
  const context = findVotingPlaceContextById(config, registration.placeId);
  if (!context || !context.place) return { ok: false, reason: 'place-not-found' };

  if (registration.registrationType === 'mtm') {
    context.place.mobileTeamMembers = (context.place.mobileTeamMembers || []).filter((entry) =>
      String(entry && entry.signalUser || '').trim().toLowerCase() !== String(sender || '').trim().toLowerCase()
    );
  } else {
    const entry = (context.place.sender || []).find((item) =>
      String(item && item.signalUser || '').trim().toLowerCase() === String(sender || '').trim().toLowerCase()
    );
    if (entry) entry.signalUser = 'TBD';
    context.place.senderStatus = '0';
  }

  try {
    persist(config);
    return { ok: true, ...registration };
  } catch (err) {
    console.error('Failed to save config after unregistration:', err.message);
    return { ok: false, reason: 'config-save-failed' };
  }
}

function isMtmCommandAllowed(commandType) {
  return commandType === 'irregularity';
}

function buildRegistrationAcceptedReply(registration, options = {}) {
  const prependRecipientName = Boolean(options.prependRecipientName);
  const recipientName = String(options.recipientName || '').trim();
  const template = getI18nUiString('sr', registration.registrationType === 'mtm' ? 'signalMtmRegistrationAcceptedReply' : 'signalRegistrationAcceptedReply', 'Регистровани сте као контролор на бирачком месту,\n"{placeName}".\nБрој регистрованих бирача је {registeredVoters}.');
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
  const template = getI18nUiString('sr', registration && registration.registrationType === 'mtm' ? 'signalMtmRegistrationQueryReply' : 'signalRegistrationQueryReply',
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
  findSenderRegistration,
  unregisterSender,
  isMtmCommandAllowed
};
