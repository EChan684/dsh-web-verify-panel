// Preset patcher test: builds a fake preset tree in a temp dir, verifies the
// patcher injects web_verify_open into coreFor/personas/guides, is idempotent,
// keeps backups, and never touches files that were already patched.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { patchPreset } from '../lib/router-preset.mjs';

// Fixture mirrors the REAL shipped preset (trailing spaces before closing
// quotes included — quote-inclusive match patterns silently no-op on it).
const CORE_SAMPLE = `export const MODE_SPEC = 0
const SPEC_PERSONA = 'You are a helpful software engineer assistant. '
const MIXED_PERSONA =
  'You are a helpful software engineer assistant.\\n'
  + 'Work directly: prefer writing or editing code over describing plans. '
  + 'Verify your changes by reading and running them. '
const REACT_PERSONA =
  'You are a hands-on software engineer who delivers working output fast.\\n'
  + 'Work directly: write or edit code, then verify it by reading and running. '
  + 'Keep the loop tight — produce, verify, fix — and do not build test '
  + 'harnesses, scaffolding, or ceremony the user did not ask for. '
  + 'Finish with a usable deliverable and a short summary. '
export function coreFor(mode) {
  switch (bandOf(mode)) {
    case 'spec': return ['read', 'edit', 'glob', 'grep'] // read-first
    case 'transition': return ['read', 'edit', 'write', 'glob', 'grep'] // union
    default: return ['read', 'write', 'edit'] // write-first
  }
}
`;

const BOOT_SAMPLE = `  const GUIDE_WEAK =
    '\\nRouter: classify this task (build or fix) now, then adopt the matching style — build: direct production; fix: inspect-first. Think deeply first, then commit and act.'
  const GUIDE_DEEP =
    '\\nRouter: classify this task (build or fix) now, then adopt the matching style — build: direct production; fix: inspect-first. Think deeply about the architecture, edge cases, and integration points. Do not spend reasoning on the environment or tooling. Produce when your information is complete. End each reasoning block with a decision or an information need.'
`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wvp-preset-'));
const presetDir = path.join(tmp, 'router-standard');
fs.mkdirSync(presetDir, { recursive: true });
const coreFile = path.join(presetDir, 'router-core.mjs');
const bootFile = path.join(presetDir, 'router-bootstrap.mjs');
fs.writeFileSync(coreFile, CORE_SAMPLE);
fs.writeFileSync(bootFile, BOOT_SAMPLE);

// 1. first patch
const r1 = patchPreset(tmp);
assert.equal(r1.found, true, 'preset found');
assert.equal(r1.patched, true, 'first patch applies');
let core = fs.readFileSync(coreFile, 'utf8');
let boot = fs.readFileSync(bootFile, 'utf8');
assert.ok(core.includes("'web_verify_open'"), 'coreFor spec band patched');
assert.ok(core.includes("default: return ['read', 'write', 'edit', 'web_verify_open']"), 'coreFor default band patched');
const personaCount = (core.match(/Exception: when asked to open or verify a web page/g) || []).length;
assert.equal(personaCount, 3, 'all 3 personas patched (SPEC/MIXED/REACT)');
assert.ok(boot.includes('call web_verify_open immediately, never try another way'), 'guides patched');

// 2. backups exist
assert.ok(fs.existsSync(coreFile + '.bak-webverify'), 'core backup');
assert.ok(fs.existsSync(bootFile + '.bak-webverify'), 'bootstrap backup');
assert.equal(fs.readFileSync(coreFile + '.bak-webverify', 'utf8'), CORE_SAMPLE, 'backup is the original');

// 3. idempotent: second run skips and does not touch files
const r2 = patchPreset(tmp);
assert.equal(r2.patched, false, 'second run is a no-op');
assert.equal(fs.readFileSync(coreFile, 'utf8'), core, 'core unchanged after second run');

// 4. missing preset → found=false, no throw
const r3 = patchPreset(path.join(tmp, 'nope'));
assert.equal(r3.found, false, 'missing preset handled');

// 5. divergent preset content (no known patterns) → found, patched=false, no throw
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'wvp-div-'));
fs.mkdirSync(path.join(tmp2, 'router-standard'), { recursive: true });
fs.writeFileSync(path.join(tmp2, 'router-standard', 'router-core.mjs'), '// divergent unrelated content\n');
fs.writeFileSync(path.join(tmp2, 'router-standard', 'router-bootstrap.mjs'), '// divergent unrelated content\n');
const r4 = patchPreset(tmp2);
assert.equal(r4.found, true, 'divergent preset still found');
assert.equal(r4.patched, false, 'divergent preset not patched');
fs.rmSync(tmp2, { recursive: true, force: true });

fs.rmSync(tmp, { recursive: true, force: true });
console.log('preset-patch test: all 5 checks passed');
