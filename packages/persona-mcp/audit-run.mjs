/**
 * Audits a finished persona dir: did anything the AGENT could read mention the
 * answer key? Checks every MCP tool result text Codex recorded, the brief, and
 * the tool descriptions. Exit 1 on any hit.
 *
 *   node packages/persona-mcp/audit-run.mjs runs/<runId>/<persona>
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toolDefinitions } from './tools.mjs';

const dir = process.argv[2];
if (!dir) { console.error('usage: audit-run.mjs <personaDir>'); process.exit(2); }
const FORBIDDEN = /__telemetry|flaw|ledger|decoy/i;

const texts = [];
const lines = readFileSync(join(dir, 'session.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
let toolResults = 0;
for (const e of lines) {
  if (e.kind !== 'codex') continue;
  const item = e.event?.item;
  if (item?.type === 'mcp_tool_call') {
    toolResults++;
    for (const c of item.result?.content ?? []) if (c.type === 'text') texts.push(['tool result', c.text]);
    if (item.error) texts.push(['tool error', JSON.stringify(item.error)]);
  }
}
if (existsSync(join(dir, 'brief.md'))) texts.push(['brief.md', readFileSync(join(dir, 'brief.md'), 'utf8')]);
const persona = JSON.parse(readFileSync(join(dir, 'persona.json'), 'utf8'));
for (const t of toolDefinitions(persona)) texts.push([`tool description ${t.name}`, `${t.description} ${JSON.stringify(t.inputSchema)}`]);

const hits = texts.filter(([, t]) => FORBIDDEN.test(t));
const actions = lines.filter((l) => l.kind === 'action').length;
const findings = lines.filter((l) => l.kind === 'finding').length;
const gates = lines.filter((l) => l.kind === 'gate').length;
console.log(`${texts.length} agent-visible texts (${toolResults} tool results) · ${actions} actions · ${findings} findings · ${gates} gate events`);
for (const [where, t] of hits) console.log(`LEAK in ${where}: ${t.slice(0, 200)}`);
console.log(hits.length ? `FAIL: ${hits.length} leak(s)` : 'ok: no agent-visible text mentions __telemetry / flaw / ledger / decoy');
process.exit(hits.length ? 1 : 0);
