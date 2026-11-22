/* Can *this machine* reach BWF at all?
 *
 *   node tools/probe-reach.mjs
 *
 * ⚠️⚠️ **The one question an unattended harvest turns on.** BWF's extranet API
 * sits behind Cloudflare, which refuses `curl` and refuses a headless Chrome
 * with a 403 — that is why every tool here drives a windowed browser and asks
 * the API *from BWF's own page*. What nobody had measured is whether Cloudflare
 * also refuses a **datacenter IP**: a GitHub Actions runner is an Azure address
 * in a range that bot scoring treats very differently from a home connection,
 * and a real browser on a bad IP is still a bad IP.
 *
 * So this is the probe that decides where a scheduled harvest can live. It is
 * deliberately tiny — one page load and two API calls — because a probe that
 * gets itself rate-limited has answered a different question than the one asked.
 * Exits 0 when the API answers with JSON, 1 otherwise, and says which wall it
 * hit so the answer is actionable rather than "it failed".
 */
import { launch, sweepProfiles, CHROME, CHROME_FLAGS } from '../tests/browser.mjs';

const API = 'https://extranet-lv.bwfbadminton.com/api/';
const PAGE = 'https://bwfworldtour.bwfbadminton.com/';
const SEP = String.fromCharCode(1);

const line = (...a) => console.log(...a);

line('chrome:   ' + CHROME);
line('flags:    ' + (CHROME_FLAGS.join(' ') || '(none)'));
line('display:  ' + (process.env.DISPLAY || '(none — not an X session)'));
line('');

sweepProfiles({ quiet: true });

let b;
try {
  b = await launch({ port: 9490, tag: 'reach' });
} catch (e) {
  line('FAIL  chrome did not start: ' + (e && e.message));
  line('      a CI image usually needs CHROME_FLAGS="--no-sandbox'
    + ' --disable-dev-shm-usage" and an Xvfb display.');
  process.exit(1);
}
line('ok    chrome started and CDP attached');

/* ---- 1. does BWF's own page load, or is it a Cloudflare interstitial? ---- */
await b.send('Page.navigate', { url: PAGE }, b.sessionId);
await b.until('document.readyState === "complete"', { timeout: 60000 }).catch(() => {});
await b.wait(6000);

const title = String(await b.ev('document.title') || '');
const bodyHead = String(await b.ev(
  'document.body ? document.body.innerText.slice(0, 200) : ""') || '');
const challenged = /just a moment|checking your browser|attention required|cf-/i
  .test(title + ' ' + bodyHead);

line(`page      title=${JSON.stringify(title)}`);
if (challenged) {
  line('FAIL  Cloudflare is challenging this address, so the page never loads.');
  line('      body: ' + JSON.stringify(bodyHead.slice(0, 120)));
  line('      A real browser is not enough here — the IP is what is refused.');
  b.close();
  process.exit(1);
}
line('ok    BWF page loaded, no interstitial');

/* ---- 2. the two calls every harvest starts with ---- */
/* ⚠️ **Parsed inside the page, not out here.** The first version brought the
   body back as text truncated to 2,000 characters and ran `JSON.parse` on it —
   so `vue-grouped-year-tournaments`, which is tens of kilobytes, came back as a
   valid 200 and was reported as a failure. The probe was wrong, not the
   request. Only a summary crosses the bridge now: whether it parsed, how big it
   was, and its top-level keys. */
const get = async path => {
  await b.wait(500);
  const out = await b.ev(`(async () => {
    try {
      const r = await fetch(${JSON.stringify(API)} + ${JSON.stringify(path)},
        { headers: { accept: 'application/json' } });
      const text = await r.text();
      let keys = null;
      try { const j = JSON.parse(text); keys = j && typeof j === 'object'
        ? Object.keys(j).slice(0, 6).join(',') : '(not an object)'; } catch { keys = null; }
      return [r.status, text.length, keys == null ? '' : keys,
        keys == null ? text.slice(0, 160) : ''].join(${JSON.stringify(SEP)});
    } catch (e) { return ['0', '0', '', String(e)].join(${JSON.stringify(SEP)}); }
  })()`);
  if (typeof out !== 'string') return { status: 0, bytes: 0, keys: null, head: '(no answer)' };
  const [status, bytes, keys, head] = out.split(SEP);
  return { status: Number(status), bytes: Number(bytes), keys: keys || null, head };
};

let bad = 0;
for (const path of ['vue-tmt-schedule?drawCount=1',
  'vue-grouped-year-tournaments?year=2026']) {
  const r = await get(path);
  const ok = r.status === 200 && r.keys;
  if (!ok) bad++;
  line(`${ok ? 'ok   ' : 'FAIL '} HTTP ${r.status}  ${String(r.bytes).padStart(7)} bytes`
    + `  ${path}`);
  if (ok) line(`      keys: ${r.keys}`);
  else line('      ' + JSON.stringify(String(r.head).slice(0, 160)));
}

b.close();

if (bad) {
  line('');
  line('FAIL  this machine cannot harvest. The page loads but the API refuses,'
    + ' which is Cloudflare scoring the address rather than the browser.');
  process.exit(1);
}
line('');
line('PASS  this machine can harvest.');
process.exit(0);
