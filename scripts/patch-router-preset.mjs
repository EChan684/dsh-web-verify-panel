#!/usr/bin/env node
/**
 * dsh-web-verify-panel — one-shot Router Standard preset patcher.
 * Run this AFTER installing the plugin (or let the plugin do it automatically
 * on boot; this script just saves you one extra restart):
 *
 *   node scripts/patch-router-preset.mjs
 *
 * Idempotent: safe to run any number of times. Backups: *.bak-webverify.
 */
import os from 'node:os';
import path from 'node:path';
import { patchPreset } from '../lib/router-preset.mjs';

const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const res = patchPreset(path.join(home, '.agent-presets'));

if (!res.found) {
  console.log(`[patch-router-preset] ${res.reason}`);
  console.log('  → 当前未使用 Router Standard 预设,无需补丁(升级到 Router Standard 后再运行本脚本即可)。');
  process.exitCode = 0;
} else if (res.patched) {
  console.log('[patch-router-preset] 已为 Router Standard 预设打补丁:');
  console.log('  · 首轮核心工具集加入 web_verify_open(spec/mixed/react 三档)');
  console.log('  · personas 与路由引导加入"打开网页直接调用 web_verify_open"例外条款');
  console.log('  · 原始文件备份为 *.bak-webverify(可手动还原)');
  console.log('→ 重启 DSH 桌面端即可生效。');
} else {
  console.log(`[patch-router-preset] 跳过:${res.reason}`);
}
