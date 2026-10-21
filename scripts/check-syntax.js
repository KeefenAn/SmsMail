'use strict';

/**
 * 语法自检：把仓库里每个 .js 编译一遍（只编译不执行）。
 * 用法：npm run check
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'data', 'dev', '.git', 'coverage']);
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full);
    } else if (entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
}

walk(ROOT);

let failed = 0;
for (const file of files.sort()) {
  const rel = path.relative(ROOT, file);
  const code = fs.readFileSync(file, 'utf8').replace(/^#!.*\r?\n/, '');
  try {
    new vm.Script(code, { filename: file });
    console.log(`  ok   ${rel}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${rel}\n        ${err.message}`);
  }
}

console.log(`\n检查了 ${files.length} 个文件，失败 ${failed} 个`);
process.exit(failed ? 1 : 0);
