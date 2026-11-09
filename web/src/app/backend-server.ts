/**
 * .NET backend: the page is served by `gridanon ui` on 127.0.0.1 and the .NET
 * engine does the work. Files go over the loopback interface only. Every API
 * call carries the per-launch token from the URL the CLI opened, so other
 * local processes and websites cannot drive the API.
 */

import type { Backend } from './backend.ts';
import type { WorkerOut } from './worker.ts';

export async function serverBackend(): Promise<Backend> {
  const token = new URLSearchParams(location.search).get('t') ?? '';
  const headers = { 'X-GridAnon-Token': token };
  const api = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(path, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
    if (!res.ok) throw new Error((await res.text()) || `${res.status} ${res.statusText}`);
    return res;
  };
  const info = (await (await api('/api/info')).json()) as { version: string; outputDir: string };

  // Files are uploaded once, when chosen; runs refer to them by session.
  let session = '';
  const uploaded = new Map<File, string>();

  async function upload(files: File[]): Promise<void> {
    session = ((await (await api('/api/session', { method: 'POST' })).json()) as { id: string }).id;
    uploaded.clear();
    for (const f of files) {
      const res = await api(`/api/session/${session}/file?name=${encodeURIComponent(f.name)}`, { method: 'PUT', body: f });
      uploaded.set(f, ((await res.json()) as { name: string }).name);
    }
  }

  return {
    kind: 'dotnet',
    outputDir: info.outputDir,
    version: info.version,
    async detect(files) {
      await upload(files);
      const res = await api(`/api/session/${session}/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names: files.map((f) => uploaded.get(f)) }),
      });
      return (await res.json()) as (string | null)[];
    },
    run(files, opts, _directory, onMessage) {
      void (async () => {
        try {
          if (files.some((f) => !uploaded.has(f))) await upload(files);
          const res = await api(`/api/session/${session}/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...opts, names: files.map((f) => uploaded.get(f)) }),
          });
          // NDJSON: one WorkerOut message per line, streamed as the engine works.
          const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
          let carry = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            carry += value;
            let nl: number;
            while ((nl = carry.indexOf('\n')) >= 0) {
              const line = carry.slice(0, nl).trim();
              carry = carry.slice(nl + 1);
              if (!line) continue;
              const msg = JSON.parse(line) as WorkerOut;
              if (msg.type === 'file-done' && msg.file?.url) msg.file.url += `?t=${encodeURIComponent(token)}`;
              if (msg.type === 'done' && msg.zip?.url) msg.zip.url += `?t=${encodeURIComponent(token)}`;
              onMessage(msg);
            }
          }
        } catch (e) {
          onMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
        }
      })();
    },
  };
}
