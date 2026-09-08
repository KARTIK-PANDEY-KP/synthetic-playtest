// Renders a fixture PNG whose contents cannot be guessed without actually seeing it.
// The secret is random per run, and the answer key is written OUTSIDE this directory
// so the agent under test cannot read it as text. That confound is the whole point.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SECRET = `QUILVERN-${Math.floor(1000 + Math.random() * 9000)}`;
const SHAPES = ['orange square', 'limegreen circle', 'violet triangle'];
const ANSWER_KEY = process.env.SPIKE_ANSWER_KEY ?? resolve('..', '..', '..', 'spike-answer-key.json');

const html = `<!doctype html><html><body style="margin:0;background:#0d1b2a;font-family:system-ui;
  color:#fff;width:900px;height:520px;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:28px">
  <div style="font-size:52px;letter-spacing:3px;font-weight:700">${SECRET}</div>
  <div style="display:flex;gap:48px;align-items:center">
    <div style="width:110px;height:110px;background:orange"></div>
    <div style="width:110px;height:110px;border-radius:50%;background:limegreen"></div>
    <div style="width:0;height:0;border-left:55px solid transparent;
      border-right:55px solid transparent;border-bottom:110px solid violet"></div>
  </div>
  <div style="font-size:20px;opacity:.75">left to right</div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
await page.setContent(html);
await page.screenshot({ path: 'fixture.png' });
await browser.close();

writeFileSync(ANSWER_KEY, JSON.stringify({ secret: SECRET, shapes: SHAPES }, null, 2));
console.log(`fixture.png written. Answer key (outside workspace): ${ANSWER_KEY}`);
