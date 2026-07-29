# Fable5 acceptance scope v1 — current product completion

> **Decision status:** Lead decision for the current product-completion run, made from the
> product owner's instruction to finish every remaining item without relaxing quality. This file
> resolves only the conflicts listed below; it does not turn untested work into a PASS.
>
> **Precedence for this run:** this decision record → `docs/game-completion-definition.md` →
> `Fable5PrefabSpec.md` / `Fable5ArtContract.md` where not contradicted here → historical QA
> records. The evidence packet must name the commit that contains this file.

## DEC-01 — Visual authority and coordinate system

**Decision:** the current product-completion visual authority is
`user_target_town_current`:

- canonical source: `art/references/user-provided/target-town.png`
- SHA-256: `39102cbaed6745d658b8449cc7197f8454fb8492b4679f288de16c204e82d607`
- dimensions and coordinate system: **1586×992**
- custody/approval authority: `art/contracts/user-provided-images.json`, source ID
  `user_target_town_current`

This is not an inferred choice: the source ledger records it as the current user-direct
world-quality and runtime-background authority, with priority 1000. The 1536×1024 former town
target is explicitly `superseded` by this record. Any conflicting 1536×1024/24×16 wording in
historical Art Contract or placement material is reference/history for this run, not the
comparison source, coordinate system, or acceptance master.

The master remains an **offline comparison input only**. Runtime must render approved prefabs
and effects; it may not load the master, target, mask, CSS world art, or a visual fallback.

## DEC-02 — Asset acceptance is manifest-owned, not quota-owned

**Decision:** final acceptance freezes an explicit list of every visible runtime asset and its
binding, not a count. `Fable5PrefabSpec.md` §8 retires the legacy fixed PNG quota. The older
`57 core + 7 support` number is therefore historical planning information, not a way to pass
HG-04 by arithmetic.

For every asset visible in the completed customer route, the current revision's asset ledger
must record:

1. runtime URL and binding;
2. source/derivation, crop or authored contract, dimensions, pivot, layer, SHA-256;
3. origin, custody, approval and protection states;
4. N1–N9 mechanical result where applicable; and
5. human visual review for newly generated or visually material assets.

The acceptance packet's `10-runtime-asset-set.json` is the frozen authoritative list. It must
include all 48 town prefab identities (including dynamically handled exceptions), all named
runtime assets, and every new approved character/interior/audio/UI asset introduced by this
release. Missing or unapproved entries fail closed; a legacy count cannot excuse them.

## DEC-03 — Audio is part of product completion

**Decision:** sound is included rather than waived. The completed game supplies restrained
footstep, door, and dialogue feedback, plus mute and persisted volume controls. It must not
autoplay before a user gesture and must remain usable when WebAudio is unavailable or blocked.

This preserves D1/D2 and the completion definition rather than reducing the quality bar. Audio
evidence belongs in the golden-route capture and recovery/accessibility logs.

## DEC-04 — This is final product completion, not only the intermediate goal

**Decision:** all six outcomes in `docs/game-completion-definition.md` are in scope:

- repository-specific WorldPlan and traceability across three repositories;
- coherent approved prefab world at both target viewports;
- natural four-direction movement and collision;
- enter/exit/cutaway for the inn, town hall, and M-house;
- meaningful full investigation route and dialogue UI; and
- save/restore/reset, robust errors, accessibility, deterministic render and owner approval.

The existing inn-only flow and closed-entry explanations are valuable intermediate behavior, but
cannot substitute for the three-building or final-quest requirements.

## Gate consequences

- A1/HG-03 reconstruction and runtime tests compare against the 1586×992 authority above.
- HG-04 uses the manifest-owned asset set above and cannot be accepted until every listed asset
  has its required contract/approval evidence.
- D1/D2 require the audio behavior above; no silent scope waiver is valid.
- HG-05 through HG-10 and the 85-point rubric apply to the complete customer journey, not a
  smaller vertical-slice-only claim.

## What this decision does not do

- It does not approve any generated image, candidate, or asset-forge export.
- It does not mark an existing test, screenshot, or old matrix row as current evidence.
- It does not replace the need for a same-revision browser evidence packet and product-owner
  play approval.
