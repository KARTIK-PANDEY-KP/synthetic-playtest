#!/usr/bin/env node
/**
 * In-sandbox probe: prove Playwright Chromium can render the game and that
 * window.__telemetry is present. Tries a bare `chromium.launch()` first (what
 * driver.js does), then falls back to --no-sandbox (needed when running as root).
 *
 *   node infra/modal/probe-screenshot.mjs <out.png> [gameUrl]
 */
import { chromium } from 'playwright';

const out = process.argv[2] ?? '/out/probe.png';
const gameUrl = process.argv[3] ?? 'http://127.0.0.1:5273/';
const t0 = Date.now();

let browser, launch = 'bare';
try { browser = await chromium.launch(); }
catch (err) {
  launch = `--no-sandbox (bare launch failed: ${String(err.message).split('\n')[0].slice(0, 120)})`;
  browser = await chromium.launch({ args: ['--no-sandbox'] });
}
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${gameUrl}?seed=7`, { waitUntil: 'load', timeout: 30_000 });
await page.waitForFunction(() => !!window.__telemetry, null, { timeout: 15_000 });
await page.waitForTimeout(500);
const snapshot = await page.evaluate(() => window.__telemetry.snapshot());
await page.screenshot({ path: out, type: 'png' });
await browser.close();
console.log(JSON.stringify({ ok: true, launch, ms: Date.now() - t0, room: snapshot.room, objective: snapshot.objective, out }));
