// All sound is synthesised: an 80s synthwave band (filtered saw bass, detuned pad, square lead
// with vibrato and tape-style echo, drum machine) on a lookahead sequencer, plus SFX.
// Nothing plays until unlock() runs inside a user gesture (iOS and Chrome autoplay rules).

let ctx = null, master, musicBus, sfxBus, noiseBuf, P25;
let musicOn = true, sfxOn = true;
const MUSIC_VOL = 0.5, SFX_VOL = 0.6;

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

function pulse(duty) {
  const n = 32, real = new Float32Array(n), imag = new Float32Array(n);
  for (let k = 1; k < n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(Math.PI * k * duty);
  return ctx.createPeriodicWave(real, imag);
}

function lowpass(freq, q = 0.7) {
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = freq; f.Q.value = q;
  return f;
}

// Shared graph for the live context and for offline rendering.
function build(c) {
  ctx = c;
  master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.ratio.value = 4;
  const tame = lowpass(7000); // takes the fizz off everything
  master.connect(tame).connect(comp).connect(ctx.destination);
  musicBus = ctx.createGain(); musicBus.gain.value = musicOn ? MUSIC_VOL : 0; musicBus.connect(master);
  sfxBus = ctx.createGain(); sfxBus.gain.value = sfxOn ? SFX_VOL : 0; sfxBus.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  P25 = pulse(0.25);
}

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    build(new AC({ latencyHint: 'interactive' }));
    if (wanted) startSong(wanted);
  }
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
}

export function setMusic(on) { musicOn = on; if (musicBus) musicBus.gain.setTargetAtTime(on ? MUSIC_VOL : 0, ctx.currentTime, 0.05); }
export function setSfx(on) { sfxOn = on; if (sfxBus) sfxBus.gain.setTargetAtTime(on ? SFX_VOL : 0, ctx.currentTime, 0.02); }

export function suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); }
export function resume() { if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); }

// ---------- voices ----------
function tone(t, f, dur, { wave = 'square', vol = 0.2, dest = sfxBus, slide = 0, sustain = false, detune = 0 } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  if (typeof wave === 'string') o.type = wave; else o.setPeriodicWave(wave);
  o.frequency.setValueAtTime(f, t);
  o.detune.value = detune;
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
  if (sustain) g.gain.setValueAtTime(vol * 0.8, t + Math.max(0.01, dur - 0.04));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise(t, dur, { vol = 0.2, hp = 1000, lp = 0, dest = sfxBus } = {}) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf;
  f.type = 'highpass'; f.frequency.value = hp;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let chain = s.connect(f);
  if (lp) chain = chain.connect(lowpass(lp));
  chain.connect(g).connect(dest);
  s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}

// Plucky synthwave bass: sawtooth through a lowpass whose cutoff snaps shut.
function bass(t, m, dur, dest, vol = 0.34) {
  const o = ctx.createOscillator(), f = lowpass(1600, 5), g = ctx.createGain();
  o.type = 'sawtooth';
  o.frequency.value = mtof(m);
  f.frequency.setValueAtTime(1600, t);
  f.frequency.exponentialRampToValueAtTime(220, t + Math.min(dur, 0.25));
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
  g.gain.setValueAtTime(vol * 0.85, t + dur * 0.8);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f).connect(g).connect(dest);
  o.start(t); o.stop(t + dur + 0.02);
}

// Soft chord bed: two detuned saws per note, slow attack, filtered dark.
function pad(t, notes, dur, dest, vol = 0.035) {
  for (const m of notes) for (const dt of [-9, 9]) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = mtof(m);
    o.detune.value = dt;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.25);
    g.gain.setValueAtTime(vol, t + dur - 0.2);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.15);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.2);
  }
}

