import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const VISTA_SKILL_NAME = "vista-cli";

export const VISTA_SKILL_CONTENT = `---
name: vista-cli
description: Use when a user asks an agent to inspect, sync, summarize, or answer questions from their local Vista financial CLI. Assumes \`vista\` is available on PATH and runs on the user's machine.
---

# Vista CLI

Use \`vista\` as the source of truth for local financial data. Run commands directly; do not read or mutate the SQLite DB unless explicitly asked.

Commands:

\`\`\`sh
vista version --check
vista init
vista status
vista sync
vista sync runs
vista sync show <run-id>
vista connections
vista connections show <id>
vista connections test <id>
vista dashboard --json
vista accounts --json
vista accounts show <id>
vista accounts rename <id> "Display Name"
vista accounts rename <id> --clear
vista accounts hide <id>
vista accounts unhide <id>
vista accounts include <id>
vista accounts exclude <id>
vista accounts owner <id> --owner mine|wife|joint
vista holdings --json
vista holdings show <id-or-symbol> --json
vista holdings classify <id-or-symbol> --asset-class cash|equity|fixed_income|crypto|fund|other --json
vista transactions --limit 25 --json
vista transactions --kind bank --since YYYY-MM-DD --until YYYY-MM-DD --account "Account Name" --json
vista transactions show <id>
vista income show --json
vista income show --person "Name" --json
vista connect plaid
vista connect healthequity
vista connect coinbase --api-key-file ~/Downloads/cdp_api_key.json
vista upgrade --check
\`\`\`

Workflow:

- For current financial answers, run \`vista sync\` first unless the user asks for cached/local data only.
- Use \`vista status\` for sync health, stale/never-synced state, latest result, and local record counts. Use \`vista sync runs\` for sync history and \`vista sync show <run-id>\` for a specific failure.
- Use \`vista connections\` and \`vista connections show <id>\` for provider connection management.
- Prefer \`--json\` for commands you need to parse. Use \`vista dashboard --json\` for net worth/summary, \`vista accounts --json\` for balances, \`vista holdings --json\` for investments, \`vista transactions --limit N --json\` for recent activity, and \`vista income show --json\` for salary/bonus income by person.
- Use \`vista accounts show <id>\` before changing account metadata.
- Use account mutation commands only when asked. \`hide\` and \`exclude\` both remove an account from dashboard totals; \`rename --clear\` resets the local display name.
- Use \`vista holdings show <id-or-symbol>\` before changing a holding. Use \`vista holdings classify <id> --asset-class <value>\` for local classification overrides; if a symbol is ambiguous, rerun with the exact holding id.
- For transaction questions, use \`vista transactions --kind bank|investment --account <id-or-name> --since YYYY-MM-DD --until YYYY-MM-DD\` and \`vista transactions show <id>\`. Use \`exclude\`/\`include\` only when the user explicitly asks to change bank transaction reporting.
- If Vista is not initialized, run \`vista init\`. Connect Plaid, HealthEquity, or Coinbase only when the user asks.
- Summarize command output. Mention sync errors, stale data, or missing data.
- Do not upgrade Vista, change config, or inspect raw DB files unless asked.
`;

export type SkillOptions = {
  codexHome?: string;
};

export function resolveCodexHome(codexHome = process.env.CODEX_HOME) {
  return codexHome?.trim() || join(homedir(), ".codex");
}

export function resolveVistaSkillPath(options: SkillOptions = {}) {
  return join(resolveCodexHome(options.codexHome), "skills", VISTA_SKILL_NAME);
}

export function installVistaSkill(options: SkillOptions = {}) {
  const skillPath = resolveVistaSkillPath(options);
  const skillFilePath = join(skillPath, "SKILL.md");

  mkdirSync(skillPath, { recursive: true });
  writeFileSync(skillFilePath, VISTA_SKILL_CONTENT, "utf8");

  return skillFilePath;
}

export function printSkillHelp() {
  console.log(`Vista skill commands

Usage:
  vista skill install
  vista skill print
`);
}
