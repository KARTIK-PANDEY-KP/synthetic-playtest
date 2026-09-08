/**
 * Verifies the game contract and persona enforcement against a real browser.
 * Fails loudly — this is the fixture the platform is built on.
 */
import { GameDriver } from './driver.js';
import { serveGame } from './serve.mjs';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';


const { server, url } = await serveGame();

const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? ' ok ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const persona = JSON.parse(readFileSync(new URL('./personas/maya.json', import.meta.url)));
const driver = new GameDriver({ gameUrl: url, persona, frameDir: '/tmp/sp-smoke', seed: 7 });
await driver.start();

// 1. contract present
const state = await driver.state();
check('window.__telemetry exposes snapshot()', state?.room === 'airlock', `room=${state?.room}`);

// 2. text regions are discoverable for redaction
const regions = await driver.page.evaluate(() => window.__telemetry.textRegions());
const tutorial = regions.find((r) => r.kind === 'tutorial');
check('textRegions() reports the tutorial box', !!tutorial, tutorial ? `${tutorial.words} words at ${tutorial.w}x${tutorial.h}` : 'missing');

// 3. redaction physically alters the pixels for a skim persona
const before = await driver.page.screenshot({ type: 'png' });
const redactedPath = await driver.screenshot();
const rawStats = await sharp(before).extract({ left: tutorial.x, top: tutorial.y, width: tutorial.w, height: tutorial.h }).stats();
const redStats = await sharp(redactedPath).extract({ left: tutorial.x, top: tutorial.y, width: tutorial.w, height: tutorial.h }).stats();
const sharpness = (s) => s.channels[0].stdev;
check('skim persona: tutorial text is blurred OUT OF THE PIXELS',
  sharpness(redStats) < sharpness(rawStats) * 0.8,
  `stdev ${sharpness(rawStats).toFixed(1)} -> ${sharpness(redStats).toFixed(1)}`);

// 4. C1 fires — tutorial self-destructs and can never be re-read
await driver.page.waitForTimeout(3800);
check('flaw C1 fires (tutorial auto-dismissed)', driver.events.some((e) => e.type === 'flaw_triggered' && e.flawId === 'C1'));
const after = await driver.page.evaluate(() => window.__telemetry.textRegions());
check('C1 is unrecoverable: tutorial gone from the DOM', !after.some((r) => r.kind === 'tutorial'));

// 5. movement works and rooms transition
await driver.move('forward', 2600);
check('WASD movement drives the character', driver.events.some((e) => e.type === 'position'));
check('room transition fires on entering the corridor',
  driver.events.some((e) => e.type === 'room_entered' && e.room === 'corridor'),
  (await driver.state()).room);

// 6. arrow-key look works WITHOUT pointer lock
const yawBefore = [...driver.events].reverse().find((e) => e.type === 'position')?.yaw;
await driver.look('left', 700);
await driver.page.waitForTimeout(700);
const yawAfter = [...driver.events].reverse().find((e) => e.type === 'position')?.yaw;
check('arrow-key look works without pointer lock', yawBefore !== yawAfter, `${yawBefore} -> ${yawAfter}`);

// 7. the audio gate is real, not advisory
const dana = JSON.parse(readFileSync(new URL('./personas/dana.json', import.meta.url)));
let denied = false;
try { await new GameDriver({ gameUrl: url, persona: dana, frameDir: '/tmp/x' }).listen(); } catch { denied = true; }
check('audio:off persona is structurally denied listen()', denied);

// 8. stall detection resets on real progress.
// The invariant is the RESET, not the absolute count: steps taken after the last
// progress event are supposed to accumulate. That is what drives the patience gate.
driver.stallSteps = 99;
await driver.move('back', 2600);            // back through the doorway into the airlock
await driver.page.waitForTimeout(300);
check('stall counter resets when real progress happens',
  driver.stallSteps < 99,
  `99 -> ${driver.stallSteps} after re-entering the airlock`);

// 9. patience is a real gate, not advice
driver.stallSteps = 999;
check('patience gate trips once the persona is genuinely stuck', driver.frustrated,
  `patience=${persona.enforcement.patience}`);

await driver.stop();
server.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
