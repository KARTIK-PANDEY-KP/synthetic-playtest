/**
 * Cross-report analyst: one `codex exec -m gpt-6-astra` call with every report in context.
 * Three preset questions are the buttons the dashboard shows.
 */
import { readAnalysis } from './archive.mjs';
import { runCodex } from './codex.mjs';

export const PRESETS = {
  1: 'What did all personas struggle with, and what did only some struggle with — and why?',
  2: 'Which three findings should the developer fix first, and what\'s the evidence?',
  3: 'Which findings are the agents\' fault rather than the game\'s?',
};

export function buildPrompt(run, question) {
  const reportMd = readAnalysis(run, 'report.md', null);
  const findings = readAnalysis(run, 'findings.json', null);
  const score = readAnalysis(run, 'score.json', null);
  const perPersona = run.personas.map((p) => ({
    id: p.id, name: p.name, enforcement: p.enforcement, status: p.status, steps: p.inputActions.length,
    roomsReached: p.roomsReached(), report: p.report,
  }));
  const parts = [
    `You are the cross-persona analyst for a synthetic playtest of the game "Station Kepler". ${run.personas.length} persona-driven agents each played the game like a beta tester; their sessions were recorded, findings were clustered across personas, attributed to the game or to the agent from ground-truth telemetry (stalls, positions — never self-report), and scored against the developer's ledger of deliberately injected flaws.`,
    'Answer the question below for a game developer. Be specific: name personas, rooms, flaw ids, counts, and cite which persona setting (audio, reading level, genre familiarity, patience, exploration) explains a difference when one does. Distinguish evidence from inference. Keep it under 400 words. Do not run commands or read files; everything you need is in this message.',
    reportMd ? `# Cross-persona report (report.md)\n${reportMd}` : '# Cross-persona report\n(not rendered yet)',
    findings ? `# Clustered findings (findings.json)\n${JSON.stringify(findings.map(slimCluster), null, 1)}` : '',
    score ? `# Score against the flaw ledger (score.json)\n${JSON.stringify({ recall: score.recall, precision: score.precision, byClass: score.byClass, found: score.found, missed: score.missed, decoysFlagged: score.decoysFlagged, emergent: score.emergent, matches: score.matches, unmatched: score.unmatched, predictions: score.predictions }, null, 1)}` : '',
    `# Per-persona reports and settings\n${JSON.stringify(perPersona, null, 1)}`,
    `# Question\n${question}`,
  ];
  return parts.filter(Boolean).join('\n\n');
}

const slimCluster = (c) => ({
  id: c.id, title: c.title, severity: c.severity, category: c.category, room: c.room, ledgerId: c.ledgerId,
  attribution: c.attribution, attributionRule: c.attributionEvidence?.rule, capabilityGap: c.attributionEvidence?.capabilityGap,
  stalled: c.attributionEvidence?.stalled?.map((s) => s.persona), reporters: c.reporters, verified: c.verified, verificationNote: c.verificationNote, description: c.description,
});

export async function ask(run, question, opts = {}) {
  const prompt = buildPrompt(run, question);
  const { text, usd } = await runCodex({ prompt, cwd: run.dir, effort: opts.effort ?? 'medium', log: opts.log });
  return { answer: text.trim(), usd, promptChars: prompt.length };
}
