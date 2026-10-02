import test from 'node:test'; import assert from 'node:assert/strict';
import * as Q from '../../src/js/modules/qr-engine.js';

test('payload: URL gets https:// when scheme missing, keeps others', () => {
  assert.equal(Q.PAYLOADS.url({ url: 'example.com/a' }), 'https://example.com/a');
  assert.equal(Q.PAYLOADS.url({ url: 'http://x.y' }), 'http://x.y'); assert.equal(Q.PAYLOADS.url({ url: '  ' }), '');
});
test('payload: Wi-Fi escapes special characters and handles open networks', () => {
  assert.equal(Q.PAYLOADS.wifi({ ssid: 'A;B', password: 'p:w"', encryption: 'WPA' }), 'WIFI:T:WPA;S:A\\;B;P:p\\:w\\";;');
  assert.equal(Q.PAYLOADS.wifi({ ssid: 'Open', encryption: 'nopass' }), 'WIFI:T:nopass;S:Open;;');
  assert.equal(Q.PAYLOADS.wifi({ ssid: 'H', password: 'x', hidden: true }), 'WIFI:T:WPA;S:H;P:x;H:true;;'); assert.equal(Q.PAYLOADS.wifi({}), '');
});
test('payload: mailto / tel / sms', () => {
  assert.equal(Q.PAYLOADS.email({ email: 'a@b.c', subject: 'หัวข้อ & x', body: 'a b' }), 'mailto:a@b.c?subject=%E0%B8%AB%E0%B8%B1%E0%B8%A7%E0%B8%82%E0%B9%89%E0%B8%AD%20%26%20x&body=a%20b');
  assert.equal(Q.PAYLOADS.phone({ phone: '081-234 5678' }), 'tel:0812345678'); assert.equal(Q.PAYLOADS.sms({ phone: '+66 81', message: 'hi there' }), 'sms:+6681?body=hi%20there');
});
test('payload: vCard 3.0 escapes and uses CRLF', () => {
  const v = Q.PAYLOADS.vcard({ firstName: 'A', lastName: 'B', org: 'X, Y; Z', phone: '1', email: 'a@b.c', url: 'b.c', address: 'l1\nl2' });
  assert.ok(v.startsWith('BEGIN:VCARD\r\nVERSION:3.0')); assert.ok(v.endsWith('END:VCARD')); assert.ok(v.includes('ORG:X\\, Y\\; Z')); assert.ok(v.includes('URL:https://b.c')); assert.ok(v.includes('l1\\nl2'));
  assert.equal(Q.PAYLOADS.vcard({}), '');
});
test('buildMatrix: square, finder patterns present, grows with data, errors on empty / too long', () => {
  const m = Q.buildMatrix('hello', 'M'); assert.equal(m.modules.length, m.size); assert.ok(m.modules.every((r) => r.length === m.size)); assert.equal(m.size, 21);
  assert.ok(m.modules[0][0] && m.modules[0][6] && m.modules[6][0] && m.modules[3][3]); // finder pattern corners + centre
  assert.ok(Q.buildMatrix('x'.repeat(500), 'M').size > m.size);
  assert.throws(() => Q.buildMatrix(''), /EMPTY/); assert.throws(() => Q.buildMatrix('x'.repeat(3000)), /TOO_LONG/);
  assert.throws(() => Q.buildMatrix('x'.repeat(2900), 'H'), /TOO_LONG/);
});
test('toSvg produces valid-looking svg with colours and optional logo', () => {
  const m = Q.buildMatrix('abc'); const svg = Q.toSvg(m, { size: 300, margin: 4, fg: '#112233', bg: '#ffffff', style: 'rounded', logo: { dataUrl: 'data:image/png;base64,AAA', ratio: 0.2 } });
  assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>')); assert.ok(svg.includes('#112233') && svg.includes('<image')); assert.ok(svg.includes(`viewBox="0 0 ${m.size + 8} ${m.size + 8}"`));
});
test('contrastRatio', () => { assert.ok(Q.contrastRatio('#000000', '#ffffff') > 20.9); assert.ok(Q.contrastRatio('#777777', '#888888') < 2); });
