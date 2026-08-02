# Verification evidence

Generated evidence is ignored by Git by default. A reviewed summary may be
promoted deliberately; raw output is not product source.

## Reviewed integration and distribution summary — 2026-08-02

Observed after the in-memory delivery refactor:

- `npm run check` passed module boundaries and 112/112 tests.
- A separate read-only security/distribution review ran the focused 10, 70,
  80, and 90 suites: 39/39 passed, with no remaining P0/P1 finding in that
  scope.
- The customer delivery path creates no distribution directory. Module 90
  admits only package-owned runtime bytes, verified approved-asset bytes, and
  the compiled SceneBundle; module 80 copies and SHA-256-checks the exact
  in-memory path map before binding literal `127.0.0.1`.
- `npm pack --dry-run` contained 38 files and excluded tests/studio sources. A
  fresh temporary install ran its packaged `codecity --text` executable across
  all packaged modules successfully.
- The ordinary non-text command still stopped with
  `ASSET_MANIFEST_REQUIRED`; no server was opened and no fixture art was used.
- The pixel-art production gate stopped with `PALETTE_READ_FAILED` and
  `CANDIDATES_EMPTY`. Empty art production is not a pass.

This verifies module composition and distribution controls, not the product
KGI. Human-approved art, a normal observed-transition producer, and the full
real-browser journey remain absent.

## Reviewed mechanical browser summary — 2026-08-02

Historical scope note: the viewport measurements below describe the browser
composition before the later integer-only CSS correction. They prove that
earlier composition only; they are not evidence for the current narrow-window
layout. The current code has static regression coverage that forbids
fractional Canvas CSS scaling, but current real-browser narrow-window behavior
remains unreviewed.

Scope: the real shipping browser/runtime composition with a generated
studio-only diagnostic sheet. This is not product KGI evidence and does not
stand in for human-approved art.

Observed:

- The inspected CodeCity repository produced 3 evidence-grounded investigations.
- The browser reached `遊べます。調査を終えたら Escape で終了できます。` with no visible startup error and no captured console warning/error.
- Canvas logical size was 384×216; default CSS size was 768×432.
- At a 320px viewport the document scroll width remained 320px and Canvas was
  300×169px.
- Escape showed `またおいで。` and Enter returned to the same running town.

Inferred for that reviewed build:

- The packaged HTML, CSS, browser bootstrap, serialized SceneBundle, runtime,
  and diagnostic PNG reached the first playable frame.
- The measured 320px case did not show horizontal layout overflow in that
  superseded build.

Unknown / not tested:

- Human-approved product art and visual quality.
- Current narrow-window layout after the integer-only scaling correction.
- Request acceptance, all three sites, report, observed visible change, process
  restart, and next-day revisit in one real-browser journey.
- Audio, localization, key remapping, large text, reduced motion, screenshot
  export, full accessibility matrix, and frame-time budget.

## Reviewed backend performance sample — 2026-08-02

Observed on this workstation: the read-only modules 10–40 processed an inert
repository containing `package.json` plus 1,000 source files in 581.1ms. It
discovered and inspected all 1,001 files without truncation, then produced 18
plots and 3 evidence-grounded investigations. The fixture source was never
executed. This is one sample, not a cross-machine performance certification;
asset compilation, browser decode, first interactive frame, and one-minute
frame timing remain unknown.
