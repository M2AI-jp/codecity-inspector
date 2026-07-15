# CodeCity Inspector — playable city design

Status: completion-candidate implementation (2026-07-15)

## Product decision

CodeCity Inspector is a game in which the player walks through one continuous
city and visits facilities that express the inspected repository. The image
board is a quality reference only. It is never drawn as the world background.

The playable world is authored from the 78 approved assets at their declared
native scales. Old assets, image-board pixels, procedural substitutes, debug
markers, and gallery-only placements are not part of the runtime render path.

## First five seconds

- The player, streets, buildings, and the next destination are visible as soon
  as the asset manifest and town model are ready.
- A four-step journey card says what to do without requiring documentation.
- WASD, arrow keys, click-to-move, and Enter are always visible on the game
  screen and respond immediately.
- The player has a warm outline and the label `あなた`; repository facilities
  have small status-aware entrance labels.
- The canvas remains visible at ordinary desktop and mobile viewport sizes.

## One continuous world

The native world is a 32 x 24 grid of 64 px cells (2048 x 1536 px). Four
districts share one four-directional navigation graph:

- `old_town`: civic plaza, gate, market, guild, inn, pub, and workshop;
- `snow_quarter`: an elevated snow settlement reached across a stone bridge
  and cliff stairs;
- `harbor`: quay, wooden bridge, warehouses, working dock, and waterway;
- `woodland`: irregular trees, homes, paths, well, and overgrown ruin.

Roads, waterways, bridge ends, stairs, cliff rims, docks, and entrances meet on
visible traversable cells. Movement never uses a district teleport. Every
facility entrance is connected to the player start, and the overview control
shows the whole city and current destination.

Ground variation, authored prop clusters, overlapping buildings, residents,
animated effects, foreground objects, and y-sorted occlusion break mechanical
tile repetition while preserving collision readability.

## Guided first journey

The initial journey is deliberately on the play surface, not inside a report:

1. Move from the old-town plaza.
2. Follow the visible route across the stone bridge and cliff stairs.
3. Enter or inspect the snow dojo and open its evidence.
4. Return to the same world location.
5. Use the overview or streets to reach a woodland home.
6. Enter the home; the city then becomes free-roam.

The journey card records walking, bridge, stairs, evidence, and return progress.
An absent repository facility remains geographically visitable: inspecting it
explains why it is unconfirmed rather than turning the street into a dead end.

## Repository mapping

`/api/town` supplies the read-only inspection model. Each of the fourteen
facility kinds owns a semantic city entrance and one or more playable sites.
Presence changes the building light, entrance status, resident activity, and
inspection wording without changing geography or reachability.

Facility evidence is always presented in three independent groups:

- observed: facts directly read from bounded static inspection;
- inferred: conclusions derived from those facts;
- unknown: behavior or state that was not verified.

Untested or absent is never rendered as broken. Every statement shown in a
facility links back to its `/api/town` evidence bag. The same repository model,
manifest, and authored world produce the same city on every reload.

## Seventeen playable sites

Town hall, gate, guild, pub, shop, inn, dock, dojo, well, workshop, warehouse,
watchtower, and ruin each have a dedicated site. The house entrance offers four
distinct stops: small home, larger home, woodland hut, and old residence.

Sites are authored 768 x 512 scenes. They keep terrain at 64 px, buildings at
256 px, characters at 24 x 40 per frame, objects at 64 px or smaller, and
effects at 32 px per frame. The player can walk a connected route, approach the
evidence point, inspect it, and return to the exact world node.

## Approved-asset contract

- `public/assets/forge/manifest.json` is the only asset entry point.
- The manifest contains exactly 78 approved IDs: 17 buildings, 22 characters,
  19 fields, 18 objects, and 2 effects.
- The world and reachable sites collectively give all 78 assets a semantic
  render role; diagnostics and galleries do not count.
- Runtime code resolves semantic IDs through the manifest and stops with a
  visible error if the approved set is incomplete. It never substitutes an old
  or generated image.
- Automated audits verify exact ID coverage, native dimensions, connected
  entrances, bridge/water and stairs/cliff geography, and deterministic
  transforms.

## Render order

1. Authored ground and geographic overlays.
2. Buildings, props, residents, and player sorted by their feet position.
3. Water and construction effects.
4. Destination route and nearby interaction prompt.
5. Minimal controls, journey card, district banner, and optional evidence
   drawer.

## Acceptance boundary

Automated tests establish technical verification only. A clean real-browser
playthrough and visual inspection establish a completion candidate. Completion
is declared only after the user opens this build, performs the journey, and
approves it.
