import type { PersonaConfig } from "./contract";

const READ_LIMIT = { skim: 12, normal: 40, thorough: Infinity } as const;
const STEP_COST = 0.117; // measured in Spike 01, $ per step

/** What the harness will physically do to this persona. Changes with every slider. */
export function describeEnforcement(p: PersonaConfig): string[] {
  const e = p.enforcement;
  const name = p.name?.trim().split(/\s+/)[0] || "This tester";
  const out: string[] = [];

  if (e.reading === "skim") out.push(`Any on-screen text region longer than ${READ_LIMIT.skim} words is blurred out of ${name}'s screenshots in pixels — a HUD label survives, a tutorial panel does not.`);
  else if (e.reading === "normal") out.push(`Text regions over ${READ_LIMIT.normal} words are blurred in ${name}'s screenshots; tutorials and labels survive, long logs do not.`);
  else out.push(`Nothing is redacted: every word on screen reaches ${name}, and the briefing rewards reading all of it.`);

  if (e.genre_familiarity === "none") out.push(`The briefing and the tool descriptions never mention WASD, E, or Ctrl. If the game does not teach crouch, ${name} cannot crouch.`);
  else if (e.genre_familiarity === "medium") out.push(`Basic movement conventions are mentioned once in the briefing; nothing genre-specific (no hold-to-interact, no vents).`);
  else out.push(`Full immersive-sim conventions are in the briefing and tool hints — crouch, hold-to-interact, vents, sequence breaks.`);

  out.push(`After ${e.patience} consecutive steps with no ground-truth progress (measured from telemetry, not self-report) the harness escalates frustration in the tool results; at ${e.patience * 2} it forces abandon().`);

  if (e.audio === "off") out.push(`The listen tool will not exist. Audio-only cues are genuinely inaudible — not discouraged, absent.`);
  else out.push(`listen() returns the transcript of audio cues fired since the last call.`);

  if (e.exploration === "high") out.push(`The briefing's success criterion rewards seeing every room and opening every container before moving on.`);
  else if (e.exploration === "medium") out.push(`The briefing's success criterion rewards steady progress with a look around each new room.`);
  else out.push(`The briefing's success criterion rewards reaching the end in the fewest actions; detours count against ${name}.`);

  out.push(`Hard cap of ${e.step_budget} actions — about ${(e.step_budget * STEP_COST).toFixed(0)} dollars at the measured ~$0.117 per step. Reasoning effort ${e.reasoning_effort}${e.reasoning_effort === "low" ? ", escalating to high on any step flagged as confusion" : ""}.`);
  return out;
}

export const DEFAULT_PERSONA: PersonaConfig = {
  id: "",
  name: "",
  age: 30,
  bio: "",
  goal: "",
  enforcement: {
    reading: "normal",
    genre_familiarity: "medium",
    patience: 6,
    exploration: "medium",
    audio: "on",
    step_budget: 100,
    reasoning_effort: "medium",
  },
};

export const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);

export function validatePersona(p: PersonaConfig): string[] {
  const errs: string[] = [];
  if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(p.id)) errs.push("id: lowercase letters, digits, - or _ (2–32 chars)");
  if (!p.name.trim()) errs.push("name is required");
  if (!Number.isFinite(p.age) || p.age < 5 || p.age > 110) errs.push("age must be between 5 and 110");
  if (p.bio.trim().length < 20) errs.push("bio: at least 20 characters — this is who the agent becomes");
  if (!p.goal.trim()) errs.push("goal is required");
  const e = p.enforcement;
  if (e.patience < 1 || e.patience > 15) errs.push("patience must be 1–15");
  if (e.step_budget < 10 || e.step_budget > 400) errs.push("step budget must be 10–400");
  return errs;
}
