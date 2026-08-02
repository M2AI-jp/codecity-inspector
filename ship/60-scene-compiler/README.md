# 60 Scene Compiler

`index.mjs` is the only public boundary. It joins a validated logical
`WorldPlan` v1 to a human-approved Asset Manifest through an explicit,
versioned selector map. It emits a deterministic `SceneBundle` v1 containing
logical layers, collisions, navigation, rooms, actors, interactions, quest
sites, evidence addresses, and exact asset bindings.

```js
const bundle = compileScene({ worldPlan, assetManifest, assetRoot, bindings });
const check = validateSceneBundle(bundle); // { ok: true, issues: [] }
```

Bindings have this shape:

```json
{
  "format": "codecity.scene-bindings",
  "schemaVersion": 1,
  "selectors": {
    "terrain:terrace": "approved-terrain-terrace-v1",
    "water:default": "approved-water-v1"
  }
}
```

Selectors are semantic and exact. Missing selectors, unknown asset IDs,
missing files, hash/dimension mismatches, wildcard selectors, and fallback
fields are hard errors. The compiler never invents a placeholder or chooses a
nearby asset. It does not render, run a game loop, inspect a repository, or
perform network I/O.

