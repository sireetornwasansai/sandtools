import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.location = { origin: 'https://sand.example.go.th' };
const { savedPayload, savedForm, savedDesign, shortUrl, catLabel, typeLabel } = await import('../../src/js/core/qrsaved.js');

test('tracked QR encodes the short URL; static QR is rebuilt from the saved fields', () => {
  assert.equal(savedPayload({ kind: 'qr', code: 'abc2345', qr: { t: 'url' } }, 'https://s.example.go.th/'), 'https://s.example.go.th/s/abc2345');
  assert.equal(savedPayload({ kind: 'qrs', qr: { t: 'url', f: { url: 'example.com' } } }, ''), 'https://example.com');
  assert.equal(savedPayload({ kind: 'qrs', qr: { t: 'phone', f: { phone: '081-234 5678' } } }, ''), 'tel:0812345678');
  assert.match(savedPayload({ kind: 'qrs', qr: { t: 'email', f: { email: 'a@b.go.th', subject: 'สวัสดี' } } }, ''), /^mailto:a@b\.go\.th\?subject=/);
});
test('Wi-Fi with a password cannot be rebuilt (the password is never stored); open Wi-Fi can', () => {
  assert.equal(savedPayload({ kind: 'qrs', qr: { t: 'wifi', f: { ssid: 'HOSP', encryption: 'WPA' } } }, ''), '');
  assert.equal(savedPayload({ kind: 'qrs', qr: { t: 'wifi', f: { ssid: 'GUEST', encryption: 'nopass', hidden: 'true' } } }, ''), 'WIFI:T:nopass;S:GUEST;H:true;;');
  assert.equal(savedForm({ qr: { f: { hidden: 'false' } } }).hidden, false);
  assert.equal(savedForm({ qr: { f: { hidden: 'true' } } }).hidden, true);
});
test('unknown / missing data never throws', () => {
  assert.equal(savedPayload(null, ''), ''); assert.equal(savedPayload({ kind: 'qrs', qr: { t: 'nope' } }, ''), ''); assert.equal(savedPayload({ kind: 'qrs' }, ''), '');
  assert.deepEqual(savedDesign({}), { size: 512, margin: 4, fg: '#000000', bg: '#ffffff', style: 'square', ec: 'M', cat: 'general', cap: '' });
  assert.equal(savedDesign({ qr: { d: { margin: 0, cat: 'hrd' } } }).margin, 0);
  assert.equal(shortUrl('', 'x1y'), 'https://sand.example.go.th/s/x1y'); assert.equal(catLabel('vaccine'), 'งานวัคซีน'); assert.equal(typeLabel('wifi'), 'Wi-Fi'); assert.equal(catLabel('zzz'), 'ทั่วไป');
});
