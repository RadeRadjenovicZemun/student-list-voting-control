const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec, spawn } = require('child_process');
const net = require('net');
const messageModules = require('./server/messages');

const app = express();
app.use(express.json());

const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const SIGNAL_PATH = path.join(DATA_DIR, 'signal.json');
const GENERAL_CONFIG_PATH = path.join(DATA_DIR, 'general-config.json');
const I18N_PATH = path.join(DATA_DIR, 'multilang.json');
const TEMPLATES_PATH = path.join(DATA_DIR, 'templates.json');
const MESSAGES_PATH = path.join(DATA_DIR, 'messages.json');
const SIGNAL_RAW_MESSAGES_PATH = path.join(DATA_DIR, 'signal-raw-messages.json');
const IRREGULARITIES_PATH = path.join(DATA_DIR, 'irregularities.json');
const IRREGULARITIES_MEDIA_DIR = path.join(DATA_DIR, 'irregularities');
const ZAP_RECORDS_PATH = path.join(DATA_DIR, 'zap_records.json');
const ZAP_MEDIA_DIR = path.join(DATA_DIR, 'zap_records');

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
    node.municipalities.forEach(mun => {
      if (!mun || typeof mun !== 'object') return;
      let munTotal = 0;
      (mun.places || []).forEach(place => {
        if (!place || typeof place !== 'object') return;
        const placeTotal = walkPlaceVote(place);
        munTotal += placeTotal;
      });
      mun.totalVoted = munTotal;
      mun.votedFromHome = (mun.places || []).reduce((sum, place) => sum + toNumber(place.votedFromHome, 0), 0);
      total += munTotal;
    });
  }

  if (Array.isArray(node.places)) {
    node.places.forEach(place => {
      if (!place || typeof place !== 'object') return;
      if (Array.isArray(place.subPlaces)) {
        const subTotal = place.subPlaces.reduce((sum, sub) => sum + walkPlaceVote(sub), 0);
        place.totalVoted = subTotal;
        place.votedFromHome = place.subPlaces.reduce((sum, sub) => sum + toNumber(sub.votedFromHome, 0), 0);
        total += subTotal;
      } else {
        const placeTotal = walkPlaceVote(place);
        total += placeTotal;
      }
    });
  }

  if (Array.isArray(node.regions)) {
    node.regions.forEach(region => {
      total += syncConfigVoteTotals(region);
    });
  }

  if (Array.isArray(node.votingUnits)) {
    node.votingUnits.forEach(unit => {
      total += syncConfigVoteTotals(unit);
    });
  }

  if (Array.isArray(node.subPlaces)) {
    node.subPlaces.forEach(sub => {
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

function syncConfigResultTotals(config) {
  const templates = Array.isArray(config && config.result && config.result.candidateVotes)
    ? config.result.candidateVotes
    : [];
  const candidateIds = templates.map((candidate) => String(candidate.id));

  function merge(target, source) {
    source.forEach((votes, id) => target.set(id, (target.get(id) || 0) + votes));
  }

  function visit(node) {
    if (!node || typeof node !== 'object') return new Map();

    const children = [];
    (node.municipalities || []).forEach((child) => children.push(child));
    (node.regions || []).forEach((child) => children.push(child));
    (node.votingUnits || []).forEach((child) => children.push(child));
    (node.places || []).forEach((place) => {
      if (Array.isArray(place.subPlaces) && place.subPlaces.length) place.subPlaces.forEach((child) => children.push(child));
      else children.push(place);
    });

    if (!children.length) {
      node.result = node.result && typeof node.result === 'object' ? node.result : {};
      node.result.nonRegularBallots = toNumber(node.result.nonRegularBallots, 0);
      node.result.remainingBallots = toNumber(node.result.remainingBallots, 0);
      return new Map((node.result && node.result.candidateVotes || []).map((candidate) => [
        String(candidate.id),
        toNumber(candidate.votes, 0)
      ]));
    }

    const totals = new Map(candidateIds.map((id) => [id, 0]));
    children.forEach((child) => merge(totals, visit(child)));
    const existing = new Map((node.result && node.result.candidateVotes || []).map((candidate) => [String(candidate.id), candidate]));
    node.result = node.result && typeof node.result === 'object' ? node.result : {};
    node.result.candidateVotes = candidateIds.map((id) => {
      const source = existing.get(id) || templates.find((candidate) => String(candidate.id) === id) || { id };
      return { ...source, id, votes: totals.get(id) || 0 };
    });
    node.result.nonRegularBallots = children.reduce((sum, child) => sum + toNumber(child.result && child.result.nonRegularBallots, 0), 0);
    node.result.remainingBallots = children.reduce((sum, child) => sum + toNumber(child.result && child.result.remainingBallots, 0), 0);
    return totals;
  }

  visit(config);
}

function loadI18n() {
  try {
    if (!fs.existsSync(I18N_PATH)) {
      return { defaultLanguage: 'sr', multiLanguage: {}, senderStatuses: [] };
    }
    const raw = fs.readFileSync(I18N_PATH, 'utf8');
    const data = JSON.parse(raw);
    return {
      defaultLanguage: data.defaultLanguage || 'sr',
      multiLanguage: data.multiLanguage || {},
      senderStatuses: data.senderStatuses || []
    };
  } catch (err) {
    console.warn('Failed to load multilang.json:', err.message);
    return { defaultLanguage: 'sr', multiLanguage: {}, senderStatuses: [] };
  }
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const cfg = JSON.parse(raw);
    const i18n = loadI18n();
    cfg.defaultLanguage = i18n.defaultLanguage || cfg.defaultLanguage || 'sr';
    cfg.multiLanguage = i18n.multiLanguage || cfg.multiLanguage || {};
    cfg.senderStatuses = i18n.senderStatuses && i18n.senderStatuses.length ? i18n.senderStatuses : (cfg.senderStatuses || []);
    // load templates from separate file if present
    try {
      if (fs.existsSync(TEMPLATES_PATH)) {
        const rawT = fs.readFileSync(TEMPLATES_PATH, 'utf8');
        const tjson = JSON.parse(rawT);
        cfg.templates = tjson.templates || cfg.templates || [];
      }
    } catch (e) {
      console.warn('Failed to load templates.json, falling back to config templates if any');
      cfg.templates = cfg.templates || [];
    }
    syncConfigVoteTotals(cfg);
    const resultTreeBeforeSync = JSON.stringify(cfg.result || null);
    syncConfigResultTotals(cfg);
    if (JSON.stringify(cfg.result || null) !== resultTreeBeforeSync) {
      saveConfig(cfg);
    }
    return cfg;
  } catch (err) {
    console.error('Failed to load config.json:', err.message);
    { const i18n = loadI18n(); return { regions: [], templates: [], defaultLanguage: 'sr', multiLanguage: i18n.multiLanguage || {}, senderStatuses: i18n.senderStatuses || [] }; }
  }
}

function defaultGeneralConfig() {
  return {
    heartbeatMinutes: 1
  };
}

function loadGeneralConfig() {
  try {
    if (!fs.existsSync(GENERAL_CONFIG_PATH)) {
      fs.writeFileSync(GENERAL_CONFIG_PATH, JSON.stringify(defaultGeneralConfig(), null, 2), 'utf8');
    }
    const raw = fs.readFileSync(GENERAL_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const heartbeatMinutes = Number(parsed.heartbeatMinutes);
    const safeMinutes = Number.isFinite(heartbeatMinutes) && heartbeatMinutes > 0 ? heartbeatMinutes : 1;
    return { heartbeatMinutes: safeMinutes };
  } catch (err) {
    console.warn('Failed to load general-config.json, using defaults:', err.message);
    return defaultGeneralConfig();
  }
}

function getSignalHeartbeatTimeoutMs() {
  const settings = loadGeneralConfig();
  return Math.max(60000, Number(settings.heartbeatMinutes || 1) * 60 * 1000);
}

function detectSignalProcess() {
  return new Promise((resolve) => {
    exec('ps -eo comm --no-headers', (error, stdout) => {
      if (error || !stdout) {
        return resolve(false);
      }

      const processNames = new Set([
        'signal',
        'signal-desktop',
        'signal-desktop-linux',
        'signal-beta',
        'signal.exe'
      ]);

      const isRunning = stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .some((line) => processNames.has(String(line).trim().toLowerCase()));

      resolve(isRunning);
    });
  });
}

function findSignalCliBinary() {
  return new Promise((resolve) => {
    exec("command -v signal-cli || command -v signal || command -v signal-desktop || command -v signal-cli.exe || command -v signal.exe || which signal-cli || which signal || which signal-desktop", (error, stdout) => {
      if (error || !stdout) {
        return resolve(null);
      }
      const binary = stdout.split(/\r?\n/).map(line => line.trim()).find(Boolean);
      resolve(binary || null);
    });
  });
}

function parseSignalGroupList(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => {
          const id = entry && (entry.id || entry.groupId || entry.name || entry.group_name || entry.groupName);
          const name = entry && (entry.name || entry.groupName || entry.group_name || id || 'Signal Group');
          return id ? { id: String(id), name: String(name) } : null;
        })
        .filter(Boolean);
    }
    if (parsed && Array.isArray(parsed.groups)) {
      return parsed.groups
        .map((entry) => {
          const id = entry && (entry.id || entry.groupId || entry.name || entry.group_name || entry.groupName);
          const name = entry && (entry.name || entry.groupName || entry.group_name || id || 'Signal Group');
          return id ? { id: String(id), name: String(name) } : null;
        })
        .filter(Boolean);
    }
  } catch (err) {
    // Fall through to textual parsing when JSON is not available.
  }

  const lines = trimmed.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const groups = [];
  lines.forEach((line) => {
    const match = line.match(/(?:id|groupId|group_id)\s*[:=]\s*['"]?([^'"\s,]+)['"]?/i) || line.match(/(?:name|groupName|group_name)\s*[:=]\s*['"]?([^'"\s,]+)['"]?/i);
    if (!match) return;
    const value = match[1];
    if (!value) return;
    const existing = groups.find(group => group.id === value || group.name === value);
    if (!existing) {
      groups.push({ id: value, name: value });
    }
  });

  return groups;
}

async function loadSignalGroupsFromBridge() {
  const daemonResult = await new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: 7583 });
    let settled = false;
    let buffer = '';
    let connected = false;
    let sawListGroupsResponse = false;

    const finish = (groups) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch (err) {
        // ignore socket close errors
      }
      resolve({ connected, sawListGroupsResponse, groups });
    };

    socket.setTimeout(4000);
    socket.on('connect', () => {
      connected = true;
      socket.write(JSON.stringify({ jsonrpc: '2.0', method: 'listGroups', id: 1 }) + '\n');
    });
    socket.on('data', (chunk) => {
      buffer += String(chunk || '');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const payload = JSON.parse(line);
          if (payload && Object.prototype.hasOwnProperty.call(payload, 'result')) {
            sawListGroupsResponse = true;
          }
          const parsed = parseSignalGroupList(JSON.stringify(payload && payload.result ? payload.result : payload));
          finish(parsed);
          return;
        } catch (err) {
          // ignore malformed daemon line and keep listening
        }
      }
    });
    socket.on('timeout', () => finish([]));
    socket.on('error', () => finish([]));
    socket.on('end', () => finish([]));
  });

  if (daemonResult.connected && daemonResult.sawListGroupsResponse) {
    return { available: true, groups: daemonResult.groups };
  }

  const binary = await findSignalCliBinary();
  if (!binary) {
    return { available: false, groups: [] };
  }

  const commands = [
    `${binary} --output json listGroups`,
    `${binary} listGroups --output json`,
    `${binary} --json listGroups`,
    `${binary} listGroups`,
    `${binary} -o json listGroups`
  ];

  for (const command of commands) {
    try {
      const stdout = await new Promise((resolve, reject) => {
        exec(command, { timeout: 15000 }, (error, stdout) => {
          if (error && !stdout) {
            reject(error);
            return;
          }
          resolve(stdout || '');
        });
      });
      const parsed = parseSignalGroupList(stdout);
      if (parsed.length) {
        return { available: true, groups: parsed };
      }
    } catch (err) {
      // Try next candidate command.
    }
  }

  return { available: true, groups: [] };
}

