// 水上の歩ける板を独立させ、端に残る水の当たりを同じ順に追加する。
import { TILE } from '../../config.js';
import { MAT } from '../../ground.js';

const T = TILE;

// 板の下の水tileは、板で覆われた部分だけ歩ける。残りは当たり矩形にして、
// 足元が板の縁に沿って滑るようにする。板をtileに丸めず、絵のdeckのpxに合わせる。
export function applyDecks(world) {
  for (const d of world.decks) {
    const tx0 = Math.max(0, Math.floor(d.x / T)), ty0 = Math.max(0, Math.floor(d.y / T));
    const tx1 = Math.min(world.cols - 1, Math.floor((d.x + d.w - 0.001) / T)), ty1 = Math.min(world.rows - 1, Math.floor((d.y + d.h - 0.001) / T));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const k = ty * world.cols + tx;
      if (world.grid[k] !== MAT.WATER || world.deckTile[k]) continue;
      world.deckTile[k] = 1;
      world.tileSolid[k] = 0;
      const X0 = tx * T, Y0 = ty * T, X1 = X0 + T, Y1 = Y0 + T;
      const ix0 = Math.max(X0, d.x), ix1 = Math.min(X1, d.x + d.w), iy1 = Math.min(Y1, d.y + d.h);
      // 岸壁の笠石を見せるため板の上端が少し下がっていても、岸の地面につなぐ。
      const shore = ty > 0 && d.y - Y0 <= 8 && world.grid[k - world.cols] !== MAT.WATER && world.grid[k - world.cols] !== MAT.OUT;
      const iy0 = shore ? Y0 : Math.max(Y0, d.y);
      world.addRect(X0, Y0, T, iy0 - Y0, 'water');
      world.addRect(X0, iy1, T, Y1 - iy1, 'water');
      world.addRect(X0, iy0, ix0 - X0, iy1 - iy0, 'water');
      world.addRect(ix1, iy0, X1 - ix1, iy1 - iy0, 'water');
    }
  }
}
