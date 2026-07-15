import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { FORGE_ROOT } from '../src/config.mjs';

const ROOT = path.join(FORGE_ROOT, 'review', 'prompts', 'wave1c-characters');

const CHARACTERS = Object.freeze([
  ['character.player', 'player', 'an alert teal-blue town inspector with a fitted inspection coat, compact ledger, practical brown satchel, dark boots, and understated cap; slim upright silhouette; ledger and satchel must remain visible from the appropriate directions'],
  ['character.innkeeper', 'innkeeper', 'a welcoming sturdy innkeeper with a muted cream apron over brown-and-blue-green clothes and one large old key at the belt; practical rolled sleeves; broad grounded silhouette; no tray'],
  ['character.tavern_master', 'tavern_master', 'a confident tavern master in a dark rust vest over a muted shirt, with one small wooden tankard held low; square vest silhouette and rolled sleeves; no apron and no serving tray'],
  ['character.town_clerk', 'town_clerk', 'a reserved town clerk in a long stone-blue formal coat holding a closed ledger to the chest; narrow orderly silhouette, tidy collar, no satchel and no apron'],
  ['character.workshop_artisan', 'workshop_artisan', 'a workshop artisan wearing a worn brown leather apron over a blue-gray work shirt, carrying one compact smith hammer low at the side; strong forearms and practical work silhouette; tool is secondary'],
  ['character.dojo_inspector', 'dojo_inspector', 'a disciplined dojo inspector in a dark blue-gray training coat with tied sash and one rolled inspection scroll; straight restrained stance, split lower coat, no weapon'],
  ['character.watchtower_guard', 'watchtower_guard', 'a watchtower guard in compact dull mail with a muted blue-green tabard and simple open helmet; guarded square shoulder silhouette; empty hands, no prominent weapon or shield'],
  ['character.dock_ferryman', 'dock_ferryman', 'a weathered dock ferryman in a long sea-dark blue coat and knit cap with one short coil of brown rope at the hip; slightly wind-braced silhouette; no boat, oar, or water'],
  ['character.warehouse_keeper', 'warehouse_keeper', 'a solid warehouse keeper in a heavy dark ochre apron with a distinct small iron keyring at the belt; thick practical gloves and blocky working silhouette; no crate'],
  ['character.gatekeeper', 'gatekeeper', 'a vigilant gatekeeper in a muted brown-green travel cloak holding one small warm lantern low; cloak creates a tapered silhouette and lantern is a restrained warm accent; no weapon'],
  ['character.mob.townsfolk_male', 'mob_townsfolk_male', 'an ordinary male town resident in a plain muted brown wool tunic, blue-gray hose, simple belt, and soft cap; modest unadorned silhouette; empty hands'],
  ['character.mob.townsfolk_female', 'mob_townsfolk_female', 'an ordinary female town resident in a muted blue-green shawl over a long warm-brown skirt; practical layered silhouette; empty hands, no apron and no luggage'],
  ['character.mob.elder', 'mob_elder', 'an elderly town resident with a clearly stooped posture, muted stone-brown layered clothes, gray hair or cap, and one short walking cane; visibly shorter than adults with a target native height of 26 to 30 pixels; cane remains secondary'],
  ['character.mob.child', 'mob_child', 'a clearly short town child in a simple muted blue-green tunic and warm-brown short cloak, small satchel strap, and practical boots; child proportions without oversized head; visibly shorter than adults with a target native height of 21 to 25 pixels'],
  ['character.mob.traveler', 'mob_traveler', 'a road traveler in a weathered muted brown cloak with a compact blue-gray backpack and bedroll; layered travel silhouette with pack visible from back and sides; empty hands'],
  ['character.mob.merchant', 'mob_merchant', 'a town merchant in a layered restrained rust-and-stone coat with a cross-body leather satchel and small folded cloth bundle; prosperous but practical silhouette; no coins or stall'],
  ['character.mob.artisan', 'mob_artisan', 'a general town artisan in a short muted ochre work apron over dark blue-gray clothes, with one small hand tool tucked at the belt; compact active silhouette distinct from the leather-apron workshop smith'],
  ['character.mob.tavern_guest', 'mob_tavern_guest', 'a relaxed tavern guest in casual muted brown and blue clothes holding one small mug low; loose friendly stance and soft cap; no vest, apron, table, or extra drink'],
  ['character.mob.inn_guest', 'mob_inn_guest', 'an inn guest in a neat stone-blue travel coat carrying one compact brown hand luggage case; upright visitor silhouette; luggage remains visible from appropriate directions; no backpack'],
  ['character.mob.dock_worker', 'mob_dock_worker', 'a dock worker in a faded blue cap, sleeveless brown work vest, rolled trousers, and one short rope loop at the belt; broad laboring silhouette; no ferryman coat and no cargo'],
  ['character.mob.delivery_person', 'mob_delivery_person', 'a brisk delivery person in a short muted blue-green coat carrying one square warm-brown parcel against the torso; forward-moving compact silhouette; no satchel, cart, or stacked parcels'],
  ['character.guildmaster', 'guildmaster', 'a dignified guildmaster in an ornate but restrained deep blue-green long coat with warm-brown trim and one small brass medallion; tall composed silhouette, empty hands, no crown, weapon, or exaggerated luxury', 'Scale correction after a rejected first source: the visible full-body character height must be identical within 3 percent across all 12 cells. Keep the head top and foot baseline at matching relative positions in every cell. Do not enlarge front/back walk poses, do not use perspective foreshortening, and do not let any pose approach the cell edges.']
]);

