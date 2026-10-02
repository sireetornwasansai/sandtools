import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, buildPackage, lint, scanPii, redact, suggestName } from '../../src/js/modules/skill-engine.js';

const proc = '# ขั้นตอนการเบิกพัสดุ\n\n## ขั้นตอน\n' + Array.from({ length: 7 }, (_, i) => `${i + 1}. ยื่นแบบฟอร์มเบิกพัสดุข้อ ${i + 1}`).join('\n') + '\n\n## เอกสารที่ต้องใช้\nแบบฟอร์มเบิกพัสดุ\n';
test('detects procedure kind, topics and title', () => {
  const a = analyze(proc);
  assert.equal(a.kind, 'procedure'); assert.equal(a.title, 'ขั้นตอนการเบิกพัสดุ'); assert.ok(a.topics.length >= 3);
});
test('package passes lint and has a valid front matter', () => {
  const a = analyze(proc); const pkg = buildPackage({ name: 'procurement-guide', md: proc, a });
  assert.match(pkg.files['SKILL.md'], /^---\nname: procurement-guide\ndescription: "/);
  const q = lint(pkg, proc); assert.equal(q.issues.filter((i) => i.level === 'error').length, 0); assert.ok(q.score >= 90);
});
test('large documents are split into references with links', () => {
  const big = Array.from({ length: 6 }, (_, i) => `## หัวข้อ ${i + 1}\n` + 'เนื้อหา\n'.repeat(80)).join('\n');
  const pkg = buildPackage({ name: 'big', md: big });
  assert.ok(pkg.split); const refs = Object.keys(pkg.files).filter((k) => k.startsWith('references/'));
  assert.equal(refs.length, 6); assert.match(pkg.files['SKILL.md'], /\(references\/01-/);
});
test('PII is detected, reported as an error, and redacted', () => {
  const t = 'บัตร 1-2345-67890-12-3 โทร 081-234-5678 อีเมล a@b.go.th HN 123456';
  assert.equal(scanPii(t).length, 4); assert.equal(scanPii(redact(t)).length, 0);
  assert.ok(lint(buildPackage({ name: 'x', md: t }), t).issues.some((i) => i.level === 'error'));
});
test('invalid or reserved names are rejected; Thai titles fall back to file name', () => {
  const pkg = buildPackage({ name: 'My Claude Skill', md: proc }); assert.equal(pkg.name, 'my-claude-skill');
  assert.ok(lint(pkg, proc).issues.some((i) => /claude/.test(i.msg)));
  assert.equal(suggestName({ title: 'ขั้นตอน' }, 'purchase-guide.docx'), 'purchase-guide');
});
