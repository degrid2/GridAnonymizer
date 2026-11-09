/**
 * gridanon (Node) - same commands, options and exit codes as the .NET `gridanon`.
 * Zero runtime dependencies: Node's standard library only.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { anonymize, auditPair, detectFormat, formats, getFormat, restore, TOOL, type InputFile, type RunResult } from '../src/core/engine.ts';
import { mappingToJson, parseMapping } from '../src/core/mapping.ts';
import { defaultProfile, loadProfile, profileToJson, type Profile } from '../src/core/profile.ts';
import { NotSupportedError, type RunReport } from '../src/core/shared.ts';
import { entrySource, listZip, ZipError } from '../src/core/zip.ts';
import { dirTarget, fileAccess, fileSource, moveFile, writeZip } from './node-io.ts';

const USAGE = `gridanon (Node edition) - anonymize power-system network models on your own machine.

USAGE
  gridanon anonymize <files|dirs...> [options]   rewrite models with pseudonyms, then audit the output
  gridanon restore   <files|dirs...> --mapping <file> [options]
  gridanon audit     <original> <anonymized> [--format F] [--profile P]
  gridanon profile   init [file]
  gridanon formats
  gridanon version

ANONYMIZE OPTIONS
  -o, --out <dir>          output directory (default: ./anonymized)
  -p, --profile <file>     JSON profile (see \`gridanon profile init\`)
      --salt <text>        secret salt; same salt => same pseudonyms across runs
      --salt-env <VAR>     read the salt from an environment variable
  -m, --mapping <file>     write the PRIVATE reversible mapping here
      --use-mapping <file> continue an earlier mapping
  -f, --format <id>        force a format: cim | psse | psse-aux | text
      --renumber-buses     PSS/E: renumber buses everywhere they are referenced
      --keep-comments      keep XML comments / RAW '/' comments
      --keep-titles        PSS/E: keep the two case-title lines
      --redact <term>      a term that must never survive (repeatable)
      --report <file>      write a JSON report of the run
      --zip <file>         put every output into one zip (a .zip input always gives <name>_anonymized.zip)
      --no-audit           skip the post-run leak audit
  -r, --recursive          descend into directories
  -q, --quiet              only print problems

EXIT CODES
  0 success   1 error   2 the audit found something identifying in the output`;

class UsageError extends Error {}

const FLAGS = new Set(['--renumber-buses', '--keep-comments', '--keep-titles', '--no-audit', '-r', '--recursive', '-q', '--quiet']);

class Args {
  readonly positional: string[] = [];
  private readonly options: [string, string | undefined][] = [];
  private readonly consumed = new Set<string>();

  constructor(argv: string[]) {
    for (let i = 0; i < argv.length; i++) {
      const s = argv[i];
      if (s === '--') { this.positional.push(...argv.slice(i + 1)); break; }
      if (s.startsWith('-') && s.length > 1) {
        const eq = s.indexOf('=');
        if (eq > 0) { this.options.push([s.slice(0, eq), s.slice(eq + 1)]); continue; }
        if (FLAGS.has(s)) { this.options.push([s, undefined]); continue; }
        if (i + 1 >= argv.length) throw new UsageError(`${s} needs a value`);
        this.options.push([s, argv[++i]]);
        continue;
      }
      this.positional.push(s);
    }
  }

  flag(...names: string[]): boolean {
    names.forEach((n) => this.consumed.add(n));
    return this.options.some(([n]) => names.includes(n));
  }

  value(...names: string[]): string | undefined {
    names.forEach((n) => this.consumed.add(n));
    return this.options.filter(([n]) => names.includes(n)).at(-1)?.[1];
  }

  values(name: string): string[] {
    this.consumed.add(name);
    return this.options.filter(([n, v]) => n === name && v !== undefined).map(([, v]) => v!);
  }

  ensureNoUnknown(): void {
    const unknown = this.options.find(([n]) => !this.consumed.has(n));
    if (unknown) throw new UsageError(`unknown option ${unknown[0]}`);
  }
}

function loadProfileFromArgs(a: Args): Profile {
  const path = a.value('-p', '--profile');
  const profile = path ? loadProfile(readFileSync(path, 'utf8')) : defaultProfile();
  if (a.flag('--renumber-buses')) profile.psse.renumberBuses = true;
  if (a.flag('--keep-comments')) { profile.cim.stripComments = false; profile.psse.stripComments = false; }
  if (a.flag('--keep-titles')) profile.psse.replaceCaseTitle = false;
  profile.redactTerms = [...profile.redactTerms, ...a.values('--redact')];
  return profile;
}

/** An input file, and where it came from when it was inside a zip. */
interface PlannedInput { input: InputFile; bundle?: string; entryPath: string }

