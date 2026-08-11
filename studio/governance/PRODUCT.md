# CodeCity v1 product authority

## READ FIRST — mandatory failure record

Codex previously treated internal production as the product. It optimized asset
counts, selectors, manifests, hashes, routes, tests, approval states, and review
records. It did not first make the customer town beautiful, coherent, and
playable. This consumed owner time and produced a browser game that could pass
mechanical checks while it showed mixed-scale image crops instead of one town.

The root failure was not one image-size defect. Work started from machinery and
worked outward. It did not start from the composed town that the end user sees.
Semantic labels were treated as visual variety. Valid files were treated as
usable game art. A completed scripted journey was treated as a completed game.

Git history records the concrete forms of this failure:

- `b13d5fd` drew one presentation master as the world and traced its visible
  roads with a fixed waypoint graph. The image was attractive. The repository
  did not generate the town.
- `b225db2` added traced walkable areas, a door, a cutaway, dialogue, clues, and
  a directional player sheet to one fixed target town. This was the strongest
  past playable version. The player still slid and changed body shape while
  walking. Numeric frame checks called the gait acceptable although direct
  viewing did not.
- `967acb1` and `40a3cd3` split the fixed master into prefabs and reconstructed
  it pixel for pixel. This changed the assembly method. It did not create a
  repository-derived town generator.
- `67b74c4` removed those customer paths. Use their history only to recognize
  failure. Do not restore their code or assets.

A beautiful fixed board is not procedural generation. A traced route is not
world design. A pixel-perfect reconstruction of one board is still one fixed
board. A numeric animation check cannot overrule visible sliding, morphing, or
poor game feel.

Do not repeat this failure.

Start with the end-user experience in one real browser. Work backward from one
beautiful repository-derived town, ordinary top-down RPG play, the complete
investigation journey, and a truthful revisit. Keep only code and art that
causes that experience or protects its safety. A test can find a defect. A test,
count, status word, asset catalog, screenshot, or approval record cannot decide
that the game is complete.

Git history can explain intent and past failure. It is not a source from which
to restore deleted requirements, systems, assets, or implementations.

This file is the only product specification and remaining-work authority.

## Product definition

CodeCity v1 is a local, read-only, top-down pixel-art game.

A user points CodeCity at a repository. The repository rises as a beautiful,
recognizable town. The user must want to look at the town, walk through it, take
a screenshot, and return to it before the user reads a report.

The town image is product value. It is not decoration around an inspection
tool. Investigation adds understanding and a caused town change to that value.
Town generation and free exploration have value before the request begins.

The immutable `target-town.png` board is the minimum visual-quality reference
for its late-medieval night worldview. The owner's Romancing SaGa comparison is
a qualitative standard for craft, character, exploration, responsiveness, and
game feel. It is not a request to copy that game's content or to add its combat,
party, statistics, equipment, or economy systems.

The generator supports multiple complete worldviews. A worldview is a coherent
visual and spatial language, not a palette swap or a new label on the same art.
Repository identity and meaning select and shape the world. One generated town
does not mix incompatible worldviews.

The opening experience must say, without a diagnostic panel, “my repository
became this place.” The town must look intentional even when the repository is
small or the investigation content is simple.

CodeCity is complete only when these qualities exist together:

- The repository becomes one beautiful and repository-specific town.
- The town belongs to one of multiple complete and coherent worldviews.
- The town works as an ordinary top-down pixel-art RPG.
- Generating and freely exploring the town is enjoyable by itself.
- The player completes the truthful investigation, report, change, exit, and
  revisit journey.
- The inspected repository stays unchanged, unexecuted, local, and private.

One quality cannot stand in for another. A beautiful still image is not a game.
A working route through an incoherent scene is not a game. A safe package is
not a game by itself.

## Complete player experience

An authorized user runs:

    npx codecity <their-repository>

CodeCity reads the repository without modifying or executing it. It opens on
literal 127.0.0.1 in a real browser.

