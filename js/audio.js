// All sound is synthesised: classical themes played by a synth band (saw bass, warm pad, arp,
// saw/square lead with vibrato and echo, drum machine) on a lookahead sequencer, plus SFX.
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

// Warm pad: detuned saws under a slowly opening lowpass, held for the whole chord.
function pad(t, notes, dur, dest, vol) {
  const f = lowpass(600, 1), g = ctx.createGain();
  f.frequency.setValueAtTime(600, t);
  f.frequency.linearRampToValueAtTime(1500, t + dur * 0.6);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.08);
  g.gain.setValueAtTime(vol, t + Math.max(0.1, dur - 0.08));
  g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.06);
  f.connect(g).connect(dest);
  for (const m of notes) for (const dt of [-8, 8]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = mtof(m);
    o.detune.value = dt;
    o.connect(f);
    o.start(t); o.stop(t + dur + 0.1);
  }
}

// Short plucked chord (the "pah" of an oom-pah).
const pluck = (t, notes, dur, dest, vol = 0.035) => notes.forEach(m => tone(t, mtof(m), dur, { wave: 'triangle', vol, dest }));

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
// Classical themes arranged for synth. Each song plays its score twice: a sparse first
// pass, then a full one, so the loop is over a minute and the restart is not obvious.
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const toMidi = s => { const m = /^([A-G])(#?)(\d)$/.exec(s); return 12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] ? 1 : 0); };

// One string per bar of `per` tokens (8 = eighths, 16 = sixteenths); "|" is ignored, "-" holds
// the previous note, "." is a rest. Returns 16 steps per bar: [midi, steps] or null.
function parse(bars, per, transpose = 0) {
  const k = 16 / per;
  return bars.map(bar => {
    const tk = bar.trim().split(/\s+/).filter(x => x !== '|'), out = new Array(16).fill(null);
    if (tk.length !== per) throw new Error(`bar has ${tk.length} tokens, want ${per}: ${bar}`);
    for (let i = 0; i < per; i++) {
      if (tk[i] === '-' || tk[i] === '.') continue;
      let len = 1;
      while (tk[i + len] === '-') len++;
      out[i * k] = [toMidi(tk[i]) + transpose, len * k];
    }
    return out;
  });
}

// "Am", "F#", "D": bass root in E2..D#3, pad triad voiced into G3..F#4, arp = pad plus octave.
function chord(name) {
  const m = /^([A-G])(#?)(m?)$/.exec(name), pc = NOTE[m[1]] + (m[2] ? 1 : 0);
  const root = 36 + pc + (pc < 4 ? 12 : 0);
  const pad = [0, m[3] ? 3 : 4, 7].map(iv => 55 + ((pc + iv - 55) % 12 + 12) % 12).sort((a, b) => a - b);
  return { root, pad, arp: [...pad, pad[0] + 12] };
}
const CH = {};
const chordAt = (bar, i) => { const h = bar.split('|'), n = h[Math.floor(i * h.length / 16)]; return CH[n] || (CH[n] = chord(n)); };

// Grieg, In the Hall of the Mountain King: theme in B minor twice, the F# major answer twice,
// theme twice more.
const MK_A = ['B3 C#4 D4 E4 F#4 D4 F#4 -', 'F4 C#4 F4 - E4 C4 E4 -', 'B3 C#4 D4 E4 F#4 D4 F#4 B4', 'A4 F#4 D4 F#4 A4 - - -'];
const MK_B = ['F#4 G#4 A#4 B4 C#5 A#4 C#5 -', 'D5 A#4 D5 - C#5 A#4 C#5 -', 'F#4 G#4 A#4 B4 C#5 A#4 C#5 -', 'D5 A#4 D5 - C#5 - - -'];
const MK_AC = ['Bm', 'F#|C', 'Bm', 'D'], MK_BC = ['F#', 'F#', 'F#', 'F#'];

// Pachelbel, Canon in D: the ground bass under the first three violin variations, and, as in
// the original, a second voice playing each variation one cycle behind the first.
const CN_REST = '. . . . . . . .';
const CN_V = [['F#5 - E5 - D5 - C#5 -', 'B4 - A4 - B4 - C#5 -'], ['D5 - C#5 - B4 - A4 -', 'G4 - F#4 - G4 - E4 -'],
  ['D5 F#5 A5 G5 F#5 D5 F#5 E5', 'D5 B4 D5 A4 G4 B4 A4 G4']];
const CN_LEAD = [[CN_REST, CN_REST], ...CN_V, ...CN_V].flat(), CN_COUNTER = [[CN_REST, CN_REST], [CN_REST, CN_REST], ...CN_V, CN_V[0], CN_V[1]].flat();
const CN_C = Array(7).fill(['D|A|Bm|F#m', 'G|D|G|A']).flat();

// Mozart, Rondo alla Turca (A minor): theme, theme with its ending, the C major episode, theme
// again. Two 2/4 bars per line, each ending with the pickup into the next phrase.
const RT_1 = 'C5 - - . D5 C5 B4 C5 | E5 - - . F5 E5 D#5 E5', RT_2 = 'B5 A5 G#5 A5 B5 A5 G#5 A5';
const RT_END = [`${RT_2} | C6 - - - A5 - B5 -`, 'C6 - B5 - A5 - G#5 - | A5 - E5 - F5 - D5 -'];
const RT_EP = ['G5 - G5 - A5 G5 F5 E5 | D5 - - - . . E5 F5', 'G5 - G5 - A5 G5 F5 E5 | D5 - - - . . C5 D5',
  'E5 - E5 - F5 E5 D5 C5 | B4 - - - . . C5 D5', 'E5 - E5 - F5 E5 D5 C5 | B4 - - - B4 A4 G#4 A4'];
const RT = [RT_1, `${RT_2} | C6 - - - A5 - C6 -`, 'B5 - A5 - G#5 - A5 - | B5 - A5 - G#5 - A5 -', 'B5 - A5 - G#5 - F#5 - | E5 - - - B4 A4 G#4 A4',
  RT_1, ...RT_END, 'C5 - - - B4 - - - | A4 - - - . . E5 F5', ...RT_EP,
  RT_1, ...RT_END, 'C5 - - - B4 - - - | A4 - - - B4 A4 G#4 A4'];
const RT_C = ['Am|Am', 'E|Am', 'E|Am', 'E|E', 'Am|Am', 'E|Am', 'E|Dm', 'E|Am',
  'C|G', 'C|G', 'Am|E', 'Am|E', 'Am|Am', 'E|Am', 'E|Dm', 'E|Am'];

const SONGS = {
  title: { bpm: 84, style: 'canon', chords: CN_C, lead: parse(CN_LEAD, 8, -12), counter: parse(CN_COUNTER, 8, -12) },
  game: {
    bpm: 138, builds: true, style: 'march',
    chords: [...MK_AC, ...MK_AC, ...MK_BC, ...MK_BC, ...MK_AC, ...MK_AC],
    lead: parse([...MK_A, ...MK_A, ...MK_B, ...MK_B, ...MK_A, ...MK_A], 8),
  },
  hardcore: { bpm: 150, builds: true, style: 'turca', chords: RT_C, lead: parse(RT, 16, -12) },
};

let wanted = null, current = null, song = null, timer = null, step = 0, nextTime = 0, bpm = 120, intensity = 0;

// Per-song mixer: separate filtered buses, plus an echo the lead and arp feed.
function mixer() {
  const out = ctx.createGain(); out.connect(musicBus);
  const bus = (freq, q, vol = 1) => { const f = lowpass(freq, q), g = ctx.createGain(); g.gain.value = vol; f.connect(g).connect(out); return f; };
  const echo = ctx.createDelay(1), fb = ctx.createGain(), wet = ctx.createGain(), dark = lowpass(1800);
  echo.delayTime.value = 0.75 * 60 / bpm; // dotted eighth
  fb.gain.value = 0.3; wet.gain.value = 0.28;
  echo.connect(dark).connect(fb).connect(echo);
  dark.connect(wet).connect(out);
  const m = { out, echo, drums: out, bass: bus(2400, 0.7), pad: bus(1600, 0.7), lead: bus(2800, 1.2), arp: bus(2200, 0.7, 0.8) };
  m.lead.connect(echo); m.arp.connect(echo);
  return m;
}

// Each style is the band's part around the tune: bass line and drums for one 16th step.
// `full` is the second pass (or a high level); `lvl` only rises in songs marked `builds`.
const STYLES = {
  // Mountain King: staccato root-fifth march, eighth-note octaves once it gets going.
  march: { dbl: -12, bass(t, i, ch, sd, m, full, lvl) {
    if (full || lvl >= 3) { if (i % 2 === 0) bass(t, ch.root + (i % 4 ? 12 : 0), sd * 1.2, m.bass, 0.26); }
    else if (i % 4 === 0) bass(t, ch.root + (i % 8 ? 7 : 0), sd * 1.4, m.bass, 0.3);
  }, drums(t, i, sd, m, full, lvl) {
    if (i === 0 || i === 8 || (lvl >= 5 && i % 4 === 0)) kick(t, m.drums);
    if (full && (i === 4 || i === 12)) snare(t, m.drums);
    if (i % 4 === 2 || (full && i % 2 === 0) || (lvl >= 4 && i % 2)) hat(t, m.drums, i % 2 ? 0.025 : 0.045);
  } },
  // Canon: legato ground bass, octave bounces and a soft backbeat on the full pass.
  canon: { dbl: 12, bass(t, i, ch, sd, m, full) {
    if (i % 4 === 0) bass(t, ch.root, sd * 3.8, m.bass, 0.28);
    else if (full && i % 4 === 2) bass(t, ch.root + 12, sd * 1.5, m.bass, 0.16);
  }, drums(t, i, sd, m, full) {
    if (!full) return;
    if (i === 0 || i === 10) kick(t, m.drums);
    if (i === 4 || i === 12) snare(t, m.drums);
    if (i % 2 === 0) hat(t, m.drums, i % 4 ? 0.025 : 0.04);
  } },
  // Rondo alla Turca: oom-pah, bass on the beat and a light plucked chord off it.
  turca: { dbl: 12, bass(t, i, ch, sd, m, full, lvl) {
    if (i % 4 === 0) bass(t, ch.root + (i % 8 ? 7 : 0), sd * 1.6, m.bass, 0.3);
    if (i % 4 === 2) pluck(t, ch.pad, sd * 1.2, m.arp, full || lvl >= 3 ? 0.04 : 0.03);
  }, drums(t, i, sd, m, full, lvl) {
    if (i % 8 === 0 || (full && i % 4 === 0) || lvl >= 5 && i % 4 === 0) kick(t, m.drums);
    if (full && (i === 4 || i === 12)) snare(t, m.drums);
    if (i % 4 === 2 || (lvl >= 3 && i % 2 === 0)) hat(t, m.drums, 0.04);
  } },
};

function scheduleStep(s, t) {
  const def = song.def, n = def.lead.length, abs = Math.floor(s / 16), bar = abs % n, i = s % 16;
  const sd = 60 / bpm / 4, m = song.mix, st = STYLES[def.style];
  const lvl = def.builds ? intensity : 0, full = abs % (2 * n) >= n || lvl >= 6;
  const spec = def.chords[bar], ch = chordAt(spec, i), span = 16 / spec.split('|').length;

  if (i % span === 0) pad(t, ch.pad, sd * span, m.pad, full ? 0.022 : 0.016);
  st.bass(t, i, ch, sd, m, full, lvl);
  if ((full || lvl >= 2) && i % 2 === 0) tone(t, mtof(ch.arp[(i / 2) % 4] + 12), sd * 1.6, { wave: 'triangle', vol: 0.045, dest: m.arp });

  const fill = full && bar % 8 === 7 && i >= 12;
  if (fill) tom(t, [220, 175, 140, 110][i - 12], m.drums);
  else st.drums(t, i, sd, m, full, lvl);
  if (i === 0 && bar % 8 === 0 && full) crash(t, m.drums);

  const note = def.lead[bar][i];
  if (note) {
    const d = note[1] * sd * 0.92;
    if (full) {
      lead(t, note[0], d, m.lead, 0.065, 'sawtooth');
      lead(t, note[0] + st.dbl, d, m.lead, st.dbl > 0 ? 0.025 : 0.045, 'square');
    } else lead(t, note[0], d, m.lead, 0.07, 'square');
  }
  const cn = def.counter && def.counter[bar][i];
  if (cn) lead(t, cn[0], cn[1] * sd * 0.92, m.lead, full ? 0.04 : 0.03, 'triangle');
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

export function setLevel(level, base = 138) {
  intensity = level;
  if (!song || !song.def.builds) return;
  bpm = Math.min(180, base + (level - 1) * 5);
  song.mix.echo.delayTime.setTargetAtTime(0.75 * 60 / bpm, ctx.currentTime, 0.1);
}

// Renders a song offline to an AudioBuffer, for listening tests outside the game.
export async function renderSong(name, seconds, level = 1) {
  const off = new OfflineAudioContext(2, 44100 * seconds, 44100);
  build(off);
  current = name; bpm = SONGS[name].bpm; intensity = 0;
  song = { def: SONGS[name], mix: mixer() };
  setLevel(level, bpm);
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
