# Inn n=1 minimal-delta asset audit

This audit is intentionally strict. A crop coordinate is not an alpha asset, and a plausible visual is not physical proof.

## Observed

- Accepted master: `1536×1024` RGB, SHA-256 `a3b33e5dcb8bd2c0475ba146888027159cb5c955eae3a5d53d58d7770a0417ce`.
- Geometry contract: SHA-256 `655e4e865a5daf110aec6357bf379b03763048abf1be7ea438bb36c962b8a6e8`.
- Inn visual bbox: `[73,430)×[179,475)`.
- Inn lot bbox: `[47,431)×[179,533)`.
- Closed door: `[185,228)×[356,439)`, observed foot `(207,439)`.
- Accepted master contains no alpha channel.
- The courtyard table/barrel cluster currently occupies `[267,358)×[449,514)`.

## Inferred production decision

- Keep the accepted full image as the background at `(0,0)` and native scale.
- Draw actors above that background.
- Draw a pixel-tight inn silhouette above actors only when their foot is north of `y=448`.
- Use a 48px visual door opening `[183,231)` centered on `x=207`; the 24px actor foot width then has 12px lateral margin per side.
- Move the courtyard cluster exactly `(0,-18)` so its translated bbox ends at `y=496`, leaving the declared raw passage `[496,544)`.

## Unknown and not approved

- Pixel-tight inn silhouette alpha.
- Pixel-tight courtyard cluster alpha and its hidden cobble.
- Open-door pixels.
- Interior/cutaway cover registration and quality.
- Final exterior collision polygon and uninterrupted browser sweep.

## Required asset verdicts

| Asset | Current verdict | Why |
|---|---|---|
| Full accepted background | PASS for the current minimal-delta decision | Exact source dimensions/hash are known; no resampling needed. |
| Interaction crop SVG | PASS as a deterministic registration/restoration view | It renders exact source pixels but has no alpha. |
| Closed-door SVG | PASS as a deterministic closed-state plate | It renders exact source pixels at the fixed world anchor. |
| Foreground occluder | FAIL / pending | RGB bbox is not an alpha mask. An opaque rectangle would cover courtyard/player pixels incorrectly. |
| Open-door plate | FAIL / pending | No authoritative pixels exist; a black reveal would violate visual and physical expectations. |
| Courtyard repair plate | FAIL / pending | Exact semantic extraction and hidden cobble reconstruction are still required. |
| Cutaway/interior | OUT OF SCOPE / required for entry completion | This asset set alone cannot honestly claim enterable inn completion. |

## Hard QA gates

1. Render at original size and at gameplay 2× zoom. Do not evaluate only a downscaled contact sheet.
2. Toggle the closed plate on/off over the background. A single changed edge pixel or visible seam fails registration.
3. Place the 64×128 actor at foot positions north/south/east/west of the inn. Only the structural silhouette may occlude it; courtyard ground and free-standing props must not.
4. Walk the foot ellipse through the open visual aperture on centerline `x=207`. It must clear without touching either jamb and without a visual/collision mismatch.
5. Traverse door `(207,439)` → approach `(207,480)` → courtyard slot `[496,544)` → gate center `(352,544)` in one run.
6. Inspect the repair plate perimeter at 100% and 200%. Repeated cobble, blur, doubled cluster fragments, relighting, or a rectangular seam fails.
7. During cutaway, draw the full interior cover below actors, hide the exterior foreground occluder, and draw only a separately masked front rim above actors. A one-piece interior overlay above the player is a failure.

## Rejected shortcuts

- Rectangular foreground crop as an occluder.
- Collision from the inn bbox or lot bbox.
- CSS brightness/filter on the rectangular interaction crop.
- Black rectangle for the open door.
- Moving collision while leaving the visible table/barrel cluster unchanged.
- Calling the inn complete before the interior cover, NPC, dialogue, exit spawn, and one uninterrupted browser proof exist.

## Asset production instructions

The exact crop, mask, prompt, placement, and acceptance details are machine-readable in `art/production/vertical-slice/runtime-assets/inn-n1-background-delta-v1.json`. The contact sheet in this directory is a coordinate review aid only; it is not runtime approval.
