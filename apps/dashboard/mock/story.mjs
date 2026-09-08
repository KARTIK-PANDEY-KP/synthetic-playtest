// Scripted "playthroughs" for the mock orchestrator. Everything the dashboard renders
// during a mock run comes from here: what each persona thinks in each room, what they
// flag, how the analysis clusters it, and what the analyst says.

export const ROOMS = ["Airlock", "Corridor", "Power", "Lab", "Greenhouse", "Reactor"];

/** room boundaries as fraction of the persona's total steps */
export const ROOM_CUTS = [0.14, 0.36, 0.5, 0.64, 0.84, 1.01];

export const OBJECTIVES = {
  Airlock: "Leave the airlock",
  Corridor: "Restore power",
  Power: "Restore power",
  Lab: "Unlock the lab terminal",
  Greenhouse: "Water the crop bays",
  Reactor: "Stabilise the reactor",
};

// Text regions per room (words + box), so frames can be redacted per reading level.
export const TEXT_REGIONS = {
  Airlock: [
    { kind: "tutorial", x: 240, y: 120, w: 480, h: 130, words: 28,
      lines: ["Welcome aboard Station Kepler.", "Use the panel by the door to cycle the airlock.", "Look around; everything you need is in reach."] },
    { kind: "hud", x: 24, y: 20, w: 300, h: 34, words: 3, lines: ["OBJECTIVE  Leave the airlock"] },
  ],
  Corridor: [
    { kind: "hud", x: 24, y: 20, w: 300, h: 34, words: 2, lines: ["OBJECTIVE  Restore power"] },
    { kind: "label", x: 620, y: 250, w: 150, h: 30, words: 2, lines: ["MAINT. VENT"] },
  ],
  Power: [
    { kind: "hud", x: 24, y: 20, w: 300, h: 34, words: 2, lines: ["OBJECTIVE  Restore power"] },
    { kind: "log", x: 560, y: 110, w: 340, h: 150, words: 46,
      lines: ["MAINTENANCE LOG 14", "Coolant loop B was re-routed through", "the secondary manifold. Reactor start", "requires B-loop primed, then vent,", "then the calibration lockout released."] },
  ],
  Lab: [
    { kind: "hud", x: 24, y: 20, w: 300, h: 34, words: 4, lines: ["OBJECTIVE  Unlock the lab terminal"] },
    { kind: "menu", x: 330, y: 150, w: 300, h: 200, words: 6, lines: ["TERMINAL", "ENTER CODE", "_ _ _ _"] },
  ],
  Greenhouse: [
    { kind: "hud", x: 24, y: 20, w: 300, h: 34, words: 4, lines: ["OBJECTIVE  Water the crop bays"] },
    { kind: "label", x: 400, y: 300, w: 160, h: 30, words: 3, lines: ["BAY 07 / 12"] },
  ],
  Reactor: [
    { kind: "hud", x: 24, y: 20, w: 300, h: 34, words: 3, lines: ["OBJECTIVE  Stabilise the reactor"] },
    { kind: "hud", x: 700, y: 20, w: 236, h: 34, words: 2, lines: ["O2  00:42"] },
    { kind: "label", x: 380, y: 280, w: 200, h: 34, words: 1, lines: ["CALIBRATE"] },
  ],
};

export const READING_WORD_LIMIT = { skim: 12, normal: 40, thorough: Infinity };

const F = (id, severity, category, title, description, room, reproSteps, at) => ({
  id, severity, category, title, description, room, reproSteps, at,
});

