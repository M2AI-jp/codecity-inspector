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

// Empty by design until a project owner has approved a Forge candidate. Every
// future binding must name the frozen ledger and exact approved assetId; the
// preflight rejects any production asset that is neither below nor in the
// immutable legacy baseline above.
export const FABLE5_APPROVED_RUNTIME_BINDINGS = Object.freeze([]);

export const PRODUCTION_ASSETS = Object.freeze({
  ...FABLE5_LEGACY_RUNTIME_ASSET_BASELINE.assets,
  ...Object.fromEntries(FABLE5_APPROVED_RUNTIME_BINDINGS.map(({ key, contract }) => [key, asset(contract)]))
});
