# Fable5 three-building interior kit — common generation constraints

Generate exactly one native-scale RGBA PNG under the supplied output contract. The image is an
interior **ground-layer kit**: it must fill the prescribed footprint with floor, north-wall trim,
and fixed furnishings, while player/NPC sprites, dialogue UI, labels, text, cursor affordances,
and renderer-owned light/halo/fog remain separate runtime layers.

Use the current user-direct target town only for pixel density, material hierarchy, dusk-adjacent
value discipline, and old-town construction language. Preserve the output canvas, pivot, and
world rectangle exactly. The building reference establishes that building's exterior material
language; it is not a license to crop or reproduce a source composition.

The entry threshold and declared NPC interaction floor must be visually and mechanically usable:
do not cover them with a black void, a character, a dialogue box, a table, or an opaque foreground
object. Do not include magenta/chroma-key background pixels, blur, fractional scaling, text,
watermarks, UI, or baked glow. The result is a candidate only; it cannot be installed, exported,
or treated as approved without an explicit human review.

# Inn interior kit

Create the 192×192 `bld_m_inn.interior` ground-layer kit. It is a warm, inhabited old-town inn:
continuous timber/stone floor, a north-wall trim band, fixed service counter and a small hearth or
shelf detail. The south-center threshold remains visibly open for entry/exit; leave a believable
walkable route from it to the innkeeper interaction floor. The output contains no innkeeper or
player sprite, no dialogue, and no text.
