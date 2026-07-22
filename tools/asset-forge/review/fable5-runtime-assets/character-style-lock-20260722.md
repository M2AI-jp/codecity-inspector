# Fable5 character style-lock review packet

Status: **pending human decision**. This is a hard gate, not evidence of acceptance.

The user-provided rendering-language authority is
`user_character_style_reference` in `art/contracts/user-provided-images.json`, binding SHA-256
`ca802aa30c7699509ad00a4c3a01456b64740fe76f8bd40833e2c309998922f7`. A different character
identity is allowed; a different drawing language is not.

## Candidate set to compare

| Asset | Pending candidate | SHA-256 | Mechanical sheet intake |
| --- | --- | --- | --- |
| Player | `generated/characters/pending/fable5_char_player_d947cf60b90d892a6104.png` | `d947cf60b90d892a6104a58950bfc48d6d310dc9e17d2a22a2df89c1c31ef266` | passed before this packet |
| Innkeeper | `generated/characters/pending/fable5_char_innkeeper_4ec9fe5a1e5ed1f8e8e1.png` | `4ec9fe5a1e5ed1f8e8e130a9ca6edd02ce132cb66fb1c7132c1a85fb3abf4753` | passed: 640×512, 4×10, transparent corners, all foot pivots, six distinct walk frames, east not mirrored |

The earlier innkeeper candidate remains a non-terminal pending artifact. It is not selected by
either current inventory and must not be implicitly preferred or promoted.

## Required paired review

View the reference, player, and innkeeper at integer / nearest-neighbour zoom (at least 400%).
All items must receive an explicit **pass** from the project owner:

- Pixel-cluster density and silhouette outline weight match the reference.
- Head-to-body proportion, face construction, and limb thickness use the same visual grammar.
- Palette compression and 2–3-step shading vocabulary match; no soft or painterly rendering.
- Hair, apron, and held-prop details stay stable across all four directions and ten columns.
- The two candidates read as one cast in the target-town lighting, without a “different artist”
  impression.

If any item fails, reject that exact SHA-256 candidate and generate a replacement. Do not approve
the character merely because its sheet and pivot checks pass.

## Binding rule

An approval record for a `character` runtime asset must contain both `runtime-use` and
`character-style-lock` in `review.approval.scope`. `fable5-runtime-asset-ledger` now fails closed
if the latter is absent. Only the project owner may add that scope after completing this review.
