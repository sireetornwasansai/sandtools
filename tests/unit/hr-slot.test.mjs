import test from 'node:test';
import assert from 'node:assert/strict';
import { slotOf, slotText } from '../../src/js/modules/hr-slot.js';

const ev = (o) => ({ startDate: '2026-11-10', endDate: '2026-11-10', ...o });
test('slotOf: a time range in the morning → left (am), in the afternoon → right (pm)', () => {
  assert.equal(slotOf(ev({ startTime: '08:00', endTime: '12:00' })), 'am');
  assert.equal(slotOf(ev({ startTime: '09:00', endTime: '11:30' })), 'am');
  assert.equal(slotOf(ev({ startTime: '13:00', endTime: '16:00' })), 'pm');
  assert.equal(slotOf(ev({ startTime: '12:00', endTime: '15:00' })), 'pm');
  assert.equal(slotOf(ev({ startTime: '08:00', endTime: '12:30' })), 'am');
});
test('slotOf: spans noon, whole day, multi-day, no time, holidays → full width', () => {
  assert.equal(slotOf(ev({ startTime: '08:00', endTime: '16:30' })), '');
  assert.equal(slotOf(ev({ startTime: '09:00', endTime: '14:00' })), '');
  assert.equal(slotOf(ev({})), '');
  assert.equal(slotOf({ startDate: '2026-11-10', endDate: '2026-11-12', startTime: '08:00', endTime: '12:00' }), '');
  assert.equal(slotOf({ isHoliday: true, startTime: '08:00', endTime: '12:00' }), '');
  assert.equal(slotOf(null), '');
});
test('slotOf: half-day leave keeps working without times (note, then start time, else morning)', () => {
  assert.equal(slotOf(ev({ isHalfDay: true })), 'am');
  assert.equal(slotOf(ev({ isHalfDay: true, note: 'ลาช่วงบ่าย' })), 'pm');
  assert.equal(slotOf(ev({ isHalfDay: true, note: 'เช้า' })), 'am');
  assert.equal(slotOf(ev({ isHalfDay: true, startTime: '13:00', endTime: '16:00' })), 'pm');
  assert.equal(slotOf(ev({ isHalfDay: true, startTime: '08:00', endTime: '16:00' })), 'am', 'a half-day leave with odd times still gets a side');
  assert.equal(slotOf({ isHalfDay: true, startDate: '2026-11-10', endDate: '2026-11-11' }), '', 'multi-day is never a half');
});
test('slotText: the times, or the standard hours of a half-day leave', () => {
  assert.equal(slotText(ev({ startTime: '13:00', endTime: '16:00' })), '13:00–16:00');
  assert.equal(slotText(ev({ isHalfDay: true })), '08:00–12:00');
  assert.equal(slotText(ev({ isHalfDay: true, note: 'บ่าย' })), '13:00–16:00');
  assert.equal(slotText(ev({})), '');
});