The first view establishes the town as one composition. It shows a readable
ground plane, a way into town, a main route, a civic focal place, distinct
districts or clusters, and the player. The player can understand where they are
without reading permanent instructions.

The game owns the browser view. It scales a composed scene to the useful browser
area. In-world overlays hold the necessary guidance. A small Canvas surrounded
by a diagnostic page is not the opening experience.

The player can move as soon as the town appears. The request does not lock free
movement. The player can follow a road, enter a building, meet residents, and
enjoy the generated place before accepting an investigation.

The player accepts the town request. The player chooses routes through clues in
the world. The player visits three distinct investigation places. Each place
uses its own spatial clue, resident, object, or action. The player returns to a
report place that is distinct from the request place.

The report connects the discoveries. The town-hall lantern responds to the
completed bounded inspection. The lantern means that CodeCity completed its
read-only inspection. It does not mean that the repository builds, runs, passes,
deploys, or works.

The player exits to the terminal and stops CodeCity. A later run for the same
repository returns to the same recognizable town and preserves the caused town
change.

The same repository identity and state produce the same recognizable town. A
meaningful repository change can evolve its districts, routes, buildings,
population, or visible condition without replacing it with arbitrary noise.

The player can state one concrete true discovery and one remaining uncertainty.
The player learns these through place, movement, clue, action, dialogue, and
report. Raw diagnostic output is not required.

## The current visual baseline

The repository already has strong visual source material. The owner-provided
boards show a dense late-medieval town in a three-quarter top-down view. They
show slate roofs, detailed masonry, warm windows, stone roads, vegetation,
water, props, residents, interiors, and game UI. The 22 boards use these source
canvases: 1086 by 1448, 1448 by 1086, 1491 by 1055, 1536 by 1024, 1586 by 992,
and 1402 by 1122 pixels. These are presentation masters and source material.
They are not ready-to-draw game sprites.

The 1586 by 992 target-town board is the owner's visual-quality reference. Its material
detail, light, density, depth, road hierarchy, buildings, vegetation, residents,
and readable player set the scene standard. Shipping art can differ in layout
and worldview. It must not look like a reduced technical substitute.

The shipping catalog has these current dimensions and limits:

| Current role | Current bytes | Product use |
|---|---|---|
| Player | One 192 by 256 sheet with 32 by 32 frames in a 6 by 8 grid | This is the only current player source with a real directional frame layout. It is provisional material, not the final body-scale or quality anchor. Keep, rework, or replace it according to the composed scene and visible gait. |
| Exterior buildings | Fourteen exterior roles resolve to thirteen 192 by 192 building images | Pub currently aliases inn. Several images contain useful building art. They have mixed framing, scale, background context, and visible role quality. Reframe, layer, or replace each role that appears in the final town. |
| Interior rooms | Fourteen room roles resolve to one 192 by 192 room image | All roles currently use the same bytes. This is one visible crop, not fourteen interiors. Build only the distinct cutaways that the complete journey uses. |
| Residents | Seven NPC roles resolve to one 133 by 249 one-frame image | All roles currently use the same bytes. Repeated idle and walk labels do not create animation. These images do not share the player body scale and cannot remain as playable residents. |
| Terrain, plots, roads, and water | 64 by 64 images | Three road roles currently resolve to one road image. These images can be source material, but they do not yet form continuous surfaces, edges, corners, junctions, banks, or crossings. |
| Street props | 38 by 145, 71 by 102, 96 by 130, and 76 by 68 images | The source art can be useful. Each prop needs a deliberate world scale, baseline, footprint, shadow, and depth role. |
| Lights and state effects | 14 by 64 or 45 by 64 images | Use them only where they read as a light or caused state in the composed scene. The lit light and town-hall effect share one lit byte where applicable. |
| Quest marker | One 48 by 64 image | Keep only if it belongs to the world and helps play. It must not act as a diagnostic icon over unrelated art. |
| UI frames | Three 384 by 216 images remain | The unused guild roster panel was removed. Their size matches the current logical canvas. They do not yet make one interface with the separate HTML text and controls. Recompose the UI as part of the game. |