function defaultSignalConfig() {
  return {
    enabled: true,
    connected: false,
    selectedGroupId: null,
    groups: [],
    lastCheck: null,
    lastHeartbeatAt: null,
    lastMessage: 'Signal app is not running; bridge is waiting for an active connection.'
  };
}

function normalizeSignalGroups(groups) {
  if (!Array.isArray(groups) || !groups.length) return [];
  return groups.map((group) => ({
    id: String(group.id || 'group-' + Math.random().toString(36).slice(2, 8)),
    name: String(group.name || 'Signal Group')
  }));
}

function loadSignalConfig() {
  try {
    if (!fs.existsSync(SIGNAL_PATH)) {
      fs.writeFileSync(SIGNAL_PATH, JSON.stringify(defaultSignalConfig(), null, 2), 'utf8');
    }
    const raw = fs.readFileSync(SIGNAL_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const fallback = defaultSignalConfig();

    const groups = normalizeSignalGroups(parsed.groups) || fallback.groups;
    const selectedGroupId = parsed.selectedGroupId && groups.some(group => group.id === parsed.selectedGroupId)
      ? parsed.selectedGroupId
      : null;

    return {
      enabled: parsed.enabled !== false,
      connected: Boolean(parsed.connected),
      selectedGroupId,
      groups,
      lastCheck: parsed.lastCheck || null,
      lastHeartbeatAt: parsed.lastHeartbeatAt || null,
      lastMessage: parsed.lastMessage || 'Signal app is not running; bridge is waiting for an active connection.'
    };
  } catch (err) {
    console.error('Failed to load signal.json:', err.message);
    return defaultSignalConfig();
  }
}

function saveSignalConfig(config) {
  fs.writeFileSync(SIGNAL_PATH, JSON.stringify(config, null, 2), 'utf8');
}

function loadMessages() {
  try {
    if (!fs.existsSync(MESSAGES_PATH)) {
      fs.writeFileSync(MESSAGES_PATH, '[]', 'utf8');
    }
    const raw = fs.readFileSync(MESSAGES_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load messages.json:', err.message);
    return [];
  }
}

function saveMessages(arr) {
  fs.writeFileSync(MESSAGES_PATH, JSON.stringify(arr, null, 2), 'utf8');
}

function loadSignalRawMessages() {
  try {
    if (!fs.existsSync(SIGNAL_RAW_MESSAGES_PATH)) {
      fs.writeFileSync(SIGNAL_RAW_MESSAGES_PATH, '[]', 'utf8');
    }
    const raw = fs.readFileSync(SIGNAL_RAW_MESSAGES_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load signal-raw-messages.json:', err.message);
    return [];
  }
}

function saveSignalRawMessages(arr) {
  fs.writeFileSync(SIGNAL_RAW_MESSAGES_PATH, JSON.stringify(arr, null, 2), 'utf8');
}

function loadIrregularities() {
  try {
    if (!fs.existsSync(IRREGULARITIES_PATH)) fs.writeFileSync(IRREGULARITIES_PATH, '[]', 'utf8');
    const parsed = JSON.parse(fs.readFileSync(IRREGULARITIES_PATH, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to load irregularities.json:', err.message);
    return [];
  }
}

function saveIrregularities(records) {
  fs.writeFileSync(IRREGULARITIES_PATH, JSON.stringify(records, null, 2), 'utf8');
}

function loadZapRecords() {
  try {
    if (!fs.existsSync(ZAP_RECORDS_PATH)) fs.writeFileSync(ZAP_RECORDS_PATH, '[]', 'utf8');
    const parsed = JSON.parse(fs.readFileSync(ZAP_RECORDS_PATH, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to load zap_records.json:', err.message);
    return [];
  }
}

function saveZapRecords(records) {
  fs.writeFileSync(ZAP_RECORDS_PATH, JSON.stringify(records, null, 2), 'utf8');
}

function storeZapAttachments(recordId, attachments) {
  fs.mkdirSync(ZAP_MEDIA_DIR, { recursive: true });
  return (Array.isArray(attachments) ? attachments : []).map((attachment, index) => {
    const sourcePath = getAttachmentSourcePath(attachment);
    const data = decodeAttachmentData(attachment);
    const extension = getAttachmentExtension(attachment);
    const storedFilename = `${recordId}-${index}${extension}`;
    const storedPath = path.join(ZAP_MEDIA_DIR, storedFilename);
    try {
      if (sourcePath) fs.copyFileSync(sourcePath, storedPath);
      else if (data && data.length) fs.writeFileSync(storedPath, data);
    } catch (err) {
      console.warn('Failed to store Zap attachment:', err.message);
    }
    return {
      contentType: String(attachment && attachment.contentType || 'application/octet-stream'),
      filename: String(attachment && attachment.filename || storedFilename),
      signalId: attachment && attachment.signalId ? String(attachment.signalId) : null,
      size: toNumber(attachment && attachment.size, data ? data.length : 0),
      storedFilename: fs.existsSync(storedPath) ? storedFilename : null
    };
  });
}

function saveZapRecord({ sender, senderNumber, groupId, groupName, region, municipality, place, attachments }) {
  const id = crypto.randomBytes(8).toString('hex') + '-' + Date.now();
  const records = loadZapRecords().filter((item) => {
    const sameNumber = senderNumber && item.senderNumber && String(item.senderNumber) === String(senderNumber);
    const sameSender = sender && item.sender && String(item.sender).trim() === String(sender).trim();
    return !(sameNumber || sameSender);
  });
  const record = { id, sender: sender || null, senderNumber: senderNumber || null, region: region || null, municipality: municipality || null, place: place || null, groupId: groupId || null, groupName: groupName || null, receivedAt: new Date().toISOString(), attachments: storeZapAttachments(id, attachments) };
  records.push(record);
  saveZapRecords(records);
  return record;
}

function getAttachmentExtension(attachment) {
  const contentType = String(attachment && attachment.contentType || '').toLowerCase();
  const known = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.heic' };
  if (known[contentType]) return known[contentType];
  const filename = String(attachment && attachment.filename || '');
  const extension = path.extname(filename).toLowerCase();
  return extension && extension.length <= 8 ? extension : '.bin';
}

function getAttachmentSourcePath(attachment) {
  if (!attachment || typeof attachment !== 'object') return null;
  const candidates = [attachment.path, attachment.filename, attachment.filePath, attachment.filepath]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return candidates.find((value) => {
    try { return fs.existsSync(value) && fs.statSync(value).isFile(); } catch (err) { return false; }
  }) || null;
}

function decodeAttachmentData(attachment) {
  if (!attachment || typeof attachment !== 'object' || typeof attachment.data !== 'string') return null;
  const raw = attachment.data.replace(/^data:[^;]+;base64,/, '');
  try { return Buffer.from(raw, 'base64'); } catch (err) { return null; }
}

function storeIrregularityAttachments(recordId, attachments) {
  fs.mkdirSync(IRREGULARITIES_MEDIA_DIR, { recursive: true });
  return (Array.isArray(attachments) ? attachments : []).map((attachment, index) => {
    const sourcePath = getAttachmentSourcePath(attachment);
    const data = decodeAttachmentData(attachment);
    const extension = getAttachmentExtension(attachment);
    const storedFilename = `${recordId}-${index}${extension}`;
    const storedPath = path.join(IRREGULARITIES_MEDIA_DIR, storedFilename);
    try {
      if (sourcePath) fs.copyFileSync(sourcePath, storedPath);
      else if (data && data.length) fs.writeFileSync(storedPath, data);
    } catch (err) {
      console.warn('Failed to store irregularity attachment:', err.message);
    }
    return {
      contentType: String(attachment && attachment.contentType || 'application/octet-stream'),
      filename: String(attachment && attachment.filename || storedFilename),
      signalId: attachment && attachment.signalId ? String(attachment.signalId) : null,
      size: toNumber(attachment && attachment.size, data ? data.length : 0),
      storedFilename: fs.existsSync(storedPath) ? storedFilename : null
    };
  });
}

function addIrregularity({ sender, explanation, attachments, senderNumber, groupId, groupName, region, municipality, place }) {
  const id = crypto.randomBytes(8).toString('hex') + '-' + Date.now();
  const records = loadIrregularities();
  const record = {
    id,
    sender: sender || null,
    senderNumber: senderNumber || null,
    explanation: String(explanation || '').trim(),
    region: region || null,
    municipality: municipality || null,
    place: place || null,
    groupId: groupId || null,
    groupName: groupName || null,
    receivedAt: new Date().toISOString(),
    attachments: storeIrregularityAttachments(id, attachments)
  };
  records.push(record);
  saveIrregularities(records);
  return record;
}

function formatRawSignalPayload(payload) {
  if (typeof payload === 'string') return payload;
  if (payload == null) return '';
  try {
    return JSON.stringify(payload, null, 2);
  } catch (err) {
    return String(payload);
  }
}

function addRawSignalMessage({ direction, rawPayload, groupId = null, groupName = null, source = 'signal-daemon-jsonrpc' }) {
  const rawMessages = loadSignalRawMessages();
  const record = {
    id: crypto.randomBytes(6).toString('hex') + '-' + Date.now(),
    direction: direction === 'outgoing' ? 'outgoing' : 'incoming',
    source,
    groupId,
    groupName,
    receivedAt: new Date().toISOString(),
    rawPayload: formatRawSignalPayload(rawPayload)
  };
  rawMessages.push(record);
  if (rawMessages.length > 2000) {
    rawMessages.splice(0, rawMessages.length - 2000);
  }
  saveSignalRawMessages(rawMessages);
  return record;
}

function isRecentServerOutgoingSignalMessage(text, groupId) {
  const normalizedText = String(text || '').trim();
  if (!normalizedText) return false;
  const cutoff = Date.now() - 120000;
  return loadSignalRawMessages().some((record) => {
    if (record.direction !== 'outgoing' || record.source !== 'local-server-send') return false;
    if (new Date(record.receivedAt).getTime() < cutoff) return false;
    if (record.groupId !== groupId) return false;
    try {
      const payload = JSON.parse(record.rawPayload || '{}');
      return String(payload.params && payload.params.message || '').trim() === normalizedText;
    } catch (err) {
      return false;
    }
  });
}

function saveConfig(config) {
  // multiLanguage/defaultLanguage/templates/senderStatuses are sourced from multilang.json/templates.json
  // and merged into the in-memory config at load time; never persist them back into config.json.
  const { multiLanguage, defaultLanguage, templates, senderStatuses, ...persisted } = config;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(persisted, null, 2), 'utf8');
}

function addAcceptedSignalRecord({ sender, text, groupId, groupName, direction = 'incoming', region = null, place = null, type = 'signal', payload = {} }) {
  const messages = loadMessages();
  const record = {
    id: crypto.randomBytes(6).toString('hex') + '-' + Date.now(),
    sender: sender || 'local-backend',
    region,
    place,
    type,
    payload,
    rawMessage: text,
    receivedAt: new Date().toISOString(),
    direction,
    groupId,
    groupName
  };
  messages.push(record);
  saveMessages(messages);
  return record;
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

function getI18nCommandHelp(languageCode, commandName) {
  const i18n = loadI18n();
  const language = i18n && i18n.multiLanguage && i18n.multiLanguage[languageCode]
    ? i18n.multiLanguage[languageCode]
    : null;
  const ui = language && language.ui && typeof language.ui === 'object' ? language.ui : null;
  const table = ui && ui.signalCommandHelp && typeof ui.signalCommandHelp === 'object' ? ui.signalCommandHelp : null;
  if (!table) return null;
  const normalized = String(commandName || '').trim().toLowerCase();
  if (!normalized) return null;
  const key = Object.keys(table).find((k) => k.toLowerCase() === normalized);
  if (!key) return null;
  const entry = table[key] || {};
  return {
    name: key,
    description: String(entry.description || ''),
    format: String(entry.format || ''),
    example: String(entry.example || '')
  };
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

async function sendSignalReply({ groupId, recipientNumber, messageText }) {
  if (!messageText) {
    return { ok: false, reason: 'missing-message' };
  }

  const params = { message: messageText };
  if (recipientNumber) {
    params.recipient = recipientNumber;
  } else if (groupId) {
    params.groupId = groupId;
  } else {
    return { ok: false, reason: 'missing-recipient-target' };
  }

  addRawSignalMessage({
    direction: 'outgoing',
    rawPayload: { method: 'send', params },
    groupId: groupId || null,
    source: 'local-server-send'
  });

  const response = await querySignalDaemon('send', params, 10000);
  if (!response) {
    return { ok: false, reason: 'bridge-unreachable' };
  }
  if (response.error) {
    return { ok: false, reason: String(response.error.message || 'bridge-send-failed') };
  }
  return { ok: true, response };
}

const buildRegistrationAcceptedReply = (...args) => messageModules.registerController.buildRegistrationAcceptedReply(...args);
const buildRegistrationQueryReply = (...args) => messageModules.registerController.buildRegistrationQueryReply(...args);
const findRegisteredController = (...args) => messageModules.registerController.findSenderRegistration(...args);

const buildIzlaznostAcceptedReply = (...args) => messageModules.izlaznost.buildIzlaznostAcceptedReply(...args);
const buildIzlaznostQueryReply = (...args) => messageModules.izlaznost.buildIzlaznostQueryReply(...args);

const STATUS_CODE_MAP = messageModules.status.STATUS_CODE_MAP;

const buildStatusAcceptedReply = (...args) => messageModules.status.buildStatusAcceptedReply(...args);

const parseRezPairs = (...args) => messageModules.rezultati.parseRezPairs(...args);

const buildRezultatiAcceptedReply = (...args) => messageModules.rezultati.buildRezultatiAcceptedReply(...args);

async function handleIncomingMessageProcessing({ sender, senderNumber = null, text, attachments = [], groupId, groupName, direction = 'incoming', region = null, place = null }) {
  const config = loadConfig();
  const matched = matchTemplates(config, text);
  if (!matched) {
    const senderCfg = findSenderConfig(config, sender);
    if (!senderCfg) {
      return { accepted: false, reason: 'sender-not-allowed' };
    }
    return { accepted: false, reason: 'no-template-match' };
  }

  if (matched.type === 'register-controller') {
    const placeId = String(matched.fields.placeId || '').trim();
    if (!placeId) {
      const registration = findRegisteredController(config, sender);
      const i18n = config.multiLanguage || {};
      const templateKey = registration
        ? 'signalRegistrationQueryReply'
        : 'signalRegistrationNotRegisteredReply';
      const fallback = registration
        ? 'Регистровани сте као контролор на бирачком месту,\n"{placeName}".\nБрој регистрованих бирача је **{registeredVoters}**.'
        : 'Нисте регистровани ни на једном бирачком месту.';
      const replyText = registration
        ? buildRegistrationQueryReply(registration, {
          prependRecipientName: !senderNumber && Boolean(groupId),
          recipientName: sender
        })
        : fillTemplate(getI18nUiString('sr', templateKey, fallback), {});
      const finalReplyText = !registration && !senderNumber && groupId && sender
        ? `${sender}, ${replyText}`
        : replyText;
      if (senderNumber || groupId) {
        await sendSignalReply({ groupId, recipientNumber: senderNumber, messageText: finalReplyText });
      }
      return { accepted: Boolean(registration), queryOnly: true, registered: Boolean(registration) };
    }
    const registration = applyRegistrationMessage(config, sender, placeId);
    if (!registration.ok) {
      console.warn('Registration failed:', registration.reason, 'placeId=', placeId, 'sender=', sender);
      const i18n = config.multiLanguage || {};
      let rejectText = null;

      if (registration.reason === 'sender-already-registered' || registration.reason === 'place-already-taken') {
        const reg = registration.existingReg;
        const locationParts = [`"${reg.placeName}"`];
        if (reg.municipalityName && reg.regionName &&
            normalizeNameForCompare(reg.municipalityName) !== normalizeNameForCompare(reg.regionName)) {
          locationParts.push(`"${reg.municipalityName}"`, `"${reg.regionName}"`);
        } else if (reg.municipalityName) {
          locationParts.push(`"${reg.municipalityName}"`);
        } else if (reg.regionName) {
          locationParts.push(`"${reg.regionName}"`);
        }
        const location = locationParts.join(', ');

        if (registration.reason === 'sender-already-registered') {
          const template = getI18nUiString('sr', 'signalRegAlreadyRegisteredReply',
            'Регистрација није прихваћена, већ сте регистровани за бирачко место {location}.');
          rejectText = fillTemplate(template, { location });
        } else {
          const template = getI18nUiString('sr', 'signalRegPlaceTakenReply',
            'Регистрација за {location} није прихваћена, други контролор је већ регистрован за ово бирачко место.');
          rejectText = fillTemplate(template, { location });
        }

        if (!senderNumber && groupId && sender) rejectText = `${sender}, ${rejectText}`;
        if (senderNumber || groupId) {
          await sendSignalReply({ groupId, recipientNumber: senderNumber, messageText: rejectText });
        }
      }

      if (!rejectText) {
        const template = getI18nUiString('sr', 'signalRegistrationFailedReply',
          'Регистрација није прихваћена. Проверите ID бирачког места и покушајте поново.');
        rejectText = fillTemplate(template, { placeId });
        if (!senderNumber && groupId && sender) rejectText = `${sender}, ${rejectText}`;
        if (senderNumber || groupId) {
          await sendSignalReply({ groupId, recipientNumber: senderNumber, messageText: rejectText });
        }
      }

      return { accepted: false, reason: registration.reason || 'register-controller-failed' };
    }

    const record = addAcceptedSignalRecord({
      sender,
      text,
      groupId,
      groupName,
      direction,
      region,
      place,
      type: matched.type,
      payload: { placeId }
    });

    const replyText = buildRegistrationAcceptedReply(registration, {
      prependRecipientName: !senderNumber && Boolean(groupId),
      recipientName: sender
    });
    let replyStatus = { ok: false, reason: 'reply-target-not-available' };
    if (senderNumber || groupId) {
      replyStatus = await sendSignalReply({ groupId, recipientNumber: senderNumber, messageText: replyText });
    }

    if (replyStatus.ok) {
      addAcceptedSignalRecord({
        sender: 'local-backend',
        text: replyText,
        groupId,
        groupName,
        direction: 'outgoing',
        region: registration.regionName || null,
        place: registration.placeName || null,
        type: 'register-controller-reply',
        payload: {
          placeId: registration.placeId,
          municipality: registration.municipalityName || null,
          signalSender: registration.sender || null,
          replyTarget: senderNumber || groupId || null
        }
      });
    } else {
      console.warn('Registration reply could not be sent:', replyStatus.reason || 'unknown-error');
    }

    return { accepted: true, record, configUpdated: true, replySent: Boolean(replyStatus.ok) };
  }

  const senderCfg = findSenderConfig(config, sender);
  if (!senderCfg) {
    const i18n = loadI18n();
    const msg = (i18n.multiLanguage && i18n.multiLanguage.sr && i18n.multiLanguage.sr.ui &&
      i18n.multiLanguage.sr.ui.signalNotRegisteredReply) ||
      'Да бисте послали захтев, морате се прво регистровати!';
    const replyText = (!senderNumber && groupId) ? `${sender}, ${msg}` : msg;
    if (senderNumber || groupId) {
      await sendSignalReply({ groupId, recipientNumber: senderNumber, messageText: replyText });
    }
    return { accepted: false, reason: 'sender-not-registered' };
  }

  const votePlace = findPlaceConfigBySender(config, senderCfg.region, senderCfg.municipality, senderCfg.place);
  if (votePlace && String(votePlace.senderStatus) === '0' && matched.type !== 'status' && matched.type !== 'help' && matched.type !== 'irregularity') {
    const i18n = loadI18n();
    const msg = (i18n.multiLanguage && i18n.multiLanguage.sr && i18n.multiLanguage.sr.ui &&
      i18n.multiLanguage.sr.ui.signalStatusZeroReply) ||
      'Да бисте послали захтев, прво промените свој статус!';
    const replyText = (!senderNumber && groupId) ? `${sender}, ${msg}` : msg;
    if (senderNumber || groupId) {
      await sendSignalReply({ groupId, recipientNumber: senderNumber, messageText: replyText });
    }
    return { accepted: false, reason: 'sender-status-zero' };
  }

  if (matched.type === 'zapRecord') {
    const placeName = senderCfg.place || senderCfg.parentPlace || 'непознато место';
    const municipalityName = senderCfg.municipality || senderCfg.region || 'непозната општина';
    const zapRecords = loadZapRecords();
    const existing = zapRecords.find((item) => {
      const sameNumber = senderNumber && item.senderNumber && String(item.senderNumber) === String(senderNumber);
      const sameSender = sender && item.sender && String(item.sender).trim() === String(sender).trim();
      return sameNumber || sameSender;
    });
    if (String(votePlace && votePlace.senderStatus || '') !== '6') {
      const template = getI18nUiString('sr', 'signalZapStatusRequiredReply', 'За бирачко место "{placeName}", "{municipalityName}" прво промените статус у Zap командом: Sta: Zap.');
      const replyText = fillTemplate(template, { placeName, municipalityName });
      if (senderNumber || groupId) await sendSignalReply({ groupId, recipientNumber: senderNumber, messageText: replyText });
      return { accepted: false, reason: 'zap-status-required', statusRequired: true };
    }
    const imageAttachments = attachments.filter((attachment) => String(attachment && attachment.contentType || '').toLowerCase().startsWith('image/'));
    if (!imageAttachments.length) {
      const message = existing ? 'Записник је већ послат.' : 'Записник још није послат.';
      const template = getI18nUiString('sr', 'signalZapQueryReply', 'За бирачко место "{placeName}", "{municipalityName}": {message}');
      const replyText = fillTemplate(template, { placeName, municipalityName, message });
      if (senderNumber || groupId) await sendSignalReply({ groupId, recipientNumber: senderNumber, messageText: replyText });
      return { accepted: true, queryOnly: true, alreadySent: Boolean(existing) };
    }
    const zapRecord = saveZapRecord({ sender, senderNumber, groupId, groupName, region: senderCfg.region, municipality: senderCfg.municipality || senderCfg.region, place: senderCfg.place || senderCfg.parentPlace, attachments: imageAttachments });
    const template = getI18nUiString('sr', 'signalZapAcceptedReply', 'Записник са бирачког места "{placeName}", "{municipalityName}" је успешно евидентиран.');
    const replyText = fillTemplate(template, { placeName, municipalityName });
    if (senderNumber || groupId) await sendSignalReply({ groupId, recipientNumber: senderNumber, messageText: replyText });
    return { accepted: true, zapRecord, record: addAcceptedSignalRecord({ sender, text, groupId, groupName, direction, region: senderCfg.region, place: senderCfg.place || senderCfg.parentPlace, type: matched.type, payload: { zapRecordId: zapRecord.id } }) };
  }

  if (matched.type === 'irregularity') {
    const replyPlaceName = senderCfg.place || senderCfg.parentPlace || 'непознато место';
    const replyMunicipalityName = senderCfg.municipality || senderCfg.region || 'непозната општина';
    const senderRecords = loadIrregularities().filter((item) => {
      const sameNumber = senderNumber && item.senderNumber && String(item.senderNumber) === String(senderNumber);
      const sameSender = sender && item.sender && String(item.sender).trim() === String(sender).trim();
      return sameNumber || sameSender;
    });
    const explanation = String(matched.fields.explanation || '').trim();
    if (!explanation) {
      const replyText = getI18nUiString('sr', 'signalNepCountReply', 'За бирачко место "{placeName}", "{municipalityName}", евидентирано је неправилности: {count}.');
      const formattedReply = fillTemplate(replyText, {
        count: senderRecords.length,
        placeName: replyPlaceName,
        municipalityName: replyMunicipalityName
      });
      if (senderNumber || groupId) {
        const replyStatus = await sendSignalReply({ groupId, recipientNumber: senderNumber, messageText: formattedReply });
        if (replyStatus.ok) {
          addAcceptedSignalRecord({ sender: 'local-backend', text: formattedReply, groupId, groupName, direction: 'outgoing', region: senderCfg.region || null, place: senderCfg.place || null, type: 'irregularity-count-reply', payload: { count: senderRecords.length } });
        }
      }
      return { accepted: true, queryOnly: true, irregularityCount: senderRecords.length };
    }
    const imageAttachments = attachments.filter((attachment) => String(attachment && attachment.contentType || '').toLowerCase().startsWith('image/'));
    if (!imageAttachments.length) {
      const photoRequiredTemplate = getI18nUiString('sr', 'signalNepPhotoRequiredReply', 'Пријава неправилности за бирачко место "{placeName}", "{municipalityName}" није евидентирана. Уз команду Nep морате послати и фотографију.');
      const photoRequiredReply = fillTemplate(photoRequiredTemplate, {
        placeName: replyPlaceName,
        municipalityName: replyMunicipalityName
      });
      if (senderNumber || groupId) {
        const replyStatus = await sendSignalReply({ groupId, recipientNumber: senderNumber, messageText: photoRequiredReply });
        if (replyStatus.ok) {
          addAcceptedSignalRecord({ sender: 'local-backend', text: photoRequiredReply, groupId, groupName, direction: 'outgoing', region: senderCfg.region || null, place: senderCfg.place || senderCfg.parentPlace || null, type: 'irregularity-photo-required-reply', payload: { reason: 'irregularity-photo-required' } });
        }
      }
      return { accepted: false, reason: 'irregularity-photo-required', replySent: Boolean(senderNumber || groupId) };
    }
    const irregularity = addIrregularity({
      sender,
      senderNumber,
      explanation: matched.fields.explanation,
      attachments: imageAttachments,
      groupId,
      groupName,
      region: senderCfg.region,
      municipality: senderCfg.municipality,
      place: senderCfg.place
    });
    const record = addAcceptedSignalRecord({
      sender,
      text,
      groupId,
      groupName,
      direction,
      region: senderCfg.region,
      place: senderCfg.place,
      type: matched.type,
      payload: { irregularityId: irregularity.id, attachmentCount: imageAttachments.length }
    });
    const acceptedCount = senderRecords.length + 1;
    const acceptedReplyTemplate = getI18nUiString('sr', 'signalNepAcceptedReply', 'Неправилност је успешно евидентирана за бирачко место "{placeName}", "{municipalityName}". Укупно евидентираних неправилности на овом месту: {count}.');
    const acceptedReply = fillTemplate(acceptedReplyTemplate, {
      count: acceptedCount,
      placeName: replyPlaceName,
      municipalityName: replyMunicipalityName
    });
    if (senderNumber || groupId) {
      const replyStatus = await sendSignalReply({ groupId, recipientNumber: senderNumber, messageText: acceptedReply });
      if (replyStatus.ok) {
        addAcceptedSignalRecord({ sender: 'local-backend', text: acceptedReply, groupId, groupName, direction: 'outgoing', region: senderCfg.region || null, place: senderCfg.place || null, type: 'irregularity-accepted-reply', payload: { irregularityId: irregularity.id, count: acceptedCount } });
      }
    }
    return { accepted: true, record, irregularity };
  }

  if (matched.type === 'help') {
    const requestedName = String(matched.fields.commandName || '').trim();
    const commandNames = (Array.isArray(config.templates) ? config.templates : [])
      .map((t) => String(t.name || '').trim())
      .filter(Boolean);

    let replyText;
    if (requestedName) {
      const commandHelp = getI18nCommandHelp('sr', requestedName);
      if (commandHelp) {
        const template = getI18nUiString('sr', 'signalHelpDetailReply',
          'Команда: {name}\nОпис: {description}\nФормат: {format}\nПример: {example}');
        replyText = fillTemplate(template, commandHelp);
      } else {
        const template = getI18nUiString('sr', 'signalHelpUnknownCommand',
          "Непозната команда: {name}. Пошаљите '?:' за листу доступних команди.");
        replyText = fillTemplate(template, { name: requestedName });
      }
    } else {
      const commandsList = commandNames.join(', ');
      const template = getI18nUiString('sr', 'signalHelpReply', 'Доступне команде: {commands}');
      replyText = fillTemplate(template, { commands: commandsList });
    }
    if (!senderNumber && groupId) replyText = `${sender}, ${replyText}`;

    const record = addAcceptedSignalRecord({
      sender,
      text,
      groupId,
      groupName,
      direction,
      region: senderCfg.region,
      place: senderCfg.place,
      type: matched.type,
      payload: { commandName: requestedName || null }
    });

    if (senderNumber || groupId) {
      const replyStatus = await sendSignalReply({ groupId, recipientNumber: senderNumber, messageText: replyText });
      if (replyStatus.ok) {
        addAcceptedSignalRecord({
          sender: 'local-backend',
          text: replyText,
          groupId,
          groupName,
          direction: 'outgoing',
          region: senderCfg.region || null,
          place: senderCfg.place || null,
          type: 'help-reply',
          payload: { commands: commandNames, requestedCommand: requestedName || null }
        });
      } else {
        console.warn('Help reply could not be sent:', replyStatus.reason || 'unknown-error');
      }
    }

    return { accepted: true, record };
  }

  const parsedPayload = {};
  for (const [k, v] of Object.entries(matched.fields)) {
    if (k === 'count') {
      if (v === undefined || v === null || String(v).trim() === '') {
        continue;
      }
      const n = parseInt(v, 10);
      if (Number.isNaN(n)) {
        return { accepted: false, reason: 'invalid-count' };
      }
      parsedPayload[k] = n;
    } else if (k === 'homeCount') {
      if (v === undefined || v === null || String(v).trim() === '') {
        continue;
      }
      const n = parseInt(v, 10);
      if (Number.isNaN(n)) {
        return { accepted: false, reason: 'invalid-home-count' };
      }
      parsedPayload[k] = n;
    } else if (k === 'homeOnly') {
      if (v === undefined || v === null || String(v).trim() === '') {
        continue;
      }
      const n = parseInt(v, 10);
      if (Number.isNaN(n)) {
        return { accepted: false, reason: 'invalid-home-count' };
      }
      parsedPayload.homeCount = n;
    } else if (k === 'countOnly') {
      if (v === undefined || v === null || String(v).trim() === '') {
        continue;
      }
      const n = parseInt(v, 10);
      if (Number.isNaN(n)) {
        return { accepted: false, reason: 'invalid-count' };
      }
      parsedPayload.count = n;
    } else {
      parsedPayload[k] = v;
    }
  }

  const record = addAcceptedSignalRecord({
    sender,
    text,
    groupId,
    groupName,
    direction,
    region: senderCfg.region,
    place: senderCfg.place,
    type: matched.type,
    payload: parsedPayload
  });

  if (votePlace && matched.type === 'vote' && typeof parsedPayload.count === 'number') {
    votePlace.voted = toNumber(votePlace.voted, 0) + parsedPayload.count;
    syncConfigVoteTotals(config);
    try {
      saveConfig(config);
    } catch (err) {
      console.error('Failed to save config with updated vote totals:', err.message);
      return { accepted: false, reason: 'config-save-failed' };
    }
  }

  if (votePlace && matched.type === 'izlaznost') {
    const hasCountUpdate = (matched.fields.count !== undefined && matched.fields.count !== null && String(matched.fields.count).trim() !== '') ||
      (matched.fields.countOnly !== undefined && matched.fields.countOnly !== null && String(matched.fields.countOnly).trim() !== '');
    const hasHomeUpdate = (matched.fields.homeCount !== undefined && matched.fields.homeCount !== null && String(matched.fields.homeCount).trim() !== '') ||
      (matched.fields.homeOnly !== undefined && matched.fields.homeOnly !== null && String(matched.fields.homeOnly).trim() !== '');

    if (!hasCountUpdate && !hasHomeUpdate) {
      const responseCount = toNumber(votePlace.voted, 0);
      const responseFromHome = toNumber(votePlace.votedFromHome, 0);
      const replyText = buildIzlaznostQueryReply(senderCfg, {
        prependRecipientName: !senderNumber && Boolean(groupId),
        recipientName: sender,
        count: responseCount,
        homeCount: responseFromHome,
      });

      if (senderNumber || groupId) {
        const replyStatus = await sendSignalReply({ groupId, recipientNumber: senderNumber, messageText: replyText });
        if (replyStatus.ok) {
          addAcceptedSignalRecord({
            sender: 'local-backend',
            text: replyText,
            groupId,
            groupName,
            direction: 'outgoing',
            region: senderCfg.region || null,
            place: senderCfg.place || null,
            type: 'izlaznost-query-reply',
            payload: { count: responseCount, votedFromHome: responseFromHome, queryMode: true }
          });
        }
      }
      return { accepted: true, record, queryOnly: true };
    }

    const nextCount = hasCountUpdate ? toNumber(parsedPayload.count, 0) : toNumber(votePlace.voted, 0);
    const nextHomeCount = hasHomeUpdate ? toNumber(parsedPayload.homeCount, 0) : toNumber(votePlace.votedFromHome, 0);

    votePlace.voted = nextCount;
    if (hasCountUpdate || hasHomeUpdate) {
      votePlace.votedFromHome = nextHomeCount;
    }
    syncConfigVoteTotals(config);

    try {
      saveConfig(config);
    } catch (err) {
      console.error('Failed to save config with updated izlaznost totals:', err.message);
      return { accepted: false, reason: 'config-save-failed' };
    }

    const replyText = buildIzlaznostAcceptedReply({ ...senderCfg, place: votePlace }, {
      prependRecipientName: !senderNumber && Boolean(groupId),
      recipientName: sender,
      count: nextCount,
      homeCount: nextHomeCount
    });
    if (senderNumber || groupId) {
      const replyStatus = await sendSignalReply({ groupId, recipientNumber: senderNumber, messageText: replyText });
      if (replyStatus.ok) {
        addAcceptedSignalRecord({
          sender: 'local-backend',
          text: replyText,
          groupId,
          groupName,
          direction: 'outgoing',
          region: senderCfg.region || null,
          place: senderCfg.place || null,
          type: 'izlaznost-reply',
          payload: { count: nextCount, votedFromHome: nextHomeCount }
        });
      } else {
        console.warn('Izlaznost reply could not be sent:', replyStatus.reason || 'unknown-error');
      }
    }
  }

  if (votePlace && matched.type === 'status' && matched.fields.statusCode) {
    const rawCode = matched.fields.statusCode;
    // Normalize to title case (e.g. "zap" → "Zap") since regex uses i flag
    const statusCode = rawCode.charAt(0).toUpperCase() + rawCode.slice(1).toLowerCase();
    const numericId = STATUS_CODE_MAP[statusCode];
    if (!numericId) {
      return { accepted: false, reason: 'invalid-status-code' };
    }
    votePlace.senderStatus = numericId;
    try {
      saveConfig(config);
    } catch (err) {
      console.error('Failed to save config with updated senderStatus:', err.message);
      return { accepted: false, reason: 'config-save-failed' };
    }

    const replyText = buildStatusAcceptedReply(senderCfg, statusCode, {
      prependRecipientName: !senderNumber && Boolean(groupId),
      recipientName: sender
    });
    if (senderNumber || groupId) {
      const replyStatus = await sendSignalReply({ groupId, recipientNumber: senderNumber, messageText: replyText });
      if (replyStatus.ok) {
        addAcceptedSignalRecord({
          sender: 'local-backend',
          text: replyText,
          groupId,
          groupName,
          direction: 'outgoing',
          region: senderCfg.region || null,
          place: senderCfg.place || null,
          type: 'status-reply',
          payload: { statusCode, senderStatus: numericId }
        });
      } else {
        console.warn('Status reply could not be sent:', replyStatus.reason || 'unknown-error');
      }
    }
  }

  if (votePlace && matched.type === 'rezultati') {
    const pairsText = String(matched.fields.pairs || '').trim();
    if (!pairsText) {
      const replyText = messageModules.rezultati.buildRezultatiQueryReply(votePlace.result, {
        prependRecipientName: !senderNumber && Boolean(groupId),
        recipientName: sender
      });
      if (senderNumber || groupId) {
        const replyStatus = await sendSignalReply({ groupId, recipientNumber: senderNumber, messageText: replyText });
        if (replyStatus.ok) {
          addAcceptedSignalRecord({
            sender: 'local-backend',
            text: replyText,
            groupId,
            groupName,
            direction: 'outgoing',
            region: senderCfg.region || null,
            place: senderCfg.place || null,
            type: 'rezultati-query-reply',
            payload: { result: votePlace.result }
          });
        }
      }
      return { accepted: true, record };
    }

    const pairs = parseRezPairs(pairsText);
    if (!pairs.length) {
      return { accepted: false, reason: 'invalid-rez-pairs' };
    }

    const updatedIds = [];
    const result = votePlace.result && typeof votePlace.result === 'object' ? votePlace.result : {};
    votePlace.result = result;
    const candidateVotes = Array.isArray(result.candidateVotes)
      ? votePlace.result.candidateVotes
      : [];

    for (const { id, votes } of pairs) {
      if (id === 'N') {
        result.nonRegularBallots = votes;
        updatedIds.push(id);
        continue;
      }
      if (id === 'P') {
        result.remainingBallots = votes;
        updatedIds.push(id);
        continue;
      }
      const entry = candidateVotes.find((cv) => String(cv.id) === String(id));
      if (entry) {
        entry.votes = votes;
        updatedIds.push(id);
      }
    }

    if (!updatedIds.length) {
      return { accepted: false, reason: 'no-matching-candidates' };
    }

    try {
      syncConfigResultTotals(config);
      saveConfig(config);
    } catch (err) {
      console.error('Failed to save config with updated rezultati:', err.message);
      return { accepted: false, reason: 'config-save-failed' };
    }

    const replyText = buildRezultatiAcceptedReply(votePlace.result, {
      prependRecipientName: !senderNumber && Boolean(groupId),
      recipientName: sender
    });
    if (senderNumber || groupId) {
      const replyStatus = await sendSignalReply({ groupId, recipientNumber: senderNumber, messageText: replyText });
      if (replyStatus.ok) {
        addAcceptedSignalRecord({
          sender: 'local-backend',
          text: replyText,
          groupId,
          groupName,
          direction: 'outgoing',
          region: senderCfg.region || null,
          place: senderCfg.place || null,
          type: 'rezultati-reply',
          payload: { updatedIds, pairs }
        });
      } else {
        console.warn('Rezultati reply could not be sent:', replyStatus.reason || 'unknown-error');
      }
    }
  }

  return { accepted: true, record };
}

function normalizeSignalEnvelope(rawEnvelope) {
  if (!rawEnvelope || typeof rawEnvelope !== 'object') return null;

  const envelope = rawEnvelope.envelope || rawEnvelope;
  if (!envelope || typeof envelope !== 'object') return null;

  const syncMessage = envelope.syncMessage || {};
  const sentMessage = syncMessage.sentMessage || null;
  const dataMessage = envelope.dataMessage || null;
  const groupInfo = envelope.groupInfo || sentMessage?.groupInfo || dataMessage?.groupInfo || null;

  const sender = envelope.sourceName || envelope.sourceUuid || envelope.sourceNumber || envelope.source || 'unknown-signal-user';
  let text = null;
  const messageSource = sentMessage || dataMessage || envelope;
  const attachments = Array.isArray(messageSource.attachments)
    ? messageSource.attachments
    : (Array.isArray(envelope.attachments) ? envelope.attachments : []);

  if (sentMessage && typeof sentMessage.message === 'string') {
    text = sentMessage.message;
  } else if (dataMessage) {
    text = dataMessage.body || dataMessage.message || null;
  } else if (typeof envelope.body === 'string') {
    text = envelope.body;
  } else if (typeof envelope.message === 'string') {
    text = envelope.message;
  }

  if (!text || !String(text).trim()) return null;

  return {
    sender: String(sender).trim() || 'unknown-signal-user',
    senderNumber: envelope.sourceNumber ? String(envelope.sourceNumber) : null,
    text: String(text).trim(),
    attachments,
    groupId: groupInfo && (groupInfo.groupId || groupInfo.id) ? String(groupInfo.groupId || groupInfo.id) : null,
    groupName: groupInfo && (groupInfo.groupName || groupInfo.name) ? String(groupInfo.groupName || groupInfo.name) : null,
    timestamp: envelope.timestamp || Date.now(),
    isSyncSent: Boolean(sentMessage)
  };
}

async function hydrateSignalAttachments(attachments, { groupId = null, senderNumber = null } = {}) {
  return Promise.all((Array.isArray(attachments) ? attachments : []).map(async (attachment) => {
    if (!attachment || typeof attachment !== 'object') return attachment;
    if (attachment.path || attachment.filePath || attachment.filepath || attachment.data) return attachment;
    const id = attachment.id || attachment.attachmentId || attachment.signalId;
    if (!id) return attachment;
    const params = { id: String(id) };
    if (groupId) params.groupId = groupId;
    else if (senderNumber) params.recipient = senderNumber;
    const response = await querySignalDaemon('getAttachment', params, 15000);
    const data = response && response.result && response.result.data;
    return typeof data === 'string' && data
      ? { ...attachment, data, signalId: String(id) }
      : { ...attachment, signalId: String(id) };
  }));
}

async function processSignalCaptureLine(line) {
  if (!line || !line.trim()) return null;
  if (line.startsWith('INFO ') || line.startsWith('WARN ') || line.startsWith('ERROR ')) return null;

  try {
    const json = JSON.parse(line);
    addRawSignalMessage({
      direction: 'incoming',
      rawPayload: json,
      groupId: json && json.envelope && json.envelope.groupInfo && (json.envelope.groupInfo.groupId || json.envelope.groupInfo.id) ? String(json.envelope.groupInfo.groupId || json.envelope.groupInfo.id) : null,
      groupName: json && json.envelope && json.envelope.groupInfo && (json.envelope.groupInfo.groupName || json.envelope.groupInfo.name) ? String(json.envelope.groupInfo.groupName || json.envelope.groupInfo.name) : null
    });
    const payload = normalizeSignalEnvelope(json);
    if (!payload) return null;

    const result = await handleIncomingMessageProcessing({
      sender: payload.sender,
      senderNumber: payload.senderNumber,
      text: payload.text,
      attachments: await hydrateSignalAttachments(payload.attachments, payload),
      groupId: payload.groupId,
      groupName: payload.groupName,
      direction: 'incoming'
    });

    if (!result.accepted) {
      return { accepted: false, reason: result.reason || 'ignored' };
    }

    return result;
  } catch (err) {
    return null;
  }
}

function querySignalDaemon(method, params = {}, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: 7583 });
    let settled = false;
    let buffer = '';

    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch (err) {
        // ignore socket close errors
      }
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => {
      socket.write(JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() }) + '\n');
    });
    socket.on('data', (chunk) => {
      buffer += String(chunk || '');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const payload = JSON.parse(line);
          finish(payload);
          return;
        } catch (err) {
          // Ignore malformed line and continue
        }
      }
    });
    socket.on('timeout', () => finish(null));
    socket.on('error', () => finish(null));
    socket.on('end', () => finish(null));
  });
}

