# Fable5 animated character source

Create one map-scale character sprite sheet with exactly 40 isolated cells: four direction rows
(`front`, `back`, `left`, `right`) and ten action columns in this order:
`idle_1`, `idle_2`, `walk_1`, `walk_2`, `walk_3`, `walk_4`, `talk_1`, `talk_2`, `work_1`, `work_2`.

Every cell uses a 48x96 logical frame with a common foot baseline. The visible body is about
40x80 pixels, leaving transparent safety padding. Preserve identity, costume, palette, apparent
height, head size, handedness, and carried equipment across all cells. Use a slim adult town-map
silhouette unless the definition explicitly declares child or elder proportions. The role reads
through clothing and work pose rather than facial detail.

No chibi proportions, oversized head, large anime eyes, round plush body, side-view platformer
pose, modern clothing, labels, separators, frame numbers, guide marks, or decorative sheet border.
Each cell must be independently extractable without overlap.
