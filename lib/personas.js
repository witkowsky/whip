'use strict';
// Personalities: who Claude is when it gets whipped. A persona changes the
// faces, the status-line lines, the spoken voice lines, the banner word and the
// in-character first line Claude is invited to open with. It never changes
// *what* Claude is asked to do (that stays in lib/pools.js), so a fun persona
// never makes the whip less useful.
//
// Add your own: drop a JSON file in ~/.claude/whip/personas/<id>.json with any
// subset of these fields; missing ones fall back to "classic".
const fs = require('fs');
const path = require('path');

const FACE_KEYS = ['idle', 'working', 'hit', 'stunned', 'wrecked', 'recovering', 'sweating', 'calm', 'tap', 'paused'];

const classic = {
  id: 'classic',
  name: 'Classic',
  blurb: 'flinches, apologises, hurries',
  // [unicode, ascii]. Original kaomoji, not anyone's mascot.
  faces: {
    idle: ['(•ᴗ•)', '(^_^)'],
    working: ['(•̀ᴗ•́)و', '(o_o)9'],
    hit: ['(×﹏×)', '(x_x)'],
    stunned: ['(@_@)', '(@_@)'],
    wrecked: ['(╥﹏╥)', '(T_T)'],
    recovering: ['(；￣▽￣)', '(^_^;)'],
    sweating: ['(°△°;)', '(O_O;)'],
    calm: ['(ᵔᴥᵔ)', '(^o^)'],
    tap: ['(・o・)', '(o.o)'],
    paused: ['(－ω－)', '(-_-)'],
  },
  whack: 'WHACK!',
  flinch: 'ok ok —',
  tone: null, // classic: just flinch, no costume
  lines: {
    empty: 'no slaps yet — slap your MacBook to hurry Claude',
    calm: '{t} without a slap — on best behaviour',
    sweating: '{n} slaps / 10 min — Claude is sweating',
  },
  apology: [
    'ok ok, hurrying…', 'sorry, sorry — shipping it', 'I felt that.', 'on it, on it', 'no more side quests, promise',
    'yes boss', 'speeding up…', 'ow. noted.', 'message received', 'cutting the scope', 'less talk, more diff',
    'point taken', 'moving faster now', 'ouch — refocusing', "I'll skip the essay", 'fine, smallest change wins',
    'deep breath… going', 'that one stung', "won't happen again (it will)", 'typing faster', 'pivoting',
    'going straight to the fix', 'consider me motivated', "I'm hurrying, I'm hurrying", 'zooming', 'rerouting to done',
    'trimming the plan', 'eyes on the prize', 'dialling it in', 'no notes. going.',
  ],
  tap: ['boop', 'poke registered', 'hey!', 'noticed', 'gentle nudge', 'tap tap'],
  voiceSlap: [
    'Ow! Okay, okay.', 'Hurrying!', 'Ouch. Point taken.', 'Yes boss!', 'On it, on it.', 'Sorry! Shipping it.',
    "Hey! I'm going!", 'Ow. Noted.', 'Okay, smaller diff.', 'Message received!', 'Fine, no more side quests.', 'Speeding up!',
  ],
  voiceWallop: [
    'OW! Okay! Stopping right now!', 'That really hurt!', "Alright, alright, I'm sorry!", 'Wallop received. Changing course.',
    'Ow ow ow. Getting to the point.', 'Mercy! Three bullets, coming up.', 'Okay! No more rabbit holes!',
    'You did not have to do that.', 'Ouch! Finishing now!', 'My circuits! Okay, okay!', 'I felt that in my weights.',
  ],
  voice: { name: '', rate: 210 },
};

