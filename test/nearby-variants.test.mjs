import { test } from 'node:test';
import assert from 'node:assert/strict';
import { separateNearbyVariants, footprintGap } from '../src/layout/variants.mjs';

test('住宅・廃屋・商店・工房で、再配置後に固定済みだった同じ版も隣同士に残さない', () => {
  for (const archetype of ['house_s','house_m','house_l','ruin','shop','workshop']) {
    const vs = [1,2].map(n=>({id:`${archetype}-${n}`,doorX:1,doorW:1,cover:[0,0,0,0]}));
    const placed = [0,5,10].map((x,i)=>({x,y:10,w:4,h:3,yb:12,spec:{id:`b${i}`,archetype,doorDx:1}}));
    const selected = new Map(placed.map(p=>[p,vs[0]]));
    separateNearbyVariants(placed,selected,{[archetype]:{variants:vs}});
    assert.deepEqual(placed.map(p=>selected.get(p).id),[vs[1].id,vs[0].id,vs[1].id]);
  }
});

test('外接矩形の距離を使い、階段を隠す版には差し替えない', () => {
  const a={x:0,y:5,w:4,h:3,yb:7,spec:{id:'a',archetype:'ruin',doorDx:1}};
  const b={...a,x:6,spec:{...a.spec,id:'b'}};
  assert.equal(footprintGap(a,b),2);
  assert.equal(footprintGap(a,{...b,y:10}),Math.sqrt(8));
  const vs=[{id:'ruin-1',doorX:1,cover:[0,0,0,0]},{id:'ruin-2',doorX:1,cover:[1,0,0,0]}];
  const selected=new Map([[a,vs[0]],[b,vs[0]]]);
  separateNearbyVariants([a,b],selected,{ruin:{variants:vs}},[{x:0,y:2,w:10}]);
  assert.equal(selected.get(a).id,'ruin-1');
  assert.equal(selected.get(b).id,'ruin-1');
});
