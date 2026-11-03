import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreStudent, pickStars } from '../functions/_lib/insights.js';

test('scores reps gained over the previous set and skills in the class window', () => {
  const sets = [
    { exercise: 'dasrang_1min', record_date: '2026-10-20', best: 20 },
    { exercise: 'dasrang_1min', record_date: '2026-10-27', best: 24 },
    { exercise: 'rope_climb_1min', record_date: '2026-10-27', best: 9 } // no earlier set: no gain counted
  ];
  const skills = [
    { apparatus: 'pole', started_date: '2026-10-27', mastered_date: null },
    { apparatus: 'rope', started_date: '2026-09-01', mastered_date: '2026-10-27' },
    { apparatus: 'pole', started_date: '2026-10-20', mastered_date: null } // before the window
  ];
  const s = scoreStudent(sets, skills, '2026-10-20', '2026-10-27');
  assert.equal(s.pole, 4 + 3);
  assert.equal(s.rope, 5);
});

test('a slower set scores nothing, not a negative', () => {
  const sets = [{ exercise: 'sadhi_adhi_1min', record_date: '2026-10-20', best: 15 }, { exercise: 'sadhi_adhi_1min', record_date: '2026-10-27', best: 12 }];
  assert.equal(scoreStudent(sets, [], '2026-10-20', '2026-10-27').pole, 0);
});

test('two pole stars, one rope star who is not a pole star, nobody at zero', () => {
  const s = [
    { id: 'a', name: 'A', pole: 9, rope: 9 }, { id: 'b', name: 'B', pole: 5, rope: 0 },
    { id: 'c', name: 'C', pole: 1, rope: 2 }, { id: 'd', name: 'D', pole: 0, rope: 0 }
  ];
  const st = pickStars(s);
  assert.deepEqual(st.pole.map(x => x.id), ['a', 'b']);
  assert.deepEqual(st.rope.map(x => x.id), ['c']);
  assert.deepEqual(pickStars([s[3]]), { pole: [], rope: [] });
});
