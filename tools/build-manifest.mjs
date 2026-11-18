#!/usr/bin/env node
// Builds art/game/manifest.json from the images and their sidecar .json files (CONTRACTS.md
// 「画像ごとのsidecar」). Never edit manifest.json by hand; run `node tools/build-manifest.mjs`.
//
//   art/game/buildings/<archetype>-<n>.json (+ the pngs it names)  -> archetypes[archetype].variants[]
//                                                                      (+ wall: [left, right] inset px, measured)
//   art/game/residents/keeper-<kind>.png                            -> characters.keepers[kind]
//   art/game/residents/townsfolk-<n>.png                            -> characters.townsfolk[] (by n)
//   art/game/residents/contractor.png                               -> characters.contractor (外部工務店の代理人)
//   art/game/props/<type>.png (+ <type>.json)                       -> props[type] (solid, light, flicker, layer, deck,
//                                                                      solids, lights, opening)
//   art/game/landmarks/<type>.png (+ <type>.json)                   -> props[type] (also size and opaque bounds)
//   art/game/ground/<name>.png                                      -> ground[name]
//   art/game/creatures/<name>.png (+ <name>.json)                   -> creatures[name]
//
// Node 22+, standard library only.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSource } from './build-manifest/source.mjs';
import { buildings } from './build-manifest/buildings.mjs';
import { people, PLAYER } from './build-manifest/people.mjs';
import { props } from './build-manifest/props.mjs';
import { ground } from './build-manifest/ground.mjs';
import { creatures } from './build-manifest/creatures.mjs';
import { writeManifest } from './build-manifest/output.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAME = path.join(ROOT, 'art', 'game');
const OUT = path.join(GAME, 'manifest.json');
const source = createSource(GAME);

const { keepers, townsfolk, contractor } = people(source);
const manifest = {
  _generated: 'tools/build-manifest.mjs が art/game/ の画像と sidecar から作ったファイル。手で編集しない。',
  tile: 16,
  characters: { player: PLAYER, keepers, townsfolk, ...(contractor ? { contractor } : {}) },
  archetypes: buildings(source),
  props: { ...props(source), ...props(source, 'landmarks') },
  ground: ground(source),
  creatures: creatures(source),
};
writeManifest(ROOT, OUT, manifest, source.warnings);
