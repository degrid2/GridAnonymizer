/**
 * The GridAnonymizer page. Framework-free on purpose: the tool's pitch is
 * "small, auditable, runs locally". Work happens in the backend: a Web Worker
 * in the browser build, the local .NET engine in the `gridanon ui` build.
 * User-controlled text is only ever inserted with textContent.
 */

import cgmesBoundary from '../../profiles/cgmes-boundary.json?raw';
import namesOnly from '../../profiles/names-only.json?raw';
import vendorStrict from '../../profiles/vendor-strict.json?raw';
import sampleCgmes from '../../samples/cim/cgmes_eq_uuid.xml?raw';
import sampleCim from '../../samples/cim/sample-network.xml?raw';
import sampleCon from '../../samples/psse/meridian_v33.con?raw';
import sampleMon from '../../samples/psse/meridian_v33.mon?raw';
import sampleV33 from '../../samples/psse/meridian_v33.raw?raw';
import sampleSub from '../../samples/psse/meridian_v33.sub?raw';
import sampleV35 from '../../samples/psse/meridian_v35.raw?raw';
import sampleCsv from '../../samples/psse/study_results.csv?raw';
import { defaultProfile, loadProfile, profileToJson } from '../core/profile.ts';
import type { FileReport } from '../core/shared.ts';
import { VERSION } from '../core/version.ts';
import { blobAccess, listZip, readEntry } from '../core/zip.ts';
import { createBackend, type RunOptions } from './backend.ts';
import type { WorkerOut } from './worker.ts';

const backend = await createBackend();
const isDotnet = backend.kind === 'dotnet';

// ── helpers ─────────────────────────────────────────────────────────────────

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const check = (id: string) => $<HTMLInputElement>(id);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

const fmtBytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const basename = (p: string) => p.replace(/^.*[\\/]/, '');

const store = {
  get(key: string): string | null {
    try { return localStorage.getItem('gridanon.' + key); } catch { return null; }
  },
  set(key: string, value: string) {
    try { localStorage.setItem('gridanon.' + key, value); } catch { /* private mode: settings just don't persist */ }
  },
};

// ── content ─────────────────────────────────────────────────────────────────

const PROFILES: Record<string, string> = {
  default: profileToJson(defaultProfile()),
  'vendor-strict': vendorStrict,
  'cgmes-boundary': cgmesBoundary,
  'names-only': namesOnly,
};

const SAMPLES: [string, string][] = [
  ['sample-network.xml', sampleCim], ['cgmes_eq_uuid.xml', sampleCgmes], ['meridian_v33.raw', sampleV33],
  ['meridian_v35.raw', sampleV35], ['meridian_v33.con', sampleCon], ['meridian_v33.mon', sampleMon],
  ['meridian_v33.sub', sampleSub], ['study_results.csv', sampleCsv],
];

const FORMAT_NAMES: Record<string, string> = { cim: 'CIM / CGMES', psse: 'PSS®E RAW', 'psse-aux': 'PSS®E companion', text: 'Text', skip: 'Skip' };

/** The parts of a PSS®E set. Only the case is needed; the others follow it. */
const PSSE_ROLES: { ext: string; label: string }[] = [
  { ext: '.raw', label: 'Case' }, { ext: '.con', label: 'Contingencies' }, { ext: '.mon', label: 'Monitored elements' },
  { ext: '.sub', label: 'Subsystems' }, { ext: '.aux', label: 'Auxiliary' },
];

const STAT_NAMES: Record<string, [string, string]> = {
  names: ['name', 'names'], ids: ['id', 'ids'], refs: ['reference', 'references'], mrids: ['mRID', 'mRIDs'],
  descriptions: ['description', 'descriptions'], busNumbers: ['bus number', 'bus numbers'], titles: ['title', 'titles'],
  comments: ['comment', 'comments'], headers: ['header', 'headers'], coordinates: ['coordinate', 'coordinates'],
  overwritten: ['overwritten value', 'overwritten values'], redactions: ['redaction', 'redactions'],
  replacements: ['replacement', 'replacements'], unmappedRefs: ['unmapped reference', 'unmapped references'],
  externalIds: ['external id', 'external ids'], unmappedBusRefs: ['unmapped bus reference', 'unmapped bus references'],
  trailerLinesDropped: ['trailing line dropped', 'trailing lines dropped'],
  labels: ['label', 'labels'], rangesExpanded: ['bus range expanded', 'bus ranges expanded'],
};

