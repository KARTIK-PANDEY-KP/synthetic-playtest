// Renders fake "Station Kepler" frames with sharp: a first-person corridor scene that
// drifts with time, a HUD, and per-room props. `liveJpeg` is the human view (MJPEG);
// `agentPng` is what the agent saw, with text regions blurred per reading level.
import sharp from "sharp";
import { TEXT_REGIONS, OBJECTIVES, READING_WORD_LIMIT } from "./story.mjs";

const W = 960, H = 540;

const ROOM_THEME = {
  Airlock:    { wall: "#1b2a3a", wall2: "#0e1822", floor: "#0a1219", accent: "#63c7ff", glow: "#2f7fb8" },
  Corridor:   { wall: "#24262c", wall2: "#141519", floor: "#0c0d10", accent: "#ffb020", glow: "#7a5410" },
  Power:      { wall: "#2b1f1c", wall2: "#160f0e", floor: "#0d0908", accent: "#ff7b3a", glow: "#8a3a17" },
  Lab:        { wall: "#1c2b2a", wall2: "#0f1817", floor: "#090f0f", accent: "#7ee787", glow: "#2b6b3a" },
  Greenhouse: { wall: "#1d2a17", wall2: "#0f160c", floor: "#0a0d07", accent: "#b6e35a", glow: "#3f6a1a" },
  Reactor:    { wall: "#2c1a26", wall2: "#170d14", floor: "#0d080c", accent: "#ff5d7a", glow: "#8a1f3a" },
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Draw the corridor perspective + room props for a given phase (0..1) */
function scene(room, phase, opts) {
  const th = ROOM_THEME[room] ?? ROOM_THEME.Corridor;
  const vx = W / 2 + Math.sin(phase * Math.PI * 2) * 40; // vanishing point drifts (look)
  const vy = H / 2 + 10 + Math.cos(phase * Math.PI * 2) * 8;
  const parts = [];

  // sky/ceiling + floor + walls
  parts.push(`<rect width="${W}" height="${H}" fill="${th.wall2}"/>`);
  parts.push(`<polygon points="0,${H} ${W},${H} ${vx},${vy}" fill="${th.floor}"/>`);
  parts.push(`<polygon points="0,0 ${W},0 ${vx},${vy}" fill="${th.wall2}"/>`);
  parts.push(`<polygon points="0,0 0,${H} ${vx},${vy}" fill="${th.wall}"/>`);
  parts.push(`<polygon points="${W},0 ${W},${H} ${vx},${vy}" fill="${th.wall}"/>`);

  // moving wall light strips (forward motion)
  for (let i = 0; i < 7; i++) {
    const t = ((i / 7) + phase * 0.6) % 1;           // 0 = far, 1 = near
    const k = Math.pow(t, 2.2);
    const x1 = vx + (0 - vx) * k, x2 = vx + (W - vx) * k;
    const y = vy + (H * 0.34 - vy) * k;
    const op = 0.15 + k * 0.5;
    parts.push(`<line x1="${x1.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x1 + 6 + 40 * k).toFixed(1)}" y2="${(y + 60 * k + 10).toFixed(1)}" stroke="${th.accent}" stroke-opacity="${op.toFixed(2)}" stroke-width="${(2 + 6 * k).toFixed(1)}"/>`);
    parts.push(`<line x1="${x2.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x2 - 6 - 40 * k).toFixed(1)}" y2="${(y + 60 * k + 10).toFixed(1)}" stroke="${th.accent}" stroke-opacity="${op.toFixed(2)}" stroke-width="${(2 + 6 * k).toFixed(1)}"/>`);
    // floor seams
    const fy = vy + (H - vy) * k;
    parts.push(`<line x1="${(vx + (0 - vx) * k).toFixed(1)}" y1="${fy.toFixed(1)}" x2="${(vx + (W - vx) * k).toFixed(1)}" y2="${fy.toFixed(1)}" stroke="#ffffff" stroke-opacity="${(0.04 + 0.08 * k).toFixed(2)}" stroke-width="1.5"/>`);
  }

  // far door with glow
  const dw = 120, dh = 170;
  parts.push(`<rect x="${vx - dw / 2}" y="${vy - dh / 2 - 10}" width="${dw}" height="${dh}" rx="6" fill="#05070a" stroke="${th.accent}" stroke-width="3"/>`);
  parts.push(`<rect x="${vx - dw / 2 + 12}" y="${vy - dh / 2 + 2}" width="${dw - 24}" height="${dh - 24}" rx="3" fill="${th.glow}" fill-opacity="0.55"/>`);
  parts.push(`<rect x="${vx - 6}" y="${vy - dh / 2 - 10}" width="12" height="${dh}" fill="#05070a"/>`);

  // room props
  if (room === "Corridor") {
    // vent + crate + speaker
    parts.push(`<rect x="600" y="290" width="150" height="90" rx="4" fill="#0b0c0f" stroke="#454a55" stroke-width="4"/>`);
    for (let i = 0; i < 4; i++) parts.push(`<rect x="612" y="${304 + i * 18}" width="126" height="7" fill="#2a2e36"/>`);
    parts.push(`<rect x="470" y="330" width="120" height="110" fill="#3a3326" stroke="#5a4f3a" stroke-width="3"/>`);
    const pulse = 0.4 + 0.6 * Math.abs(Math.sin(phase * Math.PI * 6));
    parts.push(`<circle cx="790" cy="220" r="${(10 + pulse * 6).toFixed(1)}" fill="${th.accent}" fill-opacity="${pulse.toFixed(2)}"/>`);
    parts.push(`<circle cx="790" cy="220" r="5" fill="#fff"/>`);
    // locked door left
    parts.push(`<rect x="110" y="170" width="120" height="240" fill="#101216" stroke="#ff5d5d" stroke-width="3"/>`);
    parts.push(`<rect x="150" y="270" width="40" height="18" fill="#ff5d5d"/>`);
  }
  if (room === "Power") {
    parts.push(`<rect x="120" y="180" width="200" height="240" rx="6" fill="#151010" stroke="#5a3a2a" stroke-width="3"/>`);
    for (let i = 0; i < 6; i++) parts.push(`<rect x="${140 + (i % 3) * 56}" y="${200 + Math.floor(i / 3) * 90}" width="44" height="70" fill="${i === 3 ? th.accent : "#2a1c17"}"/>`);
    parts.push(`<rect x="560" y="110" width="340" height="150" rx="4" fill="#0a0d0f" fill-opacity="0.85" stroke="#334" stroke-width="1"/>`);
  }
  if (room === "Lab") {
    parts.push(`<rect x="330" y="150" width="300" height="200" rx="6" fill="#06110f" stroke="${th.accent}" stroke-width="3"/>`);
    parts.push(`<rect x="300" y="350" width="360" height="30" fill="#1a2422"/>`);
  }
  if (room === "Greenhouse") {
    for (let i = 0; i < 6; i++) {
      const x = 80 + i * 145, y = 330 + (i % 2) * 20;
      parts.push(`<rect x="${x}" y="${y}" width="110" height="80" rx="6" fill="#2a2418" stroke="#4a3f2a" stroke-width="2"/>`);
      parts.push(`<ellipse cx="${x + 55}" cy="${y - 10}" rx="42" ry="24" fill="#3f8a2e" fill-opacity="0.9"/>`);
    }
    parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#000" fill-opacity="0.18"/>`);
  }
  if (room === "Reactor") {
    const spin = phase * 360;
    parts.push(`<g transform="translate(${vx} ${vy - 20}) rotate(${spin.toFixed(1)})"><circle r="70" fill="none" stroke="${th.accent}" stroke-width="10" stroke-dasharray="40 30"/><circle r="40" fill="${th.glow}" fill-opacity="0.8"/></g>`);
    parts.push(`<rect x="380" y="270" width="200" height="50" rx="6" fill="#20151b" stroke="${th.accent}" stroke-width="2"/>`);
  }
  if (room === "Airlock") {
    parts.push(`<rect x="60" y="200" width="90" height="220" rx="8" fill="#0c1a26" stroke="${th.accent}" stroke-width="3"/>`);
    parts.push(`<circle cx="105" cy="260" r="16" fill="${th.accent}" fill-opacity="${(0.5 + 0.5 * Math.abs(Math.sin(phase * 8))).toFixed(2)}"/>`);
  }

  // vignette
  parts.push(`<rect width="${W}" height="${H}" fill="url(#vg)"/>`);

  // crosshair
  parts.push(`<g stroke="#ffffff" stroke-opacity="0.8" stroke-width="2"><line x1="${W / 2 - 12}" y1="${H / 2}" x2="${W / 2 - 4}" y2="${H / 2}"/><line x1="${W / 2 + 4}" y1="${H / 2}" x2="${W / 2 + 12}" y2="${H / 2}"/><line x1="${W / 2}" y1="${H / 2 - 12}" x2="${W / 2}" y2="${H / 2 - 4}"/><line x1="${W / 2}" y1="${H / 2 + 4}" x2="${W / 2}" y2="${H / 2 + 12}"/></g>`);

  // inventory slots bottom-left
  for (let i = 0; i < 4; i++) {
    parts.push(`<rect x="${24 + i * 46}" y="${H - 64}" width="40" height="40" rx="4" fill="#000" fill-opacity="0.45" stroke="${i === (opts.slot ?? 0) ? th.accent : "#444"}" stroke-width="2"/>`);
  }
  return parts.join("");
}

function textRegionsSvg(room, blurWordsOver) {
  const regs = TEXT_REGIONS[room] ?? [];
  const out = [];
  for (const r of regs) {
    const blur = r.words > blurWordsOver;
    const fs = r.kind === "hud" ? 22 : r.kind === "tutorial" ? 24 : 20;
    const box = `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="4" fill="#000" fill-opacity="${r.kind === "hud" ? 0.35 : 0.72}" stroke="${r.kind === "tutorial" ? "#63c7ff" : "none"}" stroke-width="2"/>`;
    const lines = r.lines.map((ln, i) => `<text x="${r.x + 14}" y="${r.y + 30 + i * (fs + 8)}" font-family="Helvetica, Arial, sans-serif" font-size="${fs}" fill="${r.kind === "hud" ? "#ffb020" : "#e8edf2"}" font-weight="${r.kind === "hud" ? 700 : 400}">${esc(ln)}</text>`).join("");
    if (blur) out.push(`${box}<g filter="url(#blur)">${lines}</g><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="none" stroke="#ff5d5d" stroke-opacity="0.9" stroke-width="2" stroke-dasharray="6 4"/>`);
    else out.push(`${box}${lines}`);
  }
  return out.join("");
}

function overlay(persona, step, room, live) {
  const label = live ? "LIVE" : `FRAME ${String(step).padStart(5, "0")}`;
  const text = `${label}  ·  ${persona}  ·  step ${step}`;
  const bw = Math.min(W - 48, text.length * 11.5 + 60);
  return `
    <rect x="${W - 24 - bw}" y="${H - 58}" width="${bw}" height="38" rx="6" fill="#000" fill-opacity="0.55"/>
    <circle cx="${W - 24 - bw + 18}" cy="${H - 39}" r="6" fill="${live ? "#ff3b3b" : "#8b93a0"}"/>
    <text x="${W - 40}" y="${H - 31}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="700" fill="#fff">${esc(text)}</text>
    <text x="${W - 24}" y="${H - 8}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="12" fill="#8b93a0">${esc(room)} · mock feed</text>`;
}

function svgDoc(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="vg" cx="50%" cy="50%" r="75%"><stop offset="55%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.75"/></radialGradient>
    <filter id="blur" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="7"/></filter>
  </defs>${body}</svg>`;
}

/** Human view. No redaction, small JPEG. */
export async function liveJpeg({ personaName, step, room, t, width = 480 }) {
  const phase = ((t / 1000) % 6) / 6;
  const body = scene(room, phase, { slot: step % 4 }) + textRegionsSvg(room, Infinity) + overlay(personaName, step, room, true);
  return sharp(Buffer.from(svgDoc(body))).resize(width).jpeg({ quality: 72, mozjpeg: false }).toBuffer();
}

/** What the agent saw: PNG, text blurred according to reading level. */
export async function agentPng({ personaName, step, room, reading }) {
  const limit = READING_WORD_LIMIT[reading] ?? Infinity;
  const phase = (step % 7) / 7;
  const body = scene(room, phase, { slot: step % 4 }) + textRegionsSvg(room, limit) + overlay(personaName, step, room, false);
  return sharp(Buffer.from(svgDoc(body))).png({ compressionLevel: 6 }).toBuffer();
}

export const objectiveFor = (room) => OBJECTIVES[room] ?? "";
