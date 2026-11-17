import { SKIP_DIR } from './scan.mjs';
import { sortPaths } from './common.mjs';
import { DB } from './sdk-names.mjs';

export function detectWarehouse({ files, depHits, sqliteSrc }) {
  // ---------- 倉庫: DB・storage ----------
  const db = depHits(DB);
  const dirFiles = files.filter((f) => !SKIP_DIR.test(f.path) && /(^|\/)(prisma|migrations|migrate|alembic)\//.test(f.path)).map((f) => f.path);
  const sql = files.filter((f) => f.ext === 'sql' && !SKIP_DIR.test(f.path)).map((f) => f.path);
  const sqlite = files.filter((f) => /^(sqlite|sqlite3|db)$/.test(f.ext) && !SKIP_DIR.test(f.path)).map((f) => f.path);
  const cfg = files.filter((f) => !SKIP_DIR.test(f.path) && /^(schema\.prisma|drizzle\.config\.[cm]?[jt]s|knexfile\.[cm]?[jt]s|ormconfig\.(json|[jt]s)|database\.yml|redis\.conf)$/i.test(f.path.slice(f.path.lastIndexOf('/') + 1))).map((f) => f.path);
  const kinds = [...db.keys()];
  if ((sqlite.length || sqliteSrc.length) && !kinds.includes('SQLite')) kinds.push('SQLite');
  if (dirFiles.some((p) => /(^|\/)prisma\//.test(p)) && !kinds.includes('Prisma')) kinds.push('Prisma');
  const migrations = dirFiles.filter((p) => /(^|\/)(migrations|migrate|alembic)\//.test(p));
  if (!(kinds.length || sql.length || migrations.length || cfg.length)) return null;
  const parts = [];
  if (kinds.length) parts.push(`データをしまう仕組み: ${kinds.slice(0, 4).join('、')}`);
  if (sql.length) parts.push(`SQL のファイル ${sql.length} 件`);
  if (migrations.length) parts.push(`作りかえの手順（migrations）${migrations.length} 件`);
  if (!parts.length) parts.push(`DB の設定「${cfg[0]}」がある`);
  return {
    reason: parts.join('、'),
    evidence: [...cfg, ...sortPaths(dirFiles), ...sql, ...sqlite, ...sqliteSrc, ...[...db.values()].flatMap((s) => [...s])],
    facts: {
      kinds, sqlFiles: sql.length, migrations: migrations.length, configs: cfg.slice(0, 4), dataFiles: sqlite.slice(0, 4), sqliteCode: sqliteSrc.slice(0, 3),
    },
  };
}
