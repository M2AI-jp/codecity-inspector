# Asset Forge agent rules

This subproject manages generated game assets.

## Critical anti-reward-fraud rule

Every external contractor claim is `pending-inspection` until independently checked.
Never claim an asset is approved. Never move generated files to approved automatically.
Only a human may approve assets.

Generated candidates belong in `generated/<category>/pending/`.
Approved assets may enter `generated/<category>/approved/` only through an explicit human action.
Codex may implement the promote command, but Codex must not run it to approve project assets.

Reports must separate:

- observed: directly inspected files, hashes, schemas, command output, and exit status
- inferred: conclusions derived from observed facts
- unknown: visual quality, runtime behavior not exercised, provenance not established, and human decisions

Untested does not mean broken.

## No API billing

Do not add OpenAI API usage, the `openai` SDK, or an `OPENAI_API_KEY` requirement.
Do not add a paid API fallback. Default operation must be mock or dry-run.
Supported provider names are `mock`, `job-pack`, `manual-import`, and optionally `codex-subscription`.

## Subscription image generation

A local subscription-based image command may run only when all of these are true:

- the command is explicitly configured
- the project owner requested it
- the CLI uses `--provider codex-subscription --yes-subscription`
- execution does not use an API key or paid API fallback
- every result is saved as pending

If availability, billing, terms, or automation safety is unknown, keep the provider unavailable.

## References and approval

Use only human-provided approved references by default.
Do not download references from the internet.
Do not add third-party commercial-game artwork.
Record a SHA-256 hash and a license note for each reference.
Never overwrite an approved image or its approval metadata.

## Reporting

Do not say “動作確認済み” unless the report includes the exact command, commit SHA,
environment, stdout/stderr summary, operation mode, verified scope, and unverified scope.
Distinguish mock, dry-run, job-pack, manual-import, and subscription-run.

Workers edit only files assigned in their `owns`, and never commit or push.
Distribution and security changes require a separate read-only reviewer.
