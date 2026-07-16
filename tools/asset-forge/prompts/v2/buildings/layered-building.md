# Fable5 layered building source

Create one functional town building as the definition's aligned `base` and `roof` pair. Both
panels show exactly the same footprint, projection, anchor, wall positions, entrance, and scale.

- `base`: ground-contact foundation, cutaway interior floor, interior wall trim, fixed furniture,
  doorway, and the declared walkable interior. It must remain coherent when shown alone.
- `roof`: roof planes plus the front facade/occlusion band that normally closes the building. It
  must align pixel-for-pixel over the base and may contain only the removable upper shell.

The entrance is visually obvious without text. The building's purpose must be inferable from its
silhouette and declared functional fixtures, not from a sign label. Preserve a one-pixel foundation
contact band and the declared footprint. Do not add surrounding roads, trees, neighboring houses,
people, loose scenery, or an isometric presentation board. Keep every window at its declared
anchor so `effect.window_glow` can be overlaid deterministically.
