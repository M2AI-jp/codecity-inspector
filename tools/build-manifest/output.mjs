import fs from 'node:fs';
import path from 'node:path';

export function writeManifest(ROOT, OUT, manifest, warnings) {
  const { keepers, townsfolk, contractor } = manifest.characters;
  // keep short number arrays on one line so the file stays readable
  const text = JSON.stringify(manifest, null, 2).replace(/\[\s+([-\d.,\s]+?)\s+\]/g, (_, inner) => `[${inner.trim().split(/\s*,\s*/).join(', ')}]`);
  fs.writeFileSync(OUT, `${text}\n`);

  const nv = Object.values(manifest.archetypes).reduce((n, a) => n + a.variants.length, 0);
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${Object.keys(manifest.archetypes).length} archetypes (${nv} variants), ` +
    `${Object.keys(keepers).length} keepers, ${townsfolk.length} townsfolk${contractor ? ', contractor' : ''}, ${Object.keys(manifest.props).length} props, ` +
    `${Object.keys(manifest.ground).length} ground textures, ${Object.keys(manifest.creatures).length} creatures`);
  for (const w of warnings) console.warn(`  ! ${w}`);
}
