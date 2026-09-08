#!/usr/bin/env node
/** Regenerates fixtures/run-fixture/analysis/ end to end (cluster → verify against the mock
 *  replay page → score → report --html) so the committed fixture ships as a complete example. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { serveMock } from './mock-game/serve.mjs';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const CLI = join(HERE, '..', 'cli.mjs'), RUN = join(HERE, 'run-fixture'), LEDGER = join(HERE, 'ledger.json');
const { server, url } = await serveMock();
try {
  // score before verify here: once a cluster carries its ledgerId, verify checks THAT flaw's own
  // signal first instead of whatever else fired nearby. (The orchestrator's contract order
  // cluster → verify → score also works; test.mjs exercises that order.)
  for (const args of [['cluster', '--run', RUN], ['score', '--run', RUN, '--ledger', LEDGER], ['verify', '--run', RUN, '--game-url', url], ['report', '--run', RUN, '--html']]) {
    // async spawn: this process hosts the mock server, so the event loop must stay free
    const code = await new Promise((resolve) => spawn(process.execPath, [CLI, ...args], { stdio: 'inherit' }).on('close', resolve));
    if (code !== 0) process.exit(code ?? 1);
  }
} finally { server.close(); }
