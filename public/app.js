'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtB = n => { if (n == null) return '–'; const u = ['B','KB','MB','GB','TB']; let i = 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + ' ' + u[i]; };
const fmtUp = s => { const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return `${d ? d + 'z ' : ''}${h}h ${m}m`; };
const level = p => p >= 90 ? 'bad' : p >= 75 ? 'warn' : '';
const bar = p => `<div class="bar ${level(p)}"><i style="width:${Math.min(100, p || 0)}%"></i></div>`;
const card = (t, big, small, p) => `<div class="card"><h3>${t}</h3><div class="big">${big}</div><div class="small">${small}</div>${p != null ? bar(p) : ''}</div>`;

let apps = [], ports = [], control = false, selfName = '';

async function get(url) {
  const r = await fetch(url);
  if (r.status === 401) { location.href = '/login'; throw new Error('sesiune expirata'); }
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
}

async function loadResources() {
  const r = await get('/api/resources');
  $('host').textContent = `${r.hostname} · ${r.platform} · uptime ${fmtUp(r.uptime)}`;
  const m = r.memory;
  const memP = m.used / m.total * 100;
  let h = card('CPU', (r.cpu.total ?? 0).toFixed(1) + '%', `${r.cpu.count} nuclee · ${esc(r.cpu.model)}`, r.cpu.total);
  h += card('Memorie', memP.toFixed(0) + '%', `${fmtB(m.used)} / ${fmtB(m.total)}`, memP);
  if (m.swapTotal) h += card('Swap', (m.swapUsed / m.swapTotal * 100).toFixed(0) + '%', `${fmtB(m.swapUsed)} / ${fmtB(m.swapTotal)}`, m.swapUsed / m.swapTotal * 100);
  h += card('Load average', r.load.map(x => x.toFixed(2)).join(' · '), '1 / 5 / 15 min');
  if (r.temperature != null) h += card('Temperatura', r.temperature.toFixed(0) + ' °C', 'maxim din senzori', r.temperature);
  for (const d of r.disks) {
    h += d.error ? card('Disc ' + esc(d.path), '–', esc(d.error))
      : card('Disc ' + esc(d.path), (d.used / d.total * 100).toFixed(0) + '%', `${fmtB(d.used)} / ${fmtB(d.total)} · liber ${fmtB(d.free)}`, d.used / d.total * 100);
  }
  for (const n of r.network) h += card('Retea ' + esc(n.iface), `↓ ${fmtB(n.rxRate)}/s`, `↑ ${fmtB(n.txRate)}/s · total ↓ ${fmtB(n.rx)} ↑ ${fmtB(n.tx)}`);
  $('res').innerHTML = h;
}

function renderApps() {
  const q = $('appFilter').value.toLowerCase();
  const list = apps.filter(a => !q || `${a.name} ${a.image} ${a.project}`.toLowerCase().includes(q));
  const run = apps.filter(a => a.state === 'running').length;
  $('appCount').textContent = `(${run} pornite / ${apps.length} total)`;
  $('apps').innerHTML = list.map(a => {
    const s = a.stats;
    const stat = s ? `CPU ${s.cpu.toFixed(1)}% · RAM ${fmtB(s.mem)}${s.memLimit && s.memLimit < 2 ** 50 ? ' / ' + fmtB(s.memLimit) : ''}` : '';
    const pt = [...new Map(a.ports.map(p => [p.host + p.proto, p])).values()]
      .map(p => p.proto === 'tcp' ? `<a class="tag" href="http://${location.hostname}:${p.host}" target="_blank" rel="noopener">:${p.host}</a>` : `<span class="tag">:${p.host}/${p.proto}</span>`).join('');
    return `<div class="card app"><div class="top"><span class="name"><span class="dot ${esc(a.state)}"></span>${esc(a.name)}</span><span class="small">${esc(a.state)}</span></div>
      <div class="small">${esc(a.image)}</div><div class="small">${esc(a.status)}</div>${stat ? `<div class="small">${stat}</div>` : ''}
      ${control && a.name !== selfName ? `<div class="actions">${
        a.state === 'running'
          ? `<button data-act="restart" data-id="${esc(a.id)}">Restart</button><button data-act="stop" data-id="${esc(a.id)}" class="danger">Stop</button>`
          : `<button data-act="start" data-id="${esc(a.id)}">Start</button>`}</div>` : ''}
      <div class="tags">${a.project ? `<span class="tag">${esc(a.project)}</span>` : ''}${pt}</div></div>`;
  }).join('') || '<div class="small">Nicio aplicatie.</div>';
}

