/**
 * The tools a persona is given — names, descriptions, input schemas.
 *
 * Descriptions are part of the model's prompt prefix, so they must be a pure
 * function of the persona (prompt caching) and must respect the persona's
 * genre familiarity: a player who has never touched a PC game is not told that
 * W/A/S/D moves or that E interacts. The tools still press those keys; the
 * player simply doesn't know the convention, exactly like the real person.
 *
 * Input-level only. Nothing here describes the game world.
 */

/** Tools that count as a step against the persona's budget and patience. */
export const ACTION_TOOLS = new Set(['move', 'look', 'crouch', 'interact', 'use_item', 'open_inventory', 'type_text']);

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

export function toolDefinitions(persona) {
  const keys = persona.enforcement.genre_familiarity === 'high';
  const k = (withKeys, without) => (keys ? withKeys : without);

  const tools = [
    {
      name: 'screenshot',
      description:
        'Look at the game screen. Saves what is on screen right now to an image file and returns ' +
        'the FILE PATH — you must then open (view) that image file to actually see anything. ' +
        'Nothing about the screen is described in text. This is the only way to see the game; ' +
        'use it after your actions to see what changed.',
      inputSchema: obj(),
    },
    {
      name: 'move',
      description: k(
        'Walk in a direction (W/A/S/D) for a number of milliseconds. Roughly 600 ms is a few paces.',
        'Walk in a direction for a number of milliseconds. Roughly 600 ms is a few paces.',
      ),
      inputSchema: obj({
        direction: { type: 'string', enum: ['forward', 'back', 'left', 'right'] },
        ms: { type: 'integer', minimum: 100, maximum: 3000, default: 600, description: 'How long to keep walking.' },
      }, ['direction']),
    },
    {
      name: 'look',
      description: k(
        'Turn your view (arrow keys / mouse look) in a direction for a number of milliseconds. About 400 ms turns roughly 35 degrees.',
        'Turn your head to look in a direction for a number of milliseconds. About 400 ms turns roughly 35 degrees.',
      ),
      inputSchema: obj({
        direction: { type: 'string', enum: ['left', 'right', 'up', 'down'] },
        ms: { type: 'integer', minimum: 100, maximum: 3000, default: 400 },
      }, ['direction']),
    },
    {
      name: 'crouch',
      description: k(
        'Crouch (hold Ctrl) with on=true, or stand back up with on=false.',
        'Get down low with on=true, or stand back up with on=false.',
      ),
      inputSchema: obj({ on: { type: 'boolean' } }, ['on']),
    },
    {
      name: 'interact',
      description: k(
        'Press E: use, pick up, open, or read whatever is directly in front of you.',
        'Reach out and use, pick up, open, or read whatever is directly in front of you.',
      ),
      inputSchema: obj(),
    },
    {
      name: 'use_item',
      description: 'Try to use a named item you are carrying on whatever is directly in front of you.',
      inputSchema: obj({ name: { type: 'string', description: 'The item as you would call it.' } }, ['name']),
    },
    {
      name: 'open_inventory',
      description: k(
        'Toggle your inventory (I) to see what you are carrying. Toggle again to close it.',
        'Open or close the view of what you are carrying.',
      ),
      inputSchema: obj(),
    },
    {
      name: 'type_text',
      description: 'Type text on the keyboard, for example into a terminal or keypad you are standing at.',
      inputSchema: obj({ text: { type: 'string', maxLength: 120 } }, ['text']),
    },
  ];

  // The audio gate is structural: a persona who plays with the sound off does not
  // get a weaker listen tool, they get no listen tool. It cannot be called because
  // it does not exist.
  if (persona.enforcement.audio === 'on') {
    tools.push({
      name: 'listen',
      description: 'Tell me what I have heard since I last listened — voices, announcements, alarms — as text.',
      inputSchema: obj(),
    });
  }

  tools.push(
    {
      name: 'note_finding',
      description:
        'Speak up. Record something you would tell the developers: you are confused, bored, annoyed, ' +
        'stuck, something feels unfair, or something looks broken. Call this the moment you feel it, ' +
        'not just at the end — a session with no findings is a session where you kept quiet.',
      inputSchema: obj({
        severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        category: { type: 'string', enum: ['bug', 'confusion', 'boredom', 'unfair', 'accessibility', 'other'] },
        title: { type: 'string', description: 'One line, in your own words.' },
        description: { type: 'string', description: 'What happened, what you expected, how it felt.' },
        room: { type: 'string', description: 'Where you were, if you can tell.' },
        reproSteps: { type: 'array', items: { type: 'string' }, description: 'What you did, step by step, to end up here.' },
      }, ['severity', 'category', 'title', 'description']),
    },
    {
      name: 'abandon',
      description:
        'Put the game down for good. Call this when you would quit in real life — bored, stuck, fed up — ' +
        'or when you are told you have had enough. After this, write your final report.',
      inputSchema: obj({ reason: { type: 'string' } }, ['reason']),
    },
  );

  return tools;
}

export const toolNames = (persona) => toolDefinitions(persona).map((t) => t.name);
