const { test } = require('node:test');
const assert = require('node:assert/strict');
const schedule = require('../src/schedule.js');
const at = value => new Date(`${value}:00`);
const rule = (days, start, end) => ({ days, timeWindow: { mode: 'custom', start, end } });

test('weekday block includes start, excludes end and ignores unselected days', () => {
  const r = rule(['Mon', 'Wed'], '08:00', '18:00');
  for (const [time, expected] of [
    ['2026-11-23T07:59', false], ['2026-11-23T08:00', true],
    ['2026-11-23T17:59', true], ['2026-11-23T18:00', false],
    ['2026-11-24T10:00', false], ['2026-11-25T10:00', true]
  ]) assert.equal(schedule.applies(r, at(time)), expected, time);
});

test('overnight block follows the selected start day, including Sunday rollover', () => {
  const r = rule(['Sun'], '22:00', '08:00');
  assert.equal(schedule.applies(r, at('2026-11-22T07:00')), false);
  assert.equal(schedule.applies(r, at('2026-11-22T22:00')), true);
  assert.equal(schedule.applies(r, at('2026-11-23T07:59')), true);
  assert.equal(schedule.applies(r, at('2026-11-23T08:00')), false);
  assert.equal(schedule.applies(r, at('2026-11-23T22:00')), false);
});

test('availability respects adjacent and overlapping schedules', () => {
  const rules = [rule(['Mon'], '08:00', '12:00'), rule(['Mon'], '11:00', '14:00'), rule(['Mon'], '14:00', '18:00')];
  assert.equal(schedule.availableAt(rules, at('2026-11-23T09:00')), at('2026-11-23T18:00').toISOString());
});

test('all-day blocks extend through consecutive selected days', () => {
  const r = { days: ['Mon', 'Tue'], timeWindow: { mode: 'allDay' } };
  assert.equal(schedule.availableAt([r], at('2026-11-23T09:00')), at('2026-11-25T00:00').toISOString());
  assert.equal(schedule.availableAt([{ days: [], timeWindow: { mode: 'allDay' } }], at('2026-11-23T09:00')), null);
});

test('next boundary uses local calendar dates across daylight saving changes', () => {
  const r = rule(['Sat'], '22:00', '08:00');
  const now = at('2026-10-31T23:00');
  assert.equal(schedule.availableAt([r], now), at('2026-11-01T08:00').toISOString());
  assert.equal(schedule.boundaries([r], now)[0], at('2026-11-01T08:00').getTime());
});

test('legacy empty days and equal times retain all-day behavior', () => {
  assert.equal(schedule.applies(rule([], '08:00', '08:00'), at('2026-11-22T03:00')), true);
  assert.equal(schedule.minutes('24:00'), null);
  assert.equal(schedule.minutes('08:60'), null);
});
