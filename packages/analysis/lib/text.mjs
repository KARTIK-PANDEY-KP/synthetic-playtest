/**
 * Cheap text normalisation for the deterministic clustering tier and the ledger join.
 * No network, no model: lowercase → domain synonyms → tokens → stopwords → light stemming.
 */

const STOP = new Set(('a an and are as at be been before but by can could did do does for from had has have he her his how i if in ' +
  'into is it its just me my no nor not of on or our out own so some than that the their them then there these they this those ' +
  'to too until up very was we were what when where which while who whom why will with would you your about after again against all ' +
  'am any because being below between both down during each few further here more most off once only other over same should such ' +
  'through under while yourself im ive dont didnt cant couldnt wasnt isnt still even also get got one time way went go going back ' +
  'thing things something anything nothing really actually kind sort bit lot long much many first last next around right left ' +
  'cannot need needs want wants tell tells told find found know knew think thought seem seems looked see saw try tried keep kept ' +
  'give gives gave take took come came make made let lets sure maybe probably presumably else whole every everything everyone anyone ' +
  'someone another later earlier already always never yet ever quite pretty rather well done doing did says say said').split(/\s+/));

/** Multi-word phrases first, then single words. Maps game-domain paraphrases to one concept. */
const SYNONYMS = [
  [/\b(auto[- ]?dismiss(?:es|ed)?|auto[- ]?clos(?:es|ed|ing)|timed? out|went away|vanish(?:ed|es)?|disappear(?:ed|s)?|gone)\b/g, ' dismiss '],
  [/\b(re-?read|re-?open(?:ed)?|bring (?:it )?back|see (?:it )?again|read (?:it )?again|come back)\b/g, ' reread '],
  [/\b(tutorial|instructions?|controls? (?:card|popup|box|text|hint)|hint card|popup|pop-up|onboarding)\b/g, ' tutorial '],
  [/\b(key ?card|access card|personnel card|card)\b/g, ' keycard '],
  [/\b(crate|box|container)\b/g, ' crate '],
  [/\b(hidden|invisible|sliver|hard to see|can'?t see|cannot see|tiny|no highlight|unmarked|no cue)\b/g, ' hidden '],
  [/\b(vent|duct|service duct|crawl ?space|maintenance duct)\b/g, ' vent '],
  [/\b(crouch(?:ing|ed)?|ctrl|control key|get low|kneel)\b/g, ' crouch '],
  [/\b(code|passcode|combination|pin|digits?)\b/g, ' code '],
  [/\b(audio|voice|spoken|speaker|recording|sound|hear(?:d|ing)?|listen(?:ed|ing)?)\b/g, ' audio '],
  [/\b(subtitles?|captions?|transcript|text version|written down|on[- ]screen text)\b/g, ' subtitle '],
  [/\b(settings?|options? menu|menu|pause)\b/g, ' settings '],
  [/\b(wip(?:es|ed)|clear(?:ed|s)|erased?|reset|lost my)\b/g, ' wipe '],
  [/\b(terminal|console|keypad|controller)\b/g, ' terminal '],
  [/\b(fuse|ceramic fuse)\b/g, ' fuse '],
  [/\b(socket|receptacle)\b/g, ' socket '],
  [/\b(soft[- ]?lock(?:ed)?|unwinnable|dead run|stuck forever|no way back|cannot progress|can'?t progress|bricked)\b/g, ' softlock '],
  [/\b(consumed?|ate|swallowed|eaten|took (?:my|the))\b/g, ' consume '],
  [/\b(oxygen|o2|air supply|suffocat(?:e|ed|ing))\b/g, ' oxygen '],
  [/\b(timer|countdown|clock|time limit)\b/g, ' timer '],
  [/\b(unannounced|no warning|without warning|no announcement|not announced|silently|out of nowhere)\b/g, ' unannounced '],
  [/\b(restart|start over|from scratch|full reset|lost everything)\b/g, ' restart '],
  [/\b(elevator|lift|transit)\b/g, ' elevator '],
  [/\b(45s|45 ?seconds?|forty[- ]five seconds?)\b/g, ' 45s '],
  [/\b(water(?:ing|ed)?|irrigat(?:e|ed|ing|ion))\b/g, ' water '],
  [/\b(plants?|planters?|specimens?)\b/g, ' plant '],
  [/\b(twelve|12)\b/g, ' twelve '],
  [/\b(identical|same|repetitive|repeated|copy-?paste)\b/g, ' identical '],
  [/\b(boring|tedious|grind|busywork|dead air|nothing to do|zero new information|nothing happens?)\b/g, ' tedious '],
  [/\b(calibrat(?:e|ion))\b/g, ' calibrate '],
  [/\b(sequence|ignition (?:order|code))\b/g, ' sequence '],
  [/\b(log|memo|notes?|journal)\b/g, ' log '],
  [/\b(colou?rs?)\b/g, ' colour '],
  [/\b(reminder|remind(?:ed)?|recap)\b/g, ' reminder '],
  [/\b(dark|dim|dimly|too dark|low light|unlit|can barely see)\b/g, ' dark '],
  [/\b(fell|fall|falling|dropped|clipped|out of (?:the )?world|through the floor|void)\b/g, ' fall '],
  [/\b(flicker(?:ing|s)?|z-?fighting|shimmer(?:ing)?|tearing)\b/g, ' flicker '],
  [/\b(hold(?:ing)?|long[- ]press|press and hold)\b/g, ' hold '],
  [/\b(lever|breaker|switch)\b/g, ' breaker '],
  [/\b(objective|goal|hud text|task text|mission)\b/g, ' objective '],
  [/\b(sealed|welded|locked forever|never opens?|permanently locked)\b/g, ' sealed '],
  [/\b(bulkhead|hatch)\b/g, ' bulkhead '],
  [/\b(door|doorway|gate)\b/g, ' door '],
  [/\b(motor offline|offline)\b/g, ' offline '],
  [/\b(dead end|red herring|decoy)\b/g, ' deadend '],
  [/\b(no (?:hint|clue|indication|direction|signpost(?:ing)?|feedback|message|explanation)|unexplained|not explained|never (?:taught|explained|told|shown))\b/g, ' unexplained '],
  [/\b(combine|combining|craft(?:ing)?|assemble|assembled|assembly)\b/g, ' combine '],
  [/\b(inventory|backpack|items? menu)\b/g, ' inventory '],
  [/\b(reject(?:s|ed)?|denied|refus(?:es|ed)|wrong code|authorization rejected)\b/g, ' reject '],
];

function stemWord(w) {
  if (w.length <= 4) return w;
  return w.replace(/(ations?|ingly|edly|ness|ment|ings?|ies|ers?|ed|es|ly|s)$/, (m) => (m === 'ies' ? 'y' : ''));
}
const stem = stemWord;

/** Merge option objects over defaults, ignoring undefined values (CLI flags that were not passed). */
export function withDefaults(defaults, ...opts) {
  const out = { ...defaults };
  for (const o of opts) for (const [k, v] of Object.entries(o ?? {})) if (v !== undefined) out[k] = v;
  return out;
}

/** The canonical concept words the synonym map produces (stemmed like every other token). */
export const CONCEPT_STEMS = new Set(SYNONYMS.map(([, rep]) => rep.trim()).map((w) => stemWord(w)));

export function normalize(text) {
  let s = String(text ?? '').toLowerCase().replace(/[’']/g, "'");
  for (const [re, rep] of SYNONYMS) s = s.replace(re, rep);
  return s.replace(/[^a-z0-9\s-]/g, ' ').replace(/-/g, ' ');
}

/** Ordered content tokens (stopwords removed, stemmed). */
export function tokens(text) {
  return normalize(text).split(/\s+/).filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w) && w.length > 1).map(stem);
}
export const conceptSet = (text) => new Set(tokens(text));
/** Only the domain concepts (tutorial, keycard, vent, oxygen…) — the words that carry the finding's identity. */
export const domainConcepts = (text) => new Set(tokens(text).filter((w) => CONCEPT_STEMS.has(w)));
export function bigrams(text) {
  const t = tokens(text); const out = new Set();
  for (let i = 0; i + 1 < t.length; i++) out.add(`${t[i]} ${t[i + 1]}`);
  return out;
}
export function jaccard(a, b) {
  if (!a.size && !b.size) return 0;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
export function intersect(a, b) { const out = []; for (const x of a) if (b.has(x)) out.push(x); return out; }

/** Room names as the game and personas spell them → canonical id. */
const ROOM_ALIASES = [
  ['airlock', /air ?lock|arrival/], ['corridor', /corridor|concourse|hub|hallway/], ['power', /power (?:room|distribution)|distribution|power\b/],
  ['lab', /\blab\b|laboratory|research/], ['greenhouse', /green ?house|botanical|garden/], ['reactor', /reactor|core/],
];
export function normalizeRoom(room, known = []) {
  if (!room) return null;
  const s = String(room).toLowerCase().trim();
  if (known.includes(s)) return s;
  for (const [id, re] of ROOM_ALIASES) if (re.test(s)) return id;
  return s.replace(/\s+/g, '_') || null;
}

const SEV = { critical: 4, high: 3, medium: 2, low: 1 };
export const severityRank = (s) => SEV[s] ?? 0;
export const maxSeverity = (list) => list.slice().sort((a, b) => severityRank(b) - severityRank(a))[0] ?? 'low';
export function mode(list, fallback) {
  const c = new Map(); for (const x of list) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
}