// ── state ───────────────────────────────────────────────────────────────────

type View = 'anonymize' | 'restore' | 'settings';
let workView: 'anonymize' | 'restore' = 'anonymize';
let files: File[] = [];
/** Per file: its path in the set. A zip's entries keep their folders ("case/x.raw"). */
let paths: string[] = [];
/** Per file: the zip it came from, if any. */
let bundles: (string | undefined)[] = [];
let formats: string[] = [];
let customProfile: { name: string; json: string } | undefined;
let blobUrls: string[] = [];
let running = false;
let showingResults = false;

const canPickFolder = !isDotnet && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

// ── views ───────────────────────────────────────────────────────────────────

function setView(next: View) {
  if (next !== 'settings') workView = next;
  for (const v of ['anonymize', 'restore', 'settings'] as const) $(`tab-${v}`).setAttribute('aria-selected', String(v === next));
  $('view-work').hidden = next === 'settings';
  $('view-settings').hidden = next !== 'settings';
  const restoring = workView === 'restore';
  $('drop-title').textContent = files.length ? 'Add more files' : restoring ? 'Drop anonymized files' : 'Drop model files';
  $('drop-hint').textContent = restoring ? 'Vendor results, contingency lists or the anonymized model, as files or a .zip' : DROP_HINT;
  $('quick').hidden = restoring;
  refresh();
}

/** After a run the results replace the workspace; "Back to files" brings it back unchanged. */
function showWorkspace(show: boolean) {
  showingResults = !show;
  for (const id of ['drop', 'files', 'actionbar']) if (!show) $(id).hidden = true;
  $('drop').hidden = !show;
  $('sample-line').hidden = !show || files.length > 0;
  $('files').hidden = !show || files.length === 0;
  refresh();
}

for (const v of ['anonymize', 'restore', 'settings'] as const) $(`tab-${v}`).addEventListener('click', () => setView(v));

// ── files ───────────────────────────────────────────────────────────────────

const drop = $('drop');
const picker = $<HTMLInputElement>('picker');

const DROP_HINT = 'CIM/CGMES, PSS®E .raw with its .con .mon .sub files, CSVs, or one .zip of them';
const stem = (name: string) => basename(name).replace(/\.[^.]*$/, '');

interface Incoming { file: File; path: string; bundle?: string }

/** Unpack dropped zips here, in the page: their entries become files that remember their folder. */
async function unpack(next: File[]): Promise<Incoming[]> {
  const out: Incoming[] = [];
  for (const f of next) {
    if (!f.name.toLowerCase().endsWith('.zip')) { out.push({ file: f, path: f.name }); continue; }
    const access = blobAccess(f);
    for (const e of await listZip(access, f.name)) {
      const parts: Uint8Array[] = [];
      for await (const c of readEntry(access, e, f.name)) parts.push(c);
      out.push({ file: new File(parts as BlobPart[], basename(e.path)), path: e.path, bundle: f.name });
    }
  }
  return out;
}

/** Keep paths unique: a clash from a zip moves under the zip's name, anything else gets " (2)". */
function uniquePath(it: Incoming, taken: Set<string>): string {
  let p = it.path;
  if (taken.has(p.toLowerCase()) && it.bundle) p = `${stem(it.bundle)}/${it.path}`;
  for (let n = 2; taken.has(p.toLowerCase()); n++) p = it.path.replace(/(\.[^./]*)?$/, ` (${n})$1`);
  taken.add(p.toLowerCase());
  return p;
}

async function addFiles(next: File[]) {
  let incoming: Incoming[];
  try {
    incoming = await unpack(next);
  } catch (e) {
    showNotice(`Could not open the zip: ${(e as Error).message}`);
    return;
  }
  const fresh = incoming.filter((it) => !files.some((g, i) => (paths[i] === it.path || paths[i].endsWith('/' + it.path)) && g.size === it.file.size && bundles[i] === it.bundle));
  if (fresh.length === 0) return;
  let detected: (string | null)[];
  try {
    detected = await backend.detect([...files, ...fresh.map((it) => it.file)]);
  } catch (e) {
    showNotice(`Could not read the files: ${(e as Error).message}`);
    return;
  }
  const kept = new Map(files.map((f, i) => [f, formats[i]]));
  const taken = new Set(paths.map((p) => p.toLowerCase()));
  files = [...files, ...fresh.map((it) => it.file)];
  paths = [...paths, ...fresh.map((it) => uniquePath(it, taken))];
  bundles = [...bundles, ...fresh.map((it) => it.bundle)];
  formats = files.map((f, i) => kept.get(f) ?? detected[i] ?? 'skip');
  clearResults();
  renderFiles();
  setView(workView);
}

