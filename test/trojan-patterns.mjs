// Runs plugin-guard.js's TROJAN_PATTERNS (copied verbatim from
// E:\dsh\Deepseek Harness EAC\dsh-desktop\plugin-guard.js:29-35) against the
// plugin files to confirm the desktop health check will not flag this plugin.
import fs from 'node:fs';

const TROJAN_PATTERNS = [
  { code: 'TROJAN_REMOTE_EXEC', re: /(?:child_process|execSync|spawnSync|exec|spawn)\s*\(\s*['"`](?:curl|wget|powershell|cmd|bash|sh)\b[^'"`]*['"`][\s\S]{0,200}(?:\|\s*(?:sh|bash|iex|Invoke-Expression)|-enc\b)/i },
  { code: 'TROJAN_DOWNLOAD_EXEC', re: /(?:curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr)\b[\s\S]{0,160}?(?:\|\s*(?:sh|bash|iex|Invoke-Expression)\b|Out-File[\s\S]{0,80}\.(?:ps1|bat|cmd|vbs))/i },
  { code: 'TROJAN_BASE64_EVAL', re: /(?:eval|Function)\s*\(\s*(?:atob|Buffer\.from\([^)]*,\s*['"]base64['"]\)|window\.atob)\s*\(/i },
  { code: 'TROJAN_PERSISTENCE', re: /(?:reg(?:\.exe)?\s+add[\s\S]{0,120}(?:Run|RunOnce)|Startup[\\\\/][\w.-]+\.(?:bat|cmd|ps1|vbs|lnk)|schtasks\s+\/create|Register-ScheduledTask)/i },
  { code: 'TROJAN_EXFIL_ENV', re: /(?:process\.env|os\.env)[\s\S]{0,120}(?:https?:\/\/|fetch\s*\(|XMLHttpRequest|net\.connect|dgram)/i },
];

let hit = false;
const targets = ['lib/index.js', 'lib/client.js', 'lib/router-preset.mjs', 'scripts/patch-router-preset.mjs', 'package.json', 'cordis.patch.yml'];
for (const f of targets) {
  const src = fs.readFileSync(f, 'utf8');
  for (const { code, re } of TROJAN_PATTERNS) {
    if (re.test(src)) {
      console.log('HIT', code, 'in', f);
      hit = true;
    }
  }
}
console.log(hit ? 'FAILED: trojan pattern hit' : 'clean: no trojan pattern matches');
process.exit(hit ? 1 : 0);
