import { execFileSync } from 'node:child_process';
export function readPng(path) {
  const probe = execFileSync('ffprobe', ['-v','error','-show_entries','stream=width,height','-of','csv=p=0', path]).toString().trim().split(',').map(Number);
  const [w, h] = probe;
  const buf = execFileSync('ffmpeg', ['-loglevel','error','-i', path, '-f','rawvideo','-pix_fmt','rgba','-'], { maxBuffer: 1<<30 });
  return { w, h, data: new Uint8Array(buf) };
}
export function writePng(path, img) {
  execFileSync('ffmpeg', ['-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgba','-s',`${img.w}x${img.h}`,'-i','-', path], { input: Buffer.from(img.data) });
}
export function blank(w, h, rgba=[0,0,0,0]) { const d = new Uint8Array(w*h*4); for (let i=0;i<w*h;i++) d.set(rgba, i*4); return { w, h, data: d }; }
export function scale(img, k) { const o = blank(img.w*k, img.h*k); for (let y=0;y<o.h;y++) for (let x=0;x<o.w;x++){ const si=((y/k|0)*img.w+(x/k|0))*4; o.data.set(img.data.subarray(si,si+4),(y*o.w+x)*4);} return o; }