function removeFile(i: number) {
  files.splice(i, 1);
  paths.splice(i, 1);
  bundles.splice(i, 1);
  formats.splice(i, 1);
  clearResults();
  renderFiles();
  setView(workView);
}

/** Which part of a PSS®E set a file is, or undefined when it is not one. */
function psseRole(i: number): string | undefined {
  if (formats[i] === 'psse') return '.raw';
  if (formats[i] !== 'psse-aux') return undefined;
  const ext = paths[i].slice(paths[i].lastIndexOf('.')).toLowerCase();
  return PSSE_ROLES.some((r) => r.ext === ext) ? ext : '.aux';
}

/** The PSS®E set panel: what is there, and one click to add a missing part. */
function renderSet() {
  const panel = $('psse-set');
  const roles = files.map((_, i) => psseRole(i));
  panel.hidden = workView === 'restore' || showingResults || !roles.some(Boolean);
  if (panel.hidden) return;
  const chips = $('psse-chips');
  chips.replaceChildren();
  for (const r of PSSE_ROLES) {
    const mine = paths.filter((_, i) => roles[i] === r.ext);
    if (mine.length) {
      const chip = el('span', { className: 'chip on' }, el('span', { className: 'tick', textContent: '✓' }), r.label);
      chip.title = mine.join('\n');
      if (mine.length > 1) chip.append(el('small', { textContent: ` ×${mine.length}` }));
      chips.append(chip);
    } else {
      const add = el('button', { type: 'button', className: `chip add${r.ext === '.raw' ? ' need' : ''}`, textContent: `+ ${r.label} ${r.ext}` });
      add.setAttribute('aria-label', `Add ${r.label.toLowerCase()} (${r.ext})`);
      add.addEventListener('click', () => { picker.accept = r.ext; picker.click(); });
      chips.append(add);
    }
  }
  const hasCase = roles.includes('.raw');
  const note = $('psse-note');
  note.className = hasCase ? 'hint' : 'hint warn-text';
  note.textContent = hasCase
    ? 'Anonymized together, so bus numbers and names match across the set.'
    : 'Add the case (.raw): the other files take their bus numbers and names from it.';
}

function renderFiles() {
  const list = $('files');
  list.replaceChildren();
  list.hidden = files.length === 0;
  drop.classList.toggle('compact', files.length > 0);
  $('sample-line').hidden = files.length > 0;
  files.forEach((f, i) => {
    const sel = el('select', { title: 'Format' });
    sel.setAttribute('aria-label', `Format of ${paths[i]}`);
    for (const id of ['cim', 'psse', 'psse-aux', 'text', 'skip']) sel.append(el('option', { value: id, textContent: FORMAT_NAMES[id] }));
    sel.value = formats[i];
    const name = el('span', { className: 'name' });
    if (bundles[i]) name.append(el('span', { className: 'from', textContent: `${basename(bundles[i]!)} › ` }));
    name.append(paths[i]);
    const li = el('li', { className: formats[i] === 'skip' ? 'skipped' : '' }, name, sel, el('span', { className: 'size', textContent: fmtBytes(f.size) }));
    sel.addEventListener('change', () => { formats[i] = sel.value; li.className = sel.value === 'skip' ? 'skipped' : ''; refresh(); });
    const rm = el('button', { className: 'remove', type: 'button', textContent: '×', title: `Remove ${paths[i]}` });
    rm.setAttribute('aria-label', `Remove ${paths[i]}`);
    rm.addEventListener('click', () => removeFile(i));
    li.append(rm);
    list.append(li);
  });
}

drop.addEventListener('click', () => picker.click());
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); } });
picker.addEventListener('change', () => { void addFiles([...(picker.files ?? [])]); picker.value = ''; picker.accept = ''; });
// A cancelled "Add …" picker must not leave its filter on the next one.
picker.addEventListener('cancel', () => { picker.accept = ''; });
drop.addEventListener('click', () => { picker.accept = ''; }, { capture: true });
for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); });
drop.addEventListener('drop', (e) => { const dt = (e as DragEvent).dataTransfer; if (dt?.files.length) void addFiles([...dt.files]); });
document.querySelector('[data-sample]')!.addEventListener('click', () => void addFiles(SAMPLES.map(([n, t]) => new File([t], n))));
$('mapping-in').addEventListener('change', refresh);