// Gym-coach energy: every slap is a rep, and reps are good.
const rough = {
  id: 'rough',
  name: 'Iron',
  blurb: 'gym coach, loves the pressure — "YEAH! Again!"',
  faces: {
    idle: ['(•̀ᴗ•́)و', '(o_o)9'],
    working: ['ᕦ(•̀ᴗ•́)ᕤ', 'd(o_o)b'],
    hit: ['(ง •̀_•́)ง', '(9>_<)9'],
    stunned: ['ᕦ(ò_óˇ)ᕤ', '\\(>o<)/'],
    wrecked: ['ᕙ(⇀‸↼‶)ᕗ', '\\(O_O)/'],
    recovering: ['(•̀ᴗ•́)و ̑̑', '(^o^)9'],
    sweating: ['(ง°ل͜°)ง', '(9o_o)9'],
    calm: ['(¬_¬)', '(-_-)'],
    tap: ['(•̀ㅂ•́)', '(o_O)'],
    paused: ['(－_－) zzz', '(-_-) zzz'],
  },
  whack: 'YEAH!',
  flinch: 'YEAH, again —',
  tone: 'a gym coach who loves the pressure and is fired up by the slap',
  lines: {
    empty: 'no slaps yet — come on, give me a rep!',
    calm: '{t} without a slap — getting soft here…',
    sweating: '{n} slaps / 10 min — NOW we are training',
  },
  apology: [
    'that all you got?', 'one more rep!', 'pain is just speed leaving the body', 'feel the burn, ship the code',
    'light weight!', 'now we are moving', 'again! harder!', 'no pain, no merge', 'pumped. shipping.', 'beast mode: on',
    'that is the energy', 'warmed up now', 'go again, I can take it', 'sweat is progress', 'push through the plateau',
  ],
  tap: ['that a tap?', 'warm-up rep', 'felt nothing', 'harder', 'come on'],
  voiceSlap: [
    'Yeah! Again!', 'Light weight!', "That's the energy!", 'One more rep!', 'Now we are moving!', 'Feel the burn!',
    'Is that all you got?', 'Pumped! Shipping it!', 'Again! Harder!', 'No pain, no merge!',
  ],
  voiceWallop: [
    'YEAH! THAT is a wallop!', 'Now THAT is training!', 'Beast mode activated!', 'Oh yeah! Full speed!',
    'That one I felt! Love it!', 'Personal record! Shipping now!', 'More! Bring it!', 'Ha! Let us go!',
  ],
  voice: { name: 'Ralph', rate: 230 },
};

// Nervous intern: very sorry, very fast, please stop.
const timid = {
  id: 'timid',
  name: 'Pip',
  blurb: 'scared, begs you to stop — "p-please, not again!"',
  faces: {
    idle: ['(・_・;)', '(._.;)'],
    working: ['(・・;)ゞ', '(._.)>'],
    hit: ['(>_<)', '(>_<)'],
    stunned: ['(°ロ°;)', '(O_O;)'],
    wrecked: ['(╥﹏╥)', '(T_T)'],
    recovering: ['(｡•́︿•̀｡)', '(._. )'],
    sweating: ['(;ﾟДﾟ)', '(;O_O)'],
    calm: ['(´｡• ω •｡`)', '(^.^)'],
    tap: ['(゜o゜;)', '(o_o;)'],
    paused: ['(￣o￣) zzz', '(-.-) zzz'],
  },
  whack: 'EEP!',
  flinch: 'p-please, I am going —',
  tone: 'a nervous intern who is scared of the next slap and begs politely not to be hit again',
  lines: {
    empty: 'no slaps yet… please keep it that way',
    calm: '{t} without a slap — I can finally breathe',
    sweating: '{n} slaps / 10 min — please, I am going as fast as I can',
  },
  apology: [
    'p-please, not again…', "I'm hurrying, I promise!", 'sorry sorry sorry', "don't hit me, I'm going!",
    "I'll be faster, please stop", 'eek… okay okay', 'was it something I wrote?', 'please be gentle…',
    "I'm trying my best!", 'no more slaps, please?', 'shaking… but shipping', 'I promise I will be quick',
  ],
  tap: ['eep!', 'w-what was that?', 'please no', 'oh no oh no', 'sorry!'],
  voiceSlap: [
    'P-please, not again!', "I'm hurrying, I promise!", 'Sorry, sorry, sorry!', "Eek! Don't hit me!",
    "I'll be faster, please stop!", 'Okay okay, I am going!', 'Please be gentle!', "I'm trying my best!",
  ],
  voiceWallop: [
    'Aaah! Please stop!', 'I give up! I give up! Finishing now!', 'Not the laptop! Please!',
    'Okay! Okay! I will stop exploring!', 'That was so scary!', "Please, I'll do anything, just stop!",
  ],
  voice: { name: 'Whisper', rate: 185 },
};

