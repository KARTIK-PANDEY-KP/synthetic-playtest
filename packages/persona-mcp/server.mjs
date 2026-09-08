/**
 * The MCP stdio server Codex talks to. Registered as MCP server `game`.
 *
 * Two modes, one code path for the tools themselves:
 *   - RUNNER_CONTROL_URL set   → thin shim: every tool call is forwarded to the
 *     runner's GameSession over loopback HTTP. This is how runs work. Codex owns
 *     this process's lifetime, the runner owns the browser and the session log.
 *   - RUNNER_CONTROL_URL unset → standalone: this process owns a GameSession
 *     itself (GAME_URL, SEED, RUN_DIR). Useful for tests and one-off debugging.
 *
 * Either way `screenshot` returns TEXT containing a file path — never an image
 * block; Codex drops those (see docs/SPIKE-01-codex-vision.md).
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'node:fs';
import { toolDefinitions } from './tools.mjs';

const env = (k, dflt) => process.env[k] ?? dflt;
const PERSONA_CONFIG = env('PERSONA_CONFIG');
if (!PERSONA_CONFIG) { console.error('server.mjs: PERSONA_CONFIG is required'); process.exit(2); }
const persona = JSON.parse(readFileSync(PERSONA_CONFIG, 'utf8'));
const tools = toolDefinitions(persona);
const known = new Set(tools.map((t) => t.name));

const backend = process.env.RUNNER_CONTROL_URL ? remote(process.env.RUNNER_CONTROL_URL) : standalone();

function remote(url) {
  return {
    async call(name, args) {
      const res = await fetch(`${url}/call`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, args }),
      });
      return res.json();
    },
    async close() {},
  };
}

function standalone() {
  let sessionP = null;
  const get = () => (sessionP ??= import('./session.mjs').then(({ GameSession }) => GameSession.create({
    persona, gameUrl: env('GAME_URL', 'http://127.0.0.1:5273/'), seed: env('SEED', '1'), runDir: env('RUN_DIR', process.cwd()),
  })));
  return {
    call: async (name, args) => (await get()).call(name, args),
    close: async () => { if (sessionP) await (await sessionP).close(); },
  };
}

const server = new Server({ name: 'game', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  if (!known.has(name)) return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  try {
    const { text, isError } = await backend.call(name, args ?? {});
    return { isError: !!isError, content: [{ type: 'text', text: String(text) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: `The game did not respond: ${err.message}` }] };
  }
});

const transport = new StdioServerTransport();
transport.onclose = async () => { await backend.close(); process.exit(0); };
await server.connect(transport);
