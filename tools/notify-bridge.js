#!/usr/bin/env node
// notify-bridge.js
// Listens to org.freedesktop.Notifications on the session bus and forwards Signal notifications to the local backend

const { SessionBus } = require('dbus-next');
const fetch = require('node-fetch');

const BUS = new SessionBus();
const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:3000/api/messages';

console.log('notify-bridge starting, forwarding to', BACKEND_URL);

BUS.connection.on('message', async (msg) => {
  try {
    if (!msg || msg.interface !== 'org.freedesktop.Notifications' || msg.member !== 'Notify') return;

    const body = msg.body || [];
    // Notify signature: (app_name, replaces_id, app_icon, summary, body, actions, hints, expire_timeout)
    const appName = body[0] || '';
    const summary = body[3] || '';
    const messageBody = body[4] || '';

    const appNameLower = String(appName).toLowerCase();
    if (!appNameLower.includes('signal')) return; // skip non-signal notifications

    // Determine sender and text.
    // Common Signal desktop notification formats:
    // - Direct message: summary = "Sender Name", body = "message text"
    // - Group message: summary = "Group Name", body = "Sender Name: message text"

    let sender = String(summary).trim();
    let text = String(messageBody).trim();

    // If body starts with "Name: ", extract sender from body
    const colonIndex = text.indexOf(':');
    if (colonIndex > 0 && text.slice(0, colonIndex).length < 60) {
      // Heuristic: treat first token before colon as sender only if it's reasonably short
      const possibleSender = text.slice(0, colonIndex).trim();
      const possibleText = text.slice(colonIndex + 1).trim();
      if (possibleText.length > 0) {
        sender = possibleSender;
        text = possibleText;
      }
    }

    console.log(new Date().toISOString(), 'Signal notification ->', sender, '::', text);

    // POST to backend
    try {
      const resp = await fetch(BACKEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender, text })
      });
      const json = await resp.json().catch(() => ({}));
      if (resp.ok) {
        console.log('Forwarded:', json.accepted ? 'accepted' : 'ignored', json.reason || '');
      } else {
        console.warn('Backend returned status', resp.status, json);
      }
    } catch (err) {
      console.error('Failed to POST to backend:', err.message);
    }
  } catch (err) {
    console.error('notify-bridge error processing message:', err && err.stack ? err.stack : err);
  }
});

// Keep process alive
process.on('SIGINT', () => process.exit());
process.on('SIGTERM', () => process.exit());
