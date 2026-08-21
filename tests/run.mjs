/* Test runner.
 *
 *   node tests/run.mjs               every suite
 *   node tests/run.mjs unit          only the ones that need no browser (seconds)
 *   node tests/run.mjs season        the season area
 *   node tests/run.mjs test_api      named suites
 *   node tests/run.mjs --live season ignore the fixtures and hit the real API
 *   node tests/run.mjs --record …    top the fixture set up with what that suite asks for
 *
 * Areas exist so that a change to the request layer does not have to re-run
 * anything that launches Chrome.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sweepProfiles } from './browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const AREAS = {
  unit:   ['test_model', 'test_api'],
  model:  ['test_model'],
  api:    ['test_api'],
  season: ['test_model', 'test_season'],
  all:    ['test_model', 'test_api', 'test_season'],
};

const args = process.argv.slice(2);
const live = args.includes('--live');
const record = args.includes('--record');
const names = args.filter(a => !a.startsWith('--'));

let suites;
if (!names.length) suites = AREAS.all;
else {
  suites = [];
  for (const n of names) {
    if (AREAS[n]) suites.push(...AREAS[n]);
    else suites.push(n.replace(/\.mjs$/, ''));
  }
  suites = [...new Set(suites)];
}

const env = { ...process.env };
if (record) env.FIXTURES = 'record';
if (live) env.FIXTURES = 'live';

console.log(`running ${suites.length} suite(s)`
  + `${record ? ' [RECORDING]' : live ? ' [LIVE]' : ''}: ${suites.join(' ')}\n`);

// Before anything launches Chrome, not after. See browser.mjs — a run that
// crashes leaves a ~50MB profile behind and they are not self-limiting.
sweepProfiles();

const t0 = Date.now();
const failed = [];

for (const s of suites) {
  const started = Date.now();
  process.stdout.write(s.padEnd(14));

  const out = await new Promise(res => {
    const p = spawn(process.execPath, [path.join(HERE, s + '.mjs')], { env, cwd: HERE });
    let buf = '';
    p.stdout.on('data', d => { buf += d; });
    p.stderr.on('data', d => { buf += d; });
    p.on('close', code => res({ buf, code }));
  });

  const secs = ((Date.now() - started) / 1000).toFixed(0);
  const verdict = /ALL CHECKS PASSED/.test(out.buf) ? 'pass'
    : (out.buf.match(/FAILURES: \d+/) || ['crash'])[0];
  const fixtures = (out.buf.match(/fixtures (?:served|recorded): [^\n]*/) || [''])[0];

  if (verdict !== 'pass') failed.push(s);
  console.log(`${verdict.padEnd(12)} ${secs}s   ${fixtures}`);

  if (verdict !== 'pass') {
    const lines = out.buf.split('\n').filter(l => /^FAIL|^EXC |^LOG /.test(l)).slice(0, 10);
    // A suite that dies before its first check has no FAIL lines at all, and
    // printing nothing sends you off to re-run the whole set to find out why.
    if (!lines.length) {
      lines.push(`exit ${out.code}, no checks reported — tail:`,
        ...out.buf.trimEnd().split('\n').slice(-8));
    }
    console.log(lines.map(l => '    ' + l).join('\n'));
  }
}

console.log(`\n${suites.length - failed.length}/${suites.length} passed`
  + ` in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (failed.length) console.log('failed: ' + failed.join(' '));
process.exit(failed.length ? 1 : 0);
