# Fable5 prefab character drafts (player, innkeeper)

Draft-only. Nothing here has been generated, imported, or approved. This directory and its
companions exist to unblock the next phase (real generation + human review) without re-deriving
identity/background facts each time.

## What exists

| File | What it is |
|---|---|
| `character.player.contract-draft.json` | Target Fable5PrefabSpec section 7 contract for `char_player` (640x512 sheet, 64x128 frames, footPivot 32,120) |
| `character.innkeeper.contract-draft.json` | Same, newly authored for `char_innkeeper` (no prior entry existed) |
| `../../prompts/fable5-prefab/00_common_fable5_character_sheet_style.md` | Shared sheet/lighting spec both prompts include |
| `../../prompts/fable5-prefab/character.player.prompt-draft.md` | Player generation prompt, identity anchored on the green reference sheet |
| `../../prompts/fable5-prefab/character.innkeeper.prompt-draft.md` | Innkeeper generation prompt, distinct person / shared rendering language |
| `../../review/provenance/fable5-character-candidate-provenance.template.json` | Blank origin/custody/approval/protection + derivation fill-in form |
| `../../review/provenance/character.player.candidate-provenance-draft.json` | Same form, pre-filled with what's known for the player |
| `../../review/provenance/character.innkeeper.candidate-provenance-draft.json` | Same form, pre-filled with what's known for the innkeeper |

## Why a fresh draft instead of reusing this tool's existing character.player entry

`data/v2/art-direction/characters.json` and `data/asset-definitions/characters.json` both still
define `character.player` around the navy-coat/scarf/satchel/badge identity and point at
`character_visual_master.png`. `docs/user-provided-image-policy.md` (2026-07-19) records that
identity as a Codex-generated image the project owner has since rejected for player identity and
runtime use. Running this tool's existing definitions as-is would regenerate the wrong person.
These drafts intentionally do not touch those existing definition files (out of scope for this
pass) and instead anchor identity on the current user-provided character-style reference sheet
under `art/references/user-provided/` (ledger `sourceId`: `user_character_style_reference` in
`art/contracts/user-provided-images.json`). Its exact basename and SHA-256 are deliberately not
spelled out in this directory: `../../test/reference-integrity.test.mjs`
(`RETIRED_CHARACTER_REFERENCE`) asserts that specific basename/hash must not appear anywhere
inside `tools/asset-forge`, so every draft here resolves it from the external ledger instead.

The frame grid also differs from every existing definition in this tool: legacy `data/
asset-definitions/characters.json` uses 96x120/4x3/24x40px frames; the existing v2 `character.
player` prose describes 48x96 frames with an idle2+walk4+talk2+work2 split. Neither matches
`Fable5PrefabSpec.md` section 6 (64x128 frames, 640x512 sheet, idle2+walk6+interact2,
footPivot fixed at 32,120), which is the contract these drafts target.

## Next steps (not done here)

1. Author real `character.player` (rewrite) and `character.innkeeper` (new) entries in
   `data/v2/art-direction/characters.json` using these drafts' identity/contract facts, or adapt
   `make-job`/`make-job-v2` to consume the contract JSON directly.
2. Run `make-job` / `make-job-v2` to produce a job-pack (no image; see each prompt draft's
   "Route to a real candidate" section).
3. Run an external, human-supervised generation session against that job-pack. This tool has no
   built-in path to do this step — see the root-level report for why.
4. `import` / `import-v2` the result, `process`, then interactive `promote` — human-only, per
   `AGENTS.md`.
5. Fill in the matching `review/provenance/*.candidate-provenance-draft.json` record as each fact
   in steps 2–4 becomes real, instead of writing a new record from scratch.