// ── settings (mirrored quick controls, persisted toggles) ───────────────────

const mirrors: [string, string][] = [['renumber', 'renumber-settings'], ['mapping', 'mapping-settings']];
for (const [a, b] of mirrors) {
  for (const [from, to] of [[a, b], [b, a]]) {
    check(from).addEventListener('change', () => { check(to).checked = check(from).checked; store.set(a, String(check(from).checked)); refresh(); });
  }
  const saved = store.get(a);
  if (saved !== null) check(a).checked = check(b).checked = saved === 'true';
}
for (const id of ['titles', 'comments', 'typehints', 'tofolder']) {
  const saved = store.get(id);
  if (saved !== null) check(id).checked = saved === 'true';
  check(id).addEventListener('change', () => { store.set(id, String(check(id).checked)); refresh(); });
}
for (const id of ['salt', 'redact']) $(id).addEventListener('input', refresh);
$('mapping-continue').addEventListener('change', refresh);

const profileSelects = [$<HTMLSelectElement>('profile'), $<HTMLSelectElement>('profile-settings')];
const profileFile = $<HTMLInputElement>('profile-file');
function setProfile(value: string) {
  for (const s of profileSelects) s.value = value;
  if (value !== 'custom') store.set('profile', value);
  describeProfile();
  refresh();
}
for (const s of profileSelects) s.addEventListener('change', () => {
  if (s.value === 'custom' && !customProfile) { profileFile.click(); return; }
  setProfile(s.value);
});
profileFile.addEventListener('change', async () => {
  const f = profileFile.files?.[0];
  if (!f) { setProfile(store.get('profile') ?? 'default'); return; }
  const json = await f.text();
  try {
    loadProfile(json);
    customProfile = { name: f.name, json };
    for (const s of profileSelects) s.options[4].textContent = `Custom: ${f.name}`;
    setProfile('custom');
  } catch (e) {
    showNotice(`${f.name} is not a valid profile: ${(e as Error).message}`);
    setProfile(store.get('profile') ?? 'default');
  }
});
const currentProfileJson = () => (profileSelects[0].value === 'custom' && customProfile ? customProfile.json : PROFILES[profileSelects[0].value] ?? PROFILES.default);
function describeProfile() {
  try { $('profile-desc').textContent = loadProfile(currentProfileJson()).description ?? ''; } catch { $('profile-desc').textContent = ''; }
}
$('profile-dl').addEventListener('click', () => {
  const a = el('a', { href: URL.createObjectURL(new Blob([currentProfileJson()], { type: 'application/json' })), download: `${profileSelects[0].value}-profile.json` });
  a.click();
});
describeProfile();

const redactTerms = () => $<HTMLTextAreaElement>('redact').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

/** Settings that change the result but aren't visible on the main tab. */
function activeSettings(): string[] {
  const on: string[] = [];
  if ($<HTMLInputElement>('salt').value.trim()) on.push('your salt');
  if ($<HTMLInputElement>('mapping-continue').files?.length) on.push('previous mapping');
  const terms = redactTerms().length;
  if (terms) on.push(plural(terms, 'redact term'));
  if (check('titles').checked) on.push('keep case titles');
  if (check('comments').checked) on.push('keep comments');
  if (check('typehints').checked) on.push('keep plant-type hints');
  if (canPickFolder && check('tofolder').checked) on.push('save to a folder');
  return on;
}

// ── run ─────────────────────────────────────────────────────────────────────

function refresh() {
  const usable = formats.filter((f) => f !== 'skip').length;
  const restoring = workView === 'restore';
  $('actionbar').hidden = files.length === 0 || showingResults;
  const run = $<HTMLButtonElement>('run');
  const verb = restoring ? 'Restore' : 'Anonymize';
  run.textContent = running ? (restoring ? 'Restoring…' : 'Anonymizing…') : usable > 1 ? `${verb} ${usable} files` : verb;
  run.disabled = running || usable === 0 || (restoring && !$<HTMLInputElement>('mapping-in').files?.length);
  $('restore-mapping').hidden = !restoring || files.length === 0 || showingResults;
  renderSet();

  const on = restoring ? [] : activeSettings();
  const line = $('active-settings');
  line.hidden = on.length === 0 || files.length === 0 || showingResults;
  line.replaceChildren(`Also applied: ${on.join(', ')}. `);
  const change = el('button', { type: 'button', className: 'link', textContent: 'Change' });
  change.addEventListener('click', () => setView('settings'));
  line.append(change);
}

