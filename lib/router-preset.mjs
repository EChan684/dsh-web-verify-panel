/**
 * dsh-web-verify-panel — Router Standard preset patcher.
 *
 * WHY: the default "Router Standard (experimental)" agent preset exposes only a
 * first-turn core tool set on a session's very first model request (the full
 * catalog opens after the first durable tool/call). With the preset alone, the
 * model cannot call `web_verify_open` in round one and tends to fall back to
 * other browser-opening habits. This module patches the *user's* preset copy
 * (skip-if-exists: user edits always win, never touches the bundled assets):
 *
 *   coreFor()  → web_verify_open joins the first-turn core set (all bands)
 *   personas   → "open/verify a web page → call web_verify_open right away"
 *   bootstrap guides → same exception for weak-mode guidance
 *
 * SAFETY: idempotent (files already mentioning `web_verify_open` are skipped),
 * non-destructive (one backup `<file>.bak-webverify`, never overwritten),
 * string-level edits only, every failure degrades to a console note — a broken
 * or absent preset never breaks this plugin.
 */
import fs from 'node:fs';
import path from 'node:path';

export const PRESET_ID = 'router-standard';

const WEB_TOKEN = 'web_verify_open';

const PERSONA_EXCEPTION =
  ' Exception: when asked to open or verify a web page, call web_verify_open right away instead of deliberating or trying any other method.';

const GUIDE_EXCEPTION =
  ' EXCEPTION: if the task is to open or verify a web page, do NOT classify or deliberate - call web_verify_open immediately, never try another way.';

/** [old, new] pairs applied to router-core.mjs. */
const CORE_PAIRS = [
  [
    "case 'spec': return ['read', 'edit', 'glob', 'grep']",
    "case 'spec': return ['read', 'edit', 'glob', 'grep', 'web_verify_open']",
  ],
  [
    "case 'transition': return ['read', 'edit', 'write', 'glob', 'grep']",
    "case 'transition': return ['read', 'edit', 'write', 'glob', 'grep', 'web_verify_open']",
  ],
  [
    "default: return ['read', 'write', 'edit']",
    "default: return ['read', 'write', 'edit', 'web_verify_open']",
  ],
  // Persona pairs append the exception INSIDE the string literal (the from
  // strings deliberately stop before the closing quote): the shipped preset
  // has a trailing space before the quote (`assistant. '`), so quote-inclusive
  // patterns silently never match. PERSONA_EXCEPTION starts with a space.
  [
    "const SPEC_PERSONA = 'You are a helpful software engineer assistant.",
    "const SPEC_PERSONA = 'You are a helpful software engineer assistant." + PERSONA_EXCEPTION,
  ],
  [
    "Verify your changes by reading and running them.",
    "Verify your changes by reading and running them." + PERSONA_EXCEPTION,
  ],
  [
    "Finish with a usable deliverable and a short summary.",
    "Finish with a usable deliverable and a short summary." + PERSONA_EXCEPTION,
  ],
];

/** [old, new] pairs applied to router-bootstrap.mjs. */
const BOOT_PAIRS = [
  [
    "Think deeply first, then commit and act.'",
    "Think deeply first, then commit and act." + GUIDE_EXCEPTION + "'",
  ],
  [
    "End each reasoning block with a decision or an information need.'",
    "End each reasoning block with a decision or an information need." + GUIDE_EXCEPTION + "'",
  ],
];

function applyPairs(src, pairs) {
  let changed = false;
  for (const [from, to] of pairs) {
    if (src.includes(to)) continue; // pair-level idempotency: never double-append
    if (!src.includes(from)) continue;
    src = src.replace(from, to);
    changed = true;
  }
  return { src, changed };
}

function backupOnce(file) {
  const bak = file + '.bak-webverify';
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
}

/**
 * Patch one preset id under `presetsRoot` (e.g. `<home>/.agent-presets`).
 * @returns {{ found: boolean, patched: boolean, reason?: string }}
 */
export function patchPreset(presetsRoot) {
  try {
    const presetDir = path.join(presetsRoot, PRESET_ID);
    const coreFile = path.join(presetDir, 'router-core.mjs');
    const bootFile = path.join(presetDir, 'router-bootstrap.mjs');
    if (!fs.existsSync(coreFile) || !fs.existsSync(bootFile)) {
      return { found: false, patched: false, reason: `${PRESET_ID} preset not found (only needed for Router Standard users)` };
    }
    let core = fs.readFileSync(coreFile, 'utf8');
    let boot = fs.readFileSync(bootFile, 'utf8');
    if (core.includes(WEB_TOKEN) && boot.includes(WEB_TOKEN)) {
      return { found: true, patched: false, reason: 'already patched' };
    }
    const coreP = applyPairs(core, CORE_PAIRS);
    const bootP = applyPairs(boot, BOOT_PAIRS);
    if (!coreP.changed && !bootP.changed) {
      return { found: true, patched: false, reason: 'no known pattern matched (preset has diverged; skip)' };
    }
    if (coreP.changed) {
      backupOnce(coreFile);
      fs.writeFileSync(coreFile, coreP.src);
    }
    if (bootP.changed) {
      backupOnce(bootFile);
      fs.writeFileSync(bootFile, bootP.src);
    }
    return { found: true, patched: true, reason: 'patched (backup: *.bak-webverify)' };
  } catch (err) {
    return { found: false, patched: false, reason: String((err && err.message) || err) };
  }
}
