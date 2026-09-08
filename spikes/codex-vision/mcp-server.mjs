// Spike MCP server: the ONLY sensory channel.
// take_screenshot returns a FILE PATH as text — never image content, never the
// fixture's actual contents. If the agent can report the secret word, it means
// Codex successfully viewed the PNG off disk. That is the whole question.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { resolve } from 'node:path';
import { appendFileSync } from 'node:fs';

const FIXTURE = resolve(process.env.SPIKE_FIXTURE ?? './fixture.png');
const TRACE = resolve('./mcp-trace.log');
const trace = (m) => appendFileSync(TRACE, `${new Date().toISOString()} ${m}\n`);

const server = new Server(
  { name: 'spike-vision', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  trace('tools/list');
  return {
    tools: [
      {
        name: 'take_screenshot',
        description:
          'Capture what is currently on screen. Writes a PNG to disk and returns its absolute path. ' +
          'You must then actually LOOK at that file to see the screen.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  trace(`tools/call ${req.params.name}`);
  if (req.params.name !== 'take_screenshot') {
    return { isError: true, content: [{ type: 'text', text: 'unknown tool' }] };
  }
  return {
    content: [
      {
        type: 'text',
        text: `Screenshot captured: ${FIXTURE}\n(900x520 PNG. Contents are not described here — view the file.)`,
      },
    ],
  };
});

await server.connect(new StdioServerTransport());
trace('connected');