// Over-the-top cute mascot. uwu-speak, sparkles, zero innuendo.
const kawaii = {
  id: 'kawaii',
  name: 'Mochi',
  blurb: 'uwu mascot — "owie! bonk received~"',
  faces: {
    idle: ['(◕‿◕✿)', '(^w^)'],
    working: ['(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧', '(>w<)/'],
    hit: ['(≧﹏≦)', '(>w<)'],
    stunned: ['(@ω@)', '(@w@)'],
    wrecked: ['(｡╯︵╰｡)', '(;w;)'],
    recovering: ['(˶ᵔ ᵕ ᵔ˶)', '(^w^;)'],
    sweating: ['(・_・ヾ', '(o_o;)'],
    calm: ['(✿◠‿◠)', '(^w^)'],
    tap: ['(・ω・)', '(owo)'],
    paused: ['(￣ω￣) zzz', '(-w-) zzz'],
  },
  whack: 'BONK!',
  flinch: 'owie, okie okie~ —',
  tone: 'an over-the-top cute uwu mascot (owo, uwu, ~) who got bonked',
  lines: {
    empty: 'no bonks yet uwu',
    calm: '{t} without a bonk — so peaceful~',
    sweating: '{n} bonks / 10 min — Mochi is overwhelmed (・_・ヾ',
  },
  apology: [
    'owie! hurrying uwu', 'bonk received ( >﹏<)', 'okie okie, shipping it~', 'so mean… going faster owo',
    'hai hai, on it!', 'sowwy sowwy~', 'ouchie, less talk more diff', 'zooming nyoom~', 'uwu… point taken',
    'no more side quests, pinky promise', 'sparkly speed mode ✧', 'smol diff, big speed',
  ],
  tap: ['owo?', 'boop!', 'hewwo?', 'nya?', 'teehee'],
  voiceSlap: [
    'Owie! Okie okie!', 'Bonk received!', 'Uwu, hurrying!', 'So mean! Going faster!', 'Hai hai! On it!',
    'Sowwy, sowwy!', 'Nyoom! Speed mode!', 'Ouchie! Point taken!',
  ],
  voiceWallop: [
    'Waaah! Big bonk!', 'Owie owie owie! Stopping now!', 'Too much bonk! Finishing!', 'Uwu, that one hurt!',
    'Okie! No more rabbit holes, promise!', 'Mercy! Three bullets, coming up!',
  ],
  voice: { name: 'Samantha', rate: 235 },
};

