/* The calendar payload nests its category differently from vue-player-tournaments;
 * find where, then count 2026 by level. */
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const DBG = 9405;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const API = 'https://extranet-lv.bwfbadminton.com/api/';
const CATS = [20,21,22,23,24,25,26,27].map(c => 'category[]=' + c).join('&');

const profile = path.join(process.env.TEMP, 'wc26-cal-' + process.pid);
const chrome = spawn(CHROME, ['--no-first-run', '--no-default-browser-check',
  '--window-position=-2400,0', '--window-size=1200,900',
  '--user-data-dir=' + profile, '--remote-debugging-port=' + DBG, 'about:blank']);
chrome.stderr.on('data', () => {});
const kill = () => {
  try { spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
  try { chrome.kill(); } catch {}
};
let wsUrl = null;
for (let i = 0; i < 60 && !wsUrl; i++) {
  await new Promise(r => setTimeout(r, 400));
  try { wsUrl = (await (await fetch('http://127.0.0.1:' + DBG + '/json/version')).json()).webSocketDebuggerUrl; } catch {}
}
const ws = new WebSocket(wsUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
const send = (method, params = {}, sessionId) => new Promise(res => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId }));
});
const { targetId } = await send('Target.createTarget', { url: 'https://bwfbadminton.com/calendar/' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Runtime.enable', {}, sessionId);
await new Promise(r => setTimeout(r, 11000));
const ev = async e => (await send('Runtime.evaluate',
  { expression: e, returnByValue: true, awaitPromise: true }, sessionId))?.result?.value;

for (const year of [2026, 2027]) {
  const raw = await ev(`fetch(${JSON.stringify(API + 'vue-grouped-year-tournaments?year=' + year + '&' + CATS)},
    {headers:{accept:'application/json'}}).then(r=>r.text())`);
  const j = JSON.parse(raw);
  const all = [];
  for (const m of j.results || []) for (const t of m.tournaments || []) all.push(t);
  if (year === 2026) {
    console.log('=== one calendar entry, keys ===');
    console.log(Object.keys(all[0]).join(', '));
    console.log('\n=== sample values ===');
    for (const k of Object.keys(all[0])) {
      const v = all[0][k];
      if (v && typeof v === 'object') console.log('  ' + k + ': {' + Object.keys(v).slice(0, 10).join(',') + '}');
      else console.log('  ' + k + ': ' + JSON.stringify(v).slice(0, 70));
    }
  }
  // The calendar carries the level as a display string, not the id the player
  // endpoint uses: "HSBC BWF World Tour Super 1000". Reduce it to a short label.
  const short = s => String(s || '?')
    .replace(/^HSBC\s+/i, '').replace(/^BWF\s+/i, '').replace(/^World Tour\s+/i, '')
    .replace(/^Tour\s+/i, '').trim();
  const money = t => Number(String(t.prize_money || '0').replace(/[^0-9]/g, '')) || 0;

  const n = {}, byLevel = {}, purse = {};
  for (const t of all) {
    const c = short(t.category);
    n[c] = (n[c] || 0) + 1;
    (byLevel[c] = byLevel[c] || []).push(t.name);
    (purse[c] = purse[c] || []).push(money(t));
  }
  const ORD = ['Super 1000','Super 750','Super 500','Super 300','Super 100'];
  const rank = c => { const i = ORD.indexOf(c); return i < 0 ? 99 : i; };
  console.log('\n=== ' + year + ': ' + all.length + ' tournaments ===');
  const med = a => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1] || 0; };
  const top = med(purse['Super 1000'] || [1]);
  Object.keys(n).sort((a, b) => rank(a) - rank(b) || n[b] - n[a]).forEach(c => {
    const m = med(purse[c]);
    console.log('  ' + String(n[c]).padStart(2) + '  ' + c.padEnd(16)
      + (m ? '$' + (m / 1e3).toFixed(0).padStart(5) + 'k   ' + (m / top).toFixed(2) + ' of S1000' : ''));
  });
  if (year === 2026) for (const c of ORD.slice(0, 3)) {
    console.log('\n  ' + c + ' (' + (byLevel[c] || []).length + '):');
    (byLevel[c] || []).forEach(x => console.log('    - ' + x));
  }
}
ws.close(); kill();
