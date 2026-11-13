#!/usr/bin/env node
/**
 * 用平台的口径本地跑一遍 manifest.assertions（不烧 token）。
 *
 * 用法：node tools/check-asserts.mjs <output.json>
 * 依赖：先打包并在复验镜像里跑一次，拿到 output.json。
 *
 * 单场景包没有 expected.*，表达式里不要引用 expected（这里按 null 传）。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, '..', 'problem', 'manifest.json'), 'utf8'));
const outArg = process.argv[2];
if (!outArg) {
  console.error('用法：node tools/check-asserts.mjs <output.json>');
  process.exit(2);
}
const out = JSON.parse(readFileSync(outArg, 'utf8'));
const expected = null;

let failed = 0;
for (const a of manifest.assertions) {
  let ok = false;
  let err = null;
  try {
    ok = eval(a.expr) === true;
  } catch (e) {
    err = String(e.message ?? e);
  }
  if (ok) console.log('pass  ', a.name);
  else {
    failed += 1;
    console.log('FAIL  ', a.name, err ? `→ ${err}` : '→ false');
  }
}
const total = manifest.assertions.length;
console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
