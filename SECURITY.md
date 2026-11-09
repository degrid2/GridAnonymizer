# Security policy

## Reporting

If any edition of GridAnonymizer lets identifying information through (a name, id, coordinate or anything else that survives anonymization without the audit flagging it), treat it as a security issue.

Report it privately through **GitHub → Security → Report a vulnerability** on this repository. Do not open a public issue, and **never include the model itself**. Describe the construct instead (e.g. "a name inside an `rdf:about` element spanning two lines"), ideally as a few fictional records.

We aim to acknowledge reports within 3 working days and to ship a fix or mitigation within 30 days.

## Supported versions

Only the latest release receives fixes.

## Design guarantees

- No network I/O in any edition. The code contains no HTTP client, socket or telemetry. The browser pages enforce this with a `connect-src 'none'` Content Security Policy: as HTTP headers when hosted with `server.mjs` or `_headers`, as a `<meta>` tag in every build, and as a hash-pinned policy in the offline single-file page.
- The .NET edition's `gridanon ui` listens on localhost only, refuses non-loopback connections, requires a random per-launch token on every API call, checks `Host` and `Origin`, and serves its page with `connect-src 'self'`.
- No runtime dependencies: the .NET edition uses only the base class library, the TypeScript edition only browser/Node built-ins.
- Release artifacts are built by GitHub Actions from the tagged commit, with SHA-256 checksums published alongside.
