/** Stand-in for backend-worker.ts in the .NET page build (see vite.config.ts): that page never runs the engine itself. */
import type { Backend } from './backend.ts';

export function workerBackend(): Backend {
  throw new Error('this page is served by gridanon ui and has no in-browser engine');
}
