// The only direct-runtime asset table. `site-runtime.mjs` deliberately imports
// this file rather than declaring URLs itself so the build preflight can prove
// that every new Fable5 asset is either part of the frozen legacy baseline or
// bound byte-for-byte to a frozen Asset Forge ledger.

const asset = (value) => Object.freeze(value);

export const FABLE5_LEGACY_RUNTIME_ASSET_BASELINE = Object.freeze({
  format: 'fable5-runtime-legacy-baseline-v1',
  assets: Object.freeze({
    player: asset({
      id: 'player-green-8walk-v4',
      url: '/fable5-v2/assets/characters/player-green-8walk-v4.png',
      width: 576,
      height: 512,
      bytes: 118169,
      sha256: 'f55e954d04304fd0c05c329b2477ef4980d50f23b172823aea7c912fe553f913',
      role: 'user-source-derived green character, 4 directions × idle plus 8 planted-foot 64×128 walk phases with common head/sole rhythm'
    }),
    bartender: asset({
      id: 'innkeeper-talk-4frame-v2',
      url: '/fable5-v2/assets/characters/innkeeper-talk-4frame-v2.png',
      width: 384,
      height: 64,
      bytes: 19270,
      sha256: '19fbe607d0e085d7dc969a682d3175c2eaf458cf63f0b1b88e9724a1c63ba63e',
      role: 'imagegen innkeeper bust, four same-style idle and speaking frames'
    }),
    innExteriorClosed: asset({
      id: 'target-town-inn-exterior-closed-v1',
      url: '/fable5-v2/assets/objects/target-town-inn/inn-exterior-closed-v1.png',
      width: 397,
      height: 402,
      bytes: 309447,
      sha256: '9e6ed907784281579e26308fbdede7784054d749bb43800e75ee9e7038b1438a',
      role: 'roof-closed exterior overlay shown only before entering the inn'
    }),
    innCounterClean: asset({
      id: 'inn-counter-clean-plate-v1',
      url: '/fable5-v2/assets/objects/target-town-inn/inn-counter-clean-plate-v1.png',
      width: 49,
      height: 57,
      bytes: 5344,
      sha256: 'f68b3a44ca25e741fd105e3b29c00273560f1f6de759cb6150e0e762350439f1',
      role: '49x57 background-only repair plate that removes the baked source bartender before the runtime NPC is drawn'
    }),
    entranceForeground: asset({
      id: 'target-town-inn-entrance-foreground-v1',
      url: '/fable5-v2/assets/objects/target-town-inn/entrance-foreground-v1.png',
      width: 151,
      height: 89,
      bytes: 16765,
      sha256: '8934e3a8b29b9b71c04e08ac33a054a25bdf245bd9752bdc3e77c2302855354a',
      role: 'exact source-pixel foreground occlusion object at the inn entrance'
    }),
    routeStreetlamp: asset({
      id: 'target-town-route-streetlamp-foreground-v1',
      url: '/fable5-v2/assets/objects/target-town-streetlamp/route-streetlamp-foreground-v1.png',
      width: 53,
      height: 162,
      bytes: 10590,
      sha256: '4b40d527e7d621198c2bef221d812d6cc7da84fc8ca8fb12eeea21e75b96187e',
      role: 'exact source-pixel depth-sorted foreground on the n=1 route'
    }),
    dialogueSheet: asset({
      id: 'ui-dialogue-frames',
      url: '/fable5-v2/assets/ui/ui_dialogue_frames.png',
      width: 1448,
      height: 1086,
      bytes: 2799709,
      sha256: '60a2255fe72e2e96c91f00caa93fa7f4906f57fc1f8f0332bdbe91648b9ba29d',
      role: 'retained fixed-crop dialogue source'
    }),
    speechBubble: asset({
      id: 'speech-bubble-transparent-v2',
      url: '/fable5-v2/assets/ui/speech-bubble-transparent-v2.png',
      width: 202,
      height: 124,
      bytes: 54670,
      sha256: '77293c248ec7b1d1c709585d83c558278f8ff6150c0341cca79847b7bc86208e',
      role: 'user-provided speech UI with only edge-connected matte made transparent'
    }),
    dialogueFrame: asset({
      id: 'dialogue-frame-transparent-v2',
      url: '/fable5-v2/assets/ui/dialogue-frame-transparent-v2.png',
      width: 370,
      height: 180,
      bytes: 150495,
      sha256: '43bc459d09e330fbbe14f40b6916089ad4e17634e4eb69f476f55e21240ecc7a',
      role: 'user-provided dialogue UI with only edge-connected matte made transparent'
    })
  })
});