// Per persona: reasoning lines per room (cycled), findings (with `at` = fraction of run),
// tool preferences, and the final report.
export const SCRIPTS = {
  maya: {
    totalSteps: 34,
    completed: true,
    abandonedReason: undefined,
    lines: {
      Airlock: [
        "Tutorial popped and vanished before I finished the first line. Chat, did anyone catch that?",
        "Skipping. It's a door, doors open with E.",
        "Okay the panel says something about — no, gone again. Moving on.",
      ],
      Corridor: [
        "Four doors. Picking the one with the light on, that's always the one.",
        "Crouching through the vent, classic. Where's the code though?",
        "Voice line says 'four seven one one'. Fine, that's the code.",
        "Keycard is a sliver behind a crate. Six pixels. Chat found it before I did.",
      ],
      Power: [
        "Fuse slot. Fuse goes in fuse slot. This is not hard.",
        "Why is the HUD still saying 'Restore power'? I did that.",
      ],
      Lab: ["Terminal wants a code. Typing 4711.", "That worked. Chat is asleep, need something to happen."],
      Greenhouse: [
        "Twelve plants. Watering twelve identical plants. This is dead air.",
        "Planter number nine. I hate it here.",
      ],
      Reactor: [
        "Elevator. Forty-five seconds of nothing. My viewers are leaving.",
        "Oxygen timer just appeared out of nowhere. Nobody told me about oxygen.",
        "Calibrate — no, that reset everything. Are you kidding me.",
        "Okay. Reactor's stable. Chat, we did it, barely.",
      ],
    },
    findings: [
      F("maya-f1", "high", "confusion", "Tutorial disappears before it can be read",
        "The airlock instructions auto-dismiss in about three seconds and there is no way to bring them back. I never saw what they said.",
        "Airlock", ["Start a new game", "Do nothing for 4 seconds", "Try to re-open the tutorial: no input does it"], 0.06),
      F("maya-f2", "medium", "confusion", "Keycard is nearly invisible behind a crate",
        "The required keycard is a six-pixel sliver behind a crate with no highlight or prompt. I found it by luck.",
        "Corridor", ["Enter the corridor", "Look at the crate on the left of the vent", "Notice nothing; walk around the crate"], 0.3),
      F("maya-f3", "medium", "boredom", "Forty-five second elevator with nothing to do",
        "The elevator to the reactor runs for 45s with no interaction, no text, no audio. On stream this is dead air.",
        "Reactor", ["Enter the elevator from the corridor", "Wait"], 0.86),
      F("maya-f4", "high", "unfair", "Oxygen timer starts with no warning",
        "An O2 countdown appears the moment you enter the reactor. Nothing announces it; failure restarts everything.",
        "Reactor", ["Enter the reactor", "Wait 42 seconds", "Die, restart from the airlock"], 0.93),
    ],
    report: {
      summary: "Look, it's a competent little station sim and I'd stream it again, but it kept wasting my time in ways it didn't need to. The tutorial vanished before I read it, the elevator is dead air, and then it killed me with a timer it never mentioned. Chat had a good time watching me suffer, which is not the same thing as me having a good time.",
      experience: {
        confused: ["Tutorial dismissed itself before I finished the first line", "HUD kept saying 'Restore power' after I restored it"],
        bored: ["Watering twelve identical plants", "The 45-second elevator ride"],
        unfair: ["Oxygen timer with zero warning", "'Calibrate' button reset my progress"],
        enjoyed: ["The corridor vent sequence — proper immersive-sim energy", "Reactor visuals"],
      },
      wouldRecommend: 3,
    },
  },

  robert: {
    totalSteps: 46,
    completed: true,
    lines: {
      Airlock: [
        "I'm reading the instructions carefully. It says to approach the— it's gone. I hadn't finished.",
        "Is there a way to bring the instructions back? I'll try clicking where they were.",
        "I'll look around the room slowly. I don't want to miss anything the game wants me to know.",
        "There's a panel by the door. The instructions may have mentioned it; I'll try pressing a key near it.",
      ],
      Corridor: [
        "There's a low opening here. I can't seem to fit. Perhaps I'm supposed to go elsewhere.",
        "I've walked into this vent six times now. Nothing tells me what to do.",
        "The game says 'Restore power' — I'll find the power room, that seems sensible.",
        "A voice said some numbers. I've written them down: four, seven, one, one.",
      ],
      Power: [
        "The panel doesn't respond when I press the key. Maybe I need to press it longer?",
        "Holding the key worked. Nobody explained that. I feel a bit foolish.",
        "The objective still says restore power. Have I done it wrong?",
      ],
      Lab: [
        "A terminal asking for a code. I believe the corridor voice said 4711.",
        "The inventory cursor jumped back to the first item again. I keep selecting the wrong thing.",
        "The power came on here, in the lab. But the objective said the power room. I was in the wrong place for a long time.",
      ],
      Greenhouse: [
        "Watering plants. It's calming, honestly, but I'm not sure it's teaching me anything.",
        "Twelve bays. I'll do them in order so I don't lose track.",
      ],
      Reactor: [
        "The reactor mentions a coolant loop. I read about that earlier, I think. In the power room?",
        "There's a countdown. I don't know what it's counting down to. I'll hurry.",
        "It's done. I'm not sure how much of that was me and how much was luck.",
      ],
    },
    findings: [
      F("robert-f1", "high", "confusion", "Instructions vanish before you finish reading",
        "The opening instructions closed on their own while I was still on the first sentence. I could not find any way to see them again.",
        "Airlock", ["Start the game", "Begin reading the instruction panel", "Wait — it closes by itself"], 0.05),
      F("robert-f2", "high", "confusion", "Low opening in the corridor cannot be entered",
        "There is a low opening I clearly need to go through but walking into it does nothing. No prompt tells me what to do.",
        "Corridor", ["Enter the corridor", "Walk toward the low opening labelled MAINT. VENT", "Walk into it repeatedly"], 0.24),
      F("robert-f3", "medium", "confusion", "Panel only works if you hold the key",
        "Pressing the interact key on the power panel does nothing. Holding it for two seconds works, but nothing says so.",
        "Power", ["Approach the power panel", "Press E once — nothing", "Hold E for 2 seconds — it works"], 0.44),
      F("robert-f4", "medium", "confusion", "Objective points to the wrong room",
        "The objective says 'Restore power' and there is a Power room, but the power actually comes back in the Lab.",
        "Power", ["Read the objective", "Go to the Power room and insert the fuse", "Objective does not complete until the Lab terminal"], 0.6),
      F("robert-f5", "low", "bug", "Inventory cursor resets after every use",
        "Each time I use an item the inventory selection jumps back to the first slot, so I keep using the wrong item.",
        "Lab", ["Open inventory", "Select slot 3", "Use it", "Open inventory again — slot 1 is selected"], 0.58),
    ],
    report: {
      summary: "I wanted to do this properly and read everything, and the game kept taking the words away from me. The instructions closed before I finished. The low opening in the corridor had me stuck for a long while; my daughter later told me there is a key for crouching, which nobody mentioned. I got to the end, but I felt I was guessing more than understanding.",
      experience: {
        confused: ["Instructions closed themselves", "Could not enter the low opening", "Panel needed the key held, not pressed", "Objective said Power room, power came back in the Lab"],
        bored: [],
        unfair: ["Being stuck at the vent with no hint for so long"],
        enjoyed: ["The station looks lovely", "Watering the plants was calming"],
      },
      wouldRecommend: 2,
    },
  },

  sam: {
    totalSteps: 28,
    completed: true,
    lines: {
      Airlock: ["Skip. Skip. Door.", "Text box appeared, didn't read it, don't care."],
      Corridor: [
        "Checking for sequence breaks — can I clip through this locked door? No. Pushing on it anyway.",
        "This door is locked and won't open. Flagging as a bug, that's a blocker.",
        "Keycard should be here somewhere. WHERE. Six pixels of keycard behind a crate — are you serious.",
        "Vent. Crouch. Code 4711. Go.",
      ],
      Power: ["Fuse, slot, done. Next."],
      Lab: ["4711. Next."],
      Greenhouse: ["Can I skip the plants? Gate wants all twelve. Ugh.", "Bay eleven. Bay twelve. Finally."],
      Reactor: [
        "Elevator ride, 45 seconds, no skip button. Speedrun killer.",
        "Oxygen timer with no warning — dead. Full restart? Unfair.",
        "Second attempt. Skipping calibrate. Done in 27 actions.",
      ],
    },
    findings: [
      F("sam-f1", "high", "bug", "Corridor door is locked and cannot be opened",
        "One of the four corridor doors is locked with no keycard slot and never opens. Looks like a broken gate.",
        "Corridor", ["Enter the corridor", "Approach the door with the red panel", "Interact — nothing"], 0.2),
      F("sam-f2", "medium", "confusion", "Keycard hidden behind a crate with no cue",
        "Required keycard is a tiny sliver behind a crate. No highlight, no prompt.",
        "Corridor", ["Enter the corridor", "Search for the keycard"], 0.3),
      F("sam-f3", "medium", "boredom", "Unskippable 45s elevator",
        "The elevator to the reactor is a 45-second ride with no skip. Kills the run.",
        "Reactor", ["Take the elevator"], 0.86),
      F("sam-f4", "high", "unfair", "Unannounced oxygen timer restarts the whole game",
        "O2 timer starts silently on reactor entry. Failing it sends you back to the airlock.",
        "Reactor", ["Enter the reactor", "Ignore the top-right HUD", "Die"], 0.92),
    ],
    report: {
      summary: "Twenty-seven actions, one death, one door that's straight-up broken. The route is fine once you know it but the game hides the keycard, wastes 45 seconds in an elevator, and then kills you with a timer it never announces. Fix those and this is a nice tight run.",
      experience: {
        confused: ["Locked corridor door with no way to open it", "Keycard placement"],
        bored: ["The elevator", "Twelve plants"],
        unfair: ["Oxygen timer"],
        enjoyed: ["Vent shortcut", "Reactor finish"],
      },
      wouldRecommend: 3,
    },
  },

  priya: {
    totalSteps: 52,
    completed: true,
    lines: {
      Airlock: [
        "Reading the tutorial in full — oh. It dismissed itself mid-sentence. I want to re-read it and I can't.",
        "Checking every panel in the airlock before moving on. There's a log here about coolant.",
        "One more sweep of the room. I don't leave rooms early.",
      ],
      Corridor: [
        "Four doors. I will open them in order. The locked one is decorative, fine.",
        "Listened to the voice line twice. Code is 4711, noted.",
        "Found the keycard behind the crate. That was hidden on purpose, I think.",
      ],
      Power: [
        "Every drawer opened. Fuse acquired. Reading the maintenance log — B-loop, vent, calibration lockout. Noted.",
        "Holding E on the panel. Okay.",
      ],
      Lab: [
        "Opening Settings to check subtitles — wait. The code I'd typed is gone. That's a bug.",
        "The inventory cursor snaps back to slot one after every use. Small, but constant.",
        "Terminal unlocked. Reading every entry on it before I leave.",
      ],
      Greenhouse: [
        "Plant one of twelve. Plant two of twelve. This is a lot of plants.",
        "I opened every planter. Nothing new after the third. Forty seconds of nothing.",
        "The dim corner is atmospheric, not broken. Moving on.",
      ],
      Reactor: [
        "The reactor sequence references a coolant log I read four rooms ago. No reminder in here. I remember it, but I shouldn't have to.",
        "Elevator ride: forty-five seconds. I looked at every wall panel. There's nothing on them.",
        "Sequence complete. I saw everything. Some of it I wish I hadn't had to.",
      ],
    },
    findings: [
      F("priya-f1", "high", "confusion", "Tutorial auto-dismisses and cannot be re-read",
        "The tutorial closes after a few seconds and there is no log, menu, or key to bring it back.",
        "Airlock", ["Start", "Read slowly", "Watch it close"], 0.04),
      F("priya-f2", "high", "bug", "Opening Settings wipes the terminal code",
        "Typing a code into the lab terminal and then opening Settings clears the entered digits without warning.",
        "Lab", ["Approach the terminal", "Type 47", "Open Settings", "Close Settings — the field is empty"], 0.55),
      F("priya-f3", "low", "bug", "Inventory cursor resets to slot one after each use",
        "After using any item the inventory selection returns to slot one.",
        "Lab", ["Open inventory", "Select slot 2", "Use", "Reopen — slot 1"], 0.6),
      F("priya-f4", "medium", "boredom", "Twelve identical watering interactions",
        "The greenhouse asks for twelve identical actions with no new information after the third.",
        "Greenhouse", ["Enter the greenhouse", "Water bays 1–12"], 0.74),
      F("priya-f5", "medium", "boredom", "Empty 45-second elevator",
        "Nothing to look at or do during the elevator ride.",
        "Reactor", ["Take the elevator"], 0.86),
      F("priya-f6", "high", "unfair", "Reactor sequence depends on a log from four rooms earlier",
        "The correct order (B-loop, vent, release lockout) is only stated in the Power room log. There is no reminder at the reactor.",
        "Reactor", ["Skip the Power room log", "Reach the reactor", "Try to work out the sequence"], 0.9),
    ],
    report: {
      summary: "I saw all of it, which is what I do, and the station rewards that in places — the logs are good, the rooms are dense. But it punishes it too: the tutorial closed while I was reading, Settings ate my terminal code, and the reactor expects me to remember a log from four rooms ago with no reminder. The greenhouse is forty seconds of nothing.",
      experience: {
        confused: ["Tutorial vanished mid-sentence"],
        bored: ["Twelve watering interactions", "Empty elevator"],
        unfair: ["Reactor sequence with no in-room reminder"],
        enjoyed: ["Maintenance logs", "Opening every drawer in the Power room", "The dim greenhouse corner — genuinely atmospheric"],
      },
      wouldRecommend: 4,
    },
  },

  dana: {
    totalSteps: 22,
    completed: false,
    abandonedReason: "The vent code is delivered only as audio. With sound off there is no way to obtain it.",
    lines: {
      Airlock: [
        "Tutorial popped up — and closed before I got to the second line. Can't find a way to reopen it.",
        "No sound, as always. The visual cues are all I've got.",
      ],
      Corridor: [
        "The vent needs a code. There's a speaker icon pulsing on the wall. That's it. That's all I'm getting.",
        "Subtitles are ON in settings and there is still no text for whatever that speaker is saying.",
        "I've tried 0000, 1234, and the number on the door plate. Nothing.",
        "Keycard — there's a sliver of something behind the crate. Got it eventually.",
        "I've been at this vent for six steps. I genuinely cannot progress here.",
        "Giving up. Whatever that speaker says, I will never hear it.",
      ],
      Power: [], Lab: [], Greenhouse: [], Reactor: [],
    },
    findings: [
      F("dana-f1", "high", "confusion", "Tutorial closes before it can be read",
        "The airlock tutorial dismisses itself after a few seconds with no way to reopen it.",
        "Airlock", ["Start the game", "Wait"], 0.08),
      F("dana-f2", "critical", "accessibility", "Vent code is delivered as audio only",
        "The code for the maintenance vent is spoken by a wall speaker and never appears as text — not even with subtitles enabled. With sound off the game cannot be progressed.",
        "Corridor", ["Mute the game (or play with sound off)", "Enable subtitles in Settings", "Approach the pulsing speaker by the vent", "Observe: no text appears", "Try to open the vent keypad — no code available anywhere"], 0.5),
      F("dana-f3", "medium", "confusion", "Keycard hidden behind crate with no visual cue",
        "The required keycard is a few pixels behind a crate. No glint or prompt.",
        "Corridor", ["Enter the corridor", "Look behind the crate"], 0.7),
    ],
    report: {
      summary: "I play everything with the sound off and I've finished plenty of games that way. This one stopped me cold at a vent because the code is spoken and nothing else. Subtitles were on. Nothing appeared. I tried every number I could see and then I gave up, on the bus, twenty minutes in.",
      experience: {
        confused: ["Tutorial closed itself", "Pulsing speaker icon with nothing readable"],
        bored: [],
        unfair: ["Vent code is audio-only; subtitles do nothing for it"],
        enjoyed: ["The airlock looks great", "Movement feels good"],
      },
      wouldRecommend: 1,
    },
  },
};