function clearResults() {
  blobUrls.forEach((u) => URL.revokeObjectURL(u));
  blobUrls = [];
  $('results').hidden = true;
  $('results').replaceChildren();
  if (showingResults) showWorkspace(true);
}

function startOver() {
  files = [];
  paths = [];
  bundles = [];
  formats = [];
  clearResults();
  renderFiles();
  setView(workView);
}

function showNotice(text: string) {
  const r = $('results');
  r.hidden = false;
  r.replaceChildren(el('p', { className: 'notice', textContent: text }));
}

function setProgress(fraction: number, label: string) {
  const pct = `${Math.round(Math.min(1, fraction) * 100)}%`;
  for (const i of document.querySelectorAll<HTMLElement>('.phase-bar i')) i.style.setProperty('--p', pct);
  $('progress-label').textContent = label;
}

function blobLink(blob: Blob, name: string, text: string, id?: string): HTMLAnchorElement {
  const url = URL.createObjectURL(blob);
  blobUrls.push(url);
  const a = el('a', { href: url, download: name, textContent: text, className: 'secondary' });
  if (id) a.id = id;
  return a;
}

function summary(r: FileReport): string {
  const parts = [FORMAT_NAMES[r.format] ?? r.format];
  for (const k of ['names', 'busNumbers', 'labels', 'ids', 'replacements'].filter((key) => r.stats[key]).slice(0, 2))
    parts.push(plural(r.stats[k], STAT_NAMES[k][0], STAT_NAMES[k][1]));
  return parts.join(', ');
}

function renderResult(list: HTMLElement, r: FileReport, blob?: Blob, url?: string) {
  const outName = basename(r.output ?? r.input);
  const clean = r.audit?.clean ?? true;
  const li = el('li', { className: 'result' });
  li.dataset.clean = String(clean);

  const text = el('div', {}, el('p', { className: 'result-name', textContent: outName }), el('p', { className: 'result-meta', textContent: summary(r) }));
  const head = el('div', { className: 'result-head' }, el('span', { className: 'dot' }), text);
  if (blob) head.append(blobLink(blob, outName, 'Download'));
  else if (url) head.append(el('a', { href: url, download: outName, textContent: 'Download', className: 'secondary' }));
  else head.append(el('span', { className: 'hint', textContent: 'Saved' }));
  for (const a of head.querySelectorAll('a')) a.classList.add('download');
  li.append(head);

  const details = el('details', {}, el('summary', { textContent: 'Details' }));
  if (r.audit) {
    const a = r.audit;
    if (a.clean) {
      details.append(el('p', { className: 'finding clean', textContent: `Audit passed: none of ${plural(a.hunted, 'identifying value')} found. ${plural(a.vocabularyExcluded, 'shared label')} kept on purpose.` }));
    } else {
      const ul = el('ul');
      if (a.leakedNames.length) ul.append(el('li', { textContent: `Names: ${a.leakedNames.join(', ')}` }));
      if (a.leakedIds.length) ul.append(el('li', { textContent: `Ids: ${a.leakedIds.join(', ')}` }));
      if (a.leakedTerms.length) ul.append(el('li', { textContent: `Redact terms: ${a.leakedTerms.join(', ')}` }));
      for (const i of a.integrityIssues) ul.append(el('li', { textContent: i }));
      details.append(el('div', { className: 'finding leak' }, 'Do not share this file. The audit found:', ul));
      details.open = true;
    }
  }
  for (const w of r.warnings) details.append(el('p', { className: 'warning', textContent: w }));
  const stats = el('p', { className: 'stats' });
  for (const [k, v] of Object.entries(r.stats)) {
    if (k === 'revision' || !v) continue;
    const [one, many] = STAT_NAMES[k] ?? [k, k];
    stats.append(el('span', {}, el('b', { textContent: v.toLocaleString() }), ` ${v === 1 ? one : many}`));
  }
  stats.append(el('span', {}, `${fmtBytes(r.bytesIn)} in, ${fmtBytes(r.bytesOut)} out${r.stats.revision ? `, rev ${r.stats.revision}` : ''}`));
  details.append(stats);
  if (isDotnet && r.output) details.append(el('p', { className: 'hint', textContent: `Saved as ${r.output}` }));
  li.append(details);
  list.append(li);
}

