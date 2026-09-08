#!/usr/bin/env node
/** Orchestrator entrypoint — port 4000. See apps/orchestrator/README.md. */
import { createServer } from 'node:http';
import { ROOT, config } from './config.mjs';
import { PersonaRegistry } from './personas.mjs';
import { ensureGameServer } from './game-server.mjs';
import { Governor } from './governor.mjs';
import { RunManager } from './runs.mjs';
import { createApi } from './api.mjs';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

log(`orchestrator: root ${ROOT}`);
const registry = new PersonaRegistry(config.personasDir, log);
const game = await ensureGameServer({ dist: config.gameDist, port: config.gamePort, log }).catch((err) => { log(`game: could not serve on :${config.gamePort}: ${err.message}`); return null; });
const governor = new Governor(config, log);
const runs = new RunManager({ cfg: config, root: ROOT, registry, governor, log });
const { app, attachWs } = createApi({ cfg: config, root: ROOT, registry, runs, governor, log });

const server = createServer(app);
attachWs(server);
server.listen(config.port, () => {
  log(`orchestrator: http://127.0.0.1:${config.port}  (ws://127.0.0.1:${config.port}/ws)`);
  log(`orchestrator: runner = ${config.runnerCmd}${config.runnerPauseSignals ? ' (pause signals on)' : ''}${config.runnerMaxSteps ? ` max-steps ${config.runnerMaxSteps}` : ''}`);
  log(`orchestrator: governor tpm=${config.tpmLimit} rpm=${config.rpmLimit} headroom>=${config.headroomMin} stagger=${config.startStaggerMs}ms budget±${config.budgetStagger * 100}%`);
});

let shuttingDown = false;
async function shutdown(sig) {
  if (shuttingDown) return; shuttingDown = true;
  log(`orchestrator: ${sig} — stopping runs and exiting`);
  runs.stopAll();
  governor.close();
  server.close();
  game?.server?.close();
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => log(`orchestrator: uncaught ${err.stack ?? err}`));
process.on('unhandledRejection', (err) => log(`orchestrator: unhandled ${err?.stack ?? err}`));