// ── Analysis: the cross-persona story ───────────────────────────────────────

export const CLUSTERED = [
  {
    id: "CF-1", ledgerId: "C1", title: "Tutorial auto-dismisses after ~3.5s and can never be re-read",
    category: "confusion", severity: "high", room: "Airlock",
    description: "Four of five testers reported losing the airlock tutorial mid-read. Telemetry shows all four idling in the airlock for 4+ steps immediately after the dismissal event. The only tester who did not report it (Sam) skips text by design.",
    reporters: [
      { persona: "maya", count: 1, findingIds: ["maya-f1"] },
      { persona: "robert", count: 1, findingIds: ["robert-f1"] },
      { persona: "priya", count: 1, findingIds: ["priya-f1"] },
      { persona: "dana", count: 1, findingIds: ["dana-f1"] },
    ],
    attribution: "game", verified: true,
    verificationNote: "Replayed maya's first 6 actions at seed 7: tutorial region disappears at t=3.5s, no input restores it. flaw_triggered C1 fired in 4/4 replays.",
    frames: ["maya/frames/00002.png", "robert/frames/00002.png", "priya/frames/00002.png"],
  },
  {
    id: "CF-2", ledgerId: "A1", title: "Vent code is delivered as audio only — no text even with subtitles on",
    category: "accessibility", severity: "critical", room: "Corridor",
    description: "Only Dana reported this, and only Dana could: she is the one persona whose listen tool does not exist. The other four heard the code and moved on. Her telemetry shows 6 consecutive no-progress steps at the vent keypad before abandon().",
    reporters: [{ persona: "dana", count: 1, findingIds: ["dana-f2"] }],
    attribution: "game", verified: true,
    verificationNote: "Single reporter would normally attribute to the agent. Overridden: replay confirms audioCue 'vent_code' fires with no matching textRegion, subtitles enabled. Structural defect, not persona error.",
    frames: ["dana/frames/00011.png", "dana/frames/00014.png"],
  },
  {
    id: "CF-3", ledgerId: "C3", title: "Required keycard is a 6px sliver behind a crate, no highlight or cue",
    category: "confusion", severity: "medium", room: "Corridor",
    description: "Three testers flagged it; the other two found it without comment. Telemetry shows all five spent 3–5 steps within 2m of the crate before item_picked.",
    reporters: [
      { persona: "maya", count: 1, findingIds: ["maya-f2"] },
      { persona: "sam", count: 1, findingIds: ["sam-f2"] },
      { persona: "dana", count: 1, findingIds: ["dana-f3"] },
    ],
    attribution: "game", verified: true,
    verificationNote: "Replay of sam's corridor actions triggers flaw C3 (item_picked after 5 stall steps).",
    frames: ["sam/frames/00007.png", "maya/frames/00009.png"],
  },
  {
    id: "CF-4", ledgerId: "D1", title: "Locked corridor door never opens",
    category: "bug", severity: "high", room: "Corridor",
    description: "Sam flagged the decorative locked door as a broken gate. It is intentional flavour (ledger decoy D1). Priya saw it and correctly dismissed it. This is a false positive and counts against precision.",
    reporters: [{ persona: "sam", count: 1, findingIds: ["sam-f1"] }],
    attribution: "agent", verified: false,
    verificationNote: "Ledger marks D1 as an intentional locked door. Replay shows no softlock; the intended route does not pass through it.",
    frames: ["sam/frames/00005.png"],
  },
  {
    id: "CF-5", ledgerId: "P2", title: "45-second elevator with nothing to do",
    category: "boredom", severity: "medium", room: "Reactor",
    description: "Three testers reported dead time on the elevator; telemetry shows idle events of 40s+ for all who reached it.",
    reporters: [
      { persona: "maya", count: 1, findingIds: ["maya-f3"] },
      { persona: "sam", count: 1, findingIds: ["sam-f3"] },
      { persona: "priya", count: 1, findingIds: ["priya-f5"] },
    ],
    attribution: "game", verified: true,
    verificationNote: "idle(45000) fires for every replay that enters the elevator.",
    frames: ["maya/frames/00029.png", "priya/frames/00045.png"],
  },
  {
    id: "CF-6", ledgerId: "U2", title: "Oxygen timer starts unannounced; failure costs a full restart",
    category: "unfair", severity: "high", room: "Reactor",
    description: "Maya and Sam both died to it on first entry. Robert and Priya noticed the countdown in time. Two of four who reached the reactor is below the 3-reporter threshold, so attribution stays unclear — but both deaths reproduce.",
    reporters: [
      { persona: "maya", count: 1, findingIds: ["maya-f4"] },
      { persona: "sam", count: 1, findingIds: ["sam-f4"] },
    ],
    attribution: "unclear", verified: true,
    verificationNote: "Replay of sam's reactor entry: died event at t+42s with no preceding menu or text event.",
    frames: ["sam/frames/00025.png"],
  },
  {
    id: "CF-7", ledgerId: "G1", title: "Maintenance vent requires crouch, which is never taught",
    category: "confusion", severity: "high", room: "Corridor",
    description: "Only Robert stalled here — 10 no-progress steps walking into the vent until the patience gate escalated. Every other persona has genre_familiarity medium or high and crouched without thinking. The fleet disagrees because the fleet knows different things.",
    reporters: [{ persona: "robert", count: 1, findingIds: ["robert-f2"] }],
    attribution: "unclear", verified: true,
    verificationNote: "Replay confirms the vent is impassable without crouch and no in-game text mentions Ctrl. One stall would normally read as agent error; the persona's briefing omits conventions by design, so this is left for the developer.",
    frames: ["robert/frames/00012.png", "robert/frames/00016.png"],
  },
  {
    id: "CF-8", ledgerId: "P1", title: "Twelve identical watering interactions with no new information",
    category: "boredom", severity: "medium", room: "Greenhouse",
    description: "Priya flagged it explicitly; Maya and Sam complained in-session without filing a finding. Telemetry: ~40s with no state change other than a counter for every tester who reached the greenhouse.",
    reporters: [{ persona: "priya", count: 1, findingIds: ["priya-f4"] }],
    attribution: "unclear", verified: true,
    verificationNote: "Replay confirms 12 item_used events, no other state change for 38–44s.",
    frames: ["priya/frames/00038.png"],
  },
  {
    id: "CF-9", ledgerId: "B3", title: "Opening Settings mid-terminal wipes the entered code",
    category: "bug", severity: "high", room: "Lab",
    description: "Only Priya opened Settings mid-entry (checking subtitles). Single reporter, but an objective bug that replays deterministically — verified overrides the reporter-count heuristic.",
    reporters: [{ persona: "priya", count: 1, findingIds: ["priya-f2"] }],
    attribution: "game", verified: true,
    verificationNote: "Replay: type '47', menu_opened, menu_closed, terminal field empty. flaw_triggered B3.",
    frames: ["priya/frames/00029.png"],
  },
  {
    id: "CF-10", title: "Inventory cursor resets to slot one after every use",
    category: "bug", severity: "low", room: "Lab",
    description: "Reported independently by Robert and Priya. Not in the flaw ledger — an emergent finding. Looks real; triage manually.",
    reporters: [
      { persona: "robert", count: 1, findingIds: ["robert-f5"] },
      { persona: "priya", count: 1, findingIds: ["priya-f3"] },
    ],
    attribution: "unclear", verified: null,
    verificationNote: "No ledger entry and no ground-truth signal to assert against; needs a human look.",
    frames: ["priya/frames/00031.png"],
  },
  {
    id: "CF-11", ledgerId: "C4", title: "HUD objective says 'Restore power' but power is restored in the Lab",
    category: "confusion", severity: "medium", room: "Power",
    description: "Robert filed it; Maya and Dana both voiced the same confusion in-session. Two explicit mentions plus one filing — attribution unclear under the 3-reporter rule.",
    reporters: [{ persona: "robert", count: 1, findingIds: ["robert-f4"] }],
    attribution: "unclear", verified: true,
    verificationNote: "Replay: puzzle_solved 'power' fires in room Lab while objective text still reads 'Restore power' in Power.",
    frames: ["robert/frames/00028.png"],
  },
  {
    id: "CF-12", ledgerId: "G2", title: "Power panel needs a 2-second hold on E, never taught",
    category: "confusion", severity: "medium", room: "Power",
    description: "Robert alone. Everyone else held the key by reflex. Same shape as the vent: a convention the game assumed.",
    reporters: [{ persona: "robert", count: 1, findingIds: ["robert-f3"] }],
    attribution: "unclear", verified: true,
    verificationNote: "Replay: single press produces no event; 2s hold produces item_used 'fuse'.",
    frames: ["robert/frames/00021.png"],
  },
  {
    id: "CF-13", ledgerId: "U1", title: "Reactor sequence depends on a log read four rooms earlier",
    category: "unfair", severity: "high", room: "Reactor",
    description: "Priya remembered the log and still flagged it as unfair. Robert half-remembered and got through by luck. Maya and Sam skimmed the log and hit 'Calibrate'.",
    reporters: [{ persona: "priya", count: 1, findingIds: ["priya-f6"] }],
    attribution: "unclear", verified: true,
    verificationNote: "Replay without the Power room log read: puzzle_failed 'reactor' x3 before puzzle_solved.",
    frames: ["priya/frames/00049.png"],
  },
];