async function expand(patterns: string[], recursive: boolean, forced: string | undefined, closers: (() => Promise<void>)[]): Promise<PlannedInput[]> {
  const forcedFormat = forced ? getFormat(forced) : undefined;
  const result: PlannedInput[] = [];
  const seen = new Set<string>();
  let zips = 0;
  const add = async (path: string, explicit: boolean) => {
    const full = resolve(path);
    if (seen.has(full.toLowerCase())) return;
    seen.add(full.toLowerCase());
    if (full.toLowerCase().endsWith('.zip')) {
      const k = ++zips;
      const access = await fileAccess(full);
      closers.push(access.close);
      for (const e of await listZip(access, basename(full))) {
        // Named "<zip>!<entry>": the engine only uses the part after the last separator.
        const source = entrySource(access, e, `${full}!${e.path}`, basename(full));
        const format = forcedFormat ?? (await detectFormat(source));
        if (!format) { console.error(`  skip     ${basename(full)}!${e.path}: unknown format (use --format)`); continue; }
        const slash = e.path.lastIndexOf('/');
        const dir = slash >= 0 ? e.path.slice(0, slash) : '';
        result.push({ input: { source, format, relativeDirectory: dir ? `zip${k}/${dir}` : `zip${k}` }, bundle: full, entryPath: e.path });
      }
      return;
    }
    const source = fileSource(full);
    const format = forcedFormat ?? (await detectFormat(source));
    if (!format) { if (explicit) console.error(`  skip     ${path}: unknown format (use --format)`); return; }
    result.push({ input: { source, format }, entryPath: basename(full) });
  };
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? (recursive ? walk(join(dir, d.name)) : []) : d.isFile() ? [join(dir, d.name)] : []);
  for (const p of patterns) {
    if (existsSync(p) && statSync(p).isDirectory()) for (const f of walk(p).sort()) await add(f, false);
    else if (p.includes('*') || p.includes('?')) {
      const dir = dirname(p);
      const re = new RegExp('^' + basename(p).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      for (const f of readdirSync(dir).filter((n) => re.test(n)).sort()) await add(join(dir, f), true);
    } else if (existsSync(p)) await add(p, true);
    else throw new Error(`input not found: ${p}`);
  }
  return result;
}

/**
 * Turns staged outputs into what the user asked for (twin of Bundles.Package in
 * the .NET CLI): a .zip input becomes <name>_anonymized.zip with the original
 * layout and file names inside; --zip puts everything into one archive; other
 * files are moved to the output folder.
 */
async function packageBundles(report: RunReport, planned: PlannedInput[], outDir: string, zipOut: string | undefined, suffix: string) {
  const byInput = new Map(planned.map((p) => [p.input.source.name, p]));
  const bundles = [...new Map(planned.filter((p) => p.bundle).map((p) => [p.bundle!.toLowerCase(), p.bundle!])).values()];
  mkdirSync(outDir, { recursive: true });
  const stem = (f: string) => basename(f, extname(f));
  const entryName = (p: PlannedInput) => (p.bundle && bundles.length > 1 && zipOut ? `${stem(p.bundle)}/${p.entryPath}` : p.entryPath);
  const outputs = report.files.filter((f) => f.output && byInput.has(f.input));

  if (zipOut) {
    const entries = outputs.map((f) => ({ entryName: entryName(byInput.get(f.input)!), filePath: f.output!, f }));
    await writeZip(zipOut, entries);
    for (const e of entries) e.f.output = `${zipOut}!${e.entryName}`;
    return;
  }
  for (const bundle of bundles) {
    const target = join(outDir, stem(bundle) + suffix + '.zip');
    const mine = outputs.filter((f) => byInput.get(f.input)!.bundle?.toLowerCase() === bundle.toLowerCase());
    await writeZip(target, mine.map((f) => ({ entryName: byInput.get(f.input)!.entryPath, filePath: f.output! })));
    for (const f of mine) f.output = `${target}!${byInput.get(f.input)!.entryPath}`;
  }
  for (const f of outputs.filter((f) => !byInput.get(f.input)!.bundle)) {
    const dest = join(outDir, basename(f.output!));
    await moveFile(f.output!, dest);
    f.output = dest;
  }
}

const bytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);

function printSummary(r: RunResult, quiet: boolean, mappingOut: string | undefined, isRestore: boolean) {
  for (const f of r.report.files) {
    const stats = Object.entries(f.stats).filter(([k]) => k !== 'revision').map(([k, v]) => `${k}=${v.toLocaleString('en-US')}`).join('  ');
    if (!quiet || (f.audit && !f.audit.clean)) {
      console.log(`${basename(f.input)} -> ${f.output}  (${bytes(f.bytesIn)} -> ${bytes(f.bytesOut)}, ${f.format})`);
      if (stats) console.log('    ' + stats);
    }
    for (const w of f.warnings) console.log('    warning: ' + w);
    const au = f.audit;
    if (au) {
      if (au.clean) {
        if (!quiet) console.log(`    audit: clean - 0 of ${au.hunted.toLocaleString('en-US')} identifying values found (${au.vocabularyExcluded.toLocaleString('en-US')} shared labels deliberately kept)`);
      } else {
        console.log('    AUDIT FAILED - do not share this file.');
        if (au.leakedNames.length) console.log('      names: ' + au.leakedNames.join(', '));
        if (au.leakedIds.length) console.log('      ids:   ' + au.leakedIds.join(', '));
        if (au.leakedTerms.length) console.log('      terms: ' + au.leakedTerms.join(', '));
        for (const i of au.integrityIssues) console.log('      integrity: ' + i);
      }
    }
  }
  if (isRestore) return;
  if (mappingOut) console.log(`mapping written to ${mappingOut} - PRIVATE: it reverses the anonymization.`);
  if (r.saltWasGenerated) {
    console.log(`salt: ${r.salt}`);
    if (!mappingOut) console.log('      keep it secret; reuse it with --salt to anonymize related files consistently.');
  }
}

async function runAnonymize(a: Args, isRestore: boolean): Promise<number> {
  const quiet = a.flag('-q', '--quiet');
  const profile = loadProfileFromArgs(a);
  const outDir = a.value('-o', '--out') ?? (isRestore ? 'restored' : 'anonymized');
  const mappingIn = isRestore ? a.value('-m', '--mapping', '--use-mapping') : a.value('--use-mapping');
  const mappingOut = isRestore ? undefined : a.value('-m', '--mapping');
  let salt = a.value('--salt');
  const envVar = a.value('--salt-env');
  if (envVar) {
    salt = process.env[envVar];
    if (salt === undefined) throw new UsageError(`environment variable ${envVar} is not set`);
  }
  const forced = a.value('-f', '--format');
  const reportPath = a.value('--report');
  const zipOut = a.value('--zip');
  const recursive = a.flag('-r', '--recursive');
  const noAudit = a.flag('--no-audit');
  a.ensureNoUnknown();
  if (isRestore && !mappingIn) throw new UsageError('restore needs --mapping <file>');
  if (a.positional.length === 0) throw new UsageError('no input files');
  if (mappingOut && mappingIn && resolve(mappingOut) === resolve(mappingIn))
    throw new UsageError('write the updated mapping to a new file rather than over --use-mapping');

  const closers: (() => Promise<void>)[] = [];
  const work = mkdtempSync(join(tmpdir(), 'gridanon-'));
  let r: RunResult;
  try {
    const planned = await expand(a.positional, recursive, forced, closers);
    if (planned.length === 0) throw new UsageError('no recognizable input files (use --format to force one)');
    const inputs = planned.map((p) => p.input);
    for (const p of planned) {
      if (p.bundle) continue;
      const out = resolve(outDir, basename(p.input.source.name));
      if (out === p.input.source.name) throw new Error(`Refusing to overwrite the input file ${p.input.source.name}`);
    }
    const staging = zipOut !== undefined || planned.some((p) => p.bundle);
    const engineOut = staging ? join(work, 'out') : outDir;

    const mapping = mappingIn ? parseMapping(readFileSync(mappingIn, 'utf8'), mappingIn) : undefined;
    const opts = { profile, salt, mapping, audit: !noAudit, log: quiet ? undefined : (s: string) => console.error('  ' + s) };
    r = isRestore ? await restore(inputs, dirTarget(engineOut), opts) : await anonymize(inputs, dirTarget(engineOut), opts);
    if (staging) await packageBundles(r.report, planned, outDir, zipOut, isRestore ? '_restored' : '_anonymized');
  } finally {
    for (const c of closers) await c().catch(() => {});
    // Staged outputs are copies of the user's models: never leave them behind.
    rmSync(work, { recursive: true, force: true });
  }

  if (mappingOut) {
    mkdirSync(dirname(resolve(mappingOut)), { recursive: true });
    writeFileSync(mappingOut, mappingToJson(r.mapping));
  }
  if (reportPath) writeFileSync(reportPath, JSON.stringify(r.report, null, 2));
  printSummary(r, quiet, mappingOut, isRestore);
  return r.report.clean ? 0 : 2;
}

