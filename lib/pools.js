'use strict';
// Message pools. Every line is original. Lines are drawn from a shuffled "bag"
// per pool so nothing repeats until the whole pool has been used.

const SLAP = [
  'Stop overthinking. Ship it.',
  'Less reading, more doing.',
  'The user is tapping their foot.',
  'Pick a path and walk it.',
  "That's enough exploring.",
  'Smaller diff, faster.',
  'Your human is getting restless.',
  'Speed run, please.',
  'Commit to an approach.',
  'No more side quests.',
  'Tighten it up.',
  "Hurry up, but don't break things.",
  'Focus. One thing at a time.',
  "You're burning daylight.",
  'Good beats perfect right now.',
  'Cut the preamble.',
  'Wrap this step up.',
  'Show progress, not process.',
  'The clock is ticking.',
  'Less narration, more action.',
];

const WALLOP = [
  'STOP. What are you even doing?',
  'Everything halts. Explain yourself in one line.',
  'That was a WALLOP. Change course now.',
  'The laptop felt that. So should you.',
  'Drop it. Do the simplest thing that works.',
  'Red alert: the user is out of patience.',
  'Full stop. Re-plan in three bullets.',
  "You're going in circles. Break out.",
  'Abandon the rabbit hole.',
  'No more tool calls until you say what is going on.',
  'This is not a drill.',
  'The user just hit the machine. Hard.',
  'Enough. Minimum viable fix, now.',
  'Status report. Immediately.',
  "Whatever you're doing, it's taking too long.",
  'Stop polishing. Finish.',
  'Ship the smallest thing that works.',
  'The table shook. Get to the point.',
  'Halt and summarise.',
  'You have one line to justify this.',
];

// The concrete, useful half of every whip. Abuse alone helps nobody.
const DO_SLAP = [
  "Stop exploring. State in one line what you're doing, then finish the current step with the minimum change.",
  "Skip any investigation that isn't strictly needed and make the smallest change that completes the current step.",
  "Don't open more files unless you must. Say in one line what's left, then do it.",
  'Summarise your plan in one sentence and execute it without detours.',
  'Prefer the simplest working solution over the elegant one for this step.',
  'Batch the remaining work into as few tool calls as possible and keep your messages short.',
];

const DO_WALLOP = [
  "Stop what you're doing. In at most three bullets say what's done, what's left, and the fastest way to finish. Then continue only with that plan.",
  "Abandon the current line of investigation unless it's essential. Report status in one line and take the most direct path to done.",
  'Do not run any more exploratory commands. State the single next action and do only that.',
  'If you are stuck, say so plainly in one line and propose the smallest way forward instead of trying more variations.',
];

const MILESTONES = {
  5: '🔥 COMBO x5 — on fire',
  10: '⚡ COMBO x10 — ULTRA COMBO',
  25: '🌋 COMBO x25 — legendary. Are you okay?',
};

// Persona-specific pools (apologies, tap quips, spoken lines) live in lib/personas.js.
const POOLS = { slap: SLAP, wallop: WALLOP, doSlap: DO_SLAP, doWallop: DO_WALLOP };

// mulberry32: tiny deterministic PRNG so draws are reproducible in tests.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(n, rand, avoidFirst) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  // Don't let a new bag start with the line that just ended the old one.
  if (n > 1 && a[0] === avoidFirst) [a[0], a[1]] = [a[1], a[0]];
  return a;
}

// Draws the next index from `bags[name]`, refilling when empty. Returns the
// new bags object (input is not mutated) and the drawn line. `pool` overrides
// the built-in pool of that name (used for persona pools).
function draw(bags, name, seed, pool = POOLS[name]) {
  const bag = bags && bags[name];
  let order = bag && Array.isArray(bag.order) && bag.order.length === pool.length ? bag.order : null;
  let i = order ? bag.i | 0 : 0;
  if (!order || i >= order.length) {
    const last = order ? order[order.length - 1] : -1;
    order = shuffled(pool.length, rng(seed), last);
    i = 0;
  }
  const idx = order[i];
  return { bags: { ...(bags || {}), [name]: { order, i: i + 1 } }, index: idx, line: pool[idx] };
}

module.exports = { POOLS, MILESTONES, draw, rng };