// The project owner replaced the innkeeper's style authority.  This gate is
// deliberately separate from the historical bytes below: a mechanically
// valid frozen ledger never authorizes a character after its visual authority
// has been withdrawn.  A replacement must explicitly name this exact source,
// receive a new human approval, and be added as a new frozen-ledger binding.
// Until then the renderer must have no `bartender` production contract to
// fetch, decode, or draw.
export const FABLE5_INNKEEPER_RUNTIME_GATE = Object.freeze({
  format: 'fable5-innkeeper-runtime-gate-v1',
  key: 'bartender',
  state: 'blocked-pending-human-approved-replacement',
  runtimeInstallAllowed: false,
  authority: Object.freeze({
    sourcePath: 'art/references/user-provided/character_style_authority_20260722_v1.png',
    sha256: '446080b87192f13acd67f7410cfbfeb152830d93571edd5a9198406cef0b6932'
  }),
  approval: Object.freeze({
    state: 'not-approved',
    replacementAssetId: null
  }),
  availabilityReason: '宿帳係の新しい作画基準に合う承認済み素材を準備中です'
});

// Retain the withdrawn 4×10 binding and its frozen-ledger provenance for
// audit/history only.  It is intentionally not an approved runtime binding
// and must never be copied back into PRODUCTION_ASSETS as a fallback.
export const FABLE5_RETIRED_RUNTIME_BINDINGS = Object.freeze([
  Object.freeze({
    key: 'bartender',
    assetId: 'char_innkeeper',
    ledgerPath: 'tools/asset-forge/generated/fable5-runtime-ledgers/ca4cd4e4139d0b70cb9945d7b95572123e6507fceca7cf3086297ce5bb812f9c.json',
    ledgerSha256: 'ca4cd4e4139d0b70cb9945d7b95572123e6507fceca7cf3086297ce5bb812f9c',
    contract: asset({
      id: 'char_innkeeper-4ec9fe5a1e5ed1f8e8e1',
      url: '/fable5-v2/assets/characters/innkeeper-fable5-4x10-v1.png',
      width: 640,
      height: 512,
      bytes: 176262,
      sha256: '4ec9fe5a1e5ed1f8e8e130a9ca6edd02ce132cb66fb1c7132c1a85fb3abf4753',
      role: 'retired Fable5 innkeeper 4×10 sheet retained only as historical provenance'
    }),
    retirement: Object.freeze({
      state: 'withdrawn-after-style-authority-replacement',
      replacementAuthority: FABLE5_INNKEEPER_RUNTIME_GATE.authority
    })
  })
]);

// Empty by design.  Installing any replacement is a deliberate human action
// after the gate above moves to an approved replacement state; it cannot be
// inferred from historical provenance or a mechanically valid artifact.
export const FABLE5_APPROVED_RUNTIME_BINDINGS = Object.freeze([]);

const WITHDRAWN_RUNTIME_ASSET_KEYS = Object.freeze([
  FABLE5_INNKEEPER_RUNTIME_GATE.key
]);

export const PRODUCTION_ASSETS = Object.freeze({
  ...Object.fromEntries(
    Object.entries(FABLE5_LEGACY_RUNTIME_ASSET_BASELINE.assets)
      .filter(([key]) => !WITHDRAWN_RUNTIME_ASSET_KEYS.includes(key))
  ),
  ...Object.fromEntries(FABLE5_APPROVED_RUNTIME_BINDINGS.map(({ key, contract }) => [key, asset(contract)]))
});

// No "provisional" fallback exists for the withdrawn innkeeper key, on
// purpose. An earlier version of this module briefly reintroduced the
// withdrawn legacy bust (innkeeper-talk-4frame-v2.png) through a second,
// separately-tracked `state.assets.innkeeperBust` channel that bypassed
// PRODUCTION_ASSETS -- technically satisfying
// tools/qa/fable5-runtime-asset-preflight.mjs's "no 'bartender' key in
// PRODUCTION_ASSETS" rule while still drawing the withdrawn art as a live,
// speaking NPC and labelling it "暫定素材" (provisional material). The
// product owner ruled that a disguised-as-shipped misrepresentation
// regardless of the honest-sounding label, and required that no similar
// substitute ever be built again. There is now exactly one gate
// (FABLE5_INNKEEPER_RUNTIME_GATE, consumed the same way city-hall/residence
// consume their own asset-approval gates) and it has exactly one effect:
// the inn stays unavailable, the same as city-hall and residence, until a
// human approves a real replacement and it is added to
// FABLE5_APPROVED_RUNTIME_BINDINGS above.