async function startSignalCaptureLoop() {
  const binary = await findSignalCliBinary();
  if (!binary) {
    console.log('Signal bridge capture is disabled because signal-cli is not installed.');
    return false;
  }

  let daemonReady = await querySignalDaemon('listGroups', {}, 2500);
  if (!daemonReady) {
    const daemon = spawn(binary, ['daemon', '--tcp', '127.0.0.1:7583', '--receive-mode', 'manual', '--no-receive-stdout'], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, HOME: process.env.HOME || '/home/rade', SIGNAL_CLI_NO_TTY: '1' }
    });
    daemon.unref();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    daemonReady = await querySignalDaemon('listGroups', {}, 3000);
  }

  if (!daemonReady) {
    console.warn('Signal daemon is not reachable on 127.0.0.1:7583; capture loop is disabled.');
    return false;
  }

  const poller = setInterval(async () => {
    const response = await querySignalDaemon('receive', { timeout: 1, maxMessages: 20 }, 5000);
    if (!response) return;
    if (response.error) {
      if (String(response.error.message || '').includes('already being received')) {
        return;
      }
      return;
    }

    const items = Array.isArray(response.result) ? response.result : [];
    for (const item of items) {
      addRawSignalMessage({
        direction: 'incoming',
        rawPayload: item,
        groupId: item && item.envelope && item.envelope.groupInfo && (item.envelope.groupInfo.groupId || item.envelope.groupInfo.id) ? String(item.envelope.groupInfo.groupId || item.envelope.groupInfo.id) : null,
        groupName: item && item.envelope && item.envelope.groupInfo && (item.envelope.groupInfo.groupName || item.envelope.groupInfo.name) ? String(item.envelope.groupInfo.groupName || item.envelope.groupInfo.name) : null
      });
      const payload = normalizeSignalEnvelope(item);
      if (!payload) continue;
      if (payload.isSyncSent && isRecentServerOutgoingSignalMessage(payload.text, payload.groupId)) {
        continue;
      }
      const result = await handleIncomingMessageProcessing({
        sender: payload.sender,
        senderNumber: payload.senderNumber,
        text: payload.text,
        attachments: await hydrateSignalAttachments(payload.attachments, payload),
        groupId: payload.groupId,
        groupName: payload.groupName,
        direction: 'incoming'
      });
      if (result && result.accepted && result.record && result.record.rawMessage) {
        console.log('Accepted Signal capture message:', result.record.rawMessage);
      }
    }
  }, 3000);

  console.log('Signal capture poller is active via JSON-RPC receive.');
  return { started: true, poller };
}

