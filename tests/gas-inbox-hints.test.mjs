import { test } from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const GAS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'gas');
const ctx = { console, Utilities: {}, CacheService: {}, LNK_TZ: 'Asia/Bangkok' }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(GAS, 'Inbox.gs'), 'utf8'), ctx);
vm.runInContext('function sarGuessUrgency(text){var t=String(text||\'\');return /ด่วนที่สุด/.test(t)?\'most\':/ด่วนมาก/.test(t)?\'very\':/(^|[\\s(])ด่วน($|[\\s)])/.test(t)?\'urgent\':\'\';}', ctx);
const R = e => vm.runInContext(e, ctx);
const names = ['14-153012_แก้ไข-ด่วนที่สุด ที่ สธ 0208.02 ว 10440 ลว 14 พ.ย.2567 - มาตรการ.pdf', 'แก้ไข-ด่วนที่สุด_ที่_สธ_0208_02_ว_10440_ลว_14_พ_ย_2567_-_มาตร.pdf', '09-101010_หนังสือ ที่ นร 0505/ว 112 ลงวันที่ 16 มีนาคม 2566.pdf'];
const expect = [['สธ 0208.02/ว10440', '2024-11-14', 'most'], ['สธ 0208.02/ว10440', '2024-11-14', 'most'], ['นร 0505/ว112', '2023-03-16', '']];
test('queue-file hints: letter number / date / urgency from the file name (Inbox.gs)', () => {
names.forEach((n, i) => {
  const got = [R(`inbBookNo(inbFileText(${JSON.stringify(n)})) || inbBookNoLoose(${JSON.stringify(n)})`), R(`inbDateLoose(${JSON.stringify(n)})`), R(`sarGuessUrgency(inbFileText(${JSON.stringify(n)}))`)];
  assert.deepStrictEqual(got, expect[i], n); });
const p = R(`inbParse('', [], ${JSON.stringify(names[0])}, 'กลุ่ม')`); assert.strictEqual(p.bookNo, 'สธ 0208.02/ว10440'); assert.strictEqual(p.bookDate, '2024-11-14');
assert.strictEqual(R(`inbDateLoose('ลว 14 พ.ย. 25020.pdf')`), '');   // ปีผิดปกติต้องไม่ถูกใช้
assert.strictEqual(R(`inbParse('ที่ นร 0505/ว 112 ลงวันที่ 16 มีนาคม 2566', [], 'x.pdf', 'c').bookNo`), 'นร 0505/ว112');   // พฤติกรรมเดิมเมื่อมีข้อความ
});
