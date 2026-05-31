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
vista sync
vista connections
vista connections show <id>
vista connections test <id>
vista dashboard
vista accounts
vista holdings
vista transactions --limit 25
vista income show
vista income show --person "Name"
vista connect plaid
vista connect healthequity
vista connect coinbase --api-key-file ~/Downloads/cdp_api_key.json
vista upgrade --check
\`\`\`

Workflow:

- For current financial answers, run \`vista sync\` first unless the user asks for cached/local data only.
- Use \`vista connections\` and \`vista connections show <id>\` for provider connection status. Use \`vista dashboard\` for net worth/summary, \`vista accounts\` for balances, \`vista holdings\` for investments, \`vista transactions --limit N\` for recent activity, and \`vista income show\` for salary/bonus income by person.
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