function getRegions(config) {
  if (!config) return [];
  if (Array.isArray(config.regions)) return config.regions;
  if (Array.isArray(config.votingUnits)) {
    const regions = [];
    for (const unit of config.votingUnits) {
      if (Array.isArray(unit.regions)) {
        for (const region of unit.regions) {
          regions.push(region);
        }
      }
    }
    return regions;
  }
  return [];
}

function findSenderInPlace(place, sender, lower) {
  const senderList = Array.isArray(place.sender)
    ? place.sender
    : (Array.isArray(place.senders) ? place.senders : []);

  return (senderList || []).find(s => s.signalUser === sender || (s.displayName || '').toLowerCase() === lower || (s.name || '').toLowerCase() === lower);
}

function findSenderConfig(config, sender) {
  // Traverse regions -> municipalities -> places (and places -> subPlaces) to find sender entry
  const lower = (sender || '').toLowerCase();
  const regions = getRegions(config);
  if (!regions.length) return null;

  for (const region of regions) {
    if (Array.isArray(region.municipalities)) {
      for (const mun of region.municipalities) {
        if (!Array.isArray(mun.places)) continue;
        for (const place of mun.places) {
          const found = findSenderInPlace(place, sender, lower);
          if (found) return { region: region.name, municipality: mun.name, place: place.name, sender: found };
        }
      }
    }
    if (Array.isArray(region.places)) {
      for (const place of region.places) {
        if (Array.isArray(place.subPlaces)) {
          for (const sub of place.subPlaces) {
            const found = findSenderInPlace(sub, sender, lower);
            if (found) return { region: region.name, place: sub.name, parentPlace: place.name, sender: found };
          }
        }
        const found = findSenderInPlace(place, sender, lower);
        if (found) return { region: region.name, place: place.name, sender: found };
      }
    }
  }
  return null;
}

