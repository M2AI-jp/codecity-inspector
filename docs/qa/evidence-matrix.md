# QA Evidence Matrix

中間ゴール: 新 `target-town.png` のビジュアル品質を、固定背景ではなく再構成可能な画像Prefabで達成し、同一revisionのブラウザ上で自然な4方向歩行、衝突、3建物への入退室、正規cutaway、正規dialogue UI、NPCとの最低限の意味ある会話を証明する。

## Canonical evidence identity

| Field | Current value | State |
|---|---|---|
| Git HEAD | `356f7e6211cd32e08f80116d1a0dc6d102b04459` | observed; worktree is dirty |
| Canonical town target | `art/references/target-town.png` | observed |
| Town target SHA-256 | `39102cbaed6745d658b8449cc7197f8454fb8492b4679f288de16c204e82d607` | observed |
| Town target dimensions | 1586×992 | observed |
| Cutaway target SHA-256 | `e88b18da60d9c314ecc83c30573d6423129525fb684ce57496c240c1dbf19535` | observed |
| Dialogue source SHA-256 | `60a2255fe72e2e96c91f00caa93fa7f4906f57fc1f8f0332bdbe91648b9ba29d` | observed |
| Browser URL | `http://127.0.0.1:4173/fable5-v2/` | not started |
| Browser revision identity | unknown | browser evidence absent |
| Browser/version/DPR | unknown | browser evidence absent |
| Console/network capture | unknown | browser evidence absent |

`art/contracts/asset-inventory.json` contains the previous town-target hash and dimensions. It is historical/stale for the canonical target and must not be used for acceptance.

## Evidence-state vocabulary

- `PASS`: same-revision evidence demonstrates the requirement.
- `FAIL`: same-revision evidence demonstrates a violation.
- `UNKNOWN`: evidence is absent or insufficient. Untested is not broken, but `UNKNOWN` cannot be accepted.
- `UNMET`: a required artifact or evidence packet does not exist yet; this is a process gate, not a claim that an untested runtime behavior is broken.

## Weighted intermediate-goal rubric

Acceptance requires total ≥85, visual ≥48/55, gameplay ≥22/27, UI/dialogue ≥8/10, experience/robustness ≥5/8, every row ≥60%, and all hard gates `PASS`.

| ID | Area | Weight | Full-credit evidence | Current |
|---|---|---:|---|---|
| A1 | Recomposable visual truth | 15 | Every visible element maps to manifest source/crop/pivot/layer; prefab-only reconstruction; 100% building-coordinate agreement; SSIM ≥0.85; no hidden composite/fallback | UNMET |
| A2 | Architectural height and hierarchy | 14 | Town hall is unmistakable focal silhouette and ≥1.2× next building; three depth bands; four distinct building silhouettes | UNKNOWN |
| A3 | Density, depth, exploration shaping | 12 | Unarticulated base terrain ≤25%; no dead area beyond allowed plaza void; ≥3 visual destinations; meaningful prop clusters | UNKNOWN |
| A4 | Material/pixel/projection/lighting coherence | 8 | One density/projection/outline/light language; integer crisp rendering; contact grounding; no obvious 5×5 repeat; renderer-wide LUT/AO/halo/vignette | UNKNOWN |
| A5 | Cutaway visual quality | 6 | Exterior/interior continuity; active roof only; floor/wall/trim/door/furniture/NPC/player/light read as inhabited structure | UNKNOWN |
| B1 | Natural four-way movement | 11 | Dedicated directions; non-mirrored east/west; 2 idle +6 real walk +2 interact frames; facing ≤1 frame; idle ≤150ms; pivot drift ≤2px | UNKNOWN |
| B2 | Navigation/collision feel | 8 | Inn→road→house route; visible collision agreement; ten corner tests without snag/tunnel; invisible-wall error ≤4px | UNKNOWN |
| B3 | Entry/exit/camera/occlusion | 8 | Town hall, inn, house enter/exit; door/nav aligned; no bad spawn; only active roof hides; canopy fade; stable clamped camera | UNKNOWN |
| C1 | Correct dialogue UI | 5 | Documented source crop/9-slice; border/tail preserved at both viewports; no source examples leak; long text and choices fit | UNKNOWN |
| C2 | Meaningful minimum conversation | 5 | 2–4 turns with NPC role/local context, repository-grounded fact labeled observed/inferred/unknown, and useful next step/choice | UNKNOWN |
| D1 | Feedback/pacing/sound/exploration feel | 3 | Immediate input/interaction feedback; footsteps/door/dialogue cues; mute/volume; control ≤3s, affordance ≤5s, conversation/cutaway ≤30s | UNKNOWN |
| D2 | Robustness/resize/errors/accessibility/regressions | 5 | Both viewports crisp; explicit loading/missing states; keyboard/focus/contrast/non-color cues/reduced motion/mute; golden-route replay | UNKNOWN |

