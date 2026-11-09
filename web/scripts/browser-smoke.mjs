#!/usr/bin/env node
/**
 * Browser smoke test (dev only). Opens the offline single-file page from
 * file:// and the hosted page from server.mjs in headless Chromium (and, when
 * GRIDANON_DOTNET points at a .NET edition binary, the same page served by
 * `gridanon ui`), runs the built-in samples end to end, and checks:
 *   - every result card shows a passed audit
 *   - downloaded outputs are byte-identical to the Node CLI's
 *   - the page made no network request and raised no CSP violation
 * Needs: npm i -D playwright && npx playwright install chromium
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = web;
const work = mkdtempSync(join(tmpdir(), 'gridanon-smoke-'));
const fail = (m) => { console.error('FAIL: ' + m); process.exitCode = 1; };

// Reference outputs from the Node CLI with the same salt.
// Same file order as the page's "everything" sample: files of one format share a job, and order sets name numbering.
const samples = ['cim/sample-network.xml', 'cim/cgmes_eq_uuid.xml', 'psse/meridian_v33.raw', 'psse/meridian_v35.raw', 'psse/study_results.csv'];
const cli = spawnSync(process.execPath, ['dist-cli/gridanon.mjs', 'anonymize', ...samples.map((s) => join(repo, 'samples', s)),
  '--salt', 'smoke', '-o', join(work, 'cli'), '-q'], { cwd: web, encoding: 'utf8' });
if (cli.status !== 0) fail('CLI run failed: ' + cli.stderr);

const server = spawn(process.execPath, ['server.mjs'], { cwd: web, env: { ...process.env, PORT: '18731' } });
await new Promise((r) => setTimeout(r, 800));
const targets = [
  ['offline file://', pathToFileURL(join(web, 'dist/gridanon-web.html')).href],
  ['hosted server.mjs', 'http://127.0.0.1:18731/'],
];

// Optional: the .NET edition's `gridanon ui` serving the same page.
let dotnetUi;
if (process.env.GRIDANON_DOTNET) {
  dotnetUi = spawn(resolve(process.env.GRIDANON_DOTNET), ['ui', '--no-browser', '--port', '18733', '-o', join(work, 'dotnet-ui-out')]);
  const url = await new Promise((resolve, reject) => {
    let out = '';
    dotnetUi.stdout.on('data', (d) => { out += d; const m = out.match(/(http:\/\/localhost:\d+\/\?t=[0-9a-f]+)/); if (m) resolve(m[1]); });
    dotnetUi.on('exit', (c) => reject(new Error('gridanon ui exited with ' + c)));
    setTimeout(() => reject(new Error('gridanon ui did not start')), 15000);
  });
  targets.push(['.NET gridanon ui', url]);
}

const browser = await chromium.launch();
try {
  for (const [label, url] of targets) {
    const page = await browser.newPage({ acceptDownloads: true });
    const requests = [];
    const problems = [];
    page.on('request', (r) => { if (!r.url().startsWith('blob:') && !r.url().startsWith('data:')) requests.push(r.url()); });
    page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
    page.on('pageerror', (e) => problems.push(e.message));
    await page.goto(url);
    const initialRequests = requests.length;

    // Settings tab: salt and "save mapping"; then back to Anonymize.
    await page.click('#tab-settings');
    await page.fill('#salt', 'smoke');
    await page.check('#mapping-settings', { force: true });
    await page.click('#tab-anonymize');
    await page.click('[data-sample="all"]');
    await page.waitForSelector('#files li');
    await page.click('#run');
    await page.waitForSelector('.verdict', { timeout: 30000 });
    const rows = await page.$$eval('.result', (els) => els.map((e) => e.getAttribute('data-clean')));
    if (rows.length !== 5 || rows.some((c) => c !== 'true')) fail(`${label}: audits ${JSON.stringify(rows)}`);

    // Download every output and compare with the CLI.
    const links = await page.$$('.result a.download');
    for (const link of links) {
      const [dl] = await Promise.all([page.waitForEvent('download'), link.click()]);
      const name = dl.suggestedFilename();
      const path = join(work, label.replace(/\W/g, '_') + '_' + name);
      await dl.saveAs(path);
      const expected = readFileSync(join(work, 'cli', name));
      if (!expected.equals(readFileSync(path))) fail(`${label}: ${name} differs from the CLI output`);
    }
    // Restore round trip through the UI: download the mapping, then restore the anonymized CSV.
    const [mapDl] = await Promise.all([page.waitForEvent('download'), page.click('#dl-mapping')]);
    const mapPath = join(work, label.replace(/\W/g, '_') + '_map.json');
    await mapDl.saveAs(mapPath);
    await page.click('#start-over');
    await page.click('#tab-restore');
    await page.setInputFiles('#picker', join(work, label.replace(/\W/g, '_') + '_study_results_anonymized.csv'));
    await page.waitForSelector('#files li');
    await page.setInputFiles('#mapping-in', mapPath);
    await page.click('#run');
    await page.waitForSelector('.result a.download', { timeout: 30000 });
    const [restored] = await Promise.all([page.waitForEvent('download'), page.click('.result a.download')]);
    const restoredPath = join(work, label.replace(/\W/g, '_') + '_restored.csv');
    await restored.saveAs(restoredPath);
    if (!readFileSync(restoredPath).equals(readFileSync(join(repo, 'samples/psse/study_results.csv')))) fail(`${label}: restore did not reproduce the original CSV`);

    const after = requests.slice(initialRequests);
    if (label.startsWith('.NET')) {
      // The .NET page talks to its own loopback server, and to nothing else.
      const origin = new URL(url).origin;
      const foreign = after.filter((r) => new URL(r).origin !== origin);
      if (foreign.length) fail(`${label}: requests to other origins: ${foreign.join(', ')}`);
    } else if (after.length) fail(`${label}: network requests after load: ${after.join(', ')}`);
    if (problems.length) fail(`${label}: console errors: ${problems.join(' | ')}`);
    if (!process.exitCode) console.log(`${label}: ${links.length} outputs identical to the CLI, audits passed, restore round-trips, ` +
      (label.startsWith('.NET') ? `${after.length} requests, all to its own 127.0.0.1 server` : `${after.length} requests after load`));
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
  dotnetUi?.kill();
}
if (!process.exitCode) console.log('browser smoke test passed (' + readdirSync(join(work, 'cli')).length + ' files)');
