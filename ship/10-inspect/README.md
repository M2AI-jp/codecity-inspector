# 10 Inspect

Read-only, bounded static inspection. Produces an `InspectionReport`; never
executes or writes to the inspected repository.

```js
import { inspectRepository } from './ship/10-inspect/index.mjs';

const report = await inspectRepository('/path/to/repository', {
  maxFiles: 5_000,
  maxFileBytes: 256 * 1024,
});
```

The only public entry point is `index.mjs`. The report is JSON-serializable and
uses schema version `1`: `repository`, `summary`, `files`, `graph`,
`manifests`, and an `evidence` tri-bag (`observed`, `inferred`, `unknown`).
Paths are relative to the inspected root. Symlinks are reported as unknown and
are never followed; vendor/generated/build output is excluded by policy and
also reported as unread (`unknown`).
