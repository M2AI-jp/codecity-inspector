# Fable5 terrain autotile source

Create one 5x5 logical tile sheet using 64x64 cells. It contains three non-identical base variants
and the complete declared blob-16 transition set. Edge and corner shapes must meet exactly at cell
boundaries and use the same material scale, projection, palette, and lighting. The transition tiles
are transparent outside the material edge so they can overlay a neighboring terrain family.

Variation must come from pixel-cluster distribution and small material details, not from changing
walkability or adding a focal prop. A 3x3 repeat must not reveal an obvious stamp within two
seconds. No directional lighting gradient across a whole tile, perspective drift, embedded
characters, large stones, signs, flowers, or objects that belong to overlay families.
