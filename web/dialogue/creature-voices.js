// Only presentation changes here: town.json keeps the original schedule and evidence path.
const FALLBACK = '決まった時刻に動く';
const DAYS = ['日', '月', '火', '水', '木', '金', '土', '日'];

export function cronJa(expression) {
  const fields = String(expression ?? '').trim().split(/\s+/);
  if (fields.length !== 5) return FALLBACK;
  const [minute, hour, date, month, weekday] = fields;
  if (date !== '*' || month !== '*') return FALLBACK;
  const every = /^\*\/(\d+)$/.exec(minute);
  if (every && hour === '*' && weekday === '*') {
    const n = Number(every[1]);
    // Only divisors of an hour really have a constant interval across the hour boundary.
    if (n > 0 && n < 60 && 60 % n === 0) return `${n} 分ごと`;
  }
  if (!/^\d+$/.test(minute) || Number(minute) > 59) return FALLBACK;
  const atMinute = Number(minute) ? `${Number(minute)} 分` : '';
  if (hour === '*' && weekday === '*') return `毎時 ${Number(minute)} 分`;
  if (!/^\d+(,\d+)*$/.test(hour)) return FALLBACK;
  const hours = hour.split(',').map(Number);
  if (hours.some((h) => h > 23)) return FALLBACK;
  const times = hours.map((h) => `${h} 時${atMinute ? ` ${atMinute}` : ''}`).join('・');
  if (weekday === '*') return `毎日 ${times}`;
  if (/^[0-7]$/.test(weekday)) return `毎週${DAYS[Number(weekday)]}曜 ${times}`;
  if (weekday === '1-5') return `月曜から金曜の ${times}`;
  return FALLBACK;
}

export function creatureVoice(data) {
  const workflow = data.kind === 'cat' && data.meaning === 'cron';
  let name = String(data.name ?? '');
  if (workflow) {
    name = name.replace(/\.ya?ml$/i, '');
    const chars = Array.from(name);
    if (chars.length > 24) name = `${chars.slice(0, 23).join('')}…`;
  }
  const reason = String(data.reason ?? '');
  if (!workflow) return { name, reason };
  const schedule = /（schedule(?:・cron:\s*([^）]*))?）/.exec(reason);
  const evidence = reason.split(' が決まった時間に動く')[0];
  return {
    name,
    reason: `${cronJa(schedule?.[1])}${schedule?.[1] ? '（UTC）' : ''}。根拠: ${evidence}`,
  };
}