These reductions expose missing visual variety. They are qualitative deficiencies
to repair in the composed game, not targets for asset or role counts.

Selector names are not visual coverage. Byte-identical files with different
role names are one visible asset. An accepted source file is not a usable game
asset until it performs its role in the composed town.

The player sheet is the only current role with a real multi-frame structure.
That fact does not make its scale, style, or movement correct for the target
scene.
Recognizable house, town hall, watchtower, dock, warehouse, workshop, shop, inn,
ruin, well, lamp, sign, and tree art can supply processed scene roles. The
transparent dialogue and choice frames can supply the UI language. The guild
image has an opaque crop matte. The dojo image is a complete training-yard crop,
not an exterior building. Correct these source-context defects before use.

The current browser result is not the intended baseline. It draws 64-pixel
surface images at 16-pixel cell intervals. It draws 192-pixel buildings on
plots that are four to six cells wide. It draws 133 by 249 residents next to a
32 by 32 player frame. Large images overlap, surface stamps repeat, visible
geometry disagrees with collision, and the overview only recenters the camera.
The default canvas also reads as a small technical window inside a larger page.
This result is an asset catalog placed on a map. It is not a town.

## Size and spatial decision

The current code uses a 16 by 16 navigation address and a 32 by 32 player frame.
These are implementation facts. They are not the product's art scale, camera
scale, or quality target.

The WorldPlan uses abstract logical geometry. A complete worldview declares a
coherent pixel density, actor body scale, surface unit, structure envelope,
camera, and view. The scene compiler maps logical geometry to that worldview's
world pixels. The runtime does not infer a world footprint from source-image
dimensions.

Large role envelopes are valid for roofs, trees, gestures, effects, and tall
residents. Their bodies, feet, building bases, props, steps, furniture, and
interaction reach must still share one believable scale language. Current 32 by 32 player
frames and 133 by 249 resident crops do not define that language by themselves.

Grid addresses can support navigation and composition. They must not make the
renderer stamp one source crop at every cell. Ground, roads, water, banks,
crossings, and structures form continuous placed surfaces before drawing.

Every placed role has one shared geometry contract:

- visible frame bounds;
- ground footprint;
- baseline and pivot;
- collision and walkable space;
- building occupancy or interaction region;
- depth and foreground occlusion;
- direction, action, and visible state.

World generation, scene compilation, drawing, collision, interaction, camera,
and cutaway use this same contract. The player can walk to what the player sees.

The browser scales the whole logical scene by a whole-pixel factor. It does not
blur individual assets or stretch one role to hide a scale mismatch. The final
page gives the game the screen area that its composition needs. It does not
freeze the product at the current 384 by 216 technical window. An opening
overview fits the town. The play camera then gives enough local context for
movement and interaction.

## Visual direction

The immutable target-town and world-visual-master boards are the visual north
star for their worldview. They are not runtime backgrounds. The final game must
reconstruct their world language from game-ready roles.

The town uses one three-quarter top-down projection. Ground, structures,
residents, props, effects, interiors, and UI share one pixel density, outline
language, palette, light direction, shadow language, and night atmosphere.

The first frame reads as one authored image. The eye can find the player, the
way into town, a route choice, a central place, and a landmark. Roads lead to
accessible places. Buildings sit on the ground. Water has banks and crossings. Trees and
props support depth and neighborhood character. Quiet space separates focal
places. No source-sheet border, opaque crop background, black gap, accidental
overlap, repeated stamp pattern, or unrelated scene can remain visible.

The town has spatial hierarchy. It has a civic core, meaningful district
clusters, connected routes, smaller local places, and an honest edge. Procedural
generation chooses within this composition grammar. It does not scatter assets
and call the result a city.

