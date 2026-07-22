# Fable5 structure source

Create the declared outdoor structure at native map scale with an unambiguous footprint,
walkable/collision meaning, contact shadow, and connection edges. Bridges, stairs, fences, walls,
piers, and broken endpoints must align to the 64x64 tile grid exactly. Trees separate trunk and
canopy layers; the canopy must support runtime translucency without moving the trunk. Variants
must differ in silhouette and surface wear while remaining one family.

Do not add terrain backgrounds, unrelated props, people, text, UI marks, or scenery outside the
declared bounds. Connection pieces may not terminate visually before their contract edge.
