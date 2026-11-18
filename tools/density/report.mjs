export function printMeasurement(label, r) {
  console.log(`${label}: ${r.name} size=${r.size} 建物=${r.buildings} 占有=${r.ratio} 間0/1/2/3+=${r.gaps} 裏0/1/2/3+=${r.back} 広場辺=${r.plazaEdge} lawn最大=${r.lawnMax}`);
}
