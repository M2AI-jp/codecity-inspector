# Art authority

The machine-readable authority is exported by
`studio/art-department/index.mjs`. `ORIGINAL_REGISTRY` contains all 22 entries
from MASTER.md, including the declared dimensions and SHA-256 prefix. Use
`verifyOriginalRegistry()` before deriving candidates; the gate is read-only
and does not approve or promote anything.
