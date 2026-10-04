const fs = require('fs');
const REQUEST_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;

function createRemoteConnectionHistory(filePath, options = {}) {
  const now = options.now || (() => new Date().toISOString());

  function load() {
    try {
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '[]', 'utf8');
      }
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function save(rows) {
    fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), 'utf8');
  }

  function update(requestId, patch) {
    const rows = load();
    const row = rows.find((item) => item.requestId === String(requestId));
    if (!row) return null;
    Object.assign(row, patch);
    save(rows);
    return row;
  }

  function recordRequest({ requestId, ip, userAgent }) {
    const rows = load();
    let row = rows.find((item) => item.requestId === String(requestId));
    if (!row) {
      row = {
        requestId: String(requestId),
        ip: String(ip || ''),
        userAgent: String(userAgent || '').slice(0, 240),
        role: null,
        status: 'pending',
        requestedAt: now(),
        startedAt: null,
        startedBy: null,
        endedAt: null,
        terminatedBy: null
      };
      rows.push(row);
    }
    save(rows);
    return row;
  }

  function assignRole(requestId, role) {
    return update(requestId, { role, status: 'code-issued', codeIssuedAt: now() });
  }

  function startSession(requestId, role) {
    return update(requestId, {
      role,
      status: 'active',
      startedAt: now(),
      startedBy: 'Remote user (one-time PIN)'
    });
  }

  function endSession(requestId, status, terminatedBy) {
    const rows = load();
    const row = rows.find((item) => item.requestId === String(requestId));
    if (!row || row.endedAt) return row || null;
    Object.assign(row, { status, endedAt: now(), terminatedBy });
    save(rows);
    return row;
  }

  function closeOpenConnections(terminatedBy = 'Server restarted') {
    const rows = load();
    let changed = false;
    for (const row of rows) {
      if (row.status === 'active' && !row.endedAt) {
        Object.assign(row, { status: 'interrupted', endedAt: now(), terminatedBy });
        changed = true;
      } else if (['pending', 'code-issued'].includes(row.status) && !row.endedAt) {
        Object.assign(row, { status: 'expired', endedAt: now(), terminatedBy });
        changed = true;
      }
    }
    if (changed) save(rows);
  }

  function list() {
    expireStaleRequests();
    return load().sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)));
  }

  function expireStaleRequests() {
    const rows = load();
    const timestamp = Date.parse(now());
    let changed = false;
    for (const row of rows) {
      if (!['pending', 'code-issued'].includes(row.status) || row.endedAt) continue;
      const expiryBase = row.status === 'code-issued' && row.codeIssuedAt ? row.codeIssuedAt : row.requestedAt;
      const ttl = row.status === 'code-issued' && row.codeIssuedAt ? CODE_TTL_MS : REQUEST_TTL_MS;
      if (timestamp - Date.parse(expiryBase) >= ttl) {
        Object.assign(row, {
          status: 'expired',
          endedAt: new Date(timestamp).toISOString(),
          terminatedBy: 'System (request or PIN expired)'
        });
        changed = true;
      }
    }
    if (changed) save(rows);
  }

  function clear() {
    const removed = load().length;
    save([]);
    return removed;
  }

  return { assignRole, clear, closeOpenConnections, endSession, list, recordRequest, startSession };
}

module.exports = { createRemoteConnectionHistory };
