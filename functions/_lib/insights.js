import { json } from './util.js';

// Batch progress: star students for the latest class and month-by-month trends for the whole batch.
// Every query is keyed by batch_id (or by student through batch_students), so it reads only this batch's rows.

const POLE_SETS = ['dasrang_1min', 'sadhi_adhi_1min', 'pole_climb_1min'];
const ROPE_SETS = ['rope_climb_1min'];
const ALL_SETS = [...POLE_SETS, ...ROPE_SETS];
// One point per extra rep in a one-minute set, plus points for skill progress in the same class.
const PTS = { rep: 1, started: 3, mastered: 5 };
const STARS = { pole: 2, rope: 1 };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ymd = d => d.toISOString().slice(0, 10);
const monthsBack = (end, n) => { const out = []; const [y, m] = end.split('-').map(Number); for (let k = n - 1; k >= 0; k--) { const d = new Date(Date.UTC(y, m - 1 - k, 1)); out.push(ymd(d).slice(0, 7)); } return out; };

// Scores one student for the class window (prev, last]: reps gained over their previous best set, and skills started or mastered.
export function scoreStudent(sets, skills, prev, last) {
  const inWin = d => (!prev || d > prev) && d <= last;
  const out = { pole: 0, rope: 0, reasons: { pole: [], rope: [] } };
  for (const ex of ALL_SETS) {
    const app = POLE_SETS.includes(ex) ? 'pole' : 'rope';
    const mine = sets.filter(r => r.exercise === ex);
    const now = mine.filter(r => inWin(r.record_date)).reduce((m, r) => Math.max(m, r.best), -1);
    const before = mine.filter(r => !inWin(r.record_date) && r.record_date <= last).sort((a, b) => b.record_date.localeCompare(a.record_date))[0];
    if (now < 0 || !before) continue;
    const gain = now - before.best;
    if (gain > 0) { out[app] += gain * PTS.rep; out.reasons[app].push({ kind: 'set', exercise: ex, from: before.best, to: now, gain }); }
  }
  for (const app of ['pole', 'rope']) {
    const started = skills.filter(s => s.apparatus === app && s.started_date && inWin(s.started_date)).length;
    const mastered = skills.filter(s => s.apparatus === app && s.mastered_date && inWin(s.mastered_date)).length;
    out[app] += started * PTS.started + mastered * PTS.mastered;
    if (started) out.reasons[app].push({ kind: 'started', n: started });
    if (mastered) out.reasons[app].push({ kind: 'mastered', n: mastered });
  }
  return out;
}

// Two pole stars, then one rope star who is not already a pole star. Nobody with zero improvement is a star.
export function pickStars(scored) {
  const pole = scored.filter(s => s.pole > 0).sort((a, b) => b.pole - a.pole || a.name.localeCompare(b.name)).slice(0, STARS.pole);
  const taken = new Set(pole.map(s => s.id));
  const rope = scored.filter(s => s.rope > 0 && !taken.has(s.id)).sort((a, b) => b.rope - a.rope || a.name.localeCompare(b.name)).slice(0, STARS.rope);
  return { pole, rope };
}

export async function handleInsights(path, method, env, url) {
  if (path !== 'batch-insights' || method !== 'GET') return null;
  const bid = url.searchParams.get('batch_id');
  const asOf = DATE_RE.test(url.searchParams.get('date') || '') ? url.searchParams.get('date') : ymd(new Date());
  if (!bid) return json({ error: 'batch_id is required' }, 400);
  const months = monthsBack(asOf.slice(0, 7), 6), since = months[0] + '-01';
  const [kids, dates, sets, skills, att, classes] = (await env.DB.batch([
    env.DB.prepare('SELECT s.id,s.first_name,s.last_name FROM batch_students bs JOIN students s ON s.id=bs.student_id WHERE bs.batch_id=? AND COALESCE(s.active,1)=1 ORDER BY s.first_name,s.last_name').bind(bid),
    env.DB.prepare('SELECT DISTINCT attendance_date AS d FROM student_attendance WHERE batch_id=? AND attendance_date<=? ORDER BY attendance_date DESC LIMIT 2').bind(bid, asOf),
    env.DB.prepare('SELECT r.student_id,r.exercise,r.record_date,MAX(r.total) AS best FROM batch_students bs JOIN rep_sessions r ON r.student_id=bs.student_id AND r.record_date>=? AND r.record_date<=? WHERE bs.batch_id=? GROUP BY r.student_id,r.exercise,r.record_date').bind(since, asOf, bid),
    env.DB.prepare("SELECT p.student_id,sk.apparatus,p.started_date,p.mastered_date FROM batch_students bs JOIN student_skill_progress p ON p.student_id=bs.student_id JOIN skills sk ON sk.id=p.skill_id WHERE bs.batch_id=? AND (p.started_date>=?2 OR p.mastered_date>=?2)").bind(bid, since),
    env.DB.prepare("SELECT substr(attendance_date,1,7) AS month,SUM(status IN ('present','late')) AS here,COUNT(*) AS n FROM student_attendance WHERE batch_id=? AND attendance_date>=? AND attendance_date<=? GROUP BY month").bind(bid, since, asOf),
    env.DB.prepare("SELECT attendance_date AS d,SUM(status IN ('present','late')) AS here,COUNT(*) AS n FROM student_attendance WHERE batch_id=? AND attendance_date<=? GROUP BY attendance_date ORDER BY attendance_date DESC LIMIT 12").bind(bid, asOf)
  ])).map(r => r.results);

  // The latest class is the last day attendance was taken, or a later day with timed sets; the previous class is the attendance day before it.
  const lastSet = sets.reduce((m, r) => r.record_date > m ? r.record_date : m, '');
  const last = [dates[0]?.d || '', lastSet].sort().pop() || null;
  const prev = dates.map(x => x.d).find(d => d < last) || null;

  const scored = last ? kids.map(k => {
    const name = (k.first_name + ' ' + (k.last_name || '')).trim();
    return { id: k.id, name, ...scoreStudent(sets.filter(r => r.student_id === k.id), skills.filter(r => r.student_id === k.id), prev, last) };
  }) : [];

  const byMonth = (rows, key) => months.map(m => rows.filter(r => (r[key] || '').startsWith(m)).length);
  const avgBest = ex => months.map(m => {
    const best = new Map();
    sets.filter(r => r.exercise === ex && r.record_date.startsWith(m)).forEach(r => best.set(r.student_id, Math.max(best.get(r.student_id) || 0, r.best)));
    return best.size ? Math.round([...best.values()].reduce((a, b) => a + b, 0) / best.size * 10) / 10 : null;
  });
  return json({
    last_class: last, prev_class: prev, students: kids.length,
    roster: kids.map(k => (k.first_name[0] || '') + (k.last_name?.[0] || '')),
    classes: classes.reverse(),
    stars: pickStars(scored),
    scores: scored.filter(s => s.pole || s.rope).sort((a, b) => (b.pole + b.rope) - (a.pole + a.rope)),
    months,
    trends: {
      attendance: months.map(m => { const r = att.find(x => x.month === m); return r && r.n ? Math.round(100 * r.here / r.n) : null; }),
      started: byMonth(skills, 'started_date'),
      mastered: byMonth(skills, 'mastered_date'),
      sets: Object.fromEntries(ALL_SETS.map(ex => [ex, avgBest(ex)]))
    }
  });
}
