/* Launching and driving Chrome, in one place.
 *
 * Two hard-won rules live here and nowhere else, because every suite that
 * re-implemented them got one of them wrong:
 *
 *   1. BWF's Cloudflare 403s headless Chrome and serves real ones, so anything
 *      touching the live API has to drive a windowed browser. It is parked
 *      offscreen at -2400,0 rather than hidden. Headless is fine for
 *      screenshotting local files, and is not what this module is for.
 *
 *   2. On Windows the process we spawn is a *launcher*, not the browser.
 *      chrome.kill() reaps the launcher and leaves the real browser running,
 *      holding both the remote-debugging port (the next run cannot attach) and
 *      a lock on its --user-data-dir (so the cleanup rmSync fails silently and
 *      a ~50MB profile is left behind). Take the whole tree down with taskkill
 *      /T /F. These are one bug with two symptoms; the port symptom was
 *      misdiagnosed as a transient flake three times before the second symptom
 *      forced the real diagnosis.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

export const CHROME = process.env.CHROME
  || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

/** Every throwaway profile this project makes is named so the sweep can find it. */
export const PROFILE_PREFIX = 'bst-';

/**
 * Delete stale throwaway profiles.
 *
 * Each suite launches Chrome on a fresh ~50MB profile and deletes it on the way
 * out, but a suite that crashes — or whose Chrome outlives it, per rule 2 —
 * leaves one behind. On the predecessor 467 of them accumulated and took a
 * 238GB disk to zero bytes free, which surfaces as unrelated commands dying
 * with "No space left on device". So sweep at the *start* of every run rather
 * than trusting every exit path to be taken.
 *
 * Only directories older than an hour, so a suite running in another terminal
 * does not have its profile pulled out from under it.
 *
 * `wc26-` is the predecessor's prefix. That project is retired and its leavings
 * are on the same disk, so they are swept too — the same age cutoff protects
 * anyone still running it.
 */
export function sweepProfiles({ quiet = false } = {}) {
  const tmp = os.tmpdir();
  const cutoff = Date.now() - 60 * 60 * 1000;
  const prefixes = [PROFILE_PREFIX, 'wc26-'];
  let n = 0, bytes = 0;

  let entries = [];
  try { entries = fs.readdirSync(tmp).filter(f => prefixes.some(p => f.startsWith(p))); }
  catch { return { swept: 0, bytes: 0 }; }

  for (const f of entries) {
    const dir = path.join(tmp, f);
    try {
      if (fs.statSync(dir).mtimeMs > cutoff) continue;
      bytes += dirSize(dir);
      fs.rmSync(dir, { recursive: true, force: true });
      n++;
    } catch { /* locked by a live Chrome; the next run gets it */ }
  }

  if (n && !quiet) {
    console.log(`swept ${n} stale Chrome profile(s), ${(bytes / 1e9).toFixed(2)} GB\n`);
  }
  return { swept: n, bytes };
}

function dirSize(dir) {
  let total = 0;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const f = path.join(dir, e.name);
    try { total += e.isDirectory() ? dirSize(f) : fs.statSync(f).size; } catch {}
  }
  return total;
}

/**
 * Launch a windowed Chrome on a throwaway profile and attach to a fresh tab.
 *
 * Returns `{send, ev, wait, on, events, close, sessionId}`. The caller must
 * route CDP events it cares about via `on(handler)` — the fixture layer needs
 * every one of them.
 */
export async function launch({ port, tag = 'suite', windowSize = '1400,1000' } = {}) {
  const profile = path.join(os.tmpdir(), PROFILE_PREFIX + tag + '-' + process.pid);

  const chrome = spawn(CHROME, [
    '--no-first-run', '--no-default-browser-check',
    '--window-position=-2400,0', '--window-size=' + windowSize,
    '--user-data-dir=' + profile,
    '--remote-debugging-port=' + port,
    'about:blank',
  ]);
  chrome.stderr.on('data', () => {});

  const killChrome = () => {
    // Rule 2. taskkill first: chrome.kill() alone leaves the browser alive.
    try { spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); }
    catch { /* not on Windows, or already gone */ }
    try { chrome.kill(); } catch {}
  };

  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await new Promise(r => setTimeout(r, 400));
    try {
      const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      wsUrl = v.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
  }
  if (!wsUrl) {
    killChrome();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
    throw new Error(`Chrome never opened a debugging port on ${port}`);
  }

  const ws = new WebSocket(wsUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));

  let id = 0;
  const pending = new Map();
  const events = [];
  const handlers = [];

  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
    if (!m.method) return;
    events.push(m);
    for (const h of handlers) h(m);
  });

  const send = (method, params = {}, sessionId) => new Promise(res => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Log.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);

  /** Evaluate in the page. Returns {__err} rather than throwing, so a suite
      reports a broken expression as a failed check instead of a crash. */
  const ev = async expression => {
    const r = await send('Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (r && r.exceptionDetails) return { __err: r.exceptionDetails.text };
    return r && r.result ? r.result.value : undefined;
  };

  const wait = ms => new Promise(r => setTimeout(r, ms));

  /** Poll the page until `expression` is truthy, or give up. Cheaper and far
      less flaky than sleeping for a guessed number of seconds. */
  const until = async (expression, { timeout = 30000, step = 250 } = {}) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await ev(expression) === true) return true;
      await wait(step);
    }
    return false;
  };

  const close = () => {
    try { ws.close(); } catch {}
    killChrome();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  };

  return { send, ev, wait, until, events, sessionId, profile, close,
           on: h => handlers.push(h) };
}

/** Console errors and uncaught exceptions the page produced. */
export function pageErrors(events) {
  return {
    exceptions: events.filter(e => e.method === 'Runtime.exceptionThrown')
      .map(e => e.params.exceptionDetails.text),
    errors: events.filter(e => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
      .map(e => e.params.entry.text),
  };
}
