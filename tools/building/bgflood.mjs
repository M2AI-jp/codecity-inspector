// node bgflood.mjs in.png out.png [tol]  -> border-connected background (similar to corner colour, or transparent) becomes alpha 0
import { readPng, writePng } from './img.mjs';
const [,, inp, outp, tolS='28'] = process.argv; const tol = +tolS;
const im = readPng(inp), { w, h, data: d } = im;
const c0 = [d[0], d[1], d[2]];
const isBg = (i) => d[i+3] < 128 || Math.hypot(d[i]-c0[0], d[i+1]-c0[1], d[i+2]-c0[2]) <= tol || (d[i] > 180 && d[i+1] < 90 && d[i+2] > 180);
const seen = new Uint8Array(w*h); const st = [];
for (let x=0;x<w;x++){ st.push(x, (h-1)*w+x); } for (let y=0;y<h;y++){ st.push(y*w, y*w+w-1); }
let n=0; while (st.length) { const p = st.pop(); if (seen[p]) continue; seen[p]=1; if (!isBg(p*4)) continue; d[p*4+3]=0; n++; const x=p%w, y=(p/w)|0; if (x>0) st.push(p-1); if (x<w-1) st.push(p+1); if (y>0) st.push(p-w); if (y<h-1) st.push(p+w); }
// kill 1px halo: pixels adjacent to bg that are within 2*tol of the bg colour
for (let p=0;p<w*h;p++){ const i=p*4; if (!d[i+3]) continue; const x=p%w,y=(p/w)|0; const nb=[p-1,p+1,p-w,p+w].some(q=>q>=0&&q<w*h&&d[q*4+3]===0); if (nb && Math.hypot(d[i]-c0[0],d[i+1]-c0[1],d[i+2]-c0[2]) <= tol*2) d[i+3]=0; }
writePng(outp, im); console.log(JSON.stringify({ corner: c0, bgPx: n, of: w*h }));
