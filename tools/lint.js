/**
 * tools/lint.js — dependency-free syntax check for every source module.
 *
 * There is no build step, so "lint" here means: does every .js file parse?
 * Runs `node --check` on each module and reports the first failure. Cross-platform.
 *
 *   npm run lint
 */

import { readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');

const files = [
  ...readdirSync(ROOT).filter(f => f.endsWith('.js')).map(f => path.join(ROOT, f)),
  ...readdirSync(__dirname).filter(f => f.endsWith('.js')).map(f => path.join(__dirname, f)),
];

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log(`  ok   ${path.relative(ROOT, file)}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${path.relative(ROOT, file)}`);
    console.error(String(err.stderr || err.message).trim());
  }
}

if (failed) {
  console.error(`\nLint failed: ${failed} file(s) with syntax errors.`);
  process.exit(1);
}
console.log(`\nLint OK — ${files.length} modules parse cleanly.`);