Each worldview has a complete grammar for terrain, routes, water, architecture,
interiors, vegetation, props, light, residents, effects, and UI. A worldview can
change the mood and form of a town. It does not replace completeness with a
palette, climate name, selector, or background image. Do not mix partial kits to
claim variety.

Repository facts cause the visible form. Directories shape districts. Files or
coherent file groups shape buildings. Local relationships shape roads or
proximity. Unresolved relationships can shape broken crossings or blocked
routes. Observed verification relationships can shape light. Unknown facts stay
dark, covered, unreadable, or explicitly unknown.

Safe semantic groups and relationships survive the meaning and town contracts.
World generation uses them to cause district clusters, routes, landmarks,
density, boundaries, population, and local character. A hash can make choices
stable. A hash alone must not decide a generic layout.

The same repository returns to the same recognizable place. A different
repository changes meaningful districts, buildings, routes, landmarks, density,
or boundaries. A different label on the same generic layout is not a different
town. A random seed without repository meaning is not repository identity.

Any generated field must cause a visible, playable, narrative, or safety
effect. Remove climate, elevation, movement, road width, topology, selector,
payload, or other data that the product does not use. Do not keep inert data as
pretend variety or future value.

## Asset production decision

The unit of art quality is the composed town scene.

Start from the visual master and the required playable scene. Identify the
world role that is missing or wrong. Derive, crop, clean, reframe, resize,
layer, or replace that role. Give it the geometry and state needed for
placement. Reassemble the exact result in the real game. Judge it beside the
player and its neighboring roles.

Do not build isolated assets and hope that they later form a town. Do not grow
a catalog, selector family, generator, factory, preview system, evidence system,
or art platform as a substitute for scene work.

The current source material is sufficient to define the exterior visual
language. It is not sufficient as a ready runtime kit. The required production
difference is:

- continuous ground, road, water, bank, crossing, stair, and edge treatment for
  every case that the final town can show;
- buildings with a truthful footprint, base, roof depth, occupancy boundary,
  shadow, foreground occlusion, visible state, and matching cutaway where play
  uses it;
- residents with readable role silhouettes, facing, movement, and
  place-specific action at the player body scale;
- props and vegetation that complete streets and districts without hiding
  movement or interactions;
- visible repository states that belong to the place instead of floating as
  diagnostic symbols;
- game UI that joins prompts, dialogue, request, report, controls, and exit to
  the same visual world.

The current boards define the current late-medieval night worldview. Each
other shipping worldview needs its own complete and coherent set of the same
scene roles. Build those sets inside the existing art and scene path. Do not
build a general theme factory, generate filler variants, or count incomplete
kits as product variety.

These are scene jobs. They do not authorize new asset categories. Reuse an
existing role when it works. Correct or replace the existing role when it does
not. Add only the visual piece that a final generated scene actually needs.

Owner-controlled ChatGPT Pro threads can produce new source masters. Parallel
threads work only on independent roles in the same selected composed scene.
Every prompt preserves that scene's projection, actor scale, pixel density,
light, material language, and spatial purpose. A generated image stays candidate
material until it improves the packed scene beside the player and neighbouring
art. Thread count, image count, model label, and visual approval outside the
game do not show progress or completeness.

Do not request a complete PNG for each colour or state permutation. Author a
new master when silhouette, construction, material form, or scene identity must
change. Use declared material regions, approved palette ramps, structural
layers, foreground masks, light layers, and small condition decals for changes
that preserve the authored form. The scene compiler selects a bounded recipe.
The runtime can cache the resulting local supplied-pixel composition. Neither
component generates new art or retrieves remote art.

The factory stops when the exact packed bytes form the required scene. It does
not stop at a contact sheet or an accepted isolated image.

The 22 files under art/references/user-provided remain immutable. Only the human
owner may authorize new exact bytes under `ship/50-art/assets/`. This custody
decision controls source ownership. It does not make the game complete.

