/**
 * Where the work happens. The same page ships in two builds:
 *   - browser (default): the engine runs in a Web Worker inside this tab;
 *   - dotnet (`vite build --mode dotnet`): the page is served by `gridanon ui`
 *     and the .NET engine on this computer does the work over a loopback API.
 * Both speak the same messages (WorkerOut), so the UI code is identical.
 */

import { serverBackend } from './backend-server.ts';
import { workerBackend } from './backend-worker.ts';
import type { RunRequest, WorkerOut } from './worker.ts';

export type RunOptions = Omit<RunRequest, 'type' | 'files' | 'directory'>;

export interface Backend {
  readonly kind: 'browser' | 'dotnet';
  /** The .NET edition writes results to a folder on this computer. */
  readonly outputDir?: string;
  readonly version?: string;
  detect(files: File[]): Promise<(string | null)[]>;
  run(files: File[], opts: RunOptions, directory: FileSystemDirectoryHandle | undefined, onMessage: (m: WorkerOut) => void): void;
}

declare const __GRIDANON_BACKEND__: 'browser' | 'dotnet';

// Static imports + a build-time constant: the unused backend is tree-shaken away
// (the .NET page ships without the engine, the browser page without the API client).
export function createBackend(): Promise<Backend> {
  return __GRIDANON_BACKEND__ === 'dotnet' ? serverBackend() : Promise.resolve(workerBackend());
}