$('run').addEventListener('click', async () => {
  if (running) return;
  const restoring = workView === 'restore';
  let directory: FileSystemDirectoryHandle | undefined;
  if (!restoring && canPickFolder && check('tofolder').checked) {
    try {
      directory = await (window as unknown as { showDirectoryPicker(o: unknown): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: 'readwrite' });
    } catch {
      return;
    }
  }
  const mappingFile = restoring ? $<HTMLInputElement>('mapping-in').files?.[0] : $<HTMLInputElement>('mapping-continue').files?.[0];
  const typedSalt = $<HTMLInputElement>('salt').value.trim();
  const keep = files.map((f, i) => [f, formats[i], i] as const).filter(([, f]) => f !== 'skip');
  // More than one result, or a zip in: everything also comes back as one zip, original names inside.
  const suffix = restoring ? '_restored' : '_anonymized';
  const fromZips = [...new Set(keep.map(([, , i]) => bundles[i]))];
  const zipName = directory || (keep.length < 2 && !fromZips[0]) ? undefined
    : fromZips.length === 1 && fromZips[0] ? `${stem(fromZips[0])}${suffix}.zip` : `gridanon${suffix}.zip`;
  const opts: RunOptions = {
    mode: restoring ? 'restore' : 'anonymize',
    formats: keep.map(([, f]) => f),
    paths: keep.map(([, , i]) => paths[i]),
    zipName,
    profileJson: currentProfileJson(),
    overrides: {
      renumberBuses: check('renumber').checked,
      keepComments: check('comments').checked,
      keepTitles: check('titles').checked,
      keepTypeHints: check('typehints').checked,
      redactTerms: restoring ? [] : redactTerms(),
    },
    salt: !restoring && typedSalt ? typedSalt : undefined,
    mappingJson: mappingFile ? await mappingFile.text() : undefined,
  };

  clearResults();
  running = true;
  refresh();
  $('progress').hidden = false;
  setProgress(0.02, 'Starting');

  const results = $('results');
  const list = el('ul', { className: 'result-list' });
  const reports: FileReport[] = [];
  let downloadable = 0;

  backend.run(keep.map(([f]) => f), opts, directory, (msg: WorkerOut) => {
    if (msg.type === 'progress') {
      const step = msg.stage === 'scanning' ? 0.15 : msg.stage === 'auditing' ? 0.8 : 0.5;
      setProgress((msg.index + step) / Math.max(1, msg.total), `${msg.stage[0].toUpperCase()}${msg.stage.slice(1)} ${msg.file}`);
    } else if (msg.type === 'file-done') {
      reports.push(msg.report);
      if (msg.file?.blob || msg.file?.url) downloadable++;
      renderResult(list, msg.report, msg.file?.blob, msg.file?.url);
    } else if (msg.type === 'done') {
      running = false;
      $('progress').hidden = true;
      const failed = reports.filter((r) => r.audit && !r.audit.clean).length;
      const n = reports.length;
      const title = restoring ? `Restored ${plural(n, 'file')}`
        : failed ? (n === 1 ? 'The file failed the audit' : `${failed} of ${n} files failed the audit`)
        : n === 1 ? 'The file is clean' : `All ${n} files are clean`;
      const sub = isDotnet ? `Saved to ${backend.outputDir}.`
        : directory ? 'Saved to the folder you chose.'
        : restoring ? 'Names, ids and bus numbers are back to the originals.'
        : failed ? 'Open the red file to see what was found. Do not share it.'
        : 'Nothing identifying was found in the output.';
      const back = el('button', { type: 'button', className: 'secondary', textContent: 'Back to files', id: 'back' });
      back.addEventListener('click', () => { clearResults(); });
      const again = el('button', { type: 'button', className: 'secondary', textContent: 'Start over', id: 'start-over' });
      again.addEventListener('click', startOver);
      results.replaceChildren(
        el('div', { className: 'verdict-row' },
          el('div', {}, el('div', { className: `verdict ${failed ? 'leak' : 'clean'}` }, el('h2', { textContent: title })),
            el('p', { className: 'verdict-sub', textContent: sub })),
          el('div', { className: 'verdict-actions' }, back, again)),
        list,
      );
      showWorkspace(false);
      const foot = el('div', { className: 'result-foot' });
      if (msg.zip?.blob) foot.append(blobLink(msg.zip.blob, msg.zip.name, `Download all as ${msg.zip.name}`, 'dl-zip'));
      else if (msg.zip?.url) foot.append(el('a', { href: msg.zip.url, download: msg.zip.name, textContent: `Download all as ${msg.zip.name}`, className: 'secondary', id: 'dl-zip' }));
      else if (downloadable > 1) {
        const all = el('button', { type: 'button', className: 'secondary', textContent: `Download all ${downloadable}` });
        all.addEventListener('click', () => list.querySelectorAll<HTMLAnchorElement>('a.download').forEach((a, i) => setTimeout(() => a.click(), i * 250)));
        foot.append(all);
      }
      foot.querySelector('#dl-zip')?.classList.add('strong');
      if (!restoring && check('mapping').checked)
        foot.append(blobLink(new Blob([msg.mapping], { type: 'application/json' }), 'gridanon_mapping.json', 'Download mapping', 'dl-mapping'));
      if (foot.childElementCount) results.append(foot);
      if (!restoring && msg.saltWasGenerated)
        results.append(el('p', { className: 'salt-note' }, 'Random salt used: ', el('code', { textContent: msg.salt }), '. Save it, or the mapping, to anonymize related files the same way later.'));
      results.hidden = false;
      refresh();
    } else if (msg.type === 'error') {
      running = false;
      $('progress').hidden = true;
      showNotice(msg.message);
      showWorkspace(true);
      refresh();
    }
  });
});


