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
  // 临时文件名必须唯一：多个进程同时写时，共用一个 .tmp 会出现
  // 「A 写临时文件 → B 覆盖临时文件 → A 改名」把 B 的内容写进去，导致丢档。
  const tmp = file + '.' + process.pid + '.' + (writeJSON._n = (writeJSON._n || 0) + 1) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

/* ------------------------- 跨进程写锁 ------------------------- */
/**
 * 有时会有两个服务实例（比如自己的 启动游戏.bat + 另一个窗口）同时开着，
 * 它们共享同一个 _save。两个请求各自「读档 → 改 → 写回」就会出现后写覆盖先写，
 * 表现就是「刚买的东西过一会儿又回去了」。这里用文件锁把写操作串起来。
 */
const LOCK_FILE = path.join(SAVE_DIR, '.write.lock');
const sleepSync = (ms) => {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch (e) { const t = Date.now(); while (Date.now() - t < ms) { /* 兜底忙等 */ } }
};

function withWriteLock(fn) {
  ensureDir();
  let fd = null;
  for (let i = 0; i < 6000; i++) {
    try {
      fd = fs.openSync(LOCK_FILE, 'wx');
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') break; // 锁文件出问题就直接放行，别把游戏卡死
      // 超过 5 秒的锁视为残留（进程被强杀），清掉重来
      try {
        const st = fs.statSync(LOCK_FILE);
        if (Date.now() - st.mtimeMs > 5000) fs.unlinkSync(LOCK_FILE);
      } catch (e2) { /* 已被别人删掉 */ }
      sleepSync(i < 20 ? 1 : 5);
    }
  }
  if (fd === null) console.error('[lock] timeout, proceeding without lock');
  try {
    return fn();
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (e) { /* ignore */ }
      try { fs.unlinkSync(LOCK_FILE); } catch (e) { /* ignore */ }
    }
  }
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
const ACTION_LOG = path.join(SAVE_DIR, 'actions.log');

/* 记录每一次会改档案的操作，方便排查「买完又回去了」这类问题 */
function logAction(a, ok, p) {
  try {
    ensureDir();
    let line = new Date().toISOString() + ' ' + (ok ? 'OK  ' : 'SKIP') + ' ' +
      JSON.stringify(a) + ' | lab=' + JSON.stringify(p.lab || {}) +
      ' dust=' + p.stardust + ' bag=' + Object.keys(p.bag || {}).length +
      ' items=' + (p.itemsOwned || []).length + '\n';
    try {
      const st = fs.statSync(ACTION_LOG);
      if (st.size > 256 * 1024) fs.writeFileSync(ACTION_LOG, '');
    } catch (e) { /* 文件不存在，忽略 */ }
    fs.appendFileSync(ACTION_LOG, line);
  } catch (e) { /* 日志失败不影响主流程 */ }
}

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
/* 价格与客户端一致：当日第 n 次购买 = 基础价 × (1 + 0.5n)，名额按 UTC 日重置 */
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

/* ------------------------- 研究所（Lab） ------------------------- */
/* 与客户端 news 分包里的实验室表完全一致：
   cost 统一走 0.85 系数并取 5 的整数倍（原站就是这么写的）。 */
const labRound = (v) => Math.round((v * 0.85) / 5) * 5;
const labConst = (v) => () => labRound(v);
const labGeo = (base, ratio) => (n) => labRound(base * Math.pow(ratio, n));
const labSteps = (arr) => (n) => labRound(arr[Math.min(n, arr.length - 1)]);

