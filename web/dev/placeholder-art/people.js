// Keep resident drawing and palette choices together so all debug people share the same frames.
import { mk } from './shared.js';

function residentSheet(tunic, hair) {
  const c = mk(192, 256), g = c.getContext('2d');
  const skin = '#e0b48c';
  const dirs = ['up', 'down', 'right', 'left'];
  dirs.forEach((dir, di) => {
    for (let col = 0; col < 6; col++) {
      const ox = col * 32, oy = di * 64;
      const phase = col >= 2 ? col - 2 : -1;
      const bob = phase === 1 || phase === 3 ? -1 : 0;
      const legA = phase === 0 ? 2 : phase === 2 ? -2 : 0;
      const y0 = oy + 6 + bob;
      // legs
      g.fillStyle = '#2c2a34';
      if (dir === 'up' || dir === 'down') { g.fillRect(ox + 12, y0 + 18, 3, 7 + (legA > 0 ? 0 : -1)); g.fillRect(ox + 17, y0 + 18, 3, 7 + (legA < 0 ? 0 : -1)); }
      else { g.fillRect(ox + 14 + legA, y0 + 18, 3, 7); g.fillRect(ox + 15 - legA, y0 + 18, 3, 7); }
      // body
      g.fillStyle = tunic; g.fillRect(ox + 10, y0 + 9, 12, 11);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(ox + 10, y0 + 17, 12, 3);
      // head
      g.fillStyle = skin; g.fillRect(ox + 11, y0 + 1, 10, 9);
      g.fillStyle = hair;
      if (dir === 'up') g.fillRect(ox + 11, y0, 10, 9);
      else if (dir === 'down') { g.fillRect(ox + 11, y0, 10, 3); g.fillStyle = '#1d1a1a'; g.fillRect(ox + 13, y0 + 5, 1, 2); g.fillRect(ox + 18, y0 + 5, 1, 2); }
      else if (dir === 'right') { g.fillRect(ox + 11, y0, 10, 3); g.fillRect(ox + 11, y0, 4, 8); g.fillStyle = '#1d1a1a'; g.fillRect(ox + 18, y0 + 5, 1, 2); }
      else { g.fillRect(ox + 11, y0, 10, 3); g.fillRect(ox + 17, y0, 4, 8); g.fillStyle = '#1d1a1a'; g.fillRect(ox + 13, y0 + 5, 1, 2); }
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(ox + 11, oy + 31, 10, 1);
    }
  });
  return c.toDataURL();
}

export function placeholderPeople() {
  const anims = {
    idle: { up: [0], down: [12], right: [24], left: [36] },
    walk: { up: [2, 3, 4, 5], down: [14, 15, 16, 17], right: [26, 27, 28, 29], left: [38, 39, 40, 41] },
  };
  const residents = [['#7a4a3a', '#2a1a14'], ['#3a5a7a', '#c0a060'], ['#4a6a3a', '#5a3a2a']]
    .map(([t, h]) => ({ src: residentSheet(t, h), frame: [32, 32], pivot: [16, 31], anims }));
  const keepers = {
    workshop: { src: residentSheet('#6a4a30', '#8a2a20'), frame: [32, 32], pivot: [16, 31], anims },
    shop: { src: residentSheet('#7a2a3a', '#7a5a3a'), frame: [32, 32], pivot: [16, 31], anims },
    house: { src: residentSheet('#a06a4a', '#4a2a1a'), frame: [32, 32], pivot: [16, 31], anims },
    ruin: { src: residentSheet('#6a6058', '#c8c8c8'), frame: [32, 32], pivot: [16, 31], anims },
  };
  return { keepers, townsfolk: residents };
}