function findPlaceConfigBySender(config, regionName, municipalityName, placeName) {
  const regions = getRegions(config);
  for (const region of regions) {
    if (region.name !== regionName) continue;
    if (municipalityName) {
      const mun = (region.municipalities || []).find(item => item.name === municipalityName);
      if (!mun) return null;
      const place = (mun.places || []).find(item => item.name === placeName);
      if (place) return place;
      for (const item of mun.places || []) {
        if (Array.isArray(item.subPlaces)) {
          const sub = item.subPlaces.find(subItem => subItem.name === placeName);
          if (sub) return sub;
        }
      }
      return null;
    }

    if (Array.isArray(region.places)) {
      const direct = region.places.find(place => place.name === placeName);
      if (direct) return direct;
      for (const place of region.places) {
        if (Array.isArray(place.subPlaces)) {
          const sub = place.subPlaces.find(subItem => subItem.name === placeName);
          if (sub) return sub;
        }
      }
    }
  }
  return null;
}

function matchTemplates(config, text) {
  const trimmed = text.trim();

  const cyrToLatMap = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ђ: 'dj', е: 'e', ж: 'z', з: 'z', и: 'i', ј: 'j', к: 'k', л: 'l', љ: 'lj',
    м: 'm', н: 'n', њ: 'nj', о: 'o', п: 'p', р: 'r', с: 's', т: 't', ћ: 'c', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'c',
    џ: 'dz', ш: 's', А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Ђ: 'DJ', Е: 'E', Ж: 'Z', З: 'Z', И: 'I', Ј: 'J', К: 'K',
    Л: 'L', Љ: 'LJ', М: 'M', Н: 'N', Њ: 'NJ', О: 'O', П: 'P', Р: 'R', С: 'S', Т: 'T', Ћ: 'C', У: 'U', Ф: 'F', Х: 'H',
    Ц: 'C', Ч: 'C', Џ: 'DZ', Ш: 'S'
  };

  const transliterateSerbianCyrillic = (value) => String(value || '')
    .split('')
    .map((ch) => cyrToLatMap[ch] || ch)
    .join('');

  const candidates = [trimmed];
  const transliterated = transliterateSerbianCyrillic(trimmed);
  if (transliterated && transliterated !== trimmed) {
    candidates.push(transliterated);
  }

  for (const candidate of candidates) {
    for (const t of config.templates) {
      try {
        const re = new RegExp(t.regex, 'i');
        const m = re.exec(candidate);
        if (m) {
          const result = { type: t.type, fields: {} };
          // groups start at index 1
          for (let i = 0; i < (t.fields || []).length; i++) {
            const fieldName = t.fields[i];
            result.fields[fieldName] = m[i+1];
          }
          return result;
        }
      } catch (err) {
        console.warn('Invalid template regex for', t.type, t.regex, err.message);
      }
    }
  }

  return null;
}

