#!/usr/bin/env node
'use strict';
// Synthesises the three sound effects from scratch (noise + sine maths), so
// they are original work released under CC0. Run: node scripts/gen-sounds.js
const fs = require('fs');
const path = require('path');
const { rng } = require('../lib/pools');

const RATE = 44100;

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.max(-1, Math.min(1, s)) * 32767, i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

// A whip crack: a rising "whoosh" (filtered noise) then a sharp broadband snap.
function crack({ whooshMs = 180, snapMs = 60, gain = 0.9, seed = 7 } = {}) {
  const rand = rng(seed);
  const n = Math.floor(((whooshMs + snapMs + 120) / 1000) * RATE);
  const out = new Float32Array(n);
  let lp = 0;
  const w = Math.floor((whooshMs / 1000) * RATE);
  const s = Math.floor((snapMs / 1000) * RATE);
  for (let i = 0; i < n; i++) {
    const noise = rand() * 2 - 1;
    if (i < w) {
      const t = i / w;
      const a = 0.02 + 0.15 * t * t; // swell
      const k = 0.02 + 0.3 * t; // filter opens as the tip accelerates
      lp += k * (noise - lp);
      out[i] = lp * a * 3;
    } else if (i < w + s) {
      const t = (i - w) / s;
      const env = Math.exp(-t * 6);
      out[i] = (noise * 0.8 + Math.sin(i * 0.9) * 0.4) * env * gain;
    } else {
      const t = (i - w - s) / (n - w - s);
      out[i] = (rand() * 2 - 1) * 0.05 * Math.exp(-t * 8); // room tail
    }
  }
  return Array.from(out);
}

function tap() {
  const n = Math.floor(0.12 * RATE);
  return Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 520 * i) / RATE) * Math.exp(-i / (0.025 * RATE)) * 0.6);
}

function wallop() {
  const a = crack({ whooshMs: 260, snapMs: 90, gain: 1, seed: 11 });
  const boomN = Math.floor(0.35 * RATE);
  const boom = Array.from({ length: boomN }, (_, i) => Math.sin(2 * Math.PI * (70 - 30 * (i / boomN)) * (i / RATE)) * Math.exp(-i / (0.09 * RATE)) * 0.9);
  const start = Math.floor(0.26 * RATE);
  const out = a.concat(new Array(Math.max(0, start + boomN - a.length)).fill(0));
  boom.forEach((v, i) => (out[start + i] = Math.max(-1, Math.min(1, out[start + i] + v))));
  return out;
}

const dir = path.join(__dirname, '..', 'sounds');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'tap.wav'), wav(tap()));
fs.writeFileSync(path.join(dir, 'crack.wav'), wav(crack()));
fs.writeFileSync(path.join(dir, 'wallop.wav'), wav(wallop()));
console.log('wrote sounds/tap.wav, sounds/crack.wav, sounds/wallop.wav');
