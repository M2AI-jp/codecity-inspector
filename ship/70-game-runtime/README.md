# 70 Game Runtime

The runtime consumes one serialized `SceneBundle v1` and has no repository,
network, or sibling-module dependency. `createGameRuntime` validates the
bundle before touching the supplied Canvas, UI root, storage, or asset loader.
`startGameRuntime` then loads every exact approved asset reference; a missing
asset is a hard error (there are no placeholders or fallback images).

## Runtime contract

The top-level bundle must contain `format: "codecity.scene-bundle"`,
`schemaVersion: 1`, `bindingsVersion: 1`, the compiler fields `world`,
`assets`, `layers`, `collisions`, `nav`, `rooms`, `actors`, `interactions`,
`questSites`, and `evidence`, plus the `game` adapter contract below.

`game.logicalSize` is exactly `384x216`; `worldSize` is at least that size.
The adapter supplies a spawn, player binding/footbox and canonical speeds
(`run: 75`, `walk: 45` px/s), collision rectangles, and renderables with
integer-sorted foot pivots. Every entrance has `rect`, `roomId`,
`cutawayIds`, `exteriorSpawn`, and `interiorSpawn`; entering moves to the
interior spawn and Back returns to the exterior spawn. Rooms expose their
cutaway IDs. NPCs provide an approved asset, interaction rectangle, prompt,
and dialogue.

`game.quests` is the compiler-provided list of zero through three sites. No
sites means `no_request` and the report is unavailable. Each answered site is
one of `見た`, `そうらしい`, or `わからない`, rendered with the corresponding
evidence-ending grammar. A report becomes complete after all supplied sites
are answered; `townRevision` changes only when `game.report.change` is
non-null. The five guild tabs are `なかま`, `うけつけ`, `いらい`, `もちもの`,
and `じょうたい`.

`game.request` is the bulletin-board address and `game.report` is the separate
town-hall address. The customer CLI launches the release journey only when
exactly three evidence-grounded sites exist; the lower-level zero-site state
is retained solely to represent exceptional repositories truthfully.

## Controls

Arrow keys/WASD move; Shift changes to walking; Enter/Space/E/Z interact;
Escape/X backs out; M/Tab toggles overlook; +/- changes integer scale.
Standard Gamepad API input is polled defensively: D-pad or left stick moves,
A decides, B backs out, and Start overlooks. Missing, disconnected, or
throwing Gamepad APIs are treated as no input. A connection notice is shown
for 3.2 seconds without creating a settings screen.

Persistence is local and identity-scoped (`codecity.game.v1.<repository-key>`)
with a strict 64 KiB serialized bound. Saved answers are keyed only by quest
ID, so reordering compiler sites cannot transfer an answer to another site.