function promptFor(assetId, role, retryNote = '') {
  return `Use case: stylized-concept
Asset type: production game character spritesheet source for ${assetId}
Input images: Image 1 is the global CodeCity world style and map-scale reference; Image 2 is the approved character proportion, clothing treatment, pixel-cluster, palette, and 4x3 sheet reference. Use both images directly as references, but author a new role-specific character rather than copying or recoloring the inspector.

Primary request: create exactly one consistent late-medieval CodeCity character across a 4-column by 3-row spritesheet.
Subject: ${role}.
Style/medium: authentic compact pixel art matching both references, with dense deliberate hard-edged pixel clusters, small head, slim map-scale anatomy, restrained detail, and no anti-aliasing.
Color palette: muted blue-green, brown, stone-gray, dark charcoal, and at most one restrained warm accent; no bright saturated carpet-like color and no modern synthetic color.

Layout contract: exactly 4 equal columns by 3 equal rows on one perfectly uniform solid #ff00ff chroma-key background. Columns left-to-right are front, back, left, right. Rows top-to-bottom are idle, walk pose A, walk pose B. The same individual, face, body, clothing, accessories, colors, lighting, and scale must remain consistent in all 12 cells. Each cell contains exactly one full-body sprite centered within generous magenta separation. Feet share a consistent baseline. Walk A and B visibly alternate arms and legs. Front faces toward viewer, back clearly faces away, and side views are true left and right.${retryNote ? `\n\n${retryNote}` : ''}

Production contract: the source will be chroma-removed, cell-extracted, and nearest-neighbor downscaled into 24x40 frames without enlargement. Preserve role-defining silhouette and accessory at that size. Use crisp fully opaque subject pixels and a flat background. No semi-transparent edge, blur, painterly texture, smooth vector curve, soft shadow, cast shadow, floor plane, scenery, border, divider, panel, grid line, label, text, letter, number, logo, watermark, or signature.

Avoid: additional people or creatures; multiple characters in any cell; swapped outfits; missing cells; duplicate poses; cropped body; oversized head; chibi or anime proportions; modern clothing; weapon as focal point; environmental objects; #ff00ff anywhere in the subject.`;
}

await mkdir(ROOT, { recursive: true });
for (const [assetId, stem, role, retryNote] of CHARACTERS) {
  await writeFile(path.join(ROOT, `${stem}.txt`), `${promptFor(assetId, role, retryNote)}\n`);
}

console.log(JSON.stringify({ promptRoot: ROOT, count: CHARACTERS.length }, null, 2));