Current score: **not scored**. Missing evidence is not converted into zero-point product claims; acceptance is withheld.

## Hard gates

| Gate | Requirement | Current | Evidence |
|---|---|---|---|
| HG-01 | Reference hash, dirty revision identity, URL, viewport, DPR, and capture time pinned | UNMET | target hashes only |
| HG-02 | One live browser revision supplies all visual/gameplay evidence | UNMET | none |
| HG-03 | Runtime loads accepted prefabs only; no target/master background, legacy fallback, CSS world art, or missing-asset concealment | UNKNOWN | runtime absent |
| HG-04 | 57 core assets manifest-backed and accepted; support assets needed by visible scene accepted; N1–N9 and AC evidence complete | UNMET | accepted 0/57 core, 0/7 support |
| HG-05 | Four-way movement is visibly natural, not frame-count theater | UNKNOWN | no capture |
| HG-06 | Collision, nav, three-building entry/exit, and cutaway pass in one uninterrupted run | UNKNOWN | no capture |
| HG-07 | Retained dialogue source visibly used through valid slicing with readable meaningful conversation | UNKNOWN | no runtime |
| HG-08 | Console/fatal/missing production asset/source upload/non-loopback/old fallback counts are all zero | UNKNOWN | no logs |
| HG-09 | Observed, inferred, and unknown remain visibly separated | PASS | source and planning records separate states |
| HG-10 | No acceptance before browser evidence | PASS | current verdict is not scored |

## Unstated but obviously required checklist

This table must be completed as `PASS / FAIL / UNKNOWN` on every visual/runtime iteration. No line may remain `UNKNOWN` at intermediate-goal acceptance.

| Check | Measurable expectation | Current |
|---|---|---|
| Visual hierarchy | Landmark wins a one-second squint/grayscale test; lamps or UI do not steal focus | UNKNOWN |
| Navigation affordance | Main route, three destinations, entrances, and blocked states read before prompts | UNKNOWN |
| Feedback | Input-to-visible response ≤100ms; interaction response ≤150ms; blocked action explains itself | UNKNOWN |
| Pacing | Control ≤3s; first affordance ≤5s; meaningful interaction ≤30s; no empty traversal >5s | UNKNOWN |
| Legibility | Player, NPC, doors, prompts remain distinct over all tested surfaces; text never clips | UNKNOWN |
| Scene coherence | Projection, scale, palette, light, outline, seams, and grounding remain consistent | UNKNOWN |
| Fun/exploration pull | ≥3 visually distinct destinations promise different payoffs; scene is more than a checklist route | UNKNOWN |
| Animation feel | No duplicate-frame theater, sliding, moonwalking, direction flicker, robotic stop, or pivot wobble | UNKNOWN |
| Occlusion | Player remains readable; only intended roof/canopy fades; draw order never cuts the player | UNKNOWN |
| Camera | Integer-aligned stable follow, map clamping, no jitter/snap/void, useful destination framing | UNKNOWN |
| Sound expectations | Footstep, door, dialogue feedback; restrained repetition; mute/volume; no autoplay failure | UNKNOWN |
| Error states | Missing asset, closed entry, invalid data/save, failed load are explicit and recoverable | UNKNOWN |
| Accessibility basics | Keyboard-only, visible focus, contrast ≥4.5:1, non-color cues, reduced motion, mute, 44px touch targets | UNKNOWN |
| Loading/resize | Loading feedback after 250ms; state survives resize; target viewports stay sharp; no fractional zoom | UNKNOWN |
| Regressions | Golden route, hashes, asset set, console, collision, cutaway, dialogue, and resize replayed every iteration | UNKNOWN |