const LAB = {
  'slot-move': { max: 1, cost: labConst(1500) },
  'slot-vit': { max: 2, cost: labSteps([1200, 3000]) },
  reroll: { max: 6, cost: labGeo(120, 1.4) },
  skip: { max: 6, cost: labGeo(80, 1.4) },
  banish: { max: 6, cost: labGeo(150, 1.4) },
  choice4: { max: 1, cost: labConst(3000) },
  dmg: { max: 8, cost: labGeo(100, 1.4) },
  hp: { max: 8, cost: labGeo(100, 1.4) },
  spd: { max: 6, cost: labGeo(120, 1.45) },
  xp: { max: 6, cost: labGeo(120, 1.45) },
  gold: { max: 6, cost: labGeo(100, 1.45) },
  luck: { max: 6, cost: labGeo(140, 1.45) },
  magnet: { max: 5, cost: labGeo(80, 1.45) },
  regen: { max: 5, cost: labGeo(120, 1.45) },
  armor: { max: 6, cost: labGeo(120, 1.45) },
  revive: { max: 1, cost: labConst(5000) },
  research: { max: 4, cost: labGeo(250, 1.6) },
  party: { max: 1, cost: labConst(3500) },
  archive: { max: 6, cost: labSteps([600, 1200, 2000, 3000, 4000, 5500]) },
  crit: { max: 5, cost: labGeo(200, 1.5) },
  atkspd: { max: 5, cost: labGeo(220, 1.5) },
  area: { max: 5, cost: labGeo(200, 1.5) },
  ult: { max: 5, cost: labGeo(250, 1.5) },
  bag: { max: 1, cost: labConst(4000) },
};

function buyLab(p, id, wantLv) {
  const item = LAB[id];
  if (!item) return false;
  p.lab = p.lab || {};
  const cur = p.lab[id] || 0;
  // 客户端会带上它认为的最新等级。以它为准（只增不减），
  // 万一服务端落后一步也不会把刚买的等级吞回去。
  let target = Number(wantLv);
  if (!Number.isFinite(target) || target <= cur) target = cur + 1;
  target = Math.min(target, item.max);
  if (target <= cur) return false;
  let total = 0;
  for (let l = cur; l < target; l++) total += item.cost(l);
  if ((p.stardust || 0) < total) return false;
  p.stardust -= total;
  p.lab[id] = target;
  return true;
}

/* 永久解锁道具：花星尘买断，价格取自客户端的道具价目表 */
const ITEM_PRICE = {
  'soda-pop': 150, repel: 150, 'white-flute': 150, 'binding-band': 200, metronome: 200,
  'smooth-rock': 250, 'adrenaline-orb': 250, awakening: 250, 'old-rod': 300, 'burn-heal': 300,
  'ice-heal': 300, 'metal-powder': 300, lemonade: 250, 'secret-key': 300, 'gold-teeth': 300,
  'macho-brace': 350, 'focus-band': 350, 'kings-rock': 400, eviolite: 400, 'black-sludge': 400,
  'lum-berry': 450, stick: 500, 'shed-shell': 500, 'razor-fang': 550, 'cell-battery': 600,
  bicycle: 500, 'iron-ball': 500, 'fresh-water': 550, 'full-heal': 550, 'guard-spec': 600,
  'coin-case': 600, 'poke-doll': 550, 'dowsing-machine': 600, 'focus-sash': 900, 'comet-shard': 900,
  'fire-stone': 1000, 'thunder-stone': 1000, 'ice-stone': 1000, 'leaf-stone': 1000,
  protector: 1100, electirizer: 1100, revive: 1200, 'griseous-orb': 1200, 'reaper-cloth': 1400,
  'thick-club': 1100, 'rage-candy-bar': 1100, 'silph-scope': 1200, 'ss-ticket': 1200,
  'max-ether': 1200, 'moon-stone': 2200, 'silver-wing': 2500, 'sun-stone': 2500,
  'adamant-orb': 2800, 'lustrous-orb': 2800, 'soul-dew': 3000, 'dawn-stone': 3200,
  'rainbow-wing': 3500, 'poke-flute': 3000, 'tm-case': 3200,
};

function buyItem(p, key) {
  p.itemsOwned = p.itemsOwned || [];
  if (p.itemsOwned.includes(key)) return false;
  const price = ITEM_PRICE[key];
  // 价目表里没有的 key（正常不会出现）：不拦着，直接放行，
  // 宁可白送也不能让客户端「买了又被退回去」。
  if (price == null) {
    p.itemsOwned.push(key);
    return true;
  }
  if ((p.stardust || 0) < price) return false;
  p.stardust -= price;
  p.itemsOwned.push(key);
  return true;
}

/* 档案库栏位：每级 +5，另加「已解锁道具数 ÷ 2」（仅在档案库 ≥1 级时生效） */
function archiveSlots(p) {
  const arch = (p.lab && p.lab.archive) || 0;
  const bonus = arch > 0 ? Math.floor((p.itemsOwned || []).filter((k) => k in ITEM_PRICE).length / 2) : 0;
  return 5 * arch + bonus;
}

