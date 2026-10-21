'use strict';

/**
 * 前端自检：index.html 里定义的 id、app.js 引用的 id、以及用到的 class
 * 必须互相对得上，避免改页面时漏改另一处。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');

const definedIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const usedIds = new Set([...app.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));

test('app.js 引用的 DOM id 都存在于 index.html', () => {
  const missing = [...usedIds].filter((id) => !definedIds.has(id));
  assert.deepEqual(missing, [], `缺少这些 id：${missing.join(', ')}`);
});

test('index.html 里没有被写错名字的重复 id', () => {
  const all = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = all.filter((id, i) => all.indexOf(id) !== i);
  assert.deepEqual([...new Set(dup)], [], `重复 id：${dup.join(', ')}`);
});

test('JS 里用到的 class 都有对应样式', () => {
  const jsClasses = new Set();
  for (const m of app.matchAll(/class="([^"$]+)"/g)) {
    m[1].split(/\s+/).forEach((c) => c && jsClasses.add(c));
  }
  for (const m of app.matchAll(/classList\.(?:add|remove|toggle)\('([^']+)'\)/g)) {
    jsClasses.add(m[1]);
  }
  const cssClasses = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
  const missing = [...jsClasses].filter((c) => !cssClasses.has(c));
  assert.deepEqual(missing, [], `没有样式的 class：${missing.join(', ')}`);
});

test('页面没有引用外部 CDN 资源（离线可用）', () => {
  const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(external, [], `发现外部资源：${external.join(', ')}`);
});
