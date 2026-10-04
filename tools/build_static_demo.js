#!/usr/bin/env node
// Builds a single self-contained HTML file (data + CSS + JS inlined) that shows
// a static snapshot of the current app state, with no backend required.
// Usage: node tools/build_static_demo.js  (server must be running on localhost:3000)

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const OUT_DIR = path.join(ROOT, 'dist');
const BASE_URL = 'http://localhost:3000';

const GET_ENDPOINTS = [
  '/api/config',
  '/api/config-version',
  '/api/summary',
  '/api/signal/raw-messages',
  '/api/irregularities',
  '/api/zap-records',
  '/api/messages',
  '/api/signal/config',
  '/api/signal/status',
  '/api/signal/groups'
];

function fetchJson(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(BASE_URL + urlPath, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (err) { reject(new Error(`Failed to parse JSON from ${urlPath}: ${err.message}`)); }
      });
    }).on('error', (err) => reject(new Error(`Failed to fetch ${urlPath}: ${err.message}`)));
  });
}

function fetchBinaryAsDataUri(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(BASE_URL + urlPath, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`${urlPath} returned ${res.statusCode}`)); }
      const contentType = res.headers['content-type'] || 'application/octet-stream';
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(`data:${contentType};base64,${Buffer.concat(chunks).toString('base64')}`));
    }).on('error', reject);
  });
}

async function collectAttachmentDataUris(irregularities, zapRecords) {
  const attachments = {};
  const sources = [
    ['irregularities', irregularities],
    ['zap-records', zapRecords]
  ];
  for (const [kind, records] of sources) {
    for (const record of records || []) {
      (record.attachments || []).forEach((attachment, index) => {
        if (!attachment || !attachment.storedFilename) return;
        const urlPath = `/api/${kind}/${encodeURIComponent(record.id)}/attachments/${index}`;
        attachments[urlPath] = urlPath;
      });
    }
  }
  const paths = Object.keys(attachments);
  for (const urlPath of paths) {
    process.stdout.write(`  ${urlPath} ... `);
    attachments[urlPath] = await fetchBinaryAsDataUri(urlPath);
    console.log('ok');
  }
  return attachments;
}

async function main() {
  console.log('Fetching live data snapshot from', BASE_URL, '...');
  const snapshot = {};
  for (const endpoint of GET_ENDPOINTS) {
    process.stdout.write(`  ${endpoint} ... `);
    snapshot[endpoint] = await fetchJson(endpoint);
    console.log('ok');
  }

  console.log('Fetching attachment images (embedded as data URIs) ...');
  const attachmentDataUris = await collectAttachmentDataUris(snapshot['/api/irregularities'], snapshot['/api/zap-records']);

  const indexHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const styleCss = fs.readFileSync(path.join(PUBLIC_DIR, 'style.css'), 'utf8');
  const appJs = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');

  const demoShim = `
    <script>
      // Static demo shim: serves a frozen data snapshot instead of hitting a real backend.
      window.__DEMO_MODE__ = true;
      const __DEMO_SNAPSHOT__ = ${JSON.stringify(snapshot)};
      const __DEMO_ATTACHMENTS__ = ${JSON.stringify(attachmentDataUris)};
      const __rewriteDemoImages__ = () => {
        document.querySelectorAll('img[src]').forEach((img) => {
          const key = img.getAttribute('src');
          const dataUri = key && __DEMO_ATTACHMENTS__[key];
          if (dataUri && img.src !== dataUri) img.src = dataUri;
        });
      };
      window.addEventListener('DOMContentLoaded', () => {
        new MutationObserver(__rewriteDemoImages__).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
        __rewriteDemoImages__();
      });
      const __DEMO_WRITE_PATHS__ = new Set([
        '/api/config/clear-data', '/api/irregularities', '/api/zap-records',
        '/api/signal/raw-messages', '/api/messages/delete-selected'
      ]);
      function __demoResponse__(body, status) {
        return Promise.resolve({
          ok: status >= 200 && status < 300,
          status,
          json: async () => body,
          text: async () => JSON.stringify(body)
        });
      }
      const __nativeFetch__ = window.fetch ? window.fetch.bind(window) : null;
      window.fetch = function (input, init) {
        const method = (init && init.method ? init.method : 'GET').toUpperCase();
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const pathOnly = url.split('?')[0];
        if (method === 'GET' && Object.prototype.hasOwnProperty.call(__DEMO_SNAPSHOT__, pathOnly)) {
          return __demoResponse__(__DEMO_SNAPSHOT__[pathOnly], 200);
        }
        if (method !== 'GET' && __DEMO_WRITE_PATHS__.has(pathOnly)) {
          return __demoResponse__({ error: 'This is a static demo snapshot \\u2014 no backend is available to save changes.' }, 400);
        }
        if (pathOnly.startsWith('/api/')) {
          return __demoResponse__({ error: 'Not available in this static demo.' }, 404);
        }
        return __nativeFetch__ ? __nativeFetch__(input, init) : Promise.reject(new Error('fetch not available'));
      };
      window.addEventListener('DOMContentLoaded', () => {
        const banner = document.createElement('div');
        banner.textContent = 'Static demo snapshot \\u2014 read-only, no live backend connected';
        banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#7c2d12;color:#fff;text-align:center;padding:6px;font:600 12px system-ui, sans-serif;';
        document.body.appendChild(banner);
      });
    </script>
  `;

  let output = indexHtml.replace(
    /<link rel="stylesheet" href="style\.css" \/>/,
    `<style>\n${styleCss}\n</style>`
  );
  output = output.replace(
    /<script src="app\.js"><\/script>/,
    `${demoShim}\n    <script>\n${appJs}\n    </script>`
  );

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, 'voting-dashboard-demo.html');
  fs.writeFileSync(outFile, output, 'utf8');
  console.log('Wrote', outFile, `(${(fs.statSync(outFile).size / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