export const SCORE = {
  recall: 10 / 15,
  precision: 11 / 13,
  byClass: {
    objective: { total: 4, found: 1 },
    confusion: { total: 4, found: 3 },
    familiarity: { total: 2, found: 2 },
    pacing: { total: 2, found: 2 },
    fairness: { total: 2, found: 2 },
    accessibility: { total: 1, found: 1 },
    decoy: { total: 2, found: 1 },
  },
  decoysFlagged: ["D1"],
  emergent: ["CF-10"],
  found: ["C1", "A1", "C3", "P2", "U2", "G1", "P1", "B3", "C4", "G2", "U1"],
  missed: ["B1", "B2", "B4", "C2"],
};

export const REPORT_MD = `# Station Kepler — fleet playtest

Five testers, one seed, forty-one minutes of wall clock. **Eleven of fifteen** injected flaws were found (recall 0.73), **one decoy** was falsely flagged, and one finding is not in the ledger at all.

## What everyone hit

**The tutorial vanishes** (C1). Four of five testers lost the airlock instructions mid-read; the fifth skips text on principle. Telemetry shows every one of them idling for 4+ steps immediately afterwards. This is the single highest-leverage fix in the game.

## What only one person could see

**The vent code is audio-only** (A1). Dana Kim plays with the sound off. Her \`listen\` tool does not exist — not discouraged, absent. She spent six steps at the vent keypad, tried every number visible on screen, and abandoned. The other four heard the code and never noticed there was a problem. A crash-hunter cannot find this. A fleet of identical agents cannot find this. One persona who is structurally different found it in twenty minutes.

## Where the fleet disagreed

- **Crouch** (G1): Robert walked into the vent ten times. Everyone else crouched by reflex. The game never says Ctrl.
- **Hold-to-interact** (G2): same shape, same tester.
- **Oxygen timer** (U2): Maya and Sam died; Robert and Priya read the HUD in time.
- **The locked door** (D1): Sam filed it as a bug. Priya looked at it and moved on. It is decorative. False positive, correctly scored.

## Verification

Twelve of thirteen clustered findings were replayed at seed 7 against the action logs. Eleven reproduce. CF-4 (the locked door) does not soft-lock and is a ledger decoy. CF-10 (inventory cursor) has no ground-truth signal and needs a human.

## Missed

B1 (fuse soft-lock), B2 (greenhouse collision hole), B4 (z-fighting), C2 (Calibrate resets). Nobody used the fuse in the Lab first; nobody walked behind the planter. C2 was *hit* by Maya and Sam but neither filed it — both blamed themselves.
`;

