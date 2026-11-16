import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, extractJson } from '../functions/_lib/ai.js';

const ctx = { students: [{ id: 's1' }, { id: 's2' }], skills: [{ id: 'k1' }], metrics: ['dasrang_1min'] };

test('keeps real actions and turns made-up ones into notes for the coach', () => {
  const r = validate({ actions: [
    { type: 'skill', student: 's1', skill: 'k1', status: 'mastered', heard: 'Riya got ulti bagli tedhi' },
    { type: 'count', student: 's2', metric: 'dasrang_1min', value: '32', heard: 'Dev 32 dasrang' },
    { type: 'skill', student: 'ghost', skill: 'k1', status: 'learning', heard: 'Zed' },
    { type: 'count', student: 's1', metric: 'made_up', value: 5 },
    { type: 'count', student: 's1', metric: 'dasrang_1min', value: 99999 }
  ], unclear: ['Two Riyas'] }, ctx);
  assert.deepEqual(r.actions.map(a => a.type + ':' + a.student), ['skill:s1', 'count:s2']);
  assert.equal(r.actions[1].value, 32);
  assert.equal(r.unclear.length, 4);
});

test('reads JSON wrapped in prose or code fences', () => {
  assert.deepEqual(extractJson('Sure!\n```json\n{"actions":[]}\n```'), { actions: [] });
  assert.equal(extractJson('no json here'), null);
});

import { validateAttendance } from '../functions/_lib/ai.js';
test('attendance keeps real people and statuses, once each', () => {
  const r = validateAttendance({ rest: 'present', marks: [
    { kind: 'student', id: 's1', status: 'absent', heard: 'Riya not here' },
    { kind: 'student', id: 's1', status: 'late' },
    { kind: 'coach', id: 'c1', status: 'present' },
    { kind: 'student', id: 'nobody', status: 'present', heard: 'Zed' },
    { kind: 'student', id: 's2', status: 'asleep' }
  ] }, { students: [{ id: 's1' }, { id: 's2' }], coaches: [{ id: 'c1' }] });
  assert.equal(r.rest, 'present');
  assert.deepEqual(r.marks.map(m => m.kind + m.id + m.status), ['students1absent', 'coachc1present']);
  assert.equal(r.unclear.length, 2);
  assert.equal(validateAttendance({ rest: 'maybe' }, { students: [], coaches: [] }).rest, null);
});

import { shortCodes, expandActions } from '../functions/_lib/ai.js';
test('a whole batch minus one becomes one action per student, with real ids', () => {
  const student = shortCodes('s', [{ id: 'uuid-a' }, { id: 'uuid-b' }, { id: 'uuid-c' }]);
  const skill = shortCodes('k', [{ id: 'skill-x' }]), batch = shortCodes('b', [{ id: 'mon' }]);
  const rosters = new Map([['mon', new Set(['uuid-a', 'uuid-b', 'uuid-c'])]]);
  const r = expandActions({ actions: [
    { type: 'skill', batch: 'b1', except: ['s2'], skill: 'k1', status: 'mastered', heard: 'everyone but B' },
    { type: 'count', students: ['s3'], metric: 'dasrang_1min', value: 30 }
  ] }, { student, skill, batch, rosters });
  assert.deepEqual(r.actions.map(a => a.student + ':' + (a.skill || a.metric)), ['uuid-a:skill-x', 'uuid-c:skill-x', 'uuid-c:dasrang_1min']);
  assert.equal(r.actions[0].batch, undefined);
});

test('ask mode keeps only real, well-formed actions', async () => {
  const { validateAsk, shortCodes } = await import('../functions/_lib/ai.js');
  const codes = shortCodes('d', [{ id: 'demo-a' }]);
  const r = validateAsk({ answer: ' Done. ', actions: [
    { type: 'practice', demo: 'd1', date: '2026-11-20', start_time: '17:00', end_time: 'late', location: 'Edison' },
    { type: 'practice', demo: 'd9', date: '2026-11-20' },          // unknown demo
    { type: 'practice', demo: 'd1', date: 'Friday' },               // not a date
    { type: 'announcement', title: 'No class Monday', body: 'Holiday.' },
    { type: 'delete_student', student: 's1' }                        // not something it may do
  ] }, codes);
  assert.equal(r.answer, 'Done.');
  assert.deepEqual(r.actions, [
    { type: 'practice', demo_id: 'demo-a', date: '2026-11-20', start_time: '17:00', end_time: '', location: 'Edison', notes: '' },
    { type: 'announcement', title: 'No class Monday', body: 'Holiday.' }
  ]);
});

test('weekly email: week starts Sunday morning US time; empty weeks send nothing', async () => {
  const { weekKey, buildDigest } = await import('../functions/_lib/digest.js');
  assert.equal(weekKey(Date.parse('2026-11-15T14:59:00Z')), '2026-11-08'); // Sunday, before 15:00 UTC: still last week
  assert.equal(weekKey(Date.parse('2026-11-15T15:00:00Z')), '2026-11-15');
  assert.equal(weekKey(Date.parse('2026-11-21T23:00:00Z')), '2026-11-15'); // Saturday
  const kid = { first_name: 'Riya', attendance: {}, mastered: [], notes: [] };
  assert.equal(buildDigest({ email: 'p@example.com', name: 'Meena Shah' }, [kid], 'https://x.test'), null);
  const m = buildDigest({ email: 'p@example.com', name: 'Meena Shah', upcoming: [] }, [{ ...kid, attendance: { present: 2, absent: 1 }, mastered: ['Bagli <b>'] }], 'https://x.test');
  assert.equal(m.subject, "Riya's week at MFU");
  assert.match(m.text, /Came to 2 of 3 classes this week \(1 missed\)/);
  assert.match(m.html, /Bagli &lt;b&gt;/); // names are escaped
});

test('one-tap links: only a parent gets a personal link, and only the bare site link changes', async () => {
  const { oneTap } = await import('../functions/_lib/mail.js');
  const saved = [];
  const env = { SITE_URL: 'https://mfu.example', DB: {
    prepare: sql => ({ sql, bind: (...b) => ({ sql, b }), all: async () => ({ results: [{ id: 'p1', e: 'mom@example.com' }] }) }),
    batch: async st => { saved.push(...st.filter(s => s.sql.startsWith('INSERT'))); }
  } };
  const html = '<a href="https://mfu.example">Open</a> <a href="https://mfu.example/#setup=abc">Set password</a> <a href="https://mfu-tracker.pages.dev/">Site</a> <a href="https://mfu.example.evil.com">x</a>';
  const [mom, coach] = await oneTap(env, [{ to: 'Mom@Example.com', html, text: 'Open: https://mfu.example' }, { to: 'coach@example.com', html, text: '' }]);
  const token = /#go=([a-f0-9]{64})/.exec(mom.html)[1];
  assert.equal(mom.html, `<a href="https://mfu.example/#go=${token}">Open</a> <a href="https://mfu.example/#setup=abc">Set password</a> <a href="https://mfu-tracker.pages.dev/#go=${token}">Site</a> <a href="https://mfu.example.evil.com">x</a>`);
  assert.equal(mom.text, 'Open: https://mfu.example/#go=' + token);
  assert.equal(coach.html, html);                       // not a parent: untouched
  assert.equal(saved.length, 1);
  assert.equal(saved[0].b[1], 'p1');
  assert.notEqual(saved[0].b[0], token);                // only the hash is stored
});
