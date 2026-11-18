
// overlay で札が消えた後にも、その下のマスから常設の歩行面へ出られるようにする。
export function prepareRemovableTiles(C) {
  const { cols, id, inC, walk } = C;
  // Native dojo signs may disappear during an overlay update. Their exposed
  // tiles must still join the persistent walking surface after every placement.
  const removable = new Set();
  const removableConnected = () => {
    const pending = new Set(removable);
    while (pending.size) {
      const first = pending.values().next().value, q = [first];
      pending.delete(first);
      let connected = false;
      for (let i = 0; i < q.length; i++) {
        const x = q[i] % cols, y = Math.floor(q[i] / cols);
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          if (!inC(nx, ny)) continue;
          const k = id(nx, ny);
          if (pending.delete(k)) q.push(k);
          if (!removable.has(k) && walk(nx, ny)) connected = true;
        }
      }
      if (!connected) return false;
    }
    return true;
  };
  Object.assign(C, { removable, removableConnected });
}
