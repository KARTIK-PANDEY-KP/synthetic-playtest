/** Renders side-by-side proof that persona reading limits are enforced in pixels. */
import { GameDriver } from './driver.js';
import { serveGame } from './serve.mjs';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const { server, url } = await serveGame();

const shots = {};
for (const id of ['priya', 'maya']) {
  const persona = JSON.parse(readFileSync(new URL(`./personas/${id}.json`, import.meta.url)));
  const d = new GameDriver({ gameUrl: url, persona, frameDir: `/tmp/sp-proof-${id}`, seed: 7 });
  await d.start();
  await d.page.waitForTimeout(400);
  shots[id] = await d.screenshot();
  await d.stop();
}

const W = 1280, H = 720, PAD = 54;
const label = (text, sub) => Buffer.from(
  `<svg width="${W}" height="${PAD}"><rect width="${W}" height="${PAD}" fill="#0b0f14"/>
   <text x="18" y="26" fill="#e8eef5" font-family="system-ui" font-size="19" font-weight="600">${text}</text>
   <text x="18" y="45" fill="#7f9bb5" font-family="system-ui" font-size="14">${sub}</text></svg>`);

const panel = async (path, text, sub) => sharp({ create: { width: W, height: H + PAD, channels: 3, background: '#0b0f14' } })
  .composite([{ input: label(text, sub), top: 0, left: 0 }, { input: await sharp(path).resize(W, H).toBuffer(), top: PAD, left: 0 }])
  .png().toBuffer();

await sharp({ create: { width: W * 2 + 12, height: H + PAD, channels: 3, background: '#000' } })
  .composite([
    { input: await panel(shots.priya, 'Priya Nair — reads everything', 'enforcement.reading: thorough  ·  no redaction'), left: 0, top: 0 },
    { input: await panel(shots.maya, 'Maya Chen — skims', 'enforcement.reading: skim  ·  text over 12 words blurred out of the pixels'), left: W + 12, top: 0 },
  ])
  .png().toFile('/tmp/redaction-proof.png');

server.close();
console.log('wrote /tmp/redaction-proof.png');
