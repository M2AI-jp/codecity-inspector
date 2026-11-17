import { basename } from 'node:path';
import { scrub } from './authors.mjs';

// ---------- README ----------
function cleanMd(s) {
  return scrub(s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__|~~)/g, '')
    .replace(/^[>*+-]\s+/, ''));
}

export function parseReadme(root, rootFiles, readText) {
  const cands = rootFiles.filter((f) => /^readme(\.(md|markdown|txt|rst|adoc))?$/i.test(f.path));
  if (!cands.length) return null;
  cands.sort((a, b) => (/\.md$/i.test(b.path) ? 1 : 0) - (/\.md$/i.test(a.path) ? 1 : 0));
  const text = readText(cands[0].path);
  if (text == null) return null;
  const lines = text.replace(/\r/g, '').replace(/^---\n[\s\S]*?\n---\n/, '').split('\n');
  let title = null;
  const para = [];
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^(```|~~~)/.test(line)) { inCode = !inCode; if (para.length) break; continue; }
    if (inCode) continue;
    const atx = line.match(/^#{1,6}\s+(.*?)\s*#*$/);
    const setext = !atx && line && /^(=+|-+)$/.test((lines[i + 1] || '').trim());
    if (atx || setext) {
      if (para.length) break;
      if (!title) title = cleanMd(atx ? atx[1] : line);
      if (setext) i++;
      continue;
    }
    if (!line) { if (para.length) break; continue; }
    if (/^(<|!\[|\[!\[|\||-{3,}|={3,}|\*{3,})/.test(line)) { if (para.length) break; continue; }
    const c = cleanMd(line);
    if (!c) continue;
    if (!title) { title = c; continue; }
    para.push(c);
  }
  let excerpt = para.join(' ');
  const chars = Array.from(excerpt);
  if (chars.length > 300) excerpt = chars.slice(0, 299).join('') + '…';
  return { title: title || basename(root), excerpt };
}