function archiveItem(p, key, off) {
  p.itemsOff = p.itemsOff || [];
  p.itemsOwned = p.itemsOwned || [];
  const already = p.itemsOff.includes(key);
  if (off) {
    if (already) return false;
    if (key in ITEM_PRICE && !p.itemsOwned.includes(key)) return false;
    if (p.itemsOff.length >= archiveSlots(p)) return false;
    p.itemsOff.push(key);
    return true;
  }
  if (!already) return false;
  p.itemsOff = p.itemsOff.filter((k) => k !== key);
  return true;
}

/* ------------------------- 委托 / 任务 ------------------------- */
/* 数据从客户端分包里一次性抽取到 mock/task-data.json（见 README） */
const TASK_DATA = readJSON(path.join(ROOT, 'mock', 'task-data.json'), null);
const QUEST_BY_ID = new Map(((TASK_DATA && TASK_DATA.quests) || []).map((q) => [q.id, q]));
const TASK_BY_ID = new Map();
if (TASK_DATA) {
  for (const period of ['daily', 'weekly']) {
    for (const slot of TASK_DATA.pools[period]) for (const t of slot) TASK_BY_ID.set(t.id, t);
  }
}

/* 与原站一致的整数混淆，用来按「周期序号 + 槽位」稳定抽取任务 */
function taskMix(x) {
  let t = (x ^ 2654435769) >>> 0;
  t = Math.imul(t ^ (t >>> 16), 2246822507) >>> 0;
  t = Math.imul(t ^ (t >>> 13), 3266489909) >>> 0;
  return (t ^ (t >>> 16)) >>> 0;
}

function periodIndex(period, now) {
  const day = 86400000;
  const base = TASK_DATA.epoch;
  return period === 'daily'
    ? Math.floor((now - base) / day) + 1
    : Math.floor((now - base) / (7 * day)) + 1;
}

function pickTask(period, idx, slot, reroll) {
  const pool = TASK_DATA.pools[period][slot];
  const a = taskMix(idx * 977 + slot * 131 + (period === 'weekly' ? 50000 : 0)) % pool.length;
  if (!reroll) return pool[a];
  return pool[(a + 1 + (taskMix(idx * 31 + slot * 7 + reroll * 1009) % (pool.length - 1))) % pool.length];
}

function ensureTasks(p, now) {
  if (!TASK_DATA) return;
  for (const period of ['daily', 'weekly']) {
    const idx = periodIndex(period, now);
    const cur = p[period];
    if (!cur || cur.idx !== idx || !Array.isArray(cur.ids) || cur.ids.length !== 3) {
      p[period] = {
        idx,
        ids: [0, 1, 2].map((s) => pickTask(period, idx, s).id),
        prog: [0, 0, 0],
        claimed: [0, 0, 0, 0],
        rerolls: 0,
      };
    }
  }
}

function bonusDaily(idx) {
  const pool = TASK_DATA.bonusPool;
  return pool[taskMix(idx * 61 + 7) % pool.length];
}

function bonusWeekly(idx) {
  const pool = TASK_DATA.bonusPool;
  return ['master-ball', pool[taskMix(idx * 17 + 3) % pool.length], pool[taskMix(idx * 23 + 5) % pool.length]];
}

/* 槽位 0~2 是三个日常/周常，槽位 3 是「三个都领完」的额外奖励 */
function taskReward(p, period, slot) {
  const d = p[period];
  if (slot < 3) return { dust: TASK_DATA.dust[period][slot], items: [] };
  if (period === 'weekly') return { dust: 500, items: bonusWeekly(d.idx) };
  const st = p.dailyStreak || { last: 0, n: 0 };
  const n = st.last === d.idx - 1 ? st.n + 1 : st.last === d.idx ? st.n : 1;
  return { dust: 50 * Math.min(5, n), items: [bonusDaily(d.idx)] };
}