// Synth-brass stab: detuned saws with a filter that snaps shut.
function stab(t, notes, dur, dest, vol = 0.05) {
  const f = lowpass(3200, 2), g = ctx.createGain();
  f.frequency.setValueAtTime(3200, t);
  f.frequency.exponentialRampToValueAtTime(500, t + 0.18);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
  g.gain.setValueAtTime(vol * 0.7, t + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  f.connect(g).connect(dest);
  for (const m of notes) for (const dt of [-12, 12]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = mtof(m);
    o.detune.value = dt;
    o.connect(f);
    o.start(t); o.stop(t + dur + 0.02);
  }
}

// Overdriven guitar: power-chord saws summed into a tanh waveshaper and a speaker-cab lowpass.
function amp() {
  const shaper = ctx.createWaveShaper(), n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(x * 9); }
  shaper.curve = curve; shaper.oversample = '4x';
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90;
  const cab = lowpass(3000, 0.9), cab2 = lowpass(4500, 0.7), g = ctx.createGain();
  g.gain.value = 0.14;
  hp.connect(shaper).connect(cab).connect(cab2).connect(g);
  return { input: hp, output: g };
}

// Power chord (root, fifth, octave). Muted = short and dark, like a palm-muted chug.
function guitar(t, root, dur, dest, muted = false) {
  const g = ctx.createGain(), f = lowpass(muted ? 700 : 5000, 0.7);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.35, t + 0.004);
  g.gain.setValueAtTime(0.3, t + dur * 0.75);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  f.connect(g).connect(dest);
  for (const [iv, dt] of [[0, -6], [7, 5], [12, 0]]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = mtof(root + iv);
    o.detune.value = dt;
    o.connect(f);
    o.start(t); o.stop(t + dur + 0.02);
  }
}

const tom = (t, f, d) => tone(t, f, 0.22, { wave: 'sine', vol: 0.7, slide: f * 0.5, dest: d });
const crash = (t, d) => noise(t, 1.4, { vol: 0.12, hp: 4500, dest: d });

// Lead: square (or saw) with delayed vibrato, sent through the echo.
function lead(t, m, dur, dest, vol, wave = 'square') {
  const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain();
  o.type = wave;
  o.frequency.value = mtof(m);
  lfo.frequency.value = 5.5;
  depth.gain.setValueAtTime(0, t);
  depth.gain.linearRampToValueAtTime(dur > 0.3 ? 14 : 0, t + Math.min(0.3, dur));
  lfo.connect(depth).connect(o.detune);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.setValueAtTime(vol * 0.75, t + Math.max(0.02, dur - 0.05));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest);
  o.start(t); o.stop(t + dur + 0.02);
  lfo.start(t); lfo.stop(t + dur + 0.02);
}

const kick = (t, d) => { tone(t, 140, 0.22, { wave: 'sine', vol: 1, slide: 42, dest: d }); tone(t, 900, 0.012, { wave: 'triangle', vol: 0.15, dest: d }); };
const snare = (t, d) => { noise(t, 0.2, { vol: 0.32, hp: 900, lp: 6000, dest: d }); tone(t, 185, 0.09, { wave: 'triangle', vol: 0.35, slide: 140, dest: d }); };
const clap = (t, d) => { for (const o of [0, 0.012, 0.024]) noise(t + o, 0.09, { vol: 0.18, hp: 1200, lp: 5000, dest: d }); };
const hat = (t, d, v = 0.06) => noise(t, 0.03, { vol: v, hp: 8000, dest: d });

