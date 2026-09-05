#!/usr/bin/env node
/**
 * Repository audit: scans production sources for forbidden placeholders and accidental debug
 * output. Exits non-zero when a violation is found. Comments that legitimately mention a word
 * (e.g. documenting that something is *not* mocked) are allowed via the ALLOW list.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');
const PATTERNS = [
  { name: 'TODO', regex: /\bTODO\b/ },
  { name: 'FIXME', regex: /\bFIXME\b/ },
  { name: 'IMPLEMENT LATER', regex: /implement later|IMPLEMENT\b(?! everything)/i },
  { name: 'placeholder', regex: /placeholder(?!=|"|\s*:\s*")/i },
  { name: 'mock', regex: /\bmock/i },
  { name: 'fake', regex: /\bfake\b/i },
  { name: 'temporary', regex: /\btemporary\b/i },
  { name: 'any type', regex: /:\s*any\b|<any>|as any\b/ },
  { name: 'console.log', regex: /console\.log\(/ },
];
/** Files/lines that are allowed to contain a pattern (with a reason). */
const ALLOW = [
  { file: /\.test\.tsx?$/, pattern: /.*/, reason: 'tests may mock modules and use test vocabulary' },
  { file: /validation\.ts$/, pattern: /placeholder/, reason: 'provenance validator rejects placeholders' },
  { file: /NumberField\.tsx$|SubstanceSelector\.tsx$/, pattern: /placeholder=/, reason: 'HTML input placeholder attribute' },
  { file: /audit\.mjs$/, pattern: /.*/, reason: 'this script' },
];

const violations = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      walk(full);
    } else if (/\.(ts|tsx|glsl|css|html)$/.test(entry)) {
      const rel = relative(ROOT, full);
      const lines = readFileSync(full, 'utf8').split('\n');
      lines.forEach((line, i) => {
        for (const p of PATTERNS) {
          if (!p.regex.test(line)) continue;
          const allowed = ALLOW.some((a) => a.file.test(rel) && a.pattern.test(line));
          if (!allowed) violations.push(`${rel}:${i + 1} [${p.name}] ${line.trim().slice(0, 120)}`);
        }
      });
    }
  }
}
walk(SRC);
walk(join(ROOT, 'e2e'));
if (violations.length > 0) {
  console.error(`Audit found ${violations.length} violation(s):`);
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log('Audit passed: no placeholders, mocks, fakes, TODOs, `any` or console.log in production sources.');
