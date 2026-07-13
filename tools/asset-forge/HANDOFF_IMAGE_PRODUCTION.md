# Asset Forge: image-production handoff

Use this document to resume candidate-asset production after changing the ChatGPT browser session.

## Objective

Finish candidate creation for the required **78 game assets** in Asset Forge.  The game reads the inspected repository and deterministically creates the town layout and placements; this task supplies the approved art that the existing runtime selects.  Do not create a single whole-town scene as a runtime input.

All output remains **pending human approval**.  Creating a candidate is not approval, promotion, export, or proof of in-game readability.

## Guardrails

- Keep the inspected target repository read-only.  Do not run its scripts, tests, hooks, or package manager.
- Do not use OpenAI API keys, paid APIs, or command-line/API fallbacks for image generation.
- Use Codex built-in `image_gen` for generated imagery.  The browser ChatGPT session is an optional supplemental image-generation surface only after the user has signed in; never upload source code, repository content, or analysis to it.
- Use only the user-provided reference images already in `references/pending/` (and any future files the user explicitly supplies).  Do not download third-party imagery.
- Never call Asset Forge `promote` or write an export as an approval shortcut.  A person reviews and approves candidates first.
- Bind any local visual test server to loopback only.

## Current state (observed 2026-07-13)

- Asset Forge definitions: **110 total assets**, **78 required assets**.
- Human-provided style references have been registered as `pending` in `data/manifests/references.json`; hashes and dimensions are recorded.
- Forge validation passed with no issues and the Forge test suite passed (**45/45**) before this handoff.
- First building batch was generated, processed, and imported as pending candidates:

| Asset ID | Pending candidate | Notes |
| --- | --- | --- |
| `building.inn` | `generated/buildings/pending/building_inn-13eb9caa39e901e1.png` | Preferred normalized candidate |
| `building.inn` | `generated/buildings/pending/building_inn-7944806d360ccddc.png` | Earlier raw alternate; retain only until human comparison |
| `building.pub` | `generated/buildings/pending/building_pub-cc9566c5ff4a202a.png` | Pending review |
| `building.town_hall` | `generated/buildings/pending/building_town_hall-0c0a4e751bbc58ea.png` | Pending review |
| `building.dock` | `generated/buildings/pending/building_dock-1f7162756130e69f.png` | Pending review |

- Two `field.cobblestone` candidates are also pending, but neither is approved.  The downscaled generated one is too abstract to treat as a final tile without a seam/readability review:
  - `generated/fields/pending/field_cobblestone-59ecc506cbd9bf53.png`
  - `generated/fields/pending/field_cobblestone-07282b336b107bfd.png`
- A workshop/dojo/watchtower/warehouse generation batch was interrupted before any candidate import.  Resume those four next.
- The character style reference at `/Users/amano/Downloads/ChatGPT Image 2026年7月12日 11_17_32.png` has been visually inspected but is not yet copied into the workspace, so it is not yet registered or hash-verified.  Ask the user to place it under `tools/asset-forge/references/pending/` before producing character candidates.

## Relevant project files

- Asset definitions: `data/asset-definitions/`
- Registered references: `data/manifests/references.json`
- Pending source references: `references/pending/`
- Candidate imports: `generated/<category>/pending/`
- Generator normalization helper: `scripts/normalize-generated.mjs`
- Temporary generation work: `tmp/imagegen/` (not source-controlled)
- Asset Forge workflow rules: `AGENTS.md`

## Important implementation change

Building definitions now use `logicalSpriteSize` rather than forcing every building to 16×16.  Current logical sprite sizes are intentionally compact while preserving readable detail:

- 48×48: inn, pub, dock, workshop, dojo, warehouse, guild
- 64×64: town hall
- 32×48: watchtower
- 32×32: well, gate, houses, shop, hut, ruin, old house

Keep `tileSize: 16`: it represents placement-grid units, not a forced image dimension.

Before character work, resolve the existing contract contradiction: character definitions currently require transparency but name a black background.  The required deliverable is a transparent 80×96 PNG sprite sheet, arranged as 4 directions × 3 frames with each frame 20×32.

## Recommended restart order

1. Continue the building batch: `building.workshop`, `building.dojo`, `building.watchtower`, `building.warehouse`.
2. Finish the remaining buildings using the category masters in `references/pending/`.
3. Establish a seam-tested 16×16 terrain master, then process terrain tiles.
4. Once the user has copied the character style sheet into the workspace, produce the 22 character sprite sheets to the exact 80×96 layout.
5. Produce objects (16×16) and effects (64×16, four 16×16 frames).
6. Validate candidates and use the game’s existing auto-placement/runtime preview for a human review.  Do not mark any candidate approved yourself.

## Candidate workflow

For one building/object/effect candidate:

1. Select only relevant registered user references.
2. Generate an isolated, original pixel-art asset with Codex built-in `image_gen`; request a flat magenta chroma-key background for items that must become transparent.  Do not include text, UI frames, anti-aliasing, or borrowed game art.
3. Copy the generated file into `tmp/imagegen/` and remove the chroma key with the local helper:

   ```sh
   python3 scripts/remove_chroma_key.py --input INPUT.png --output tmp/imagegen/ASSET-alpha.png
   ```

4. Normalize with nearest-neighbour scaling, binary alpha, and a restrained palette:

   ```sh
   node scripts/normalize-generated.mjs \
     --input tmp/imagegen/ASSET-alpha.png \
     --output tmp/imagegen/ASSET-final.png \
     --width WIDTH --height HEIGHT --palette 24 --alpha-threshold 32
   ```

5. Import as a pending candidate (use the actual asset ID and final file):

   ```sh
   node src/cli.mjs import --asset ASSET_ID --file tmp/imagegen/ASSET-final.png --allow-pending-reference
   ```

6. Record what was observed versus inferred.  Inspect a scaled preview and, for tiles, a repeated seam preview.  A clean import is only a structural check.

### Terrain caution

Generated large cobblestone imagery becomes muddy when reduced directly to 16×16.  For terrain, start from a tileable 16×16 construction/crop, test edge continuity, then use generation only to fill clearly scoped gaps.  Check walkable/non-walkable meaning at native size.

### Character caution

For each character, output exactly 80×96 with transparent background: four direction rows (front, back, left, right) and three 20×32 frames per row (idle, walk 1, walk 2).  Do not substitute a portrait or a posed character sheet.

## Verification before the next handoff

Run within `tools/asset-forge/`:

```sh
npm run validate
npm test
```

Then state separately:

- **Observed:** files imported, dimensions, hashes, test/validation results, browser/runtime preview facts.
- **Inferred:** likely style matches, proposed candidates, likely usage.
- **Unknown:** human approval, license confirmation beyond user-provided provenance, real-game legibility, and final placements until viewed in the runtime.

## Browser ChatGPT resumption

The user reports that browser ChatGPT access is available after a session switch.  At resumption, first verify the active account/session in the in-app browser.  Use it only if signed in and only to generate image candidates from the user-provided visual references; Codex built-in image generation remains the primary no-API-cost path.