function claimTask(p, period, slot, now) {
  if (!TASK_DATA || !['daily', 'weekly'].includes(period)) return false;
  if (!Number.isInteger(slot) || slot < 0 || slot > 3) return false;
  ensureTasks(p, now);
  const d = p[period];
  if (d.claimed[slot]) return false;
  if (slot === 3) {
    if (!(d.claimed[0] === 1 && d.claimed[1] === 1 && d.claimed[2] === 1)) return false;
  } else {
    const task = TASK_BY_ID.get(d.ids[slot]);
    if (!task || (d.prog[slot] || 0) < task.goal) return false;
  }
  const rw = taskReward(p, period, slot);
  d.claimed[slot] = 1;
  if (slot === 3 && period === 'daily') {
    const st = p.dailyStreak || { last: 0, n: 0 };
    p.dailyStreak = { last: d.idx, n: st.last === d.idx - 1 ? st.n + 1 : 1 };
  }
  if (slot < 3) {
    p.counters = p.counters || {};
    p.counters.tasks = (p.counters.tasks || 0) + 1;
  }
  p.bag = p.bag || {};
  for (const it of rw.items) p.bag[it] = Math.min(9, (p.bag[it] || 0) + 1);
  p.stardust = (p.stardust || 0) + rw.dust;
  p.totalStardust = (p.totalStardust || 0) + rw.dust;
  return true;
}

function rerollTask(p, period, slot, now) {
  if (!TASK_DATA || !['daily', 'weekly'].includes(period)) return false;
  if (!Number.isInteger(slot) || slot < 0 || slot > 2) return false;
  ensureTasks(p, now);
  const d = p[period];
  const cur = TASK_BY_ID.get(d.ids[slot]);
  if (d.rerolls >= 1 || d.claimed[slot]) return false;
  if (cur && (d.prog[slot] || 0) >= cur.goal) return false;
  let id = d.ids[slot];
  for (let r = d.rerolls + 1; r < d.rerolls + 8 && d.ids.includes(id); r++) id = pickTask(period, d.idx, slot, r).id;
  if (d.ids.includes(id)) return false;
  d.ids[slot] = id;
  d.prog[slot] = 0;
  d.rerolls += 1;
  return true;
}

/* 委托（成就式长期目标）：客户端只上报「已达成」，这里按表发奖 */
function claimQuest(p, id) {
  const q = QUEST_BY_ID.get(id);
  if (!q) return false;
  p.quests = p.quests || {};
  if (p.quests[id]) return false;
  p.quests[id] = 1;
  p.stardust = (p.stardust || 0) + q.reward;
  p.totalStardust = (p.totalStardust || 0) + q.reward;
  if (q.title) {
    p.cosmetics = p.cosmetics || [];
    const key = 'title:q:' + id;
    if (!p.cosmetics.includes(key)) p.cosmetics.push(key);
  }
  return true;
}

/* 任务进度：原版由服务端在对局结束时累加，这里按客户端上报的计数器差额复算 */
const BEST_METRICS = new Set(['level', 'stage', 'runKills']);

function metricDelta(metric, counters, result) {
  if (counters) {
    if (counters[metric] != null) return Number(counters[metric]) || 0;
    if (counters['best_' + metric] != null) return Number(counters['best_' + metric]) || 0;
  }
  const r = result || {};
  switch (metric) {
    case 'runs': return 1;
    case 'playtime': return Number(r.time) || 0;
    case 'wins': return r.victory ? 1 : 0;
    case 'kills': return Number(r.kills) || 0;
    case 'level': return Number(r.level) || 0;
    case 'stage': return Number(r.stage) || 0;
    case 'runKills': return Number(r.kills) || 0;
    default: return 0;
  }
}

function updateTaskProgress(p, counters, result, now) {
  if (!TASK_DATA) return;
  ensureTasks(p, now);
  for (const period of ['daily', 'weekly']) {
    const d = p[period];
    for (let slot = 0; slot < 3; slot++) {
      const task = TASK_BY_ID.get(d.ids[slot]);
      if (!task) continue;
      const v = metricDelta(task.metric, counters, result);
      if (!v) continue;
      const cur = d.prog[slot] || 0;
      d.prog[slot] = Math.min(task.goal, BEST_METRICS.has(task.metric) ? Math.max(cur, v) : cur + v);
    }
  }
}

/* ------------------------- 地区推进 ------------------------- */
/* 地区顺序取自客户端数据表；打通一张图，下一张才会开 */
const BIOME_ORDER = ['forest', 'desert', 'coast', 'glacier', 'graveyard', 'volcano'];

