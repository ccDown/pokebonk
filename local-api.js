/**
 * PokéBonk 离线版 · 本地接口层
 * 复刻游戏运行所需的 HTTP 接口，数据落盘到 _save/ 目录。
 * 仅服务于本机 127.0.0.1，不对外网发起任何请求。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const SAVE_DIR = path.join(ROOT, '_save');
const SEED_FILE = path.join(ROOT, 'mock', 'seed-profile.json');
const STATUS_FILE = path.join(ROOT, 'mock', 'status.json');
const NEWS_FILE = path.join(ROOT, 'mock', 'news.json');

function ensureDir() {
  if (!fs.existsSync(SAVE_DIR)) fs.mkdirSync(SAVE_DIR, { recursive: true });
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function writeJSON(file, data) {
  ensureDir();
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

/* ------------------------- 档案 ------------------------- */
const ACCOUNT_FILE = path.join(SAVE_DIR, 'account.json');
const PROFILE_FILE = path.join(SAVE_DIR, 'profile.json');

function seedProfile(name) {
  const seed = readJSON(SEED_FILE, null) || {};
  const p = seed.profile ? structuredClone(seed.profile) : {};
  Object.assign(p, {
    v: 1,
    name,
    created: Date.now(),
    stardust: 0,
    totalStardust: 0,
    bonk: 0,
    totalBonk: 0,
    unlocked: [],
    league: [],
    starter: 0,
    forms: [],
    research: {},
    captured: {},
    seen: [],
    played: [],
    shinies: [],
    classics: [],
    skins: [],
    team: [],
    lab: {},
    biomes: { forest: 0 },
    quests: {},
    counters: {},
    runs: [],
    best: {},
    times: {},
    kills: {},
    medals: {},
    endless: {},
    bag: {},
  });
  return p;
}

function getAccount() {
  let acc = readJSON(ACCOUNT_FILE, null);
  if (!acc) {
    const id = crypto.randomUUID();
    const n = Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, '0');
    acc = { id, name: '训练家 ' + n, guest: true, token: crypto.randomBytes(18).toString('base64url'), created: Date.now() };
    writeJSON(ACCOUNT_FILE, acc);
  }
  return acc;
}

function getProfile() {
  const acc = getAccount();
  let p = readJSON(PROFILE_FILE, null);
  if (!p || typeof p !== 'object') {
    p = seedProfile(acc.name);
    writeJSON(PROFILE_FILE, p);
  }
  return p;
}

function saveProfile(p) {
  p.name = p.name || getAccount().name;
  writeJSON(PROFILE_FILE, p);
  return p;
}

/* ------------------------- 工具 ------------------------- */
function uniq(list) { return [...new Set(list)]; }

function mergeProgress(profile, result) {
  const prog = (result && result.progress) || {};
  if (prog.counters) {
    for (const [k, v] of Object.entries(prog.counters)) {
      if (typeof v === 'number' && v > 0) profile.counters[k] = (profile.counters[k] || 0) + v;
    }
  }
  if (prog.research) {
    for (const [k, v] of Object.entries(prog.research)) {
      if (typeof v === 'number' && v > 0) profile.research[k] = (profile.research[k] || 0) + v;
    }
  }
  for (const key of ['seen', 'league', 'shinies', 'classics', 'forms']) {
    if (Array.isArray(prog[key]) && prog[key].length) {
      profile[key] = uniq([...(profile[key] || []), ...prog[key]]);
    }
  }
  if (profile.league.length && !profile.starter) profile.starter = profile.league[0];
  return profile;
}

function rewardsFor(result) {
  const kills = Number(result?.kills) || 0;
  const time = Number(result?.time) || 0;
  const stage = Number(result?.stage) || 0;
  const dusty = Math.max(1, Math.round(kills * 1.5 + stage * 25 + time * 0.4));
  const bonk = Math.max(0, Math.round(kills * 0.15 + stage * 3));
  return { stardust: dusty, dust: dusty, bonk, items: [] };
}

/* ------------------------- 星尘商店 ------------------------- */
/* 价格与客户端一致：当日第 n 次购买 = 基础价 × 1.5^n，名额按 UTC 日重置 */
const SHOP = {
  'rare-candy': { base: 150, daily: 4 },
  'lucky-egg': { base: 250, daily: 4 },
  'amulet-coin': { base: 250, daily: 4 },
  honey: { base: 450, daily: 3 },
  'shiny-stone': { base: 900, daily: 2 },
  'master-ball': { base: 1800, daily: 1 },
};

function shopDay(now) { return Math.floor(now / 86400000); }

function buyShop(p, id, now) {
  const entry = SHOP[id];
  if (!entry) return false;
  const day = shopDay(now);
  const sameDay = p.shop && p.shop.day === day && p.shop.n;
  const bought = sameDay ? (p.shop.n[id] || 0) : 0;
  if (bought >= entry.daily) return false;
  p.bag = p.bag || {};
  if ((p.bag[id] || 0) >= 9) return false;
  // 第 n 次购买（n 从 0 起）：基础价 × (1 + 0.5n)，即 150 → 225 → 300 → 375 …
  const price = Math.round(entry.base * (1 + 0.5 * bought));
  if ((p.stardust || 0) < price) return false;
  p.stardust = (p.stardust || 0) - price;
  p.bag[id] = (p.bag[id] || 0) + 1;
  p.shop = {
    day,
    n: Object.assign({}, sameDay ? p.shop.n : {}, { [id]: bought + 1 }),
  };
  return true;
}

