'use strict';

/**
 * 文档自检：Markdown 里的相对链接必须指向真实存在的文件。
 * 开源仓库最常见的翻车方式就是 README 里的图 / 链接 404。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'dev', 'data', '.git', 'coverage']);

function collectMarkdown(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectMarkdown(full, out);
    } else if (entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

const files = collectMarkdown(ROOT);

test('仓库里能找到 Markdown 文件', () => {
  assert.ok(files.length >= 10, `只找到 ${files.length} 个 Markdown 文件`);
});

test('Markdown 里的相对链接都存在', () => {
  const broken = [];

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const raw = match[1].trim();
      if (/^(https?:|mailto:|tel:|#)/i.test(raw)) continue;
      const target = raw.split('#')[0];
      if (!target) continue;
      const abs = path.resolve(path.dirname(file), decodeURIComponent(target));
      if (!fs.existsSync(abs)) {
        broken.push(`${path.relative(ROOT, file)} -> ${target}`);
      }
    }
  }

  assert.deepEqual(broken, [], `失效链接：\n${broken.join('\n')}`);
});

test('每个文档都被 README 索引到了', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const docs = fs
    .readdirSync(path.join(ROOT, 'docs'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => `docs/${f}`);

  const missing = docs.filter((d) => !readme.includes(d));
  assert.deepEqual(missing, [], `README 里没链接到：${missing.join(', ')}`);
});