/* biomes[id] 的含义：-1 未解锁 / 0 已解锁未通关 / 1 普通通关 / 2 困难 / 3 噩梦 */
function completeBiome(p, biome, tier) {
  if (!BIOME_ORDER.includes(biome)) return false;
  p.biomes = p.biomes || {};
  const cur = p.biomes[biome] ?? 0;
  const reached = Math.max(cur, (Number(tier) || 0) + 1);
  const changed = reached !== cur;
  p.biomes[biome] = reached;
  // 链式解锁：前一张图通关后，后一张图自动开启（等级 0）
  for (let i = 1; i < BIOME_ORDER.length; i++) {
    const id = BIOME_ORDER[i];
    if (!(id in p.biomes) && (p.biomes[BIOME_ORDER[i - 1]] ?? -1) >= 1) p.biomes[id] = 0;
  }
  return changed;
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

/* 读请求直接放行；写请求（POST/PUT/DELETE）加跨进程锁，避免读改写互相覆盖 */
function handle(req, res, urlPath, query, body) {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD') return route(req, res, urlPath, query, body);
  if (process.env.PB_NOLOCK === '1') return route(req, res, urlPath, query, body); // 仅用于对比测试
  return withWriteLock(() => route(req, res, urlPath, query, body));
}

function route(req, res, urlPath, query, body) {
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
        if (!a) continue;
        let ok = false;
        if (a.k === 'shop') ok = buyShop(p, a.id, now);
        else if (a.k === 'lab') ok = buyLab(p, a.id, a.lv);
        else if (a.k === 'item') ok = buyItem(p, a.key);
        else if (a.k === 'archive') ok = archiveItem(p, a.key, a.off);
        else if (a.k === 'quest') ok = claimQuest(p, a.id);
        else if (a.k === 'task') ok = claimTask(p, a.period, a.slot, now);
        logAction(a, ok, p);
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
    // 每日/每周任务的进度由服务端维护（原版逻辑），这里按本次上报的计数器差额累加
    updateTaskProgress(p, result.progress && result.progress.counters, result, now);
    // 通关推进地区进度：普通 +1、困难 +2、噩梦 +3，同时解锁下一张图
    if (result.victory && result.biome && result.mode !== 'endless' && result.mode !== 'tower') {
      completeBiome(p, result.biome, result.tier);
    }
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

  /* --- 商店 / 养成 --- */
  /* 客户端购买走的是这三个直连接口（不是 /profile/actions），
     必须真的扣费并升级，否则返回的旧档案会把本地改动覆盖回去。 */
  if (/^\/(shop|items|lab)\/buy$/.test(urlPath) && method === 'POST') {
    const p = getProfile();
    let ok = false;
    if (urlPath === '/lab/buy') {
      const id = String(body?.id ?? '');
      ok = buyLab(p, id, body?.lv);
      logAction({ k: 'lab', id, lv: body?.lv }, ok, p);
    } else if (urlPath === '/items/buy') {
      const key = String(body?.key ?? '');
      ok = buyItem(p, key);
      logAction({ k: 'item', key }, ok, p);
    } else {
      const id = String(body?.id ?? '');
      const n = Math.max(1, Math.min(9, Number(body?.n) || 1));
      for (let i = 0; i < n; i++) {
        if (!buyShop(p, id, now)) break;
        ok = true;
      }
      logAction({ k: 'shop', id, n }, ok, p);
    }
    if (ok) saveProfile(p);
    return json(200, { profile: p, ok, now });
  }
  if (/^\/items\/archive$/.test(urlPath) && method === 'POST') {
    const p = getProfile();
    const key = String(body?.key ?? '');
    const off = !!body?.off;
    const ok = archiveItem(p, key, off);
    logAction({ k: 'archive', key, off }, ok, p);
    if (ok) saveProfile(p);
    return json(200, { profile: p, ok, now });
  }
  if (/^\/treasures\/spin$/.test(urlPath)) return json(200, { profile: getProfile(), prize: null, now });
  if (/^\/(quests|tasks)\/claim$/.test(urlPath) && method === 'POST') {
    const p = getProfile();
    if (urlPath.startsWith('/quests')) claimQuest(p, body?.id);
    else claimTask(p, body?.period, body?.slot, now);
    saveProfile(p);
    return json(200, { profile: p, ok: true, now });
  }
  if (/^\/tasks\/reroll$/.test(urlPath) && method === 'POST') {
    const p = getProfile();
    rerollTask(p, body?.period, body?.slot, now);
    saveProfile(p);
    return json(200, { profile: p, ok: true, now });
  }

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
