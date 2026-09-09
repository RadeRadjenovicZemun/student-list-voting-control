const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const MULTILANG_PATH = path.join(DATA_DIR, 'multilang.json');
const TEMPLATES_PATH = path.join(DATA_DIR, 'templates.json');

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function walkPlaceVote(place) {
  if (!place || typeof place !== 'object') return 0;
  if (Array.isArray(place.subPlaces)) {
    const subtotal = place.subPlaces.reduce((sum, sub) => sum + walkPlaceVote(sub), 0);
    place.totalVoted = subtotal;
    place.votedFromHome = place.subPlaces.reduce((sum, sub) => sum + walkPlaceVoteFromHome(sub), 0);
    return subtotal;
  }
  const value = toNumber(place.voted, 0);
  const homeValue = toNumber(place.votedFromHome, 0);
  place.voted = value;
  place.totalVoted = value;
  place.votedFromHome = homeValue;
  return value;
}

function walkPlaceVoteFromHome(place) {
  if (!place || typeof place !== 'object') return 0;
  if (Array.isArray(place.subPlaces)) {
    const subtotal = place.subPlaces.reduce((sum, sub) => sum + walkPlaceVoteFromHome(sub), 0);
    place.votedFromHome = subtotal + toNumber(place.votedFromHome, 0);
    return place.votedFromHome;
  }
  const value = toNumber(place.votedFromHome, 0);
  place.votedFromHome = value;
  return value;
}

function syncConfigVoteTotals(node) {
  if (!node || typeof node !== 'object') return 0;

  let total = 0;

  if (Array.isArray(node.municipalities)) {
    node.municipalities.forEach((mun) => {
      if (!mun || typeof mun !== 'object') return;
      let munTotal = 0;
      (mun.places || []).forEach((place) => {
        if (!place || typeof place !== 'object') return;
        munTotal += walkPlaceVote(place);
      });
      mun.totalVoted = munTotal;
      mun.votedFromHome = (mun.places || []).reduce((sum, place) => sum + toNumber(place.votedFromHome, 0), 0);
      total += munTotal;
    });
  }

  if (Array.isArray(node.places)) {
    node.places.forEach((place) => {
      if (!place || typeof place !== 'object') return;
      if (Array.isArray(place.subPlaces)) {
        const subTotal = place.subPlaces.reduce((sum, sub) => sum + walkPlaceVote(sub), 0);
        place.totalVoted = subTotal;
        place.votedFromHome = place.subPlaces.reduce((sum, sub) => sum + toNumber(sub.votedFromHome, 0), 0);
        total += subTotal;
      } else {
        total += walkPlaceVote(place);
      }
    });
  }

  if (Array.isArray(node.regions)) {
    node.regions.forEach((region) => {
      total += syncConfigVoteTotals(region);
    });
  }

  if (Array.isArray(node.votingUnits)) {
    node.votingUnits.forEach((unit) => {
      total += syncConfigVoteTotals(unit);
    });
  }

  if (Array.isArray(node.subPlaces)) {
    node.subPlaces.forEach((sub) => {
      total += syncConfigVoteTotals(sub);
    });
  }

  node.totalVoted = total;
  node.votedFromHome = (Array.isArray(node.places) ? node.places.reduce((sum, place) => sum + toNumber(place.votedFromHome, 0), 0) : 0)
    + (Array.isArray(node.municipalities) ? node.municipalities.reduce((sum, mun) => sum + toNumber(mun.votedFromHome, 0), 0) : 0)
    + (Array.isArray(node.regions) ? node.regions.reduce((sum, region) => sum + toNumber(region.votedFromHome, 0), 0) : 0)
    + (Array.isArray(node.votingUnits) ? node.votingUnits.reduce((sum, unit) => sum + toNumber(unit.votedFromHome, 0), 0) : 0)
    + (Array.isArray(node.subPlaces) ? node.subPlaces.reduce((sum, sub) => sum + toNumber(sub.votedFromHome, 0), 0) : 0);
  return total;
}

function loadI18n() {
  try {
    if (!fs.existsSync(MULTILANG_PATH)) {
      return { defaultLanguage: 'sr', multiLanguage: {} };
    }
    const raw = fs.readFileSync(MULTILANG_PATH, 'utf8');
    const data = JSON.parse(raw);
    return {
      defaultLanguage: data.defaultLanguage || 'sr',
      multiLanguage: data.multiLanguage || {}
    };
  } catch (err) {
    console.warn('Failed to load multilang.json:', err.message);
    return { defaultLanguage: 'sr', multiLanguage: {} };
  }
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const cfg = JSON.parse(raw);
    const i18n = loadI18n();
    cfg.defaultLanguage = i18n.defaultLanguage || cfg.defaultLanguage || 'sr';
    cfg.multiLanguage = i18n.multiLanguage || cfg.multiLanguage || {};

    try {
      if (fs.existsSync(TEMPLATES_PATH)) {
        const rawTemplates = fs.readFileSync(TEMPLATES_PATH, 'utf8');
        const tjson = JSON.parse(rawTemplates);
        cfg.templates = tjson.templates || cfg.templates || [];
      }
    } catch (e) {
      console.warn('Failed to load templates.json, falling back to config templates if any');
      cfg.templates = cfg.templates || [];
    }

    syncConfigVoteTotals(cfg);
    return cfg;
  } catch (err) {
    console.error('Failed to load config.json:', err.message);
    return { regions: [], templates: [], defaultLanguage: 'sr', multiLanguage: loadI18n().multiLanguage || {} };
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

function getI18nUiString(languageCode, key, fallback = '') {
  const i18n = loadI18n();
  const language = i18n && i18n.multiLanguage && i18n.multiLanguage[languageCode]
    ? i18n.multiLanguage[languageCode]
    : null;
  const ui = language && language.ui && typeof language.ui === 'object' ? language.ui : null;
  const value = ui && typeof ui[key] === 'string' ? ui[key].trim() : '';
  return value || fallback;
}

function fillTemplate(template, replacements) {
  return String(template || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
    if (!Object.prototype.hasOwnProperty.call(replacements, key)) return '';
    return String(replacements[key] == null ? '' : replacements[key]);
  });
}

function normalizeNameForCompare(value) {
  return String(value || '').trim().toLocaleLowerCase('sr');
}

module.exports = {
  DATA_DIR,
  CONFIG_PATH,
  MULTILANG_PATH,
  TEMPLATES_PATH,
  toNumber,
  walkPlaceVote,
  syncConfigVoteTotals,
  loadI18n,
  loadConfig,
  saveConfig,
  getI18nUiString,
  fillTemplate,
  normalizeNameForCompare
};