function findVotingPlaceById(config, placeId) {
  const normalized = String(placeId || '').trim();
  if (!normalized) return null;

  const regions = getRegions(config);
  for (const region of regions) {
    const scan = (node) => {
      if (!node || typeof node !== 'object') return null;
      if (String(node.id || '').trim() === normalized) return node;
      if (Array.isArray(node.places)) {
        for (const place of node.places) {
          const found = scan(place);
          if (found) return found;
        }
      }
      if (Array.isArray(node.subPlaces)) {
        for (const sub of node.subPlaces) {
          const found = scan(sub);
          if (found) return found;
        }
      }
      if (Array.isArray(node.municipalities)) {
        for (const mun of node.municipalities) {
          const found = scan(mun);
          if (found) return found;
        }
      }
      return null;
    };

    const found = scan(region);
    if (found) return found;
  }

  return null;
}

function findVotingPlaceContextById(config, placeId) {
  const normalized = String(placeId || '').trim();
  if (!normalized) return null;

  const regions = getRegions(config);
  for (const region of regions) {
    const regionName = region && region.name ? String(region.name) : null;

    if (Array.isArray(region.municipalities)) {
      for (const mun of region.municipalities) {
        const municipalityName = mun && mun.name ? String(mun.name) : null;
        for (const place of mun.places || []) {
          if (String(place && place.id || '').trim() === normalized) {
            return {
              place,
              regionName,
              municipalityName,
              placeName: place && place.name ? String(place.name) : normalized
            };
          }
          for (const sub of place.subPlaces || []) {
            if (String(sub && sub.id || '').trim() === normalized) {
              return {
                place: sub,
                regionName,
                municipalityName,
                placeName: sub && sub.name ? String(sub.name) : normalized
              };
            }
          }
        }
      }
    }

    for (const place of region.places || []) {
      if (String(place && place.id || '').trim() === normalized) {
        return {
          place,
          regionName,
          municipalityName: null,
          placeName: place && place.name ? String(place.name) : normalized
        };
      }
      for (const sub of place.subPlaces || []) {
        if (String(sub && sub.id || '').trim() === normalized) {
          return {
            place: sub,
            regionName,
            municipalityName: null,
            placeName: sub && sub.name ? String(sub.name) : normalized
          };
        }
      }
    }
  }

  return null;
}

// Returns context of the first place where this sender is already registered, or null.
function findSenderRegistration(config, sender) {
  const normalizedSender = String(sender || '').trim().toLowerCase();
  if (!normalizedSender) return null;

  function checkPlaces(places, regionName, municipalityName) {
    for (const place of places || []) {
      const senderEntry = Array.isArray(place.sender) ? place.sender[0] : null;
      if (senderEntry && String(senderEntry.signalUser || '').trim().toLowerCase() === normalizedSender) {
        return {
          placeId: String(place.id || ''),
          placeName: String(place.name || place.id || ''),
          regionName: regionName || null,
          municipalityName: municipalityName || null
        };
      }
      for (const sub of place.subPlaces || []) {
        const subEntry = Array.isArray(sub.sender) ? sub.sender[0] : null;
        if (subEntry && String(subEntry.signalUser || '').trim().toLowerCase() === normalizedSender) {
          return {
            placeId: String(sub.id || ''),
            placeName: String(sub.name || sub.id || ''),
            regionName: regionName || null,
            municipalityName: municipalityName || null
          };
        }
      }
    }
    return null;
  }

  for (const region of getRegions(config)) {
    const regionName = region && region.name ? String(region.name) : null;
    if (Array.isArray(region.municipalities)) {
      for (const mun of region.municipalities) {
        const munName = mun && mun.name ? String(mun.name) : null;
        const found = checkPlaces(mun.places, regionName, munName);
        if (found) return found;
      }
    }
    const found = checkPlaces(region.places, regionName, null);
    if (found) return found;
  }
  return null;
}

const applyRegistrationMessage = (...args) => messageModules.registerController.applyRegistrationMessage(...args);

app.get('/api/config', (req, res) => {
  const config = loadConfig();
  res.json(config);
});

