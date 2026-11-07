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
