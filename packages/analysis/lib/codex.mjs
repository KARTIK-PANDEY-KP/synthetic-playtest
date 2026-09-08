/**
 * Run `codex exec -m gpt-6-astra` non-interactively with a private CODEX_HOME.
 *
 * Auth: CODEX_API_KEY if set, else a copy of ~/.codex/auth.json. We never load the
 * user's own config.toml — the temp home gets a minimal one we write ourselves, and
 * the whole directory is deleted afterwards so no credential copy lingers.
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const MODEL = process.env.ASTRA_MODEL || 'gpt-6-astra';

export async function runCodex({ prompt, cwd, schemaPath, model = MODEL, effort = 'medium', timeoutMs = 600_000, log = (s) => process.stderr.write(s) }) {
  const home = mkdtempSync(join(tmpdir(), 'sp-analysis-codex-'));
  const outFile = join(home, 'last-message.txt');
  try {
    const env = { ...process.env, CODEX_HOME: home };
    if (!process.env.CODEX_API_KEY) {
      const auth = join(homedir(), '.codex', 'auth.json');
      if (!existsSync(auth)) throw new Error('no CODEX_API_KEY and no ~/.codex/auth.json — cannot authenticate codex');
      copyFileSync(auth, join(home, 'auth.json'));
    }
    writeFileSync(join(home, 'config.toml'), `model = "${model}"\nmodel_reasoning_effort = "${effort}"\n`);

    const args = ['exec', '--json', '--skip-git-repo-check', '--color', 'never', '-s', 'read-only', '-m', model, '-C', cwd, '-o', outFile];
    if (schemaPath) args.push('--output-schema', schemaPath);
    args.push('-');   // prompt on stdin

    const started = Date.now();
    const { code, stdout, stderr } = await new Promise((resolve, reject) => {
      const child = spawn('codex', args, { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '', err = '';
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`codex exec timed out after ${timeoutMs} ms`)); }, timeoutMs);
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (c) => { clearTimeout(timer); resolve({ code: c, stdout: out, stderr: err }); });
      child.stdin.end(prompt);
    });

    const usage = parseUsage(stdout);
    log(`[codex] exit ${code} in ${((Date.now() - started) / 1000).toFixed(1)}s` + (usage ? ` — tokens in ${usage.input_tokens} (cached ${usage.cached_input_tokens}) out ${usage.output_tokens} ≈ $${usdFor(usage).toFixed(3)}` : '') + '\n');
    if (code !== 0) throw new Error(`codex exec failed (exit ${code}): ${stderr.slice(-2000)}`);
    const text = existsSync(outFile) ? readFileSync(outFile, 'utf8') : lastAgentMessage(stdout);
    return { text, usage, usd: usage ? usdFor(usage) : null };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function parseUsage(jsonl) {
  let usage = null;
  for (const line of jsonl.split('\n')) {
    try { const e = JSON.parse(line); if (e.type === 'turn.completed' && e.usage) usage = e.usage; } catch { /* not json */ }
  }
  return usage;
}
function lastAgentMessage(jsonl) {
  let text = '';
  for (const line of jsonl.split('\n')) {
    try { const e = JSON.parse(line); if (e.type === 'item.completed' && e.item?.type === 'agent_message') text = e.item.text ?? text; } catch { /* not json */ }
  }
  return text;
}
const usdFor = (u) => ((u.input_tokens - (u.cached_input_tokens ?? 0)) * 10 + (u.cached_input_tokens ?? 0) * 1 + (u.output_tokens ?? 0) * 50) / 1e6;