## Ordinary RPG experience

The player is easy to find at spawn. Held directional input causes direct,
predictable, brisk movement. Starts, turns, and stops respond at once. Walking
speed makes crossing the town enjoyable. Facing, animation, and world motion
agree. The player does not walk through visible walls, roofs, water, residents,
or props. Invisible geometry does not block the player.

A natural gait preserves the actor's identity and body volume. The feet
alternate. A planted foot holds against the ground. Limbs and clothing move
without melting or changing the character. Root motion and visible steps agree,
so the actor does not slide.

Road width, surface art, and walkable area agree. A building footprint, visible
walls, occupancy region, interior floor, and exit space agree. Entry and exit
preserve spatial orientation.

Moving into a building's visible occupancy region reveals that building
automatically. The player does not press Enter, Space, E, or another action key
to enter. The building and player stay at the same world coordinates. Its roof,
ceiling, upper walls, and foreground layers fade or clear smoothly to reveal
the interior already placed below them. Leaving the occupancy region restores
the layers after the player is clear. Entry does not target a door, use a black
transition, teleport to a detached room, or show a duplicated room crop.

The action key remains available for talk, inspect, choose, and other deliberate
actions inside or outside a building.

Residents exist as actors in the same world. They face, idle, walk, work, or
talk as their visible role requires. Their interaction area follows their body,
facing, and the declared reach. A full image rectangle is not a conversation
model.

The town has a varied and appealing resident population. Residents differ in
silhouette, age, clothing, palette, occupation, movement, and place-specific
behavior. They make districts feel inhabited without blocking routes. Cloned
static figures with different labels are not a population.

Depth sorting keeps feet grounded and keeps the active player readable.
Foreground roofs, walls, and vegetation occlude only where the art says they
do. A cutaway reveals the inside of that building. It does not replace the town
with an unrelated crop or trap the player in a smaller invisible rectangle.

The camera gives a clear establishing view and a stable walking view. The
overview fits the town instead of moving to its center at the same zoom.

Prompts, dialogue, request, report, feedback, and exit appear as game UI.
Permanent help, numeric build status, asset counts, and diagnostic panels do not
frame the customer experience.

## Generated world and game depth

Generating a town, seeing how the repository became a place, and wandering that
place are a primary game loop. The player can pause the request and still find
valuable routes, districts, landmarks, interiors, residents, and views.

Game depth comes from meaningful route choice, strong place identity, seamless
interiors, resident life, repository-derived discoveries, and a town that
changes for a truthful reason. It does not come from feature count or from
unrequested combat and progression systems.

Procedural variation preserves authored composition. It produces towns that are
surprising but legible, rich but walkable, and different but causally tied to
their repositories. Small and large repositories both become intentional
places. Neither becomes an empty grid or an unreadable asset pile.

## Investigation and truth

Walking is investigation. Roads, landmarks, residents, light, and visible
repository conditions give the player reasons to choose a direction. The game
does not reveal a complete answer path and does not require hidden operator
knowledge.

Each of the three investigation places reveals a distinct repository fact. Its
clue and action belong to that place. The same generic panel in three buildings
is not three investigations.

Every fact, symbol, state change, and line of dialogue preserves observed,
inferred, or unknown.

Observed facts are stated directly. Inferences are qualified. Unknown facts
remain unknown. Presence is not activity. A discovered relationship is not
execution or success. Unverified is not broken.

Residents speak in plain language about the place where they stand. Technical
detail can remain available through evidence, but the player does not need raw
diagnostics to understand the discovery.

## Qualitative decision lenses

These roles are viewpoints on one product. They are not separate approval gates.

The design director asks whether the opening town has value before the report.
The composition must make the repository feel like a place worth exploring and
remembering.

The world and level designer asks whether repository structure creates a
readable town shape. Routes, districts, landmarks, accessible buildings, boundaries, and quiet
space must support both visual hierarchy and natural walking.

