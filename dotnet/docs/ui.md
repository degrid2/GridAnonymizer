# The UI: `gridanon ui`

`gridanon ui` starts a small web server inside the `gridanon` process, opens your browser at it, and serves the GridAnonymizer page. Everything the page does goes through the .NET engine in that process. The page is the same one the TypeScript edition runs in the browser, built in a mode that talks to this server instead of running an in-browser engine.

```
browser tab  ──HTTP over 127.0.0.1──►  gridanon (HttpListener)  ──►  .NET engine  ──►  output folder
```

## Why it is safe

| Threat | Mitigation |
|---|---|
| Other machines on the network | Bound to `localhost` only, and any connection whose remote address isn't loopback is refused. |
| Other local programs or browser tabs calling the API | Every API call must carry a random 128-bit token, generated per launch and present only in the URL `gridanon ui` prints and opens. |
| Websites in your browser (CSRF) | Requests with a foreign `Origin` header are refused, and the token isn't available to other sites. |
| DNS rebinding | The `Host` header must be `localhost:<port>` or `127.0.0.1:<port>`. |
| The page sending data elsewhere | The page is served with `connect-src 'self'`: the browser blocks any request to another host. |
| Copies of your inputs left behind | Uploaded inputs go to a private temp folder, deleted when you choose a new file set and when the UI stops. Outputs go only to the folder you chose (`-o`). |
| A file path escaping the output folder | Folders from a dropped zip are checked like zip entries: absolute paths and `..` are refused. |
| Tampered page | The page is embedded in the executable (which you verify with the release checksum); nothing is fetched from the internet. |

Zips are unpacked in the page; each file is uploaded with its folder, and outputs keep that layout in the output folder. When several files are run, or a zip was dropped, the server also writes `<zip>_anonymized.zip` (or `gridanon_anonymized.zip`) there, with the original folders and file names inside, and offers it as *Download all as …zip*.

The mapping file is never written to disk by the UI. It is offered as a download only when *Save mapping* is on.

## The API (for the curious)

All routes require the `X-GridAnon-Token` header (or a `t=` query parameter for downloads).

| Route | Purpose |
|---|---|
| `GET /api/info` | version and output folder |
| `POST /api/session` | start a new file set (and delete the previous one's uploads) |
| `PUT /api/session/{id}/file?name=` | upload one input (streamed to disk) |
| `POST /api/session/{id}/detect` | detect formats |
| `POST /api/session/{id}/run` | run; returns progress and results as NDJSON, one message per line. The body names the uploads and, per file, its `paths` entry (its folder in the set); an optional `zipName` asks for the one-zip output |
| `GET /api/session/{id}/download/{n}` | download output `n` of this session (the run's messages carry each URL) |

## Updating the page

The page lives in `src/GridAnonymizer.Cli/wwwroot/` and is embedded at build time. It is generated from the TypeScript edition (`web/`):

```bash
# in a TypeScript edition checkout
npm ci
npm run build:dotnet-ui -- <path-to-this-dotnet-folder>
```

Then rebuild `gridanon` and commit the changed `wwwroot/`. CI checks that the committed page matches a fresh build.
