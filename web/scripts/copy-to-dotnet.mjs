#!/usr/bin/env node
/**
 * Maintainers: after `vite build --mode dotnet`, copy the page into a sibling
 * .NET edition checkout, where it is embedded into `gridanon ui`.
 *   npm run build:dotnet-ui [-- <path-to-dotnet-folder>]
 * The .NET edition commits this output, so it builds without Node.
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const dotnet = resolve(process.argv[2] ?? join(web, '..', 'dotnet'));
const target = join(dotnet, 'src', 'GridAnonymizer.Cli', 'wwwroot');
if (!existsSync(join(dotnet, 'GridAnonymizer.slnx'))) {
  console.error(`No .NET edition found at ${dotnet}. Pass its path: npm run build:dotnet-ui -- <path>`);
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
cpSync(join(web, 'dist-dotnet'), target, { recursive: true });
console.log(`copied dist-dotnet → ${target}`);
