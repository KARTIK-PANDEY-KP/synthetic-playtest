// Playwright smoke test against the mock orchestrator, at the demo resolution (1280×720).
//
//   node mock/server.mjs &  next dev &  node e2e/smoke.mjs
//   DASHBOARD_URL=http://localhost:3100 ORCH_URL=http://localhost:4100 node e2e/smoke.mjs
//
// Launches a 4-persona run from the UI, verifies MJPEG panes actually render (naturalWidth > 0),
// opens an expanded pane with a streaming reasoning log, checks the persona form, the report
// page, an analyst answer, and a 9-persona grid. Screenshots land in e2e/shots/.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, "shots");
const DASH = process.env.DASHBOARD_URL ?? "http://localhost:3000";
const ORCH = process.env.ORCH_URL ?? "http://localhost:4000";
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const shot = async (page, name) => {
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`      shot → e2e/shots/${name}.png`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

try {
  // ── Warm-up: compile every route once (next dev compiles lazily; a chunk served mid-compile
  //    can throw "Invalid or unexpected token"). No-op against `next start`.
  for (const p of ["/", "/personas", "/runs", "/runs/run_demo", "/runs/run_demo/report", "/runs/run_demo/analyst"]) {
    await page.goto(`${DASH}${p}`, { waitUntil: "networkidle", timeout: 90_000 });
  }
  consoleErrors.length = 0;

  // ── Fleet launcher ────────────────────────────────────────────────────────
  await page.goto(`${DASH}/`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Maya Chen", { timeout: 30_000 });
  await shot(page, "01-launcher");
  const chips = await page.locator("aside span:has(> span[title])").count();
  check("launcher shows a default 4-persona selection", chips === 4, `${chips} chips`);

  // ── Launch a 4-persona run ────────────────────────────────────────────────
  await page.getByRole("button", { name: /Launch 4 agents/ }).click();
  await page.waitForURL(/\/runs\/run_/, { timeout: 20_000 });
  const runId = page.url().split("/runs/")[1];
  check("launch navigated to a run page", /^run_/.test(runId), runId);
  await page.waitForSelector("[data-pane]", { timeout: 20_000 });
  const paneCount = await page.locator("[data-pane]").count();
  check("grid has 4 panes", paneCount === 4, `${paneCount}`);
  const cols = await page.locator("[data-grid-cols]").getAttribute("data-grid-cols");
  check("4 panes lay out as 2×2", cols === "2", `cols=${cols}`);

  // wait for everyone to be playing and MJPEG frames to land
  await page.waitForFunction(() => document.querySelectorAll('[data-pane][data-status="playing"]').length >= 3, null, { timeout: 40_000 });
  await page.waitForFunction(() => [...document.querySelectorAll("img[data-live]")].filter((i) => i.naturalWidth > 0).length >= 4, null, { timeout: 30_000 });
  const rendered = await page.evaluate(() => [...document.querySelectorAll("img[data-live]")].map((i) => i.naturalWidth));
  check("all 4 MJPEG images render (naturalWidth > 0)", rendered.length === 4 && rendered.every((w) => w > 0), rendered.join(","));
  // one line of reasoning visible
  await page.waitForFunction(() => [...document.querySelectorAll("[data-pane] .subtitle")].some((el) => el.textContent && el.textContent.length > 20), null, { timeout: 30_000 });
  const subs = await page.evaluate(() => [...document.querySelectorAll("[data-pane] .subtitle")].map((el) => el.textContent.trim()));
  check("panes show one line of reasoning", subs.filter((s) => s.length > 20).length >= 2, subs[0]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth || document.documentElement.scrollHeight > window.innerHeight + 2);
  check("grid page has no scrollbars at 1280×720", !overflow);
  // top bar readouts
  const cost = await page.locator("header").textContent();
  check("top bar shows cost + tpm headroom", /cost/.test(cost) && /tpm headroom/.test(cost));
  await page.waitForTimeout(2500);
  await shot(page, "02-grid-4-playing");

  // ── Expanded pane ─────────────────────────────────────────────────────────
  await page.locator("[data-pane]").first().click();
  await page.waitForSelector("[data-expanded]", { timeout: 10_000 });
  await page.waitForFunction(() => document.querySelectorAll("[data-stream] li").length >= 8, null, { timeout: 30_000 });
  const streamRows = await page.locator("[data-stream] li").count();
  check("expanded view streams reasoning/actions via SSE", streamRows >= 8, `${streamRows} rows`);
  await page.waitForFunction(() => document.querySelectorAll("[data-frames] img").length >= 1, null, { timeout: 20_000 });
  await page.waitForFunction(() => [...document.querySelectorAll("[data-frames] img")].some((i) => i.naturalWidth > 0), null, { timeout: 20_000 });
  const thumbs = await page.locator("[data-frames] img").count();
  check("expanded view shows frames the agent saw", thumbs >= 1, `${thumbs} thumbnails`);
  await page.waitForTimeout(1500);
  await shot(page, "03-expanded-pane");
  await page.keyboard.press("Escape");
  await page.waitForSelector("[data-expanded]", { state: "detached" });

  // ── Personas form ─────────────────────────────────────────────────────────
  await page.goto(`${DASH}/personas`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-persona-form]");
  await page.fill('input[name="name"]', "Lena Ortiz");
  await page.fill('textarea[name="bio"]', "Colour-blind UX researcher who plays with a controller on a couch three metres from the TV. Small text is invisible to her and she says so.");
  await page.fill('input[name="goal"]', "Finish without squinting.");
  await page.getByRole("button", { name: "skim", exact: true }).click();
  await page.getByRole("button", { name: "off", exact: true }).click();
  const preview = await page.locator("[data-preview]").textContent();
  check("enforcement preview reacts to sliders", /12 words/.test(preview) && /listen tool will not exist/.test(preview));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400); // let segmented-control transitions settle
  await shot(page, "04-persona-form");
  await page.getByRole("button", { name: "Create persona" }).click();
  await page.waitForSelector("[data-toast]", { timeout: 10_000 });
  const listed = await page.locator("[data-persona-list]").textContent();
  check("POST /api/personas creates a persona that appears in the roster", /Lena Ortiz/.test(listed));

  // ── Report page (pre-seeded finished demo run) ────────────────────────────
  await page.goto(`${DASH}/runs/run_demo/report`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-scorecard]", { timeout: 60_000 });
  const findings = await page.locator("[data-finding]").count();
  check("report renders clustered findings", findings >= 10, `${findings} cards`);
  const headline = await page.locator("[data-headline]").textContent();
  check("report shows recall / precision", /recall/.test(headline) && /precision/.test(headline));
  await page.waitForFunction(() => document.querySelectorAll("[data-experience] p.italic").length >= 4, null, { timeout: 20_000 });
  await page.waitForFunction(() => [...document.querySelectorAll("[data-finding] img")].filter((i) => i.complete && i.naturalWidth > 0).length >= 3, null, { timeout: 20_000 });
  await page.waitForTimeout(600);
  await shot(page, "05-report-top");
  await page.locator("[data-section='02']").scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot(page, "06-report-findings");
  await page.locator("[data-section='04']").scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot(page, "07-report-disagreement");
  await page.locator("[data-section='03']").scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot(page, "08-report-experience");

  // ── Analyst ───────────────────────────────────────────────────────────────
  await page.goto(`${DASH}/runs/run_demo/analyst`, { waitUntil: "networkidle" });
  await page.locator("[data-preset='1']").click();
  await page.waitForSelector("[data-answer] h2", { timeout: 15_000 });
  const answer = await page.locator("[data-answer]").first().textContent();
  check("analyst preset returns rendered markdown", /tutorial/i.test(answer) && answer.length > 300);
  await page.waitForTimeout(300);
  await shot(page, "09-analyst-answer");

  // ── Runs list ─────────────────────────────────────────────────────────────
  await page.goto(`${DASH}/runs`, { waitUntil: "networkidle" });
  await page.waitForSelector("table");
  const rows = await page.locator("tbody tr").count();
  check("runs list shows runs", rows >= 2, `${rows} rows`);
  await shot(page, "10-runs-list");

  // ── 9-persona run ─────────────────────────────────────────────────────────
  const res = await fetch(`${ORCH}/api/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ personas: ["maya", "robert", "sam", "priya", "dana", "maya", "sam", "dana", "robert"], seed: 11, backend: "modal" }) });
  const { runId: run9 } = await res.json();
  await page.goto(`${DASH}/runs/${run9}`, { waitUntil: "domcontentloaded" }); // MJPEG never goes idle
  await page.waitForFunction(() => document.querySelectorAll("[data-pane]").length === 9, null, { timeout: 20_000 });
  const cols9 = await page.locator("[data-grid-cols]").getAttribute("data-grid-cols");
  check("9 panes lay out as 3×3", cols9 === "3", `cols=${cols9}`);
  await page.waitForFunction(() => [...document.querySelectorAll("img[data-live]")].filter((i) => i.naturalWidth > 0).length >= 9, null, { timeout: 40_000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-pane][data-status="playing"]').length >= 6, null, { timeout: 40_000 });
  const overflow9 = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth || document.documentElement.scrollHeight > window.innerHeight + 2);
  check("9-pane grid fits 1280×720 without scrolling", !overflow9);
  const paneBox = await page.locator("[data-pane]").first().boundingBox();
  check("9-pane panes are a usable size", paneBox && paneBox.width > 380 && paneBox.height > 180, paneBox ? `${Math.round(paneBox.width)}×${Math.round(paneBox.height)}` : "none");
  await page.waitForTimeout(3000);
  await shot(page, "11-grid-9-playing");

  // ── Reports landing at different times flip panes ─────────────────────────
  await page.goto(`${DASH}/runs/${runId}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll('[data-pane][data-status="done"]').length >= 1, null, { timeout: 90_000 });
  const statuses = await page.evaluate(() => [...document.querySelectorAll("[data-pane]")].map((p) => p.getAttribute("data-status")));
  check("some panes flipped to 'report ready' while others still play", statuses.includes("done") && statuses.some((s) => s !== "done"), statuses.join(","));
  const band = await page.locator("[data-pane] a:has-text('report ready')").count();
  check("report-ready band links to the report", band >= 1, `${band}`);
  await page.waitForTimeout(800);
  await shot(page, "12-grid-mixed-reports-landing");

  // ── Pending analysis state while running, then done ───────────────────────
  await page.goto(`${DASH}/runs/${runId}/report`, { waitUntil: "networkidle" });
  const pendingOrDone = await page.locator("h1").first().textContent();
  check("report page handles pending analysis", /Analysis pending|injected flaws/.test(pendingOrDone), pendingOrDone.trim().slice(0, 40));
} catch (e) {
  check("smoke completed without exceptions", false, String(e.message ?? e));
  await shot(page, "99-failure");
} finally {
  const uniqErrors = [...new Set(consoleErrors)].filter((e) => !/favicon|ERR_INCOMPLETE_CHUNKED|net::ERR_ABORTED|status of 409/.test(e) /* 409 = analysis pending, expected */);
  check("no console/page errors", uniqErrors.length === 0, uniqErrors.slice(0, 3).join(" | "));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
