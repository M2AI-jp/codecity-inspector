# Fable5 character candidate intake

This pack commissions a pending char_innkeeper candidate; it contains no generated pixels.

1. A human resolves the two source IDs in `references.json` through the canonical project ledger.
2. A human authorizes and runs an external, supervised generation session using `prompt.md` and `output-contract.json`.
3. Keep every returned byte outside the runtime and in pending/quarantine until a Fable5-specific intake and human review have completed.

Do not use the legacy `make-job`, `make-job-v2`, `import`, or `import-v2` commands for this candidate. Their historical character definitions have a different sheet contract; the historical player definition also carries a rejected identity. This pre-generation pack intentionally has no automatic import or promotion command.

No API key, paid API fallback, automated approval, or runtime wiring is authorized by this pack.