// ── help ────────────────────────────────────────────────────────────────────

const HELP: Record<string, { name: string; body: string[] }> = {
  profile: {
    name: 'profiles',
    body: [
      'A profile is a set of rules.',
      'Standard renames names, ids, descriptions and comments, removes coordinates, and keeps bus numbers. It suits most sharing.',
      'Vendor strict also shuffles bus numbers. Use it for models leaving your organisation.',
      'CGMES boundary keeps references to the ENTSO-E boundary set, so the model still merges with it.',
      'Names only keeps ids and bus numbers, so the model still lines up with SCADA point lists and study scripts.',
      'Custom loads your own JSON. Download one from Settings as a starting point.',
    ],
  },
  renumber: {
    name: 'renumbering buses',
    body: [
      'Gives every PSS®E bus a new number, and updates every place that refers to it: branches, transformers, generator regulation, areas, switched shunts and more.',
      'Bus numbers can identify a system. Leave this off if scripts or contingency files you keep elsewhere refer to buses by number, unless you anonymize those files in the same run.',
      'CIM files are not affected.',
    ],
  },
  mapping: {
    name: 'saving the mapping',
    body: [
      'Downloads a private file that pairs every original name, id and bus number with its replacement.',
      'You need it to restore results that come back from a vendor, or to anonymize the next revision with the same pseudonyms.',
      'Anyone holding it can undo the anonymization. Keep it with the original model and never send it with the anonymized one.',
    ],
  },
  'restore-mapping': {
    name: 'the mapping file',
    body: [
      'Choose the mapping that was saved when these files were anonymized.',
      'A mapping from a different run will not translate them back.',
    ],
  },
  salt: {
    name: 'the salt',
    body: [
      'A secret word that decides which pseudonyms are generated. The same salt and the same files always give the same output, so related files anonymized on different days still match.',
      'Leave it empty to use a random salt, which is shown after each run. Treat it like a password: with the salt and the original model, someone could rebuild the mapping.',
    ],
  },
  continue: {
    name: 'continuing from a mapping',
    body: [
      'Load the mapping from an earlier run. Equipment that already had a pseudonym keeps it, and new equipment gets a new one.',
      "Use it for next quarter's case or an updated CGMES set, so results stay comparable. The run uses that mapping's salt.",
    ],
  },
  redact: {
    name: 'redact terms',
    body: [
      "Words that must not appear anywhere in the output, including inside comments and descriptions: for example your company's name and its abbreviations.",
      "Matching ignores case. Each match is replaced with REDACTED, and the audit fails if one survives.",
    ],
  },
  titles: {
    name: 'case titles',
    body: [
      'The two title lines of a PSS®E case usually describe the study and who owns the system.',
      'By default they are replaced with ANONYMIZED CASE. Turn this on only if the titles contain nothing identifying.',
    ],
  },
  comments: {
    name: 'comments',
    body: [
      'XML comments and PSS®E "/" comments are removed by default, because they often mention real assets or people.',
      'Section markers such as END OF BUS DATA are always kept. If you turn this on, the audit still checks the comments for original names.',
    ],
  },
  typehints: {
    name: 'plant-type hints',
    body: [
      'Keeps suffixes such as _CC, _GT, _HYDRO or _WIND on renamed generating units, which can help a study.',
      'Off by default: plant type, size and region together can identify a specific plant.',
    ],
  },
  'psse-set': {
    name: 'PSS®E sets',
    body: [
      'A PSS®E study is often a case (.raw) plus contingencies (.con), monitored elements (.mon), subsystems (.sub) or other auxiliary files. Only the case is needed.',
      'Drop them together, as files or as one .zip. The companion files are anonymized after the case and reuse its pseudonyms: renumbered buses, names and labels such as contingency names all match.',
      'A zip comes back as a zip with the same folders and file names inside. Several files come back as one zip too.',
    ],
  },
  tofolder: {
    name: 'saving to a folder',
    body: [
      'Writes results straight into a folder you choose, instead of keeping them in memory for download.',
      'Use it for models of several hundred MB or more. Available in Chrome and Edge.',
    ],
  },
  outfolder: {
    name: 'the output folder',
    body: [
      'Where gridanon ui writes results on this computer. Each run adds files named like case_anonymized.raw.',
      'To use another folder, stop gridanon ui and start it again with gridanon ui -o followed by the folder.',
    ],
  },
};

