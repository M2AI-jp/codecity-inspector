# Pixel-art quality gates

`index.mjs` is the read-only candidate inspection boundary for MASTER.md
G1-G10 and character C1-C6. It reads PNG bytes and explicit JSON metadata; it
does not write, copy, approve, promote, or produce a human approval record.

Run it explicitly with:

```sh
npm run check:pixel-art
# or
node studio/quality/gates/check-pixel-art.mjs --root /path/to/repository
```

The command is fail-closed. A missing palette, missing candidate tree, empty
candidate tree, malformed PNG, missing sidecar spec, or unknown metric is not a
pass. The report keeps `observed` byte measurements, `inferred` values and
limits, and `unknown` states separate. The command never turns an untested
metric into a pass.

## Explicit metadata

The default palette file is
`studio/art-department/authority/palette-v1.json`:

```json
{ "id": "palette-v2", "colors": ["#14161C", "#..." ] }
```

Every candidate PNG needs one unambiguous sidecar: `<name>.json`,
`<name>.spec.json`, `spec.json`, or `candidate.json` in the same candidate
directory. The sidecar must declare `id`, `kind`, `dimensions` (or `width` /
`height`), and `paletteId`. Character candidates additionally declare a frame
grid and explicit `walk.rows` / `run.rows` animation rows. Tile candidates
declare `tile.neighbors` so G10 can compare actual neighboring bytes; without
that evidence G10 remains unknown and the gate fails.

Example building sidecar:

```json
{
  "id": "building_inn_v1",
  "kind": "building",
  "dimensions": { "width": 64, "height": 64 },
  "paletteId": "palette-v2"
}
```

The only output is a report. Passing this gate is numerical inspection only;
human ownership approval and the separate asset manifest remain required.