/* ------------------------- 接口实现 ------------------------- */
const STATUS = readJSON(STATUS_FILE, null) || {
  maintenance: { on: false, title: '', message: '', eta: 0 },
  bypass: false,
  season: { n: 1, name: '', start: Date.now() - 86400000, end: Date.now() + 86400000 * 60, live: true, dust: 1, message: '', next: null },
  events: [],
  registration: { inviteOnly: false },
};

const NEWS = readJSON(NEWS_FILE, null) || [];

function handle(req, res, urlPath, query, body) {
  const now = Date.now();
  const method = req.method.toUpperCase();
  const seg = urlPath.replace(/^\/+|\/+$/g, '').split('/');

  const json = (code, data) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };

  /* --- 状态 --- */
  if (urlPath === '/status') return json(200, STATUS);
  if (urlPath === '/version.json') {
    return json(200, { build: 'mvob1c8t', version: '0.8.55', offline: true });
  }

  /* --- 认证 --- */
  if (urlPath === '/auth/guest' && method === 'POST') {
    const acc = getAccount();
    getProfile();
    return json(200, { id: acc.id, name: acc.name, token: acc.token });
  }
  if (urlPath === '/auth/me') {
    const acc = getAccount();
    return json(200, { id: acc.id, name: acc.name, guest: true });
  }
  if (urlPath === '/auth/logout') return json(200, { ok: true });
  if (urlPath === '/auth/name') return json(200, { available: true, ok: true });
  if (urlPath === '/auth/register' || urlPath === '/auth/upgrade') {
    const acc = getAccount();
    if (body && typeof body.name === 'string' && body.name.trim()) {
      acc.name = body.name.trim().slice(0, 16);
      const p = getProfile();
      p.name = acc.name;
      saveProfile(p);
      writeJSON(ACCOUNT_FILE, acc);
    }
    return json(200, { id: acc.id, name: acc.name, token: acc.token, guest: false });
  }
  if (urlPath === '/auth/login') {
    const acc = getAccount();
    return json(200, { id: acc.id, name: acc.name, token: acc.token, guest: false });
  }

  /* --- 存档迁移（整体快照） --- */
  if (urlPath === '/save/export') {
    return json(200, {
      format: 1,
      app: 'PokebonkOffline',
      exportedAt: new Date().toISOString(),
      account: getAccount(),
      profile: getProfile(),
      now,
    });
  }
  if (urlPath === '/save/import' && method === 'POST') {
    const b = body || {};
    if (b.account && typeof b.account === 'object' && b.account.id) {
      const cur = getAccount();
      writeJSON(ACCOUNT_FILE, Object.assign({}, cur, b.account));
    }
    if (b.profile && typeof b.profile === 'object') {
      saveProfile(Object.assign({}, b.profile));
    }
    return json(200, { ok: true, profile: getProfile(), now });
  }
  if (urlPath === '/save/reset' && method === 'POST') {
    const acc = getAccount();
    saveProfile(seedProfile(acc.name));
    return json(200, { ok: true, profile: getProfile(), now });
  }

  /* --- 档案 --- */
  if (urlPath === '/profile' && method === 'GET') {
    return json(200, { profile: getProfile(), now });
  }
  if (urlPath === '/profile/prefs' && (method === 'PUT' || method === 'POST')) {
    const p = getProfile();
    const b = body || {};
    for (const k of ['settings', 'lastSpecies', 'lastBiome', 'avatar', 'frame', 'title', 'skins', 'team']) {
      if (b[k] !== undefined) p[k] = b[k];
    }
    saveProfile(p);
    return json(200, { ok: true, profile: p, now });
  }
  if (urlPath === '/profile/starter' && method === 'POST') {
    const p = getProfile();
    const id = Number(body?.species ?? body?.id ?? 0);
    if (!id) return json(400, { error: '缺少初始宝可梦' });
    if (p.starter) return json(409, { error: '已经选择过伙伴' });
    p.starter = id;
    p.unlocked = uniq([...(p.unlocked || []), id]);
    p.league = uniq([...(p.league || []), id]);
    p.lastSpecies = id;
    saveProfile(p);
    return json(200, { profile: p, now });
  }
  if (urlPath === '/profile/actions' && method === 'POST') {
    const p = getProfile();
    const acts = Array.isArray(body?.actions) ? body.actions : null;
    if (acts) {
      // 客户端是「本地先算、再把结果交给服务端确认」的模式，
      // 因此这里必须复算出同样结果，否则返回的旧档案会把客户端的改动覆盖掉。
      for (const a of acts) {
        if (a && a.k === 'shop') buyShop(p, a.id, now);
      }
    } else {
      mergeProgress(p, { progress: body?.progress || {} });
    }
    saveProfile(p);
    return json(200, { profile: p, now });
  }
  if (urlPath === '/account/rename' && method === 'POST') {
    const acc = getAccount();
    if (body?.name) { acc.name = String(body.name).slice(0, 16); writeJSON(ACCOUNT_FILE, acc); }
    const p = getProfile(); p.name = acc.name; saveProfile(p);
    return json(200, { id: acc.id, name: acc.name, guest: true });
  }
  if (urlPath === '/account/reset' && method === 'POST') {
    const acc = getAccount();
    saveProfile(seedProfile(acc.name));
    return json(200, { profile: getProfile(), now });
  }

  /* --- 对局 --- */
  if (urlPath === '/runs' && method === 'POST') {
    const id = crypto.randomBytes(16).toString('hex');
    const seed = crypto.randomBytes(4).readUInt32BE(0);
    return json(200, {
      id,
      seed,
      ranked: false,
      boosts: Array.isArray(body?.boosts) ? body.boosts : [],
    });
  }
  let m = urlPath.match(/^\/runs\/([^/]+)\/checkpoint$/);
  if (m) return json(200, { ok: true });
  m = urlPath.match(/^\/runs\/([^/]+)\/finish$/);
  if (m) {
    const p = getProfile();
    const result = body?.result || {};
    mergeProgress(p, result);
    const rw = rewardsFor(result);
    p.stardust = (p.stardust || 0) + rw.stardust;
    p.totalStardust = (p.totalStardust || 0) + rw.stardust;
    p.bonk = (p.bonk || 0) + rw.bonk;
    p.totalBonk = (p.totalBonk || 0) + rw.bonk;
    saveProfile(p);

    // 结算面板需要的战绩记录（字段与客户端 showSummary 对齐）
    const record = Object.assign({
      victory: false,
      stage: 1,
      species: p.lastSpecies || p.starter || 1,
      finalSpecies: p.lastSpecies || p.starter || 1,
      level: 1,
      tier: 0,
      time: 0,
      kills: 0,
      damage: 0,
      score: 0,
      target: 0,
      code: '',
      gold: 0,
      timer: 0,
      clock: 0,
      mile: 0,
    }, result);

    return json(200, {
      profile: p,
      rewards: rw,
      record,
      rank: null,
      ranked: false,
      coop: false,
      kills: record.kills,
      stardust: rw.stardust,
      bonk: rw.bonk,
      offline: false,
      now,
    });
  }

  /* --- 商店 / 养成（客户端主导，服务端确认） --- */
  if (/^\/(shop|items|lab)\/buy$/.test(urlPath) && method === 'POST') {
    return json(200, { profile: getProfile(), ok: true, now });
  }
  if (/^\/treasures\/spin$/.test(urlPath)) return json(200, { profile: getProfile(), prize: null, now });
  if (/^\/(quests|tasks)\/claim$/.test(urlPath)) return json(200, { profile: getProfile(), ok: true, now });
  if (/^\/tasks\/reroll$/.test(urlPath)) return json(200, { profile: getProfile(), ok: true, now });

  /* --- 排行榜 / 成绩：返回可渲染的空榜 --- */
  if (/^\/leaderboard/.test(urlPath)) {
    const season = STATUS.season || { n: 1, name: '', start: 0, end: 0, live: true, dust: 1, message: '', next: null };
    return json(200, {
      info: { ...season, live: true },
      entries: [],
      players: 0,
      my: null,
      rank: null,
      season: season.n,
    });
  }
  if (/^\/records/.test(urlPath)) return json(200, { best: null, entries: [], info: STATUS.season || null });

  /* --- 只读列表：返回空集合，避免界面报错 --- */
  const LIST_EMPTY = [
    /^\/seasons\/awards$/, /^\/players\/search$/,
    /^\/clans\/search$/, /^\/clans\/board$/, /^\/clans\/status$/, /^\/friends$/,
    /^\/mail$/, /^\/events\/[^/]+\/quest$/,
  ];
  if (urlPath === '/news') return json(200, NEWS);
  for (const re of LIST_EMPTY) if (re.test(urlPath)) return json(200, []);

  if (urlPath === '/seasons/claim') return json(200, { profile: getProfile(), ok: true, now });
  if (/^\/events\/[^/]+$/.test(urlPath)) {
    const id = decodeURIComponent(seg[1] || '');
    const ev = (STATUS.events || []).find((e) => e.id === id);
    return json(200, ev ? { ...ev, live: true, claimable: true } : { id, live: false, claimable: false, state: 'auto', points: { name: '', icon: '' }, art: {} });
  }
  if (/^\/events\//.test(urlPath)) return json(200, { ok: true });
  if (/^\/players\//.test(urlPath)) return json(200, { ok: true });
  if (/^\/clans/.test(urlPath)) return json(200, { ok: true, members: [], requests: 0 });
  if (/^\/coop/.test(urlPath)) return json(200, { servers: [], ok: true });
  if (/^\/feedback$/.test(urlPath)) return json(200, { ok: true });

  return json(200, {});
}

module.exports = { handle, SAVE_DIR };