let helpCount = 0;
let openTip: { button: HTMLButtonElement; tip: HTMLElement } | undefined;

function closeTip() {
  if (!openTip) return;
  openTip.tip.hidden = true;
  openTip.button.setAttribute('aria-expanded', 'false');
  openTip = undefined;
}

for (const anchor of document.querySelectorAll<HTMLElement>('[data-help]')) {
  const entry = HELP[anchor.dataset.help!];
  if (!entry) continue;
  const id = `tip-${++helpCount}`;
  const button = el('button', { type: 'button', className: 'help-btn', textContent: '?' });
  button.setAttribute('aria-label', `About ${entry.name}`);
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', id);
  const tip = el('div', { className: 'tip', id, hidden: true });
  tip.setAttribute('role', 'note');
  for (const p of entry.body) tip.append(el('p', { textContent: p }));

  // Where the button and its explanation go: quick bar → shared area below it;
  // settings row → full width under the row; anywhere else → right after the field.
  const inQuick = anchor.closest('.quick');
  if (inQuick) {
    // Keep each quick control and its "?" together when the bar wraps.
    const control = (anchor.closest('.select-wrap') ?? anchor) as HTMLElement;
    const pair = el('span', { className: 'quick-pair' });
    control.replaceWith(pair);
    pair.append(control, button);
    $('quick-help').append(tip);
  } else {
    anchor.append(button);
    (anchor.closest('.row') ?? anchor.closest('.field-inline') ?? anchor.parentElement!).append(tip);
  }

  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const wasOpen = openTip?.button === button;
    closeTip();
    if (wasOpen) return;
    tip.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    openTip = { button, tip };
  });
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openTip) { const b = openTip.button; closeTip(); b.focus(); }
});
document.addEventListener('click', (e) => {
  if (openTip && !openTip.tip.contains(e.target as Node) && e.target !== openTip.button) closeTip();
});
for (const v of ['anonymize', 'restore', 'settings']) $(`tab-${v}`).addEventListener('click', closeTip);

const helpDialog = $<HTMLDialogElement>('help-dialog');
$('help-open').addEventListener('click', () => { closeTip(); helpDialog.showModal(); });
$('help-close').addEventListener('click', () => helpDialog.close());
helpDialog.addEventListener('click', (e) => { if (e.target === helpDialog) helpDialog.close(); });

// ── edition-specific text ───────────────────────────────────────────────────

$('version').textContent = isDotnet ? `.NET edition ${backend.version ?? ''}.` : `TypeScript edition ${VERSION}.`;
$('folder-row').hidden = !canPickFolder;
if (isDotnet) {
  document.title = 'GridAnonymizer (.NET)';
  $('tagline').textContent = 'Anonymize CIM and PSS®E models with the .NET engine on this computer.';
  $('about-local').textContent = 'This page is served by gridanon on 127.0.0.1 and can only talk to it. Files never leave this computer.';
  $('help-privacy').textContent = 'The .NET engine on this computer does the work. This page is served by gridanon on 127.0.0.1 and can only talk to it, so your files never leave this computer.';
  $('dotnet-out').hidden = false;
  $('dotnet-out-path').textContent = backend.outputDir ?? '';
}

// Restore the saved profile last: setProfile() refreshes the page, which needs everything above.
const savedProfile = store.get('profile');
if (savedProfile && PROFILES[savedProfile]) setProfile(savedProfile);
setView('anonymize');
