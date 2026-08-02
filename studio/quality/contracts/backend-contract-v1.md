# Backend contract v1

This freezes the first rebuild wave. Contract changes require a governance
decision; accepting additional aliases is not a substitute for agreement.

## InspectionReport

```text
{
  schemaVersion: 1,
  repository: { name, identity },
  summary: { filesDiscovered, filesInspected, truncated },
  files: [{ id, path, kind, extension, sizeBytes, isTest }],
  graph: { nodes, edges, entrypoints },
  manifests: [],
  evidence: { observed: [], inferred: [], unknown: [] }
}
```

Absolute repository paths are not serialized. Arrays use stable lexical order.

## SemanticModel

```text
{
  schemaVersion: 1,
  inspectionDigest,
  repository,
  files: [{ fileId, path, role, evidence }],
  connections: [{ id, direction, kind, target, sourceFileIds, evidence }],
  capabilities: {
    entrypoint, persistence, configuration, build, test,
    observability, recovery, distribution, externalConnections
  }
}
```

Roles are `service`, `interface`, `data`, `configuration`, `test`, `tooling`,
or `module`. Per-file and per-connection evidence is a three-array evidence
bag. A capability is `{ state, evidence }`, where state is `observed`,
`inferred`, or `unknown`. Semantics may copy observed evidence from inspection;
it may not originate observed evidence.

## TownModel

```text
{
  schemaVersion: 1,
  inspectionDigest,
  repository,
  facilities: [14 canonical facility records],
  facts: [{ id, kind, subject, state, evidence }],
  guild: { tabs: [5], representativeConnections, connections },
  investigations: { priority, candidates: [0..3 evidence-grounded records] },
  habitability: { level, label, knownCapabilities, unknownCapabilities, evidence },
  rewards: { bindings: [9], transitions: [observed transition only] }
}
```

The candidate record owns its end-user `subject` and `statement`; the scene
compiler may not invent either. There is no minimum candidate count and no
padding. Reward transitions must match one of the nine event/binding/facility/
effect tuples and preserve a non-empty observed evidence bag.

## WorldPlan

```text
{
  format: "codecity.world-plan", schemaVersion: 1,
  repository, identity, seed, contentSeed,
  townType, climate, terrain, grid, elevation, water,
  roads, roadNetwork, topology, regions, plotIds, plots, sightlines, nav,
  occupancy, rooms, npcs, props, lights, questSites,
  rewardBindings, townState, evidence,
  l1: { identity-derived geometry and navigation },
  l2: { content-derived occupancy, actors, props, lights, quests and state }
}
```

L1 is determined by repository identity. L2 changes when structured repository
meaning changes. Plots must be in bounds, non-overlapping, and connected.
Each investigation site maps to its corresponding facility plot when present,
or to the canonical planned region when absent or unknown.

## AssetManifest and SceneBindings

```text
AssetManifest = {
  format: "codecity.asset-manifest", schemaVersion: 1,
  manifestVersion, fallbackPolicy: "none",
  assets: [{
    id, version, status: "accepted", accepted: true,
    path, url, sha256, dimensions, pivot, usage, license, provenance,
    approval: {
      recordId, actorType: "human", authority: "owner", approvedBy,
      approvedAt, decision: "accepted", assetId, assetSha256, sourceSha256
    }
  }]
}

SceneBindings = {
  format: "codecity.scene-bindings", schemaVersion: 1,
  selectors: { "exact:semantic-selector": "exact-asset-id" }
}
```

Every accepted byte is PNG-decoded, dimension-checked, hash-bound, rooted below
the approved asset directory, and rejected through symlinks. Wildcards,
aliases, defaults, placeholders, and fallback fields are forbidden. Only a
human owner may create the acceptance record.

## SceneBundle and runtime game contract

```text
SceneBundle = {
  format: "codecity.scene-bundle", schemaVersion: 1, bindingsVersion: 1,
  world: { identity, contentDigest, seed, townType, climate, terrain, grid },
  assets, layers, collisions, nav, rooms, actors, interactions,
  questSites, evidence,
  game: {
    logicalSize: { width: 384, height: 216 }, worldSize, spawn,
    player: { assetSelector, footbox, speeds: { run: 75, walk: 45 }, interactDistance },
    collisions,
    entrances: [{ id, rect, roomId, cutawayIds, exteriorSpawn, interiorSpawn }],
    rooms: [{ id, bounds, cutawayIds }],
    npcs: [{ id, kind, position, assetSelector, footPivot, interactionRect, prompt, dialogue, cutawayId? }],
    quests: [{ id, siteId, rect, subject, statement, evidenceAddresses }],
    request: { id, rect, prompt },
    report: { id, rect, prompt, change },
    guild: { tabs: [{ id, label, entries }] },
    renderables: [{ id, assetSelector, position, footPivot, z, cutawayId?, roomId?, effect? }]
  }
}
```

The compiler fills the complete grid, carves entrances out of building
collision, and proves a collision-free approach to spawn, NPCs, investigations,
and the report point. A conditional effect selector and renderable exist only
when an exact observed reward transition exists. The runtime consumes this as
serialized data and does not import the compiler.

## Distribution contract

`90-cli` is the only composition root. It reads the inspected repository
through modules 10–40, joins approved art in 50, compiles with 60, then copies
an explicit allowlist of 70 runtime bytes, hash-verified assets, and
`scene.json` into an in-memory snapshot. Module 80 copies and hash-checks that
snapshot before serving it on literal `127.0.0.1` using GET/HEAD. The product
path creates no distribution directory. Neither module may execute repository
code, follow repository symlinks, write into the repository, bind publicly,
upload source, or serve an unlisted path.

These contracts are independently testable boundaries. Passing any one of
them is not the product KGI. The KGI remains a real end user completing the
repository-derived browser loop with human-approved art.