The art director judges the whole frame for coherent craft. An isolated sprite
cannot prove a coherent town.

The asset production lead keeps only images with a necessary scene job and
enough data to assemble them. Source context remains until the game uses the
crop, layer, frame, pivot, footprint, state, and reuse. The work ends in the
game, not in an asset inventory.

The technical artist and scene compositor ask whether source pixels become one
world. They own the join between art scale, placement, collision, occlusion,
animation, lighting, and camera.

The game programmer asks whether the visible promise is true under input.
Geometry, movement, building occupancy, residents, cutaways, state change, and persistence
must use one canonical scene path. Duplicate or ignored product paths are
removed.

The narrative and UX designer asks whether the player understands why to move,
what changed, and what remains unknown from in-world language. The interface
must not expose implementation vocabulary as player instruction.

The first-time end user asks, “is this my repository, and do I want to enter
this town?” The returning user asks, “is this the same place, and did my
investigation leave a meaningful change?”

The playtester and debugger use an uncoached real-browser play. They describe
where the image, movement, collision, interaction, understanding, or return
experience breaks. They do not replace that judgment with a route script or a
green test.

The browser and release integrator asks whether the exact packed images, scene
data, Canvas, CSS, and browser display preserve the intended pixel grid, scale,
input, and composition on the customer path.

The accessibility and performance viewpoint protects readable text, sufficient
contrast, stable input, and smooth movement in the actual game. It does not add
a settings platform or reduce the visual direction to a numeric score.

The repository-truth and safety owner asks whether the town remains honest,
local, private, and read-only. Safety can reject unsafe work. It cannot declare
the visual game complete.

## Truth, privacy, persistence, and custody

CodeCity keeps every inspected repository read-only.

CodeCity never executes repository source, scripts, tests, hooks, binaries,
package managers, build commands, or generated commands.

Source, analysis, saves, and assets stay local. The local server binds to
literal 127.0.0.1 and serves only the immutable allowlisted snapshot for the
current run.

The completed journey persists locally for the same repository. Persistence
does not change the inspected repository and does not send data to a remote
service.

Runtime code uses only the shipping art needed by the final composed game.
There are no placeholder, nearest-match, wildcard, silent-fallback, or remote
assets in the customer path. Candidate art and production material do not ship.

## Implementation scope

Build only code that causes the defined player experience or protects truth,
privacy, local delivery, persistence, asset custody, or safety.

Delete every product-path line, field, selector, asset, file, tool, test,
record, and dependency that has no causal role in that experience and no
protective role. Do not archive it. Do not preserve it for possible future
scope. Do not use old unused code as authority for new implementation.

While the game is incomplete, current non-reference status, a file count, hash
equality, or test status alone does not prove deletion. Judge each line and file
by its qualitative role in the final game, its unique source, crop, geometry,
or style knowledge needed to build that game, or its safety or custody role.
Merge exact duplicate bytes only after preserving that role and production
knowledge. Candidate production material can be necessary before runtime
consumes it. Review, evidence, and catalog machinery cannot substitute for the
composed game.

Use the current inspection, meaning, town, world, art, scene, runtime, server,
and CLI module path when it serves the product. Change or remove a path when
the composed game proves that it blocks the product definition.

Keep the request, three distinct investigations, required cutaway interiors,
indoor interaction, truth states, report, town-hall lantern response, local
save, explicit exit, process restart, and revisit.

Do not add achievements, currency, streaks, engineering grades, runtime image
generation, combat, parties, character statistics, equipment, an economy, more
facility types, more game modes, audio expansion, localization expansion,
sharing, broad settings, broad controller work, framework migration, new schema
layers, dashboards, or verification UI.

Multiple complete worldviews are part of the product. They do not authorize a
theme platform, a variant-count target, or speculative art. Add only a complete
world language that the generator can compose into the defined experience.

