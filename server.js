/* Zero-dependency server for the story-card template.
   - Serves the static frontend from ./public
   - GET  /api/content  -> data/content.csv (the cards)
   - POST /api/submit   -> appends {field_key, value} to data/responses.csv
   Run: node server.js   (PORT env var optional, default 8080) */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const CONTENT_CSV = path.join(DATA_DIR, 'content.csv');
const RESPONSES_CSV = path.join(DATA_DIR, 'responses.csv');

const MAX_BODY = 10 * 1024;          // 10 KB per submission
const MAX_VALUE_LEN = 5000;          // characters per answer
const RATE_LIMIT = 20;               // submissions per IP...
const RATE_WINDOW_MS = 60 * 1000;    // ...per minute

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

/* ---- Minimal RFC 4180 CSV parsing (same rules as the frontend) ---- */

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(f => f.trim() !== ''));
}

function csvEscape(value) {
  const s = String(value);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* Field keys declared by input-type rows in content.csv — the only keys
   the server will accept submissions for. */
const INPUT_TYPES = new Set(['input', 'longtext', 'email', 'choice']);

function allowedFieldKeys() {
  try {
    const rows = parseCSV(fs.readFileSync(CONTENT_CSV, 'utf8'));
    if (!rows.length) return new Set();
    const head = rows[0].map(h => h.trim().toLowerCase());
    const typeIdx = head.indexOf('type');
    const keyIdx = head.indexOf('field_key');
    const keys = new Set();
    for (const r of rows.slice(1)) {
      if (INPUT_TYPES.has((r[typeIdx] || '').trim().toLowerCase())) {
        keys.add((r[keyIdx] || '').trim() || 'answer');
      }
    }
    return keys;
  } catch {
    return new Set();
  }
}

/* ---- Rate limiting ---- */

const hits = new Map(); // ip -> { count, windowStart }

function rateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    hits.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of hits) {
    if (now - entry.windowStart > RATE_WINDOW_MS) hits.delete(ip);
  }
}, RATE_WINDOW_MS).unref();

/* ---- Handlers ---- */

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, headers));
  res.end(body);
}

function serveContent(res) {
  fs.readFile(CONTENT_CSV, (err, buf) => {
    if (err) return send(res, 404, 'content.csv not found');
    send(res, 200, buf, { 'Content-Type': MIME['.csv'], 'Cache-Control': 'no-cache' });
  });
}

function handleSubmit(req, res) {
  const ip = req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip)) return send(res, 429, 'Too many submissions, slow down.');

  let body = '';
  let overflow = false;
  req.on('data', chunk => {
    body += chunk;
    if (body.length > MAX_BODY) { overflow = true; req.destroy(); }
  });
  req.on('end', () => {
    if (overflow) return;
    let data;
    try { data = JSON.parse(body); } catch { return send(res, 400, 'Invalid JSON'); }

    const fieldKey = String(data.field_key || '').trim();
    const value = String(data.value || '').trim().slice(0, MAX_VALUE_LEN);
    if (!fieldKey || !value) return send(res, 400, 'field_key and value are required');
    if (!allowedFieldKeys().has(fieldKey)) return send(res, 400, 'Unknown field_key');

    const line = [new Date().toISOString(), fieldKey, value].map(csvEscape).join(',') + '\n';
    fs.mkdir(DATA_DIR, { recursive: true }, () => {
      const isNew = !fs.existsSync(RESPONSES_CSV);
      fs.appendFile(RESPONSES_CSV, (isNew ? 'timestamp,field_key,value\n' : '') + line, err => {
        if (err) return send(res, 500, 'Could not save response');
        res.writeHead(204).end();
      });
    });
  });
}

function serveFrom(rootDir, urlPath, res) {
  const filePath = path.normalize(path.join(rootDir, urlPath));
  if (!filePath.startsWith(rootDir + path.sep)) return send(res, 403, 'Forbidden');

  fs.readFile(filePath, (err, buf) => {
    if (err) return send(res, 404, 'Not found');
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    send(res, 200, buf, { 'Content-Type': type });
  });
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (req.method === 'GET' && urlPath === '/api/content') return serveContent(res);
  if (req.method === 'POST' && urlPath === '/api/submit') return handleSubmit(req, res);
  if (req.method === 'GET' || req.method === 'HEAD') {
    // Photos dropped into data/images/ on the host (volume-mounted) are
    // served at /images/<file> — no rebuild needed.
    if (urlPath.startsWith('/images/')) {
      return serveFrom(path.join(DATA_DIR, 'images'), urlPath.slice('/images/'.length), res);
    }
    return serveFrom(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath, res);
  }
  send(res, 405, 'Method not allowed');
});

server.listen(PORT, () => {
  console.log('Story-card server running on http://localhost:' + PORT);
});