// ---------- songs ----------
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const toMidi = s => { const m = /^([A-G])(#?)(\d)$/.exec(s); return 12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] ? 1 : 0); };

// One string per bar, 16 steps. "-" holds the previous note, "." is a rest.
function parse(bars) {
  return bars.map(bar => {
    const tk = bar.trim().split(/\s+/), out = new Array(16).fill(null);
    for (let i = 0; i < 16; i++) {
      if (tk[i] === '-' || tk[i] === '.') continue;
      let len = 1;
      while (tk[i + len] === '-') len++;
      out[i] = [toMidi(tk[i]), len];
    }
    return out;
  });
}

const CHORDS = {
  Am: { root: 45, pad: [57, 60, 64], arp: [57, 60, 64, 69] },
  F:  { root: 41, pad: [57, 60, 65], arp: [53, 57, 60, 65] },
  C:  { root: 48, pad: [55, 60, 64], arp: [55, 60, 64, 67] },
  G:  { root: 43, pad: [55, 59, 62], arp: [55, 59, 62, 67] },
  E:  { root: 40, pad: [56, 59, 64], arp: [56, 59, 64, 68] },
};

const SONGS = {
  title: {
    bpm: 150, style: 'action',
    chords: ['Am', 'Am', 'F', 'G', 'Am', 'Am', 'F', 'E'],
    lead: parse([
      'A4 - - - - - E4 - A4 - B4 - C5 - - -',
      'B4 - A4 - G4 - A4 - - - - - . . . .',
      'F4 - - - A4 - C5 - F5 - - - E5 - D5 -',
      'D5 - - - B4 - - - G4 - A4 - B4 - D5 -',
      'E5 - - - - - D5 - C5 - - - B4 - C5 -',
      'A4 - - - - - - - . . A4 - C5 - E5 -',
      'F5 - - - E5 - - - D5 - - - C5 - D5 -',
      'E5 - - - - - - - G#4 - - - B4 - - -',
    ]),
  },
  game: {
    bpm: 132, style: 'game',
    chords: ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G'],
    lead: parse([
      'E4 - A4 - B4 - C5 - B4 - A4 - E4 - - -',
      'F4 - A4 - C5 - A4 - F4 - C5 - A4 - - -',
      'G4 - E4 - G4 - C5 - D5 - C5 - G4 - E4 -',
      'D5 - - - B4 - G4 - B4 - D5 - G4 - - -',
      'A4 . A4 . C5 - B4 - A4 - G4 - A4 - - -',
      'F4 - G4 - A4 - C5 - A4 - G4 - F4 - - -',
      'E4 - G4 - C5 - E5 - D5 - C5 - B4 - G4 -',
      'B4 - - - D5 - - - G4 - A4 - B4 - D5 -',
    ]),
  },
};

let wanted = null, current = null, song = null, timer = null, step = 0, nextTime = 0, bpm = 120, intensity = 0;

// Per-song mixer: separate filtered buses, plus an echo the lead and arp feed.
function mixer() {
  const out = ctx.createGain(); out.connect(musicBus);
  const bus = (freq, q, vol = 1) => { const f = lowpass(freq, q), g = ctx.createGain(); g.gain.value = vol; f.connect(g).connect(out); return f; };
  const echo = ctx.createDelay(1), fb = ctx.createGain(), wet = ctx.createGain(), dark = lowpass(1800);
  echo.delayTime.value = 0.75 * 60 / bpm; // dotted eighth
  fb.gain.value = 0.33; wet.gain.value = 0.3;
  echo.connect(dark).connect(fb).connect(echo);
  dark.connect(wet).connect(out);
  const gtr = amp(); gtr.output.connect(out);
  const m = { out, echo, drums: out, gtr: gtr.input, bass: bus(2400, 0.7), pad: bus(1300, 1), lead: bus(2800, 1.5), arp: bus(2200, 0.7, 0.8) };
  m.lead.connect(echo); m.arp.connect(echo);
  return m;
}

function scheduleStep(s, t) {
  const bar = Math.floor(s / 16) % song.def.lead.length, i = s % 16;
  const ch = CHORDS[song.def.chords[bar]];
  const sd = 60 / bpm / 4, m = song.mix;

  if (song.def.style === 'game') {
    if (i === 0) pad(t, ch.pad, sd * 16, m.pad, 0.028);
    if (i % 2 === 0) bass(t, ch.root + (i % 4 === 2 ? 12 : 0), sd * 1.8, m.bass);
    if (intensity > 1) tone(t, mtof(ch.arp[s % 4]), sd * 0.9, { wave: 'triangle', vol: 0.09, dest: m.arp });
    if (i % 4 === 0) kick(t, m.drums);
    if (i === 4 || i === 12) { snare(t, m.drums); clap(t, m.drums); }
    if (i % 4 === 2) hat(t, m.drums, 0.07);
    if (intensity > 3 && i % 2 === 1) hat(t, m.drums, 0.035);
  } else if (song.def.style === 'action') {
    // synth rock: palm-muted chugs with open accents, synth stabs on top, rock beat, tom fill every 4th bar
    const accent = i === 0 || i === 6 || i === 10;
    if (accent) guitar(t, ch.root, sd * (i === 10 ? 5.5 : 3.5), m.gtr);
    else if (i % 2 === 0) guitar(t, ch.root, sd * 0.9, m.gtr, true);
    if (i % 2 === 0) bass(t, ch.root, sd * 1.8, m.bass, 0.28);
    if ([0, 6, 10].includes(i)) stab(t, ch.pad.map(n => n + 12), sd * (i === 10 ? 4 : 2), m.pad, 0.025);
    const fill = bar % 4 === 3 && i >= 12;
    if ((i === 0 || i === 8 || i === 10) && !fill) kick(t, m.drums);
    if ((i === 4 || i === 12) && !fill) { snare(t, m.drums); clap(t, m.drums); }
    if (fill) tom(t, [220, 175, 140, 110][i - 12], m.drums);
    if (i % 2 === 0) hat(t, m.drums, 0.05);
    if (i === 0 && bar % 4 === 0) crash(t, m.drums);
  } else {
    if (i === 0) pad(t, ch.pad, sd * 16, m.pad, 0.04);
    if (i === 0 || i === 6 || i === 10 || i === 14) bass(t, ch.root + (i === 10 ? 12 : 0), sd * (i === 0 ? 5 : 3), m.bass, 0.3);
    if (i % 2 === 0) tone(t, mtof(ch.arp[(s / 2) % 4] + 12), sd * 1.5, { wave: 'triangle', vol: 0.07, dest: m.arp });
    if (i === 0 || i === 10) kick(t, m.drums);
    if (i === 8) { snare(t, m.drums); clap(t, m.drums); }
    if (i % 4 === 2) hat(t, m.drums, 0.04);
  }
  const n = song.def.lead[bar][i];
  if (n) {
    if (song.def.style === 'action') { lead(t, n[0], n[1] * sd * 0.95, m.lead, 0.07, 'sawtooth'); lead(t, n[0] - 12, n[1] * sd * 0.95, m.lead, 0.05, 'square'); }
    else lead(t, n[0], n[1] * sd * 0.95, m.lead, song.def.style === 'game' ? 0.11 : 0.09);
  }
}

function pump() {
  while (nextTime < ctx.currentTime + 0.12) {
    scheduleStep(step, nextTime);
    nextTime += 60 / bpm / 4;
    step++;
  }
}

function startSong(name) {
  stopSong();
  current = name;
  bpm = SONGS[name].bpm;
  intensity = 0;
  song = { def: SONGS[name], mix: mixer() };
  step = 0;
  nextTime = ctx.currentTime + 0.06;
  timer = setInterval(pump, 25);
}

function stopSong() {
  clearInterval(timer); timer = null;
  if (song) {
    const out = song.mix.out;
    out.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
    setTimeout(() => out.disconnect(), 600);
    song = null;
  }
  current = null;
}

export function playSong(name) {
  wanted = name;
  if (!ctx || current === name) return;
  if (name) startSong(name); else stopSong();
}

export function setLevel(level, base = 132) {
  intensity = level;
  if (current !== 'game') return;
  bpm = Math.min(180, base - 8 + (level - 1) * 5);
  song.mix.echo.delayTime.setTargetAtTime(0.75 * 60 / bpm, ctx.currentTime, 0.1);
}

// Renders a song offline to an AudioBuffer, for listening tests outside the game.
export async function renderSong(name, seconds, level = 1) {
  const off = new OfflineAudioContext(2, 44100 * seconds, 44100);
  build(off);
  current = name; bpm = SONGS[name].bpm; intensity = 0;
  song = { def: SONGS[name], mix: mixer() };
  if (name === 'game') { current = 'game'; setLevel(level); }
  for (step = 0, nextTime = 0.05; nextTime < seconds; step++, nextTime += 60 / bpm / 4) scheduleStep(step, nextTime);
  return off.startRendering();
}

// ---------- SFX ----------
export function sfx(name, n = 0) {
  if (!ctx || !sfxOn) return;
  const t = ctx.currentTime + 0.005;
  switch (name) {
    case 'key': tone(t, 740, 0.035, { wave: 'triangle', vol: 0.18 }); break;
    case 'select': tone(t, 523, 0.06, { vol: 0.08 }); tone(t + 0.06, 784, 0.09, { vol: 0.08 }); break;
    case 'back': tone(t, 587, 0.06, { vol: 0.07 }); tone(t + 0.06, 392, 0.09, { vol: 0.07 }); break;
    case 'correct': {
      const b = 64 + Math.min(Math.max(n - 1, 0), 12);
      tone(t, mtof(b), 0.07, { vol: 0.11 });
      tone(t + 0.06, mtof(b + 7), 0.14, { vol: 0.11 });
      tone(t + 0.06, mtof(b + 7), 0.14, { wave: 'triangle', vol: 0.2 });
      break;
    }
    case 'wrong':
      tone(t, 180, 0.38, { wave: 'sawtooth', vol: 0.2, slide: 50 });
      tone(t, 130, 0.38, { wave: 'square', vol: 0.1, slide: 40 });
      noise(t, 0.2, { vol: 0.15, hp: 200, lp: 2000 });
      break;
    case 'tick': tone(t, 1050, 0.03, { wave: 'triangle', vol: 0.18 }); break;
    case 'combo': [72, 76, 79, 84, 88].forEach((m, i) => tone(t + i * 0.04, mtof(m), 0.09, { wave: 'triangle', vol: 0.22 })); break;
    case 'level': [60, 64, 67, 72, 67, 72, 76].forEach((m, i) => tone(t + i * 0.06, mtof(m), 0.11, { wave: P25, vol: 0.1 })); break;
    case 'oneup': [64, 67, 76, 72, 74, 79].forEach((m, i) => tone(t + i * 0.07, mtof(m), 0.1, { vol: 0.09 })); break;
    case 'count': tone(t, 392, 0.14, { wave: P25, vol: 0.12 }); break;
    case 'go': tone(t, 784, 0.35, { wave: P25, vol: 0.12, sustain: true }); tone(t, 392, 0.35, { wave: 'triangle', vol: 0.25, sustain: true }); break;
    case 'gameover': [69, 67, 64, 60, 57, 52, 45].forEach((m, i) => tone(t + i * 0.17, mtof(m - 12), 0.24, { vol: 0.13 })); break;
    case 'finish': [60, 67, 72].forEach((m, i) => tone(t + i * 0.1, mtof(m), 0.18, { wave: P25, vol: 0.12 })); break;
    case 'tally': tone(t, 880 + n * 20, 0.03, { wave: 'triangle', vol: 0.12 }); break;
    case 'thud': tone(t, 110, 0.12, { vol: 0.16, slide: 55 }); noise(t, 0.1, { vol: 0.12, hp: 150, lp: 1500 }); break;
    case 'best':
      [[60, 0, 0.1], [60, 0.12, 0.1], [60, 0.24, 0.1], [65, 0.36, 0.3], [64, 0.7, 0.1], [65, 0.82, 0.1], [72, 0.94, 0.55]]
        .forEach(([m, d, l]) => { tone(t + d, mtof(m), l, { wave: P25, vol: 0.11, sustain: true }); tone(t + d, mtof(m - 12), l, { wave: 'triangle', vol: 0.3, sustain: true }); });
      break;
    case 'star': tone(t, mtof(76 + n * 4), 0.2, { wave: 'triangle', vol: 0.24 }); tone(t + 0.06, mtof(83 + n * 4), 0.22, { wave: 'triangle', vol: 0.16 }); break;
  }
}