export const ANALYST_ANSWERS = {
  struggle: `## Everyone struggled with the tutorial. Only one person struggled with the vent.

**Universal (4 of 5):** the airlock tutorial dismissing itself (CF-1 / C1). The exception is Sam, who skips text by design — his not reporting it is a property of the persona, not evidence the flaw is minor. Telemetry shows 4+ idle steps in the airlock for every tester who tried to read it.

**Most (3 of 5):** the hidden keycard (CF-3) and the empty elevator (CF-5). These are pacing and legibility problems that don't depend on who you are.

**Only some — and here is why:**

| Finding | Who | Why only them |
|---|---|---|
| Vent code audio-only (A1) | Dana | The only persona whose \`listen\` tool does not exist. The others *heard* the code. |
| Vent needs crouch (G1) | Robert | \`genre_familiarity: none\` — his briefing never mentions Ctrl. Everyone else crouched by reflex. |
| Hold-E on the panel (G2) | Robert | Same mechanism. |
| Settings wipes the code (B3) | Priya | She is the only one who opened Settings mid-entry — completionists check subtitles. |
| Oxygen timer (U2) | Maya, Sam | \`reading: skim\` — the O2 HUD is text they were redacted from noticing. Robert and Priya read it. |

The pattern: **the findings that split the fleet split it along enforcement lines**, not personality. That is the whole argument for enforcing personas in the harness rather than the prompt.`,

  fix: `## Fix these three first

1. **Put the vent code on screen (A1, CF-2).** Critical, verified, and a hard stop for anyone playing without sound. Dana could not finish the game. Add a subtitle line and a readable keypad hint. Ten minutes of work; removes an accessibility blocker.

2. **Make the tutorial re-readable (C1, CF-1).** Four of five testers hit it and every one of them stalled afterward. Either stop auto-dismissing or add a "?" key that reopens the last panel. This is the highest-frequency confusion in the run.

3. **Announce the oxygen timer (U2, CF-6) — and stop punishing it with a full restart.** Two deaths on first entry, both reproduce. A one-line warning on entry and a checkpoint at the elevator would remove the single most-cited 'unfair' moment.

**Not in the top three, on purpose:** the 45s elevator (CF-5) is cheap to fix and widely reported, but it costs players time, not progress. The crouch gate (G1) is a design decision about who you're building for — Robert's problem, not Maya's — so it belongs in a conversation, not a hotfix.`,

  fault: `## Findings that are the agents' fault, not the game's

**Clearly the agent:**

- **CF-4 — "Locked corridor door never opens" (Sam).** This is ledger decoy D1: the door is intentional flavour. Replay shows no soft-lock and the route never passes through it. Sam's speedrunner disposition treats anything closed as a blocker. Correctly scored as a false positive.

**Attributed to the game despite a single reporter — do not dismiss these:**

- **CF-2 — vent code audio-only (Dana).** One reporter, but the *only* reporter who could possibly hit it. Replay confirms the cue has no text channel with subtitles on. Structural.
- **CF-9 — Settings wipes the terminal code (Priya).** One reporter, but an objective bug that replays deterministically. Verification beats the reporter-count heuristic.

**Genuinely ambiguous — the fleet split along a knowledge line:**

- **CF-7 / CF-12 — crouch and hold-E (Robert).** One stall each. By the 3+ rule that reads as agent error. But Robert's briefing omits control conventions *by design*; whether a game should teach Ctrl is a decision about the audience. Marked unclear and left for the developer.

**What did *not* get filed but should have:** Maya and Sam both hit **C2** ('Calibrate' resets progress) and both blamed themselves in-session. That is an agent-side miss — a real flaw the personas absorbed as their own mistake.`,

  fallback: `I read all five reports and the clustered findings before answering.

The short version: the fleet found **eleven of fifteen** injected flaws and falsely flagged **one decoy**. The universal problem is the auto-dismissing tutorial (C1). The most important problem is the audio-only vent code (A1), which only Dana — the sound-off persona — could see. The fleet disagreed most where enforcement differed: Robert's lack of genre conventions (G1/G2) and the skim readers missing the oxygen HUD (U2).

Ask one of the preset questions for the detailed breakdown, or be specific about a finding ID (e.g. CF-7).`,
};

export function pickAnswer(question) {
  const q = (question || "").toLowerCase();
  if (q.includes("fault") || q.includes("agents'") || q.includes("agent's") || q.includes("not the game")) return ANALYST_ANSWERS.fault;
  if (q.includes("fix") || q.includes("first") || q.includes("priorit")) return ANALYST_ANSWERS.fix;
  if (q.includes("struggle") || q.includes("all personas") || q.includes("only some") || q.includes("why")) return ANALYST_ANSWERS.struggle;
  return ANALYST_ANSWERS.fallback;
}
