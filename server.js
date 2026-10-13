'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = parseInt(process.env.PORT || '5299', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const DISK_PATHS = (process.env.DISK_PATHS || '/').split(',').map(s => s.trim()).filter(Boolean);
const PUBLIC = path.join(__dirname, 'public');

const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };

// ---------- Resurse ----------
let prevCpu = null;
function cpuTimes() {
  const line = (read('/proc/stat') || '').split('\n').filter(l => l.startsWith('cpu'));
  return line.map(l => {
    const p = l.trim().split(/\s+/).slice(1).map(Number);
    const idle = p[3] + (p[4] || 0);
    return { idle, total: p.reduce((a, b) => a + b, 0) };
  });
}
function cpuUsage() {
  const cur = cpuTimes();
  if (!cur.length) return { total: null, cores: [] };
  let res = { total: 0, cores: cur.slice(1).map(() => 0) };
  if (prevCpu && prevCpu.length === cur.length) {
    const pct = (a, b) => {
      const dt = b.total - a.total;
      return dt > 0 ? Math.round((1 - (b.idle - a.idle) / dt) * 1000) / 10 : 0;
    };
    res.total = pct(prevCpu[0], cur[0]);
    res.cores = cur.slice(1).map((c, i) => pct(prevCpu[i + 1], c));
  }
  prevCpu = cur;
  return res;
}

function memInfo() {
  const m = {};
  for (const l of (read('/proc/meminfo') || '').split('\n')) {
    const x = l.match(/^(\w+):\s+(\d+)/);
    if (x) m[x[1]] = parseInt(x[2], 10) * 1024;
  }
  const total = m.MemTotal || os.totalmem();
  const avail = m.MemAvailable ?? os.freemem();
  const swapTotal = m.SwapTotal || 0;
  return {
    total, used: total - avail, available: avail,
    swapTotal, swapUsed: swapTotal - (m.SwapFree || 0),
  };
}

function disks() {
  return DISK_PATHS.map(p => {
    try {
      const s = fs.statfsSync(p);
      const total = s.blocks * s.bsize;
      const free = s.bavail * s.bsize;
      return { path: p, total, used: total - s.bfree * s.bsize, free };
    } catch (e) { return { path: p, error: e.code || 'eroare' }; }
  });
}

let prevNet = null;
function network() {
  const now = Date.now();
  const cur = {};
  for (const l of (read('/proc/net/dev') || '').split('\n').slice(2)) {
    const [name, rest] = l.split(':');
    if (!rest) continue;
    const iface = name.trim();
    if (iface === 'lo' || /^(veth|br-|docker)/.test(iface)) continue;
    const p = rest.trim().split(/\s+/).map(Number);
    cur[iface] = { rx: p[0], tx: p[8] };
  }
  const out = Object.entries(cur).map(([iface, v]) => {
    let rxRate = 0, txRate = 0;
    if (prevNet && prevNet.data[iface]) {
      const dt = (now - prevNet.t) / 1000;
      if (dt > 0) {
        rxRate = Math.max(0, (v.rx - prevNet.data[iface].rx) / dt);
        txRate = Math.max(0, (v.tx - prevNet.data[iface].tx) / dt);
      }
    }
    return { iface, rx: v.rx, tx: v.tx, rxRate, txRate };
  });
  prevNet = { t: now, data: cur };
  return out;
}

function temperature() {
  const dir = '/sys/class/thermal';
  try {
    const vals = fs.readdirSync(dir).filter(d => d.startsWith('thermal_zone'))
      .map(d => parseInt(read(`${dir}/${d}/temp`), 10) / 1000).filter(Number.isFinite);
    return vals.length ? Math.max(...vals) : null;
  } catch { return null; }
}

function resources() {
  const [l1, l5, l15] = os.loadavg();
  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    uptime: os.uptime(),
    cpu: { model: (os.cpus()[0] || {}).model || '', count: os.cpus().length, ...cpuUsage() },
    load: [l1, l5, l15],
    memory: memInfo(),
    disks: disks(),
    network: network(),
    temperature: temperature(),
  };
}

// ---------- Docker ----------
function docker(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: DOCKER_SOCKET, path: pathname, timeout: 8000 }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('raspuns Docker invalid')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout Docker')));
    req.on('error', reject);
    req.end();
  });
}

function containerStats(s) {
  const cpuDelta = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
  const sysDelta = (s.cpu_stats.system_cpu_usage || 0) - (s.precpu_stats.system_cpu_usage || 0);
  const ncpu = s.cpu_stats.online_cpus || (s.cpu_stats.cpu_usage.percpu_usage || []).length || 1;
  const cpu = sysDelta > 0 && cpuDelta >= 0 ? (cpuDelta / sysDelta) * ncpu * 100 : 0;
  const ms = s.memory_stats || {};
  const cache = (ms.stats && (ms.stats.inactive_file ?? ms.stats.cache)) || 0;
  return { cpu: Math.round(cpu * 10) / 10, mem: Math.max(0, (ms.usage || 0) - cache), memLimit: ms.limit || 0 };
}

