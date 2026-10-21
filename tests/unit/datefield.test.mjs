// core/datefield.js — the one date format of the site: วว/ดด/ปปปป (พ.ศ.). Pure helpers only (no DOM).
import test from 'node:test';
import assert from 'node:assert/strict';
import { isoToDisplay, displayToIso, maskDate, fmtDate, fmtDateTime } from '../../src/js/core/datefield.js';

test('isoToDisplay: yyyy-mm-dd → dd/mm/พ.ศ. ; garbage → empty', () => {
  assert.equal(isoToDisplay('2026-10-21'), '21/10/2569');
  assert.equal(isoToDisplay('2026-01-05 10:00:00'), '05/01/2569');
  assert.equal(isoToDisplay(''), ''); assert.equal(isoToDisplay('x'), ''); assert.equal(isoToDisplay(null), '');
});

test('displayToIso: accepts พ.ศ. and ค.ศ., / - . separators, one-digit day/month; rejects impossible dates', () => {
  assert.equal(displayToIso('21/10/2569'), '2026-10-21');
  assert.equal(displayToIso('21/10/2026'), '2026-10-21');
  assert.equal(displayToIso('5-1-2569'), '2026-01-05');
  assert.equal(displayToIso('29/02/2568'), '');                 // 2025 is not a leap year
  assert.equal(displayToIso('29/02/2567'), '2024-02-29');       // 2024 is
  assert.equal(displayToIso('31/04/2569'), ''); assert.equal(displayToIso('00/10/2569'), ''); assert.equal(displayToIso('21/13/2569'), '');
  assert.equal(displayToIso('21/10/69'), ''); assert.equal(displayToIso(''), ''); assert.equal(displayToIso('21/10'), '');
});

test('maskDate: digits get their slashes while typing; a lone digit before a typed slash is padded; deleting is not fought', () => {
  assert.equal(maskDate('2'), '2'); assert.equal(maskDate('21'), '21'); assert.equal(maskDate('211'), '21/1');
  assert.equal(maskDate('2110'), '21/10'); assert.equal(maskDate('21102569'), '21/10/2569'); assert.equal(maskDate('211025699999'), '21/10/2569');
  assert.equal(maskDate('5/'), '05'); assert.equal(maskDate('5/1/2569'), '05/01/2569'); assert.equal(maskDate('21-10-2569'), '21/10/2569');
  assert.equal(maskDate('2/', true), '2');                      // backspace over the slash must not re-pad to "02"
  assert.equal(maskDate('abc'), '');
});

test('fmtDate / fmtDateTime: Bangkok time, วว/ดด/ปปปป', () => {
  assert.equal(fmtDate('2026-10-21'), '21/10/2569');
  assert.equal(fmtDate(new Date('2026-10-21T18:30:00Z')), '22/10/2569');   // already the 22nd in Bangkok
  assert.equal(fmtDate(''), ''); assert.equal(fmtDate('nope'), '');
  assert.equal(fmtDateTime('2026-10-21T03:05:00Z'), '21/10/2569 10:05');
  assert.equal(fmtDateTime(Date.UTC(2026, 9, 21, 17, 0)), '22/10/2569 00:00');
  assert.equal(fmtDateTime(null), '-'); assert.equal(fmtDateTime('x'), '-');
});