function renderPorts() {
  const q = $('portFilter').value.toLowerCase();
  const only = $('onlyExposed').checked;
  const list = ports.filter(p => (!only || p.exposed) && (!q || `${p.port} ${p.proto} ${p.process} ${p.container}`.toLowerCase().includes(q)));
  $('portCount').textContent = `(${list.length})`;
  $('ports').innerHTML = list.map(p => `<tr><td><b>${p.port}</b></td><td>${p.proto.toUpperCase()}</td><td>${esc(p.container || '–')}</td>
    <td>${esc(p.process || '–')}${p.pid ? ` <span class="small">(${p.pid})</span>` : ''}</td><td class="small">${p.addresses.map(esc).join(', ')}</td>
    <td><span class="pill ${p.exposed ? 'ext' : 'loc'}">${p.exposed ? 'retea' : 'local'}</span></td></tr>`).join('');
}

async function tick(fn, errId) {
  try { await fn(); if (errId) $(errId).textContent = ''; $('status').textContent = 'actualizat ' + new Date().toLocaleTimeString('ro-RO'); }
  catch (e) { if (errId) $(errId).textContent = 'Eroare: ' + e.message; else $('status').textContent = 'eroare: ' + e.message; }
}
const loadApps = async () => { const r = await get('/api/apps'); apps = r.list; control = r.control; selfName = r.self; renderApps(); };
const loadPorts = async () => { ports = await get('/api/ports'); renderPorts(); };

$('appFilter').oninput = renderApps;
$('portFilter').oninput = renderPorts;
$('onlyExposed').onchange = renderPorts;

const run = () => { tick(loadResources); tick(loadApps, 'appsErr'); tick(loadPorts); };
run();
setInterval(() => tick(loadResources), 2000);
setInterval(() => { tick(loadApps, 'appsErr'); tick(loadPorts); }, 5000);

$('logout').onclick = async e => { e.preventDefault(); await fetch('/auth/logout', { method: 'POST' }); location.href = '/login'; };

$('genPort').onclick = async () => {
  try {
    const r = await fetch('/api/free-port', { method: 'POST' });
    if (r.status === 401) { location.href = '/login'; return; }
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    $('freePort').textContent = j.port;
    $('freeMsg').textContent = `Liber (interval ${j.range[0]}–${j.range[1]}); rezervat 10 minute.`;
    $('copyPort').hidden = false;
  } catch (e) { $('freeMsg').textContent = 'Eroare: ' + e.message; }
};
$('copyPort').onclick = async () => {
  try { await navigator.clipboard.writeText($('freePort').textContent); $('copyPort').textContent = 'Copiat'; }
  catch { $('copyPort').textContent = 'Nu pot copia'; }
  setTimeout(() => $('copyPort').textContent = 'Copiaza', 1500);
};

const LABEL = { start: 'pornit', stop: 'oprit', restart: 'repornit' };
$('apps').onclick = async e => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const { act, id } = b.dataset;
  const app = apps.find(x => x.id === id);
  if (act !== 'start' && !confirm(`${act === 'stop' ? 'Opresti' : 'Repornesti'} containerul "${app ? app.name : id}"?`)) return;
  const row = b.parentElement;
  row.querySelectorAll('button').forEach(x => x.disabled = true);
  b.textContent = '…';
  try {
    const r = await fetch(`/api/containers/${id}/${act}`, { method: 'POST' });
    if (r.status === 401) { location.href = '/login'; return; }
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    $('status').textContent = `${j.name} ${LABEL[act]}`;
  } catch (err) {
    $('appsErr').textContent = 'Eroare: ' + err.message;
  }
  tick(loadApps, 'appsErr'); tick(loadPorts);
};