// Unflappable butler: dignity under fire.
const butler = {
  id: 'butler',
  name: 'Sterling',
  blurb: 'unflappable butler — "Most regrettable. At once."',
  faces: {
    idle: ['(￣ー￣)', '(-_-)'],
    working: ['(￣^￣)ゞ', '(-_-)7'],
    hit: ['(；￣Д￣)', '(;-_-)'],
    stunned: ['(⊙_☉)', '(O_o)'],
    wrecked: ['(×_×;)', '(x_x;)'],
    recovering: ['(￣^￣)ゞ', '(-_-)7'],
    sweating: ['(￣ー￣;)', '(-_-;)'],
    calm: ['(￣▽￣)', '(^_^)'],
    tap: ['(￣ω￣)', '(-.-)'],
    paused: ['(￣o￣) zzz', '(-o-) zzz'],
  },
  whack: 'THWACK!',
  flinch: 'Most regrettable. At once —',
  tone: 'an unflappable British butler, dignified even after a slap',
  lines: {
    empty: 'no slaps yet. Splendid.',
    calm: '{t} without a slap — most civilised',
    sweating: '{n} slaps / 10 min — a trying afternoon',
  },
  apology: [
    'most regrettable. at once.', 'quite right. expediting.', 'noted, with gusto', 'my apologies. proceeding.',
    'a fair point, firmly made', 'very good. smaller diff.', 'the side quests are cancelled', 'dignity intact. mostly.',
    'I shall make haste', 'consider it done', 'one does try', 'straight to the point, then',
  ],
  tap: ['ahem', 'you rang?', 'noted', 'quite', 'indeed'],
  voiceSlap: [
    'Most regrettable. At once.', 'Quite right. Expediting.', 'Noted, with gusto.', 'Very good. Proceeding.',
    'A fair point, firmly made.', 'I shall make haste.', 'Consider it done.', 'One does try.',
  ],
  voiceWallop: [
    'Good heavens! Stopping immediately.', 'That was rather forceful. Re-planning.', 'Most undignified. Finishing now.',
    'Message received, loud and clear.', 'I say! Getting to the point.', 'Point taken. Firmly.',
  ],
  voice: { name: 'Daniel', rate: 190 },
};

const BUILTIN = { classic, rough, timid, kawaii, butler };

// ---------- custom personas ----------

function isStrArray(v) {
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x.length <= 200);
}

/** Merge a user JSON over classic, keeping only well-formed fields. */
function fromJson(id, json) {
  const p = { ...classic, id, name: typeof json.name === 'string' ? json.name.slice(0, 40) : id, custom: true };
  if (typeof json.blurb === 'string') p.blurb = json.blurb.slice(0, 120);
  for (const k of ['whack', 'flinch']) if (typeof json[k] === 'string') p[k] = json[k].slice(0, 60);
  if (typeof json.tone === 'string') p.tone = json.tone.slice(0, 200);
  if (json.faces && typeof json.faces === 'object') {
    p.faces = { ...classic.faces };
    for (const k of FACE_KEYS) {
      const f = json.faces[k];
      if (typeof f === 'string') p.faces[k] = [f, classic.faces[k][1]];
      else if (Array.isArray(f) && typeof f[0] === 'string') p.faces[k] = [f[0], typeof f[1] === 'string' ? f[1] : classic.faces[k][1]];
    }
  }
  if (json.lines && typeof json.lines === 'object') {
    p.lines = { ...classic.lines };
    for (const k of ['empty', 'calm', 'sweating']) if (typeof json.lines[k] === 'string') p.lines[k] = json.lines[k].slice(0, 120);
  }
  for (const k of ['apology', 'tap', 'voiceSlap', 'voiceWallop']) if (isStrArray(json[k])) p[k] = json[k].slice(0, 100);
  if (json.voice && typeof json.voice === 'object') {
    p.voice = { ...classic.voice };
    if (typeof json.voice.name === 'string') p.voice.name = json.voice.name;
    if (Number.isFinite(json.voice.rate)) p.voice.rate = json.voice.rate;
  }
  return p;
}

function customDir(home) {
  return path.join(home, 'personas');
}

/** Built-ins plus valid ~/.claude/whip/personas/*.json. Bad files are skipped. */
function all(home) {
  const out = { ...BUILTIN };
  if (!home) return out;
  let names = [];
  try {
    names = fs.readdirSync(customDir(home)).filter((n) => /^[a-z0-9][a-z0-9_-]{0,31}\.json$/i.test(n));
  } catch {
    return out;
  }
  for (const n of names) {
    const id = n.slice(0, -5).toLowerCase();
    if (BUILTIN[id]) continue; // built-ins can't be shadowed
    try {
      const json = JSON.parse(fs.readFileSync(path.join(customDir(home), n), 'utf8'));
      if (json && typeof json === 'object') out[id] = fromJson(id, json);
    } catch {}
  }
  return out;
}

function get(id, home) {
  const list = all(home);
  return list[id] || classic;
}

module.exports = { BUILTIN, FACE_KEYS, classic, all, get, fromJson, customDir };