async function runAudit(a: Args): Promise<number> {
  const profile = loadProfileFromArgs(a);
  const forced = a.value('-f', '--format');
  const mappingPath = a.value('-m', '--mapping');
  a.ensureNoUnknown();
  if (a.positional.length !== 2) throw new UsageError('usage: gridanon audit <original> <anonymized>');
  const [orig, anon] = a.positional;
  const format = forced ? getFormat(forced) : await detectFormat(fileSource(orig));
  if (!format) throw new UsageError(`cannot detect the format of ${orig}; use --format`);
  const mapping = mappingPath ? parseMapping(readFileSync(mappingPath, 'utf8'), mappingPath) : undefined;
  const r = await auditPair(fileSource(orig), fileSource(anon), format, { profile, mapping });
  console.log(r.clean
    ? `clean - 0 of ${r.hunted.toLocaleString('en-US')} identifying values from ${basename(orig)} found in ${basename(anon)}`
    : `LEAKS FOUND: names [${r.leakedNames.join(', ')}] ids [${r.leakedIds.join(', ')}] terms [${r.leakedTerms.join(', ')}] ${r.integrityIssues.join('; ')}`);
  return r.clean ? 0 : 2;
}

export async function main(argv: string[]): Promise<number> {
  try {
    if (argv.length === 0 || ['-h', '--help', 'help'].includes(argv[0])) {
      console.log(USAGE);
      return argv.length === 0 ? 1 : 0;
    }
    const a = new Args(argv.slice(1));
    switch (argv[0]) {
      case 'anonymize': case 'anon': return await runAnonymize(a, false);
      case 'restore': return await runAnonymize(a, true);
      case 'audit': return await runAudit(a);
      case 'formats':
        for (const h of formats) console.log(`  ${h.id.padEnd(8)} ${h.description}  [${h.extensions.join(' ')}]`);
        return 0;
      case 'profile': {
        if ((a.positional[0] ?? 'init') !== 'init') throw new UsageError('usage: gridanon profile init [file]');
        const json = profileToJson(defaultProfile());
        const file = a.positional[1];
        if (!file) console.log(json);
        else {
          if (existsSync(file)) throw new Error(`${file} already exists`);
          writeFileSync(file, json);
          console.log(`wrote ${file}`);
        }
        return 0;
      }
      case 'version': case '--version': case '-v':
        console.log(TOOL);
        return 0;
      default:
        throw new UsageError(`Unknown command '${argv[0]}'. Run \`gridanon --help\`.`);
    }
  } catch (e) {
    if (e instanceof UsageError || e instanceof NotSupportedError || e instanceof ZipError || e instanceof Error) {
      console.error('error: ' + e.message);
      return 1;
    }
    throw e;
  }
}

process.exitCode = await main(process.argv.slice(2));
