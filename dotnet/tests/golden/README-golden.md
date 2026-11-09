# Golden files

`*.v1-golden.xml` were produced by the original TypeScript engine (v1,
`anonymize-core.ts` / `anonymize-stream.ts`) with salt `test-salt-123` and
default options. `dotnet/tests/.../CimTests.cs` and `web/test/core.test.ts` assert both editions reproduce
them byte for byte, which guarantees that a CGMES set anonymized partly with
v1 and partly with v2 still joins.