## Required evidence packet

- Exact dirty revision identity, canonical hashes, URL, viewport, DPR, browser version, and capture timestamp.
- 1920×1080 and 1280×720 screenshots plus 100% crops of character, building edge, terrain seam, door, cutaway, and dialogue.
- Master board, prefab-only reconstruction, diff heatmap, SSIM report, and coordinate comparison.
- Manifest mapping every visible asset to source board, crop, dimensions, pivot, layer, and accepted review.
- Browser network evidence that only approved prefabs and approved UI source are loaded; target/master images are absent.
- One continuous 60fps capture: idle, north/south/east/west walk, three blocker classes, inn entry/exit, town hall/house entry, cutaway, NPC dialogue.
- Frame-overlay evidence for planted foot and fixed pivot.
- Collision/nav overlay, ten corner approaches, and door-alignment replay.
- Dialogue source-to-runtime crop comparison, 9-slice spec, computed dimensions, long-text and choice stress cases.
- Console/network logs and captures for loading, missing asset, closed building, resize, reload, save failure.
- Audio cue list/capture, mute, keyboard-only, reduced-motion, and previous-iteration golden-route replay.

## Iteration log

| Iteration | Operation | Expected | Observed | Revision / URL | Screenshot/video | Console/network | Verdict |
|---|---|---|---|---|---|---|---|
| 000-source-baseline | Inspect Fable5 sources, 22 source families, new town target, cutaway target, dialogue source | Canonical identity and constraints fixed before production | Sources and hashes observed; new town target replaces stale inventory entry; production evidence absent | HEAD `356f7e6…`, dirty / no URL | source images only | not run | not scored; browser gates unmet |
| 001-blockout | Render Fable5VerticalSlice coordinates as 2304×1536 flat-color world blockout | 18×12 grid; exact ground, footprints, door/entrance, props, trees, characters; world-level composition precedes assets | PNG 2304×1536 SHA `d6c88179…`; SVG SHA `1f84ecec…`; lightweight coordinate enumeration passed; Sol found short landmark, wrong door openings, exterior/cutaway layer contradiction, bad pivots/canopy, unsafe QA marks, and an empty 54-cell road slab | HEAD `356f7e6…`, dirty / no URL | `art/production/vertical-slice/boards/old-town-blockout-128-v1.png` | not run | **FAIL as generation input**; retained only as annotated geometry evidence |
| 002-clean-exterior-mask | Separate exterior state and generation-safe geometry; apply target-town composition priority | Full-height civic landmark via north overscan; exact 128×288 openings; no grid/status/UI/glow/characters; four wall lamps; target-like foreground depth without closing central route | Earlier v2 hashes superseded; Sol confirmed overscan, door geometry, order, canopy, lamps and state isolation, then found old camera clips the hall, 8 missing decals, empty plaza, church-like needle, and merged foreground | HEAD `356f7e6…`, dirty / no URL | superseded v2 render | not run | **FAIL**; five visual/composition blockers corrected in iteration 003 |
| 003-camera-plaza-hierarchy | Correct all iteration-002 blockers before image generation | Exact real viewport proof; eight exterior decals; walkable plaza focal; broad civic clock/gables; individually cuttable foreground with gaps and outside-world collision | Superseded v3 hashes; Sol passed mechanical mask/hierarchy but rejected play-start camera, undeclared plaza decals, incomplete foreground pivot/fade contracts, wheel-like garden cue, and lack of a three-band end-user viewport | HEAD `356f7e6…`, dirty / no URL | superseded mask/camera proofs | not run | **FAIL narrowly**; end-user camera and recomposition contract corrected in iteration 004 |
| 004-playable-camera-recomposition | Separate zoom1 establishing shot from zoom2 playable spawn; make every added visual reconstructable | Full target-like three-band view before play; input begins only with player visible; organic walkable garden; 2 plaza decal prefabs; 8 non-overlapping boundary crops with pivot/anchor/fade rect | Logical PNG 2304×1536 SHA `810fd550…`; overscan PNG 2304×1856 SHA `5937226a…`; SVG SHA `d1d0c56d…`; four exact camera proofs; manifest support 9/9 and boundary 8/8; Sol hard-gate PASS; Terra JSON/hash/overlap/algebra checks all PASS | HEAD `356f7e6…`, dirty / no URL | `camera-establishing-*-zoom1-v3.png`, `camera-gameplay-*-zoom2-v3.png` | not run | **PASS for imagegen only**; generated art/reconstruction/runtime still unapproved |
| 005-exterior-candidate-01 | Built-in imagegen edit using approved mask + canonical target + role-labeled building/world support boards | Target-level whole-scene exterior without losing doors, route, hierarchy, state isolation, or future prefab separation | Candidate 1536×1024 SHA `5c4fe252…`; Sol jury 36/49 and old-contract audit 28/49: symmetric/sterile composition, anchor and door drift, missing survey door, merged/raised plaza focal, boundary overlap, baked lighting | HEAD `356f7e6…`, dirty / no URL | `art/production/vertical-slice/boards/candidates/old-town-exterior-master-candidate-01.png` | not run | **REJECTED**; art-direction evidence only; never slice or load |
| 006-exterior-candidate-02 | Imagegen correction of candidate01 using the clean mask and geometry guide | Preserve candidate01 density while repairing civic hierarchy, doors, plaza and foreground separability | Candidate 1536×1024 SHA `c7374d5f…`; visual jury 41/49 but old-contract audit 28/49; survey entrance and exact grid still fail, baked lighting remains, and forcing the fixed-size imagegen output into 18×12 would require destructive resampling | HEAD `356f7e6…`, dirty / no URL | `art/production/vertical-slice/boards/candidates/old-town-exterior-master-candidate-02.png` | not run | **REJECTED under legacy production contract**; art-direction evidence only |
| 007-exterior-candidate-03 | Imagegen correction under the user-authorized higher-quality contract revision | Native 24×16 visual master at exact 64px/cell; finished survey tower/door, stronger civic hall, organic plaza/routes and separated foreground | Candidate/canonical master 1536×1024 SHA `a3b33e5d…`; independent Sol scores 44/49 and 42/49. Observed four readable entrances, three depth bands and target-level material density. Also observed baked dusk lighting/smoke/vignette and raised blocking garden. Door cells, footprints, pivots, collision, alpha masks and hidden plates remain unknown | HEAD `356f7e6…`, dirty / no URL | `art/production/vertical-slice/boards/old-town-exterior-master-v1.png` | not run | **ACCEPTED AS VISUAL MASTER ONLY**; direct slicing/runtime forbidden; new geometry and clean layers required |
| 008-v2-geometry-overlay-draft | Replace legacy18×12 coordinates with image-derived 24×16 pixel/cell contract and one visual audit overlay | Exact observed bboxes/doors, inferred footprints/portals/routes, visible blockers, boundary occluders and unknown exits are distinguishable before any clean-layer generation | First draft `geometry-v2.json` SHA `b261d6eb…`, overlay `65c1a315…`; independent Sol hard-gate **20/49 FAIL**. It found a disconnected hall route, tower collider/bed overlap, unencoded inn egress, unresolved false exits, undefined first derivation, clipping/road/footprint contradictions and no actor/camera/sweep proof | HEAD `356f7e6…`, dirty / no URL | superseded geometry overlay | not run | **FAIL**; no imagegen call; all 12 blockers accepted without score-shopping |
| 009-v2-geometry-routes-proof | Correct every iteration-008 blocker before retrying the independent gate | Machine-readable unlitComposite definition/metrics; exact pixel route centerlines and corridor polygons; explicit 20px tower-bed and 18px inn-cluster repairs; chosen visible closures; provisional footprint language; 24×14 sweep; spawn/camera/UI-safe proof | First retry scored **38/49 REJECT**: exact inn raw slot was only 30px, tower repair named the wrong edge, and PrefabSpec still implied a fixed three-cell road. Second retry scored **43/49 REJECT**: correct repair output would still violate the unconditional prop-preservation/drift rules, and renderer-owned smoke plume could remain baked. The contract and prompt now make the two exact repair deltas the only local override and require complete smoke/plume removal with reconstructed background. Current hashes are recorded in the manifest after the final follow-up; overlay PNG remains `0ed40680…`, actor/camera proof PNG `8af6bc45…`. The v2 road contract is variable-width with a continuous ≥48px pixel corridor. Minimum post-collider margins remain road47px, hall13.09px, inn9px, house24px, tower14px; all four portal lateral margins ≥24px. Alpha/hidden plates and final browser proof remain later gates | HEAD `356f7e6…`, dirty / no URL | `old-town-master-v2-geometry-overlay.png`, `old-town-master-v2-actor-camera-proof.png` | standalone QA sweep only; project tests not run | **PENDING FINAL EXCEPTION/SMOKE RE-EVAL**; imagegen remains blocked |
| 010-v2-geometry-gate-a | Re-evaluate only the corrected repair precedence and renderer-effect ownership without score-shopping | Exact repair subjects are excluded from general preservation; mask-local deltas are explicit; all smoke plume/glow/haze is removed and its background restored; the geometry/sweep/prompt hashes are frozen | Sol **47/49 PASS**, hard failure 0, reviewed geometry `655e4e86…`, sweep `d55637d7…` (`pass:true` and matching geometry hash), prompt `5d38df93…`; Terra independently reconciled all manifest hashes. Sol explicitly withheld adoption, alpha, slicing and runtime approval | HEAD `356f7e6…`, dirty / no URL | `geometry-v2.json`, `neutral-unlit-exterior-v1.md`, geometry/camera/sweep proof artifacts | project tests not run | **GATE A PASS FOR ONE CANDIDATE GENERATION ONLY** |
| 011-neutral-unlit-candidate-01 | Generate exactly one neutral-unlit registration candidate from the approved Gate A prompt and five role-labelled references | Exact 1536×1024; neutral material preview; no renderer-owned effects; only two declared topology repairs; no direct runtime/slicing use | RGB 1536×1024 SHA `7592271b…`; original retained at the recorded generated-images path; local copy hash matches. Same-coordinate contact SHA `65c298d2…`. Three independent Sol reviews: visual/end-user **40/49 HF1**, player perspective **41/49 HF1**, contract/registration **23/49 HF6**. All found baked chimney smoke; visual reviews also found chalky cobbles/flattened value hierarchy. Registration review observed whole-scene redraw: four doors no longer prove ≤2px drift, non-repair objects exceed 4px, inn cluster identity/delta and tower-only notch both fail | HEAD `356f7e6…`, dirty / no URL | `art/production/vertical-slice/boards/candidates/old-town-exterior-unlit-candidate-01.png`, `art/production/vertical-slice/qa/neutral-unlit-candidate-01-registration-contact.png` | image generation and standalone QA contact only; project tests not run | **REJECTED**; useful only as neutral-state failure evidence; adoption/alpha/slicing/runtime blocked |
| 012-neutral-unlit-correction-02-gate | Close every candidate-01 failure before spending another generation | Master is the only edit/registration target; overlay audit-only; target finish-only; three references total; mask-local geometry constraints coexist with global neutralization; smoke backfills are explicitly inferred; actor contrast deferred | Prompt SHA `26bab755…`; Terra verified reference hashes, dimensions and both repair coordinates; Sol contract prompt gate **46/49 HF0**, visual/player prompt gate **47/49 HF0**. The inn raw slot is explicitly `y=[496,544)`; no exact-hidden-background claim or byte-identical/material-state conflict remains | HEAD `356f7e6…`, dirty / no URL | `art/production/vertical-slice/prompts/neutral-unlit-exterior-correction-02.md` | prompt/contract review only; project tests not run | **PASS FOR ONE CANDIDATE-02 GENERATION ONLY**; adoption/alpha/slicing/runtime still blocked |
| 013-neutral-unlit-candidate-02 | Execute the independently approved three-reference surgical correction once | Preserve master registration while removing all smoke/effects, restoring material hierarchy and performing only the two exact topology repairs | RGB 1536×1024 SHA `f240d622…`; original retained at the manifest path; same-coordinate contact SHA `9b318080…`. Independent visual/player **44/49 HF0** and visual/end-user **45/49 HF0**: smoke/effects are gone, material separation/hall hierarchy/exploration recovered. Independent contract/registration **27/49 HF5**: whole-scene redraw persists; four-door/non-repair drift is unproven, inn identity/delta and tower-only mask fail, smoke backfill moved surrounding anchors | HEAD `356f7e6…`, dirty / no URL | `art/production/vertical-slice/boards/candidates/old-town-exterior-unlit-candidate-02.png`, `art/production/vertical-slice/qa/neutral-unlit-candidate-02-registration-contact.png` | image generation and standalone QA contact only; project tests not run | **VISUAL PASS / REGISTRATION REJECT**; frozen only as neutral-look/material reference; never geometry/runtime/slice/alpha authority |
| 014-deterministic-hybrid-decision | Resolve the split visual/registration verdict without laundering imagegen drift or discarding valid visual gains | Freeze lit master and geometry; freeze candidate02 only as neutral-look reference; stop broad imagegen; use coordinate-preserving per-material transforms and predeclared-mask donor pixels with deterministic exact compositing | Sol layer-pipeline review and separate adversarial anti-score-shopping review independently chose the same bounded path. Both reject candidate02 geometry rebase. Non-negotiable gates include 0px final layer anchors, door art/portal ≤2px, exact repair masks, inferred smoke plates, byte-identical pixels outside each donor mask, collider sweep, prefab-only deterministic reconstruction and runtime network exclusion of every board/reference | HEAD `356f7e6…`, dirty / no URL | manifest role freeze; pipeline contract pending material/semantic masks | reviews only; project tests not run | **PIPELINE APPROVED; REGISTERED NEUTRAL PRODUCTION STILL BLOCKED** |

## Cheap-passing traps to reject

- Four correct buildings with equally small silhouettes and no civic hierarchy.
- A three-tile road/plaza rendered as a dead gray carpet.
- Correct asset counts with cloned roofs, tile stamps, evenly spaced props, or vegetation confetti.
- SSIM passing because a full-scene composite is hidden behind nominal prefabs.
- Six walk frames that barely differ while the sprite slides.
- Collision that technically blocks but snags corners or extends invisibly past art.
- Door teleport without aligned door art, camera, sound, placement, and return feedback.
- Roof removal exposing a flat brown floor card with token furniture.
- Loading the dialogue sheet while drawing a generic HTML box over it.
- Unevenly stretched gold borders, tail pointing at nobody, or clipped/low-contrast text.
- Generic greeting unrelated to NPC role or repository evidence.
- Dense art that hides the player, doors, paths, or interaction cues.
- Silent transitions and softlocks despite internally correct state changes.
