#!/usr/bin/env node
/**
 * Synthetic playtest — ANALYSIS CLI (docs/INTERFACES.md §"ANALYSIS — CLI contract").
 *
 *   node packages/analysis/cli.mjs cluster --run runs/<id> [--llm] [--threshold 0.5] [--stall-steps 6] [--radius 3]
 *   node packages/analysis/cli.mjs verify  --run runs/<id> --game-url URL [--timeout 60000] [--max-per-cluster 3]
 *   node packages/analysis/cli.mjs score   --run runs/<id> --ledger apps/game/src/flaws/ledger.json
 *   node packages/analysis/cli.mjs report  --run runs/<id> [--html]
 *   node packages/analysis/cli.mjs ask     --run runs/<id> "question" | --preset 1|2|3
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadRun, readAnalysis, writeAnalysis } from './lib/archive.mjs';
import { clusterRun } from './lib/cluster.mjs';
import { verifyRun } from './lib/verify.mjs';
import { scoreRun } from './lib/score.mjs';
import { buildModel, renderMarkdown, renderHtml } from './lib/report.mjs';
import { ask, PRESETS } from './lib/ask.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const log = (s) => process.stderr.write(s);

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = {}; const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) { opts[key] = next; i++; } else opts[key] = true;
    } else positional.push(a);
  }
  return { cmd, opts, positional };
}

const num = (v, d) => (v === undefined ? d : Number(v));

function loadClusters(run) {
  const clusters = readAnalysis(run, 'findings.json', null);
  if (!clusters) throw new Error(`no analysis/findings.json in ${run.dir} — run \`cluster\` first`);
  return clusters;
}

async function main() {
  const { cmd, opts, positional } = parseArgs(process.argv.slice(2));
  if (!cmd || cmd === 'help' || opts.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 10).join('\n').replace(/^ \*\/?\s?/gm, ''));
    return;
  }
  if (!opts.run) throw new Error('--run <dir> is required');
  const run = loadRun(opts.run);

  switch (cmd) {
    case 'cluster': {
      const { clusters, tier, rawFindings } = await clusterRun(run, {
        llm: !!opts.llm, threshold: num(opts.threshold, undefined), stallSteps: num(opts.stallSteps, undefined),
        radius: num(opts.radius, undefined), gameThreshold: num(opts.gameThreshold, undefined), log,
      });
      const p = writeAnalysis(run, 'findings.json', clusters);
      const by = clusters.reduce((m, c) => ((m[c.attribution] = (m[c.attribution] ?? 0) + 1), m), {});
      log(`[cluster] ${rawFindings} findings from ${run.personas.length} personas → ${clusters.length} clusters (${tier}); attribution: ${JSON.stringify(by)}\n[cluster] wrote ${p}\n`);
      break;
    }
    case 'verify': {
      if (!opts.gameUrl) throw new Error('--game-url <url> is required');
      const clusters = loadClusters(run);
      const summary = await verifyRun(run, clusters, { gameUrl: opts.gameUrl, timeoutMs: num(opts.timeout, undefined), maxPerCluster: num(opts.maxPerCluster, undefined), log });
      writeAnalysis(run, 'findings.json', clusters);
      log(`[verify] ${summary.replays} replays → verified ${summary.verified}, not reproduced ${summary.falsified}, unverifiable ${summary.unverifiable}\n`);
      break;
    }
    case 'score': {
      if (!opts.ledger) throw new Error('--ledger <ledger.json> is required');
      const ledger = JSON.parse(readFileSync(resolve(opts.ledger), 'utf8'));
      const clusters = loadClusters(run);
      const score = scoreRun(run, clusters, ledger);
      writeAnalysis(run, 'findings.json', clusters);       // ledgerId now populated
      const p = writeAnalysis(run, 'score.json', score);
      log(`[score] recall ${score.recall} (${score.found.length}/${score.totals.nonDecoy}) · precision ${score.precision} (${score.totals.matchedNonDecoy}/${score.totals.clusters}) · decoys flagged ${score.decoysFlagged.join(',') || 'none'} · emergent ${score.emergent.join(',') || 'none'} · missed ${score.missed.join(',') || 'none'}\n[score] wrote ${p}\n`);
      break;
    }
    case 'report': {
      const clusters = loadClusters(run);
      const score = readAnalysis(run, 'score.json', null);
      const model = buildModel(run, clusters, score);
      const md = renderMarkdown(model);
      const p = writeAnalysis(run, 'report.md', md);
      log(`[report] wrote ${p} (${md.length} chars)\n`);
      if (opts.html) {
        const html = renderHtml(model);
        const h = writeAnalysis(run, 'report.html', html);
        log(`[report] wrote ${h} (${(html.length / 1024).toFixed(0)} KB)\n`);
      }
      break;
    }
    case 'ask': {
      const question = opts.preset ? PRESETS[String(opts.preset)] : positional.join(' ').trim();
      if (!question) throw new Error(`a question is required (or --preset 1|2|3):\n${Object.entries(PRESETS).map(([k, v]) => `  ${k}. ${v}`).join('\n')}`);
      log(`[ask] ${question}\n`);
      const { answer, usd } = await ask(run, question, { log, effort: opts.effort });
      process.stdout.write(answer + '\n');
      if (usd != null) log(`[ask] ≈ $${usd.toFixed(3)}\n`);
      break;
    }
    default:
      throw new Error(`unknown subcommand: ${cmd}`);
  }
}

main().catch((e) => { log(`error: ${e.message}\n`); process.exit(1); });
export { HERE, join };