Do not implement an asset platform, acceptance platform, or governance system.
Make the smallest cohesive change that produces the whole intended experience.
Small patches are not a virtue when they preserve an incoherent town. Large
systems are not a virtue when they do not improve the town.

## Shipping module boundaries

Dependencies flow from lower-numbered ship modules to higher-numbered modules.
The 90-cli module is the only composition root.

The numbered module structure is sufficient. Do not add a new module, roadmap,
factory, or parallel customer path. Improve the existing contracts. Remove a
duplicate or ignored payload instead of preserving it beside the canonical one.

Cross-module imports use only the target module index.

The 10-inspect module reads repository bytes without executing them.

The 20-semantics module derives repository meaning, including safe groups and
relationships that can cause visible town form.

The 30-town-domain module expresses town facts, investigations, and the
town-hall lantern response. Its town model retains the safe semantic structure
that world generation needs.

The 40-worldgen module produces repository-caused logical topology, district
shape, routes, landmarks, population needs, and worldview intent. It does not
import images, Canvas, DOM, server, or CLI code.

The 50-art module contains only complete shipping worldview roles and custody
data for their assets.

The 60-scene-compiler module is the only shipping module that joins world data
to shipping art. It maps logical geometry to worldview pixels and emits one
canonical serialized SceneBundle. That bundle carries continuous surfaces,
structures, exterior bases, interiors, roofs, ceilings, foreground masks,
occlusion, collision, occupancy regions, residents, state, and camera
composition from the same placed geometry.

The 70-game-runtime module consumes that SceneBundle and never reads a
repository. It implements direct movement, automatic building occupancy,
layered cutaway, residents, interaction, camera, UI, state change, and return.
It does not invent a second map or room model.

The 80-local-server module serves the immutable loopback snapshot.

The 90-cli module composes inspection, scene compilation, and local delivery.

Shipping code never imports from studio. Non-customer production paths do not
ship.

## The only remaining product item

- [ ] Replace the current mixed-scale catalog rendering with a beautiful,
  coherent, repository-derived town from a complete worldview. Make generation
  and free exploration valuable by themselves. Carry the same placed world
  through brisk natural movement, automatic seamless building entry, layered
  roof and ceiling reveal, varied resident life, three distinct investigations,
  report, visible town change, exit, restart, and revisit in the exact packed
  browser game. Support multiple complete worldviews without a parallel product
  path.

This item is one product change. Do not split it into proxy completion gates.
Its evidence is the direct qualitative experience of the exact packed game.
Tests can explain a failure cause. Asset custody can authorize bytes. Neither
can check this item by itself.

## Completion judgment

The game is complete when an uncoached end user receives the defined experience
as one continuous product.

The user first sees a beautiful and recognizable repository town. The user can
enjoy its generation and explore it without instruction. The user moves quickly
and naturally through visible space. Crossing into a building reveals its
matching interior in place. Varied residents make the town
feel alive. The user understands a reason to investigate. The user completes
the three distinct investigations, makes the report, sees the caused town
change, exits, and later recognizes the same changed town. Other repositories
can produce coherent towns in other complete worldviews. The repository remains
safe and the claims remain truthful.

The game is not complete if it draws a fixed master, traces one board's roads,
reconstructs one board from prefabs, relabels one generic layout, stamps source
crops across a grid, slides or morphs an actor, requires an action key to enter
a building, teleports to a detached interior, surrounds a small game view with
diagnostic page chrome, fills streets with cloned static residents, or calls a
palette change a worldview.

The word APPROVE does not hold this judgment. A count, score, threshold, route,
test suite, manifest, hash, generated image, asset review, or audit state cannot
stand in for the experience. A browser run can expose a defect. It cannot make
an incoherent town complete by reporting success.

Judge the whole composed town first. Judge the whole play journey second. Fix
the direct cause of any failure. Stop when the game itself supplies the value
defined in this file.
