# WorldPlan verification harness

This is an internal, deliberately small verification harness. It consumes a
serialized `WorldPlan` v1 JSON document and draws logical terrain, roads, plots,
occupancy, NPC markers, and quest markers on a Canvas. It does **not** inspect a
repository, import a shipping module, load art, start a server, or claim to be a
playable game.

The public boundary is [`public/index.mjs`](public/index.mjs). It exposes only
`validateWorldPlan`, `createHarnessViewModel`, and the frozen `HARNESS_CONTRACT`.
Invalid or malformed input fails closed with paths and error codes; the viewer
withholds the map rather than filling missing values.

## Contract accepted by the harness

The document follows the shipping WorldPlan v1 shape: `format`,
`schemaVersion`, `identity`, hashes, town type/climate/terrain, `grid`, water,
roads, topology, regions, plots, navigation, occupancy, rooms, NPCs, props,
lights, quest sites, and a top-level evidence bag. Logical cells use integer
coordinates; pixel, image, Canvas, and DOM fields are not accepted. Optional
entity evidence may be a three-state bag or an explicit `state` value. The
viewer preserves `observed`, `inferred`, and `unknown` separately; it never
turns an absent claim into an observed fact.

The hand-authored
[`fixtures/worldplan-v1.test-only.json`](fixtures/worldplan-v1.test-only.json)
is only a test fixture. It is clearly labeled as such inside the JSON and is not
product data or a generated town.

## Local use

Open [`public/index.html`](public/index.html) in a browser that permits local
ES modules, or serve this directory through a loopback-only static server. Use
the file picker or paste serialized JSON, then choose **Render verification
view**. No request leaves the machine and no value is persisted in
`localStorage`.

Run the pure harness checks from the repository root with:

```sh
node --test studio/quality/worldplan-harness/test/index.test.mjs
```

The harness is intentionally not a product KGI. Passing these checks proves
only that a WorldPlan can be inspected honestly; it does not prove that an
end user can play the generated town.
