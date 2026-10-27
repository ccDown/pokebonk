#!/usr/bin/env node
/* PokéBonk 离线版 · 极简静态服务器（零依赖，Node 内置模块） */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const api = require('./local-api');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8730;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.ktx2': 'image/ktx2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, code, body, headers) {
  res.writeHead(code, Object.assign({
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*',
  }, headers || {}));
  res.end(body);
}

/* 视为本地接口的路径（其余走静态文件） */
const API_PREFIX = /^\/(status|auth\/|profile|account\/|save\/|runs(\/|$)|shop\/|items\/|lab\/|treasures\/|quests\/|tasks\/|records|leaderboard|seasons\/|events\/|players|clans|friends|mail|coop|news|feedback|version\.json)/;

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    return send(res, 400, 'Bad Request');
  }

  /* ---------- 本地接口层 ---------- */
  if (API_PREFIX.test(urlPath)) {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 4 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      let body = null;
      if (raw) { try { body = JSON.parse(raw); } catch (e) { body = null; } }
      try {
        api.handle(req, res, urlPath, new URL(req.url, 'http://localhost').searchParams, body);
      } catch (e) {
        console.error('[api]', urlPath, e);
        send(res, 500, JSON.stringify({ error: 'local api error' }), { 'Content-Type': 'application/json' });
      }
    });
    return;
  }

  // 阻止路径穿越
  let filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) return send(res, 403, 'Forbidden');

  fs.stat(filePath, (err, st) => {
    if (!err && st.isDirectory()) filePath = path.join(filePath, 'index.html');

    fs.readFile(filePath, (err2, buf) => {
      if (err2) {
        // SPA 回退：无扩展名的路由交给 index.html
        if (!path.extname(filePath)) {
          return fs.readFile(path.join(ROOT, 'index.html'), (e3, html) => {
            if (e3) return send(res, 404, 'Not Found');
            send(res, 200, html, { 'Content-Type': MIME['.html'] });
          });
        }
        return send(res, 404, 'Not Found');
      }
      const ext = path.extname(filePath).toLowerCase();
      send(res, 200, buf, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': buf.length,
      });
    });
  });
});

/* ---------- 启动（端口被占用时自动顺延） ---------- */
const WANT_OPEN = process.argv.includes('--open') || process.env.PB_OPEN === '1';
let port = PORT;
let tries = 0;

function onReady() {
  const url = `http://127.0.0.1:${port}/`;
  console.log('');
  console.log('  ==========================================');
  console.log('   PokeBonk Offline  is running');
  console.log('  ==========================================');
  console.log('   Open:   ' + url);
  console.log('   Folder: ' + ROOT);
  console.log('   Saves:  ' + path.join(ROOT, '_save'));
  console.log('');
  console.log('   Press Ctrl+C to stop.');
  console.log('');

  if (WANT_OPEN) {
    const cmd = process.platform === 'win32' ? `start "" "${url}"`
      : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
}

function listen() {
  server.listen(port, '127.0.0.1', onReady);
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && tries < 12) {
    tries++;
    console.log(`Port ${port} is busy, trying ${port + 1} ...`);
    port++;
    setTimeout(listen, 60);
    return;
  }
  if (e.code === 'EADDRINUSE') {
    console.error(`Ports ${PORT}-${port} are all busy. Try: PORT=9000 node serve.js`);
  } else {
    console.error(e);
  }
  process.exit(1);
});

listen();
