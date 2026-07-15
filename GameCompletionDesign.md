# CodeCity Inspector — completion-candidate record

Date: 2026-07-15
Product and integration lead: `/root`
World implementation worker: Terra (`/root/terra`)

## Decision boundary

This record distinguishes three states:

1. **Test success** — automated contracts and syntax checks pass.
2. **Completion candidate** — the Lead has completed a real-browser visual and
   interaction review with no known blocking defect.
3. **Complete** — the user has played the opened build and explicitly approved
   it.

The implementation must not call itself complete before state 3.

## Shipped play loop

The first screen is a native 2048 x 1536 city composed from approved assets,
not an image-board background. The player starts visibly in the old-town plaza.
The on-screen journey sends them across a stone bridge and cliff stairs to the
snow dojo, into an inspection site, through observed/inferred/unknown evidence,
back to the city, and onward to a woodland home. Afterwards the full city and
all seventeen sites remain available for free exploration.

World movement is a single connected graph. Keyboard input and clicks use the
same collision path, so the visible road, water, bridge, stairs, cliff, and
building entrances agree with reachability. District changes never teleport.

## Repository-state behavior

- Fourteen semantic facilities map repository state to buildings, entrance
  status, residents, and inspection sites.
- Present facilities show their observed foundation. Unconfirmed facilities
  remain visitable and explain their unknown state without claiming failure.
- Evidence arrays from `/api/town` are rendered separately and are never merged
  into a confidence score.
- The inspected repository is read only. Its code, tests, hooks, package
  scripts, and package manager are never executed.
- Identical repository input produces identical model data, world state,
  transforms, routes, and site recipes after reload.

## Asset acceptance

The runtime accepts exactly the 78 entries in
`public/assets/forge/manifest.json`:

| Category | Count | Play role |
| --- | ---: | --- |
| Buildings | 17 | World destinations and seventeen inspection sites |
| Characters | 22 | Player and role-specific residents |
| Fields | 19 | Roads, water, bridges, stairs, cliffs, snow, docks, forest |
| Objects | 18 | Navigation cues, street life, work, warnings, and evidence |
| Effects | 2 | Water movement and active construction/ruin state |

Every ID is reached by normal play in the connected world or a reachable site.
Repeated semantic placements may add density, but each distinct asset retains a
meaningful location. Loading, static reference, or a display gallery does not
count as use. Native master sizes and sprite-frame contracts are validated.

## Automated gates

- strict 78-ID manifest and hash/dimension validation;
- exact world/site runtime usage coverage;
- connected four-district path graph and reachable entrances;
- bridge spans water and stairs connect the cliff elevation;
- first journey includes walking, bridge, stairs, site entry, evidence, return,
  and second destination;
- deterministic movement, camera transforms, terrain variation, and site data;
- browser controls wired to the live `/api/town` evidence source;
- loopback-only server, hostile Host rejection, traversal rejection, and
  read-only HTTP methods;
- source scanner bounds and observed/inferred/unknown separation.

## Manual visual gates

- Within five seconds, the city, player, path, next goal, and controls are
  legible with no black gap, placeholder, asset sheet, or developer overlay.
- Old town, snow quarter, harbor, and woodland read as connected regions with
  consistent scale, color, grounding, depth, and occlusion.
- The player and residents separate immediately from the background.
- The initial dojo journey and the second home journey can be completed using
  only information on the game screen.
- Facility sites fill the play area, keep the player visible, and expose the
  three evidence classes without hiding the return path.
- Normal viewport sizes show a playable canvas; no missing images, fallback
  drawing, stuck movement state, unreachable exit, or console error appears.

## Handoff

The local loopback build is left running on its opened first screen for user
review. Test success and the Lead's browser review may be reported, together
with any remaining unknowns. Only the user's explicit hands-on approval changes
this record from completion candidate to complete.