async function apps() {
  const list = await docker('/containers/json?all=1');
  const running = list.filter(c => c.State === 'running');
  const stats = {};
  await Promise.all(running.map(async c => {
    try { stats[c.Id] = containerStats(await docker(`/containers/${c.Id}/stats?stream=false&one_shot=true`)); }
    catch { /* fara statistici */ }
  }));
  return list.map(c => ({
    id: c.Id.slice(0, 12),
    name: (c.Names[0] || '').replace(/^\//, ''),
    image: c.Image,
    state: c.State,
    status: c.Status,
    created: c.Created,
    project: (c.Labels || {})['com.docker.compose.project'] || null,
    ports: (c.Ports || []).filter(p => p.PublicPort).map(p => ({ host: p.PublicPort, container: p.PrivatePort, proto: p.Type })),
    stats: stats[c.Id] || null,
  })).sort((a, b) => (a.state === 'running') === (b.state === 'running') ? a.name.localeCompare(b.name) : a.state === 'running' ? -1 : 1);
}

// ---------- Porturi ----------
const TCP_STATES_LISTEN = '0A';
function parseNet(file, proto) {
  const out = [];
  for (const l of (read(file) || '').split('\n').slice(1)) {
    const p = l.trim().split(/\s+/);
    if (p.length < 10) continue;
    const [addrHex, portHex] = p[1].split(':');
    const state = p[3];
    // TCP: doar LISTEN; UDP: socket-uri legate (state 07)
    if (proto.startsWith('tcp') ? state !== TCP_STATES_LISTEN : state !== '07') continue;
    out.push({ proto: proto.replace(/6$/, ''), port: parseInt(portHex, 16), address: hexToIp(addrHex), inode: p[9], v6: proto.endsWith('6') });
  }
  return out;
}
function hexToIp(h) {
  if (h.length === 8) return h.match(/../g).reverse().map(x => parseInt(x, 16)).join('.');
  if (/^0+$/.test(h)) return '::';
  const words = h.match(/.{8}/g).map(w => w.match(/../g).reverse().join(''));
  const g = words.join('').match(/.{4}/g).map(x => x.replace(/^0+(?=.)/, ''));
  return g.join(':').replace(/(^|:)0(:0)+(:|$)/, '::');
}

function inodeOwners() {
  const map = {};
  let pids = [];
  try { pids = fs.readdirSync('/proc').filter(d => /^\d+$/.test(d)); } catch { return map; }
  for (const pid of pids) {
    let fds;
    try { fds = fs.readdirSync(`/proc/${pid}/fd`); } catch { continue; }
    let name = null;
    for (const fd of fds) {
      let link;
      try { link = fs.readlinkSync(`/proc/${pid}/fd/${fd}`); } catch { continue; }
      const m = link.match(/^socket:\[(\d+)\]$/);
      if (!m) continue;
      if (name === null) name = (read(`/proc/${pid}/comm`) || '').trim() || pid;
      map[m[1]] = { pid: parseInt(pid, 10), process: name };
    }
  }
  return map;
}

async function ports() {
  const sockets = [
    ...parseNet('/proc/net/tcp', 'tcp'), ...parseNet('/proc/net/tcp6', 'tcp6'),
    ...parseNet('/proc/net/udp', 'udp'), ...parseNet('/proc/net/udp6', 'udp6'),
  ];
  const owners = inodeOwners();
  let containers = [];
  try { containers = await apps(); } catch { /* docker indisponibil */ }
  const byPort = {};
  for (const c of containers) for (const p of c.ports) byPort[`${p.proto}:${p.host}`] = c.name;

  const seen = new Map();
  for (const s of sockets) {
    const key = `${s.proto}:${s.port}`;
    const o = owners[s.inode] || {};
    const exposed = !/^(127\.|::1$)/.test(s.address);
    const cur = seen.get(key);
    if (cur) {
      cur.addresses.add(s.address);
      cur.exposed = cur.exposed || exposed;
      if (!cur.process && o.process) { cur.process = o.process; cur.pid = o.pid; }
      continue;
    }
    seen.set(key, {
      port: s.port, proto: s.proto, addresses: new Set([s.address]), exposed,
      process: o.process || null, pid: o.pid || null, container: byPort[key] || null,
    });
  }
  return [...seen.values()].map(x => ({ ...x, addresses: [...x.addresses] })).sort((a, b) => a.port - b.port || a.proto.localeCompare(b.proto));
}


// ---------- Autentificare ----------
const crypto = require('crypto');
const AUTH_USER = process.env.AUTH_USER || 'admin';
const SESSION_TTL = (parseInt(process.env.SESSION_HOURS || '168', 10)) * 3600 * 1000;
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true'; // pune true cand e servit prin HTTPS
const AUTH_DISABLED = process.env.AUTH_DISABLED === 'true';

// AUTH_PASSWORD_HASH (format "scrypt$salt$hash", vezi `node hash-password.js`) sau AUTH_PASSWORD in clar.
let passwordHash = process.env.AUTH_PASSWORD_HASH || null;
if (!passwordHash) {
  let pw = process.env.AUTH_PASSWORD;
  if (!pw && !AUTH_DISABLED) {
    pw = crypto.randomBytes(9).toString('base64url');
    console.log(`[auth] AUTH_PASSWORD nesetat. Parola generata pentru "${AUTH_USER}": ${pw}`);
  }
  if (pw) {
    const salt = crypto.randomBytes(16).toString('hex');
    passwordHash = `scrypt$${salt}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
  }
}
function safeEq(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function checkPassword(pw) {
  const [alg, salt, hash] = (passwordHash || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const got = crypto.scryptSync(String(pw), salt, hash.length / 2);
  return crypto.timingSafeEqual(got, Buffer.from(hash, 'hex'));
}

const sessions = new Map(); // token -> expira
function getCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
function isAuthed(req) {
  if (AUTH_DISABLED) return true;
  const t = getCookie(req, 'sid');
  const exp = t && sessions.get(t);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(t); return false; }
  return true;
}
const cookie = (v, maxAge) =>
  `sid=${v}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${COOKIE_SECURE ? '; Secure' : ''}`;

// limitare incercari: 5 esecuri / 15 min per IP
const fails = new Map();
function blocked(ip) {
  const f = fails.get(ip);
  return f && f.until > Date.now() && f.n >= 5;
}
function noteFail(ip) {
  const f = fails.get(ip);
  if (!f || f.until < Date.now()) fails.set(ip, { n: 1, until: Date.now() + 15 * 60 * 1000 });
  else f.n++;
}
setInterval(() => {
  const now = Date.now();
  for (const [t, e] of sessions) if (e < now) sessions.delete(t);
  for (const [ip, f] of fails) if (f.until < now) fails.delete(ip);
}, 60 * 1000).unref();

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 4096) { reject(new Error('prea mare')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { reject(new Error('JSON invalid')); } });
    req.on('error', reject);
  });
}
const json = (res, code, obj, headers = {}) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
};

async function handleAuth(req, res, pathname) {
  const ip = req.socket.remoteAddress;
  if (pathname === '/auth/login' && req.method === 'POST') {
    if (blocked(ip)) return json(res, 429, { error: 'Prea multe incercari. Reincearca peste 15 minute.' });
    let body;
    try { body = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }
    const okUser = safeEq(body.username ?? '', AUTH_USER);
    const okPass = checkPassword(body.password ?? '');
    if (!(okUser && okPass)) { noteFail(ip); return json(res, 401, { error: 'Utilizator sau parola gresita.' }); }
    fails.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_TTL);
    return json(res, 200, { ok: true }, { 'Set-Cookie': cookie(token, SESSION_TTL / 1000) });
  }
  if (pathname === '/auth/logout' && req.method === 'POST') {
    sessions.delete(getCookie(req, 'sid'));
    return json(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
  }
  json(res, 404, { error: 'Not found' });
}

// ---------- Cache + server ----------
function cached(fn, ttl) {
  let val, t = 0, pending = null;
  return () => {
    if (val !== undefined && Date.now() - t < ttl) return Promise.resolve(val);
    if (pending) return pending;
    pending = Promise.resolve().then(fn).then(v => { val = v; t = Date.now(); return v; }).finally(() => { pending = null; });
    return pending;
  };
}
const routes = {
  '/api/resources': cached(resources, 1000),
  '/api/apps': cached(apps, 4000),
  '/api/ports': cached(ports, 4000),
};

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  if (url.pathname.startsWith('/auth/')) return handleAuth(req, res, url.pathname);
  const open = url.pathname === '/login' || url.pathname === '/style.css';
  if (!open && !isAuthed(req)) {
    if (url.pathname.startsWith('/api/')) return json(res, 401, { error: 'Neautentificat' });
    res.writeHead(302, { Location: '/login' }); res.end(); return;
  }
  if (url.pathname === '/login' && isAuthed(req)) { res.writeHead(302, { Location: '/' }); res.end(); return; }
  const route = routes[url.pathname];
  if (route) {
    try {
      const data = await route();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  const rel = url.pathname === '/' ? 'index.html' : url.pathname === '/login' ? 'login.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end('Not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

cpuUsage(); network();
if (AUTH_DISABLED) console.warn('[auth] ATENTIE: autentificarea este dezactivata (AUTH_DISABLED=true)');
server.listen(PORT, HOST, () => console.log(`Billuminatti ruleaza pe http://${HOST}:${PORT}`));
