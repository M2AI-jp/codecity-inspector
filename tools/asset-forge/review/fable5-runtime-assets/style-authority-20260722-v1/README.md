# Fable5 character-style authority v1 candidate evidence

This directory is a **review-only, hash-bound evidence packet** for four character-sheet candidates assembled on 2026-07-22. It is deliberately separate from the existing pending-evidence index and does not alter any inventory, contract, runtime asset, approval record, or Asset Forge state.

## Authority and scope

The sole current style-reference authority recorded for this packet is:

- Source ID: `user_character_style_authority_20260722_v1`
- Original repository path: `art/references/user-provided/character_style_authority_20260722_v1.png`
- SHA-256: `446080b87192f13acd67f7410cfbfeb152830d93571edd5a9198406cef0b6932`
- Packet copy: `source-authority/character_style_authority_20260722_v1.png`

`char_player` is reported as a deterministic segmentation of the source's actual 4x10 sprite regions, baseline alignment to the fixed pivot, crop, nearest-neighbour resize, and chroma-removal derivation of that exact user image. The innkeeper, town-clerk, and resident candidates are reported as built-in-imagegen outputs that used that exact user image as their sole style reference, followed by the same deterministic segmented transform.

The packet preserves the available source and intermediate bytes, their SHA-256 digests, and each candidate's custody/provenance record. It does not make the provenance reproducible beyond the reported transform descriptions, and does not substitute a generated candidate for the user-provided authority.

## Status and non-claims

All four candidates are `pending-human-review`.

- Human visual approval: not submitted; no decision is recorded.
- Promotion: forbidden (`false`).
- Runtime installation/use: forbidden (`false`).
- Formal Asset Forge intake: not executed and not claimed.
- Mechanical validation through Asset Forge: not executed and not claimed.

The included observations are limited to copied-byte hashes, PNG header/static checks, and static-check observations supplied in the packet handoff. Artistic fit, role identity, style continuity, human approval, future formal intake, and runtime behaviour remain unknown.

## Layout

- `index.json` — packet-wide authority, status, and hash index.
- `source-authority/` — immutable-copy evidence of the sole user-provided authority image.
- `candidates/` — immutable-copy evidence of each alpha candidate.
- `intermediates/` — available raw/chroma stages. The player receipt records the authority image itself as its raw transform input; no separately named player raw stage was present in the supplied input directory.
- `metadata/` and `receipts/` — per-candidate review metadata and provenance/derivation receipts.

Reviewers should validate hashes before opening a candidate and should record any human decision in a separately authorized review workflow. This packet alone cannot authorize promotion or runtime use.
