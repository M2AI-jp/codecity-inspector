// 決まった時間・裏で動く仕事を、猫の根拠として見つける。
import { MAX_CATS, SKIP_DIR } from './constants.mjs';
import { readText, depth, base } from './files.mjs';

const WORK_DIR = /^(workers?|jobs?|queues?|cron|crons|cronjobs?|schedulers?|background)$/i;
const WORK_FILE = /(\.|_|-)(worker|job|cron)\.[a-z]+$|^(workers?|jobs?|queues?|cron|crontab|scheduler)\.[a-z]+$|^crontab$/i;
const WORK_LIBS = new Set(['node-cron', 'cron', 'node-schedule', 'bull', 'bullmq', 'bee-queue', 'agenda', 'bree', 'toad-scheduler', 'croner',
  'sidekiq', 'resque', 'delayed_job', 'good_job', 'whenever', 'sidekiq-cron', 'que', 'solid_queue',
  'celery', 'rq', 'apscheduler', 'huey', 'dramatiq', 'schedule', 'django-q',
  'github.com/robfig/cron', 'github.com/robfig/cron/v3', 'github.com/hibiken/asynq', 'github.com/go-co-op/gocron',
  'tokio-cron-scheduler', 'job_scheduler', 'cron']);

function findWork(root, files, deps) {
  const out = [];
  // 1) GitHub Actions workflows that run on a schedule
  for (const f of files.filter((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p)).slice(0, 80)) {
    const text = readText(root, f);
    if (!text || !/^\s*schedule\s*:/m.test(text)) continue;
    const cron = /cron\s*:\s*["']?([^"'\n#]+?)["']?\s*(#.*)?$/m.exec(text);
    out.push({ name: base(f), reason: `${f} が決まった時間に動く（schedule${cron ? `・cron: ${cron[1].trim()}` : ''}）`, evidence: f, meaning: 'cron' });
  }
  // 2) worker / job / queue directories and files
  const dirs = new Map();
  const single = [];
  for (const f of files) {
    if (SKIP_DIR.test(f) || /(^|\/)(tests?|spec|__tests__|e2e|docs?|examples?)\//.test(f)) continue;
    const parts = f.split('/');
    let hit = false;
    for (let i = 0; i < parts.length - 1; i++) {
      if (WORK_DIR.test(parts[i])) {
        const d = `${parts.slice(0, i + 1).join('/')}/`;
        dirs.set(d, (dirs.get(d) || 0) + 1);
        hit = true;
        break;
      }
    }
    if (!hit && WORK_FILE.test(parts[parts.length - 1]) && !/\.(md|txt|json|lock|snap)$/i.test(f)) single.push(f);
  }
  for (const [d, n] of [...dirs].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    out.push({ name: base(d.slice(0, -1)) + '/', reason: `${d} に ${n} 個のファイル（裏で動く仕事の置き場）`, evidence: d.slice(0, -1), meaning: 'job' });
  }
  for (const f of single.sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))) {
    out.push({ name: base(f), reason: `${f}（裏で動く仕事のファイル）`, evidence: f, meaning: 'job' });
  }
  // 3) cron / queue libraries among the dependencies
  for (const d of deps) {
    if (WORK_LIBS.has(d.name.toLowerCase())) out.push({ name: d.name, reason: `${d.reason}（決まった時間・裏で仕事を動かす道具）`, evidence: d.reason.split(' ')[0], meaning: 'lib' });
  }
  // one cat per name; the schedule ones first
  const seen = new Set();
  return out.filter((c) => (seen.has(c.name) ? false : (seen.add(c.name), true))).slice(0, MAX_CATS);
}

export { findWork };
