# Fable5 character style-lock review packet

Status: **pending-human-review**. The former innkeeper approval is historical and withdrawn after
the user replaced the character style authority. The replacement player, innkeeper, town-clerk,
and resident candidates are all review-only. This is a hard gate, not blanket evidence of
acceptance.

The sole current user-provided rendering-language authority is
`user_character_style_authority_20260722_v1` in `art/contracts/user-provided-images.json`, binding
SHA-256 `446080b87192f13acd67f7410cfbfeb152830d93571edd5a9198406cef0b6932`. A different NPC
identity is allowed; a different drawing language is not.

## Candidate set to compare

| Asset | Current artifact | SHA-256 | Decision |
| --- | --- | --- | --- |
| Player | `review/fable5-runtime-assets/style-authority-20260722-v1/candidates/char_player-alpha.png` | `4a9acd472664dab515060a7fb8a988d70272cccd67b3e01c5d5503c4f9b37e5f` | deterministic derivative; pending human review and formal intake |
| Innkeeper | `review/fable5-runtime-assets/style-authority-20260722-v1/candidates/char_innkeeper-alpha.png` | `ee3e5185925cdb283b4461a04c5752d961d9a4864900024a88225edd6c3bc14b` | replacement candidate; pending human review and formal intake |
| Town clerk | `review/fable5-runtime-assets/style-authority-20260722-v1/candidates/char_town_clerk-alpha.png` | `86249a770b58118190449a711bba6cbca7750cd03fd09d26a992dc927dda409c` | replacement candidate; pending human review and formal intake |
| Resident | `review/fable5-runtime-assets/style-authority-20260722-v1/candidates/char_resident-alpha.png` | `93d0f647ebe4ad949100474c1ba54a83852c68f35e6cc962f94bd61a28e328fb` | replacement candidate; pending human review and formal intake |

The old player / innkeeper / town-clerk / resident candidates are retained only as intake history.
They are not current review items or runtime sources. In particular, the old innkeeper SHA
`4ec9fe5a1e5ed1f8e8e130a9ca6edd02ce132cb66fb1c7132c1a85fb3abf4753` is withdrawn and must not
be restored as a fallback.

## Required review for the remaining character candidates

View the reference and every replacement candidate at integer / nearest-neighbour zoom (at least
400%). Each character must receive an explicit **pass** from the project owner before it may be
promoted:

- Pixel-cluster density and silhouette outline weight match the reference.
- Head-to-body proportion, face construction, and limb thickness use the same visual grammar.
- Palette compression and 2–3-step shading vocabulary match; no soft or painterly rendering.
- Hair, costume, and held-prop details stay stable across all four directions and ten columns.
- The player, town clerk, resident, and replacement innkeeper read as one cast in the target-town
  lighting, without a “different artist” impression.

If a candidate fails, reject that exact SHA-256 candidate and generate a replacement. The two
pre-intake candidates must first complete a formal Asset Forge job/intake and mechanical check;
the review copy and its receipt do not claim that those steps have happened. Do not approve a
character merely because its sheet and pivot checks pass.

## Binding rule

An approval record for a `character` runtime asset must contain both `runtime-use` and
`character-style-lock` in `review.approval.scope`. `fable5-runtime-asset-ledger` now fails closed
if the latter is absent. Only the project owner may add that scope after completing this review.
