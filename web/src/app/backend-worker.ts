/** Browser backend: the TypeScript engine in a Web Worker, entirely inside this tab. */

import type { Backend } from './backend.ts';
import AnonWorker from './worker.ts?worker&inline';
import type { RunRequest, WorkerOut } from './worker.ts';

export function workerBackend(): Backend {
  return {
    kind: 'browser',
    detect: (files) =>
      new Promise((resolve) => {
        const w = new AnonWorker();
        w.onmessage = (e: MessageEvent<WorkerOut>) => {
          if (e.data.type === 'detected') resolve(e.data.formats);
          else if (e.data.type === 'error') resolve(files.map(() => null));
          w.terminate();
        };
        w.postMessage({ type: 'detect', files });
      }),
    run(files, opts, directory, onMessage) {
      const w = new AnonWorker();
      w.onmessage = (e: MessageEvent<WorkerOut>) => {
        onMessage(e.data);
        if (e.data.type === 'done' || e.data.type === 'error') w.terminate();
      };
      const req: RunRequest = { type: 'run', files, directory, ...opts };
      w.postMessage(req);
    },
  };
}
