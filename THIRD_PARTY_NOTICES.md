# Third-party notices

CodeCity Inspector directly uses:

- `@babel/parser` 7.29.7
- License: MIT
- Official source: https://github.com/babel/babel/tree/v7.29.7/packages/babel-parser

The package and its Babel transitive dependencies include their own `LICENSE` files in `node_modules`. Exact resolved packages and integrity hashes are recorded in `package-lock.json`.

Asset Forge (`tools/asset-forge/`) directly uses, under its separate lockfile:

- `ajv` 8.20.0 — MIT — https://github.com/ajv-validator/ajv
- `ajv-formats` 3.0.1 — MIT — https://github.com/ajv-validator/ajv-formats
- `sharp` 0.35.3 — Apache-2.0 — https://github.com/lovell/sharp

Sharp's platform packages include prebuilt libvips 1.3.2 packages licensed under LGPL-3.0-or-later. The exact optional platform packages, versions, integrity hashes, and remaining transitive licenses (MIT, BSD-3-Clause, Apache-2.0, ISC, and 0BSD) are recorded in `tools/asset-forge/package-lock.json`; installed packages retain their license files.