app.post('/api/config/clear-data', (req, res) => {
  const { operations } = req.body || {};
  if (!Array.isArray(operations) || !operations.length) {
    return res.status(400).json({ error: 'No operations specified.' });
  }
  const config = loadConfig();

  function walkPlaces(obj, fn) {
    if (!obj || typeof obj !== 'object') return;
    // A voting place has a "sender" array or "senderStatus" field
    if (Object.prototype.hasOwnProperty.call(obj, 'senderStatus') || Object.prototype.hasOwnProperty.call(obj, 'voted')) {
      fn(obj);
    }
    for (const key of Object.keys(obj)) {
      if (Array.isArray(obj[key])) {
        for (const item of obj[key]) walkPlaces(item, fn);
      }
    }
  }

  const TBD_SENDER = { signalUser: 'TBD', displayName: 'TBD', name: 'TBD', surname: 'TBD', phone: 'TBD', email: 'TBD', keep_data: 'NO' };

  walkPlaces(config, (place) => {
    if (operations.includes('sender') && place.sender) {
      place.sender = place.sender.map(() => ({ ...TBD_SENDER }));
    }
    if (operations.includes('status') && Object.prototype.hasOwnProperty.call(place, 'senderStatus')) {
      place.senderStatus = '0';
    }
    if (operations.includes('turnout') && Object.prototype.hasOwnProperty.call(place, 'voted')) {
      place.voted = 0;
    }
    if (operations.includes('results') && place.result) {
      if (Array.isArray(place.result.candidateVotes)) {
        place.result.candidateVotes = place.result.candidateVotes.map((cv) => ({ ...cv, votes: 0 }));
      }
      if (Array.isArray(place.result.nonValidVotes)) {
        place.result.nonValidVotes = place.result.nonValidVotes.map((nv) => ({ ...nv, votes: 0 }));
      }
    }
    if (operations.includes('correction') && Object.prototype.hasOwnProperty.call(place, 'correction')) {
      place.correction = 0;
    }
  });

  // Also clear totalVoted at every level if results cleared
  if (operations.includes('results') || operations.includes('turnout')) {
    function clearTotalVoted(obj) {
      if (!obj || typeof obj !== 'object') return;
      if (Object.prototype.hasOwnProperty.call(obj, 'totalVoted')) obj.totalVoted = 0;
      for (const key of Object.keys(obj)) {
        if (Array.isArray(obj[key])) obj[key].forEach(clearTotalVoted);
        else if (obj[key] && typeof obj[key] === 'object') clearTotalVoted(obj[key]);
      }
    }
    clearTotalVoted(config);
  }

  try {
    saveConfig(config);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



app.get('/api/config-version', (req, res) => {
  try {
    const stats = fs.statSync(CONFIG_PATH);
    res.json({
      mtimeMs: stats.mtimeMs,
      size: stats.size
    });
  } catch (err) {
    console.error('Failed to read config file metadata:', err.message);
    res.status(500).json({ error: 'config-version-unavailable' });
  }
});

function isSignalHeartbeatFresh(signal) {
 if (!signal || !signal.lastHeartbeatAt) return false;
 const lastHeartbeat = new Date(signal.lastHeartbeatAt).getTime();
 if (!Number.isFinite(lastHeartbeat)) return false;
 return Date.now() - lastHeartbeat <= getSignalHeartbeatTimeoutMs();
}

function detectSignalProcess() {
 return new Promise((resolve) => {
   exec('ps -eo comm --no-headers', (error, stdout) => {
     if (error || !stdout) {
       return resolve(false);
     }

     const lineList = stdout.split(/\r?\n/).filter(Boolean);
     const processNames = new Set([
       'signal',
       'signal-desktop',
       'signal-desktop-linux',
       'signal-beta',
       'signal.exe'
     ]);

     const isRunning = lineList.some((line) => {
       const normalized = line.trim().toLowerCase();
       return processNames.has(normalized);
     });

     resolve(isRunning);
   });
 });
}

async function refreshSignalRuntimeState() {
 const signal = loadSignalConfig();
 const processRunning = await detectSignalProcess();

 if (processRunning) {
   const bridgeInfo = await loadSignalGroupsFromBridge();
   const groups = normalizeSignalGroups(bridgeInfo.groups || []);
   signal.enabled = true;
   signal.connected = true;
   signal.lastHeartbeatAt = new Date().toISOString();
   signal.lastCheck = signal.lastHeartbeatAt;
   signal.groups = groups;
   if (!signal.selectedGroupId && signal.groups.length) {
     signal.selectedGroupId = signal.groups[0].id;
   }
   if (!signal.groups.length) {
     signal.selectedGroupId = null;
   }
   signal.lastMessage = groups.length
     ? 'Signal app is running on this computer and a local bridge reported groups.'
     : 'Signal app is running on this computer, but no local bridge groups were detected.';
   saveSignalConfig(signal);
   return true;
 }

 signal.enabled = true;
 signal.connected = false;
 signal.selectedGroupId = null;
 signal.groups = [];
 signal.lastCheck = null;
 signal.lastHeartbeatAt = null;
 signal.lastMessage = 'Signal app is not running; please start it on this computer.';
 saveSignalConfig(signal);
 return false;
}

app.get('/api/signal/config', (req, res) => {
 const settings = loadGeneralConfig();
 res.json({
   heartbeatMinutes: settings.heartbeatMinutes,
   heartbeatTimeoutMs: getSignalHeartbeatTimeoutMs()
 });
});

app.get('/api/signal/status', async (req, res) => {
 const signal = loadSignalConfig();
 const processRunning = await detectSignalProcess();

 if (processRunning) {
   const bridgeInfo = await loadSignalGroupsFromBridge();
   const groups = normalizeSignalGroups(bridgeInfo.groups || []);
   signal.enabled = true;
   signal.connected = true;
   signal.lastHeartbeatAt = new Date().toISOString();
   signal.lastCheck = signal.lastHeartbeatAt;
   signal.groups = groups;
   if (!signal.groups.length) {
     signal.selectedGroupId = null;
   }
   signal.lastMessage = groups.length
     ? 'Signal app is running on this computer and a local bridge reported groups.'
     : 'Signal app is running on this computer, but no local bridge groups were detected.';
   saveSignalConfig(signal);

   const group = signal.groups.find(item => item.id === signal.selectedGroupId) || null;
   return res.json({
     enabled: signal.enabled,
     connected: true,
     selectedGroupId: group ? group.id : null,
     selectedGroupName: group ? group.name : null,
     groups: signal.groups,
     lastCheck: signal.lastCheck,
     lastMessage: signal.lastMessage,
     bridgeType: bridgeInfo.available ? 'local-signal-bridge' : 'none'
   });
 }

 signal.enabled = true;
 signal.connected = false;
 signal.selectedGroupId = null;
 signal.groups = [];
 signal.lastCheck = null;
 signal.lastHeartbeatAt = null;
 signal.lastMessage = 'Signal app is not running; please start it on this computer.';
 saveSignalConfig(signal);

 return res.json({
   enabled: signal.enabled,
   connected: false,
   selectedGroupId: null,
   selectedGroupName: null,
   groups: [],
   lastCheck: null,
   lastMessage: signal.lastMessage,
   bridgeType: 'none'
 });
});

app.get('/api/signal/groups', (req, res) => {
 const signal = loadSignalConfig();
 if (!signal.connected || !isSignalHeartbeatFresh(signal)) {
   return res.json({ groups: [], selectedGroupId: null });
 }
 res.json({ groups: signal.groups, selectedGroupId: signal.selectedGroupId });
});

app.post('/api/signal/heartbeat', (req, res) => {
 const signal = loadSignalConfig();
 const payload = req.body || {};
 const nextGroups = normalizeSignalGroups(payload.groups);

 if (nextGroups.length) {
   signal.groups = nextGroups;
 }

 if (payload.selectedGroupId && signal.groups.some(group => group.id === payload.selectedGroupId)) {
   signal.selectedGroupId = payload.selectedGroupId;
 } else if (signal.groups.length) {
   signal.selectedGroupId = signal.groups[0].id;
 } else {
   signal.selectedGroupId = null;
 }

 signal.enabled = true;
 signal.connected = true;
 signal.lastHeartbeatAt = new Date().toISOString();
 signal.lastCheck = signal.lastHeartbeatAt;
 signal.lastMessage = payload.lastMessage || (signal.selectedGroupId ? `Signal bridge is active and listening to the selected group.` : 'Signal bridge is active.');
 saveSignalConfig(signal);

 res.json({ ok: true, connected: true, selectedGroupId: signal.selectedGroupId, selectedGroupName: signal.groups.find(item => item.id === signal.selectedGroupId)?.name || null, lastMessage: signal.lastMessage });
});

app.post('/api/signal/manual-ok', (req, res) => {
 const signal = loadSignalConfig();
 signal.enabled = true;
 signal.connected = true;
 signal.lastHeartbeatAt = new Date().toISOString();
 signal.lastCheck = signal.lastHeartbeatAt;
 signal.groups = [];
 signal.selectedGroupId = null;
 signal.lastMessage = 'Signal app confirmed as running on this computer, but no local bridge groups were detected.';
 saveSignalConfig(signal);

 res.json({ ok: true, connected: true, selectedGroupId: null, selectedGroupName: null, lastMessage: signal.lastMessage });
});

app.post('/api/signal/select-group', (req, res) => {
 const { groupId } = req.body || {};
 const signal = loadSignalConfig();
 const group = (signal.groups || []).find(item => item.id === groupId);

 if (!group) {
   return res.status(400).json({ ok: false, reason: 'group-not-found' });
 }

 signal.selectedGroupId = group.id;
 signal.connected = true;
 signal.lastHeartbeatAt = new Date().toISOString();
 signal.lastCheck = signal.lastHeartbeatAt;
 signal.lastMessage = `Listening to Signal group: ${group.name}`;
 saveSignalConfig(signal);

 res.json({ ok: true, selectedGroupId: group.id, selectedGroupName: group.name, lastMessage: signal.lastMessage });
});

app.post('/api/signal/test', (req, res) => {
 const signal = loadSignalConfig();
 const group = (signal.groups || []).find(item => item.id === signal.selectedGroupId) || signal.groups[0] || null;
 const requestedConnected = Boolean(req.body && req.body.connected === true);

 if (!requestedConnected) {
   signal.connected = false;
   signal.enabled = true;
   signal.lastHeartbeatAt = null;
   signal.lastCheck = null;
   signal.selectedGroupId = null;
   signal.groups = [];
   signal.lastMessage = 'Signal app is not running; bridge is waiting for an active connection.';
   saveSignalConfig(signal);
   return res.json({ ok: true, connected: false, selectedGroupId: null, selectedGroupName: null, lastMessage: signal.lastMessage });
 }

 signal.connected = true;
 signal.enabled = true;
 signal.lastHeartbeatAt = new Date().toISOString();
 signal.lastCheck = signal.lastHeartbeatAt;
 signal.groups = signal.groups || [];
 signal.selectedGroupId = group ? group.id : null;
 signal.lastMessage = group
   ? `Signal bridge test passed for group: ${group.name}`
   : 'Signal app is running, but no local bridge groups were detected.';
 saveSignalConfig(signal);

 res.json({ ok: true, connected: true, selectedGroupId: group ? group.id : null, selectedGroupName: group ? group.name : null, lastMessage: signal.lastMessage });
});

app.get('/api/messages', (req, res) => {
  const direction = String(req.query.direction || '').toLowerCase();
  const msgs = loadMessages().map((msg) => ({
    ...msg,
    direction: msg.direction === 'outgoing' ? 'outgoing' : 'incoming',
    groupId: msg.groupId || null,
    groupName: msg.groupName || null
  }));

  if (direction === 'incoming' || direction === 'outgoing') {
    return res.json(msgs.filter((msg) => (msg.direction || 'incoming') === direction));
  }

  res.json(msgs);
});

app.delete('/api/messages', (req, res) => {
  const direction = String(req.query.direction || '').toLowerCase();
  if (direction && direction !== 'incoming' && direction !== 'outgoing') {
    return res.status(400).json({ ok: false, reason: 'invalid-direction' });
  }

  const messages = loadMessages();
  const filtered = direction
    ? messages.filter((msg) => (msg.direction === 'outgoing' ? 'outgoing' : 'incoming') !== direction)
    : [];
  const removed = messages.length - filtered.length;
  saveMessages(filtered);
  return res.json({ ok: true, removed, remaining: filtered.length });
});

app.post('/api/messages/delete-selected', (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : null;
  if (!ids || !ids.length) {
    return res.status(400).json({ ok: false, reason: 'missing-ids' });
  }
  const selectedIds = new Set(ids.map((id) => String(id)).filter(Boolean));
  if (!selectedIds.size) {
    return res.status(400).json({ ok: false, reason: 'missing-ids' });
  }

  const messages = loadMessages();
  const filtered = messages.filter((msg) => !selectedIds.has(String(msg.id || '')));
  const removed = messages.length - filtered.length;
  saveMessages(filtered);
  return res.json({ ok: true, removed, remaining: filtered.length });
});

app.get('/api/signal/raw-messages', (req, res) => {
  const direction = String(req.query.direction || '').toLowerCase();
  const all = loadSignalRawMessages().map((msg) => ({
    ...msg,
    direction: msg.direction === 'outgoing' ? 'outgoing' : 'incoming'
  }));
  if (direction === 'incoming' || direction === 'outgoing') {
    return res.json(all.filter((msg) => msg.direction === direction));
  }
  return res.json(all);
});

app.get('/api/irregularities', async (req, res) => {
  const records = loadIrregularities();
  let changed = false;
  for (const record of records) {
    for (const attachment of Array.isArray(record.attachments) ? record.attachments : []) {
      if (!attachment || attachment.storedFilename || !attachment.signalId) continue;
      const hydrated = await hydrateSignalAttachments([attachment], { groupId: record.groupId, senderNumber: record.senderNumber });
      const stored = storeIrregularityAttachments(record.id, hydrated)[0];
      Object.assign(attachment, stored);
      changed = Boolean(stored.storedFilename) || changed;
    }
  }
  if (changed) saveIrregularities(records);
  res.json(records.slice().sort((a, b) => new Date(b.receivedAt || 0) - new Date(a.receivedAt || 0)));
});

app.get('/api/irregularities/:id/attachments/:index', (req, res) => {
  const record = loadIrregularities().find((item) => String(item.id) === String(req.params.id));
  const attachment = record && record.attachments && record.attachments[Number(req.params.index)];
  if (!attachment || !attachment.storedFilename) return res.status(404).end();
  const filePath = path.join(IRREGULARITIES_MEDIA_DIR, path.basename(attachment.storedFilename));
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.type(attachment.contentType || path.extname(filePath)).sendFile(filePath);
});

app.delete('/api/irregularities', (req, res) => {
  const records = loadIrregularities();
  for (const record of records) {
    for (const attachment of Array.isArray(record.attachments) ? record.attachments : []) {
      if (!attachment || !attachment.storedFilename) continue;
      try { fs.unlinkSync(path.join(IRREGULARITIES_MEDIA_DIR, path.basename(attachment.storedFilename))); } catch (err) { /* ignore missing file */ }
    }
  }
  saveIrregularities([]);
  res.json({ ok: true, removed: records.length });
});

app.get('/api/zap-records', (req, res) => {
  res.json(loadZapRecords().slice().sort((a, b) => new Date(b.receivedAt || 0) - new Date(a.receivedAt || 0)));
});

app.delete('/api/zap-records', (req, res) => {
  const records = loadZapRecords();
  for (const record of records) {
    for (const attachment of Array.isArray(record.attachments) ? record.attachments : []) {
      if (!attachment || !attachment.storedFilename) continue;
      try { fs.unlinkSync(path.join(ZAP_MEDIA_DIR, path.basename(attachment.storedFilename))); } catch (err) { /* ignore missing file */ }
    }
  }
  saveZapRecords([]);
  res.json({ ok: true, removed: records.length });
});

app.get('/api/zap-records/:id/attachments/:index', (req, res) => {
  const record = loadZapRecords().find((item) => String(item.id) === String(req.params.id));
  const attachment = record && record.attachments && record.attachments[Number(req.params.index)];
  if (!attachment || !attachment.storedFilename) return res.status(404).end();
  const filePath = path.join(ZAP_MEDIA_DIR, path.basename(attachment.storedFilename));
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.type(attachment.contentType || path.extname(filePath)).sendFile(filePath);
});

app.delete('/api/signal/raw-messages', (req, res) => {
  const direction = String(req.query.direction || '').toLowerCase();
  if (direction && direction !== 'incoming' && direction !== 'outgoing') {
    return res.status(400).json({ ok: false, reason: 'invalid-direction' });
  }

  const all = loadSignalRawMessages();
  const filtered = direction
    ? all.filter((msg) => (msg.direction === 'outgoing' ? 'outgoing' : 'incoming') !== direction)
    : [];
  const removed = all.length - filtered.length;
  saveSignalRawMessages(filtered);
  return res.json({ ok: true, removed, remaining: filtered.length });
});

app.post('/api/messages', async (req, res) => {
  const payload = req.body || {};
  const direction = payload.direction === 'outgoing' ? 'outgoing' : 'incoming';
  const { sender, text } = payload;
  if (!text || (!sender && direction === 'incoming')) {
    return res.status(400).json({ accepted: false, reason: 'missing-sender-or-text' });
  }

  const signal = loadSignalConfig();
  const groupId = payload.groupId || signal.selectedGroupId || null;
  const groupName = payload.groupName || (groupId ? ((signal.groups || []).find(item => item.id === groupId) || {}).name || null : null);

  if (direction === 'incoming') {
    const result = await handleIncomingMessageProcessing({
      sender,
      senderNumber: payload.senderNumber || null,
      text,
      attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
      groupId,
      groupName,
      direction: 'incoming'
    });
    if (!result.accepted) {
      return res.status(result.reason === 'config-save-failed' ? 500 : 200).json({ accepted: false, reason: result.reason || 'message-not-accepted' });
    }
    return res.json({ accepted: true, ...result });
  }

  const messages = loadMessages();
  const id = crypto.randomBytes(6).toString('hex') + '-' + Date.now();
  const record = {
    id,
    sender: payload.sender || 'local-backend',
    region: payload.region || null,
    place: payload.place || null,
    type: payload.type || 'signal',
    payload: payload.payload || {},
    rawMessage: text,
    receivedAt: new Date().toISOString(),
    direction: 'outgoing',
    groupId,
    groupName
  };
  messages.push(record);

  try {
    saveMessages(messages);
  } catch (err) {
    console.error('Failed to save outgoing message:', err.message);
    return res.status(500).json({ accepted: false, reason: 'save-failed' });
  }

  return res.json({ accepted: true, record });
});

app.post('/api/messages/sent', (req, res) => {
  const { groupId, groupName, text, payload } = req.body || {};
  if (!text) {
    return res.status(400).json({ accepted: false, reason: 'missing-message-text' });
  }

  const signal = loadSignalConfig();
  const selectedGroupId = groupId || signal.selectedGroupId || null;
  const selectedGroupName = groupName || (selectedGroupId ? ((signal.groups || []).find((item) => item.id === selectedGroupId) || {}).name || null : null);
  addRawSignalMessage({
    direction: 'outgoing',
    rawPayload: { method: 'send', params: { groupId: selectedGroupId, message: text } },
    groupId: selectedGroupId,
    groupName: selectedGroupName,
    source: 'local-server-send'
  });

  const messages = loadMessages();
  const record = {
    id: crypto.randomBytes(6).toString('hex') + '-' + Date.now(),
    sender: 'local-backend',
    region: null,
    place: null,
    type: 'signal-outgoing',
    payload: payload || {},
    rawMessage: text,
    receivedAt: new Date().toISOString(),
    direction: 'outgoing',
    groupId: selectedGroupId,
    groupName: selectedGroupName
  };
  messages.push(record);
  saveMessages(messages);
  res.json({ accepted: true, record });
});


app.get('/api/summary', (req, res) => {
  const config = loadConfig();
  const messages = loadMessages();
  const regionTotals = {};
  const regionTotalsInPlace = {};
  const regionTotalsFromHome = {};
  const placeTotals = {};
  const placeTotalsInPlace = {};
  const placeTotalsFromHome = {};
  let totalAccepted = 0;
  let totalAcceptedInPlace = 0;
  let totalAcceptedFromHome = 0;

  const regions = getRegions(config);
  regions.forEach(region => {
    const regionValueInPlace = toNumber(region.totalVoted, 0);
    const regionValueFromHome = toNumber(region.votedFromHome, 0);
    const regionValue = regionValueInPlace + regionValueFromHome;
    regionTotals[region.name] = regionValue;
    regionTotalsInPlace[region.name] = regionValueInPlace;
    regionTotalsFromHome[region.name] = regionValueFromHome;
    totalAcceptedInPlace += regionValueInPlace;
    totalAcceptedFromHome += regionValueFromHome;
    totalAccepted += regionValue;

    if (Array.isArray(region.municipalities)) {
      region.municipalities.forEach(mun => {
        (mun.places || []).forEach(place => {
          const placeValueInPlace = toNumber(place.totalVoted, place.voted || 0);
          const placeValueFromHome = toNumber(place.votedFromHome, 0);
          const placeValue = placeValueInPlace + placeValueFromHome;
          placeTotals[`${region.name} / ${place.name}`] = placeValue;
          placeTotalsInPlace[`${region.name} / ${place.name}`] = placeValueInPlace;
          placeTotalsFromHome[`${region.name} / ${place.name}`] = placeValueFromHome;
        });
      });
    }

    if (Array.isArray(region.places)) {
      region.places.forEach(place => {
        if (Array.isArray(place.subPlaces)) {
          place.subPlaces.forEach(sub => {
            const subValueInPlace = toNumber(sub.totalVoted, sub.voted || 0);
            const subValueFromHome = toNumber(sub.votedFromHome, 0);
            const subValue = subValueInPlace + subValueFromHome;
            placeTotals[`${region.name} / ${sub.name}`] = subValue;
            placeTotalsInPlace[`${region.name} / ${sub.name}`] = subValueInPlace;
            placeTotalsFromHome[`${region.name} / ${sub.name}`] = subValueFromHome;
          });
        } else {
          const placeValueInPlace = toNumber(place.totalVoted, place.voted || 0);
          const placeValueFromHome = toNumber(place.votedFromHome, 0);
          const placeValue = placeValueInPlace + placeValueFromHome;
          placeTotals[`${region.name} / ${place.name}`] = placeValue;
          placeTotalsInPlace[`${region.name} / ${place.name}`] = placeValueInPlace;
          placeTotalsFromHome[`${region.name} / ${place.name}`] = placeValueFromHome;
        }
      });
    }
  });

  const recentMessages = messages.slice(-20).reverse();

  res.json({
    totalAccepted,
    totalAcceptedInPlace,
    totalAcceptedFromHome,
    regionTotals,
    regionTotalsInPlace,
    regionTotalsFromHome,
    placeTotals,
    placeTotalsInPlace,
    placeTotalsFromHome,
    recentMessages
  });
});

// Serve frontend
app.use('/', express.static(path.join(__dirname, 'public')));

function resolvePort(argv) {
  const args = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i] || '');
    if (arg === '-port' || arg === '--port') {
      const next = Number(args[i + 1]);
      if (Number.isFinite(next) && next > 0) return next;
    }
    const match = arg.match(/^-(?:-)?port=(\d+)$/i);
    if (match) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  const envPort = Number(process.env.PORT);
  if (Number.isFinite(envPort) && envPort > 0) return envPort;
  return 3000;
}

const PORT = resolvePort(process.argv.slice(2));
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  startSignalCaptureLoop().catch((err) => {
    console.error('Failed to start Signal bridge capture loop:', err.message);
  });
});
