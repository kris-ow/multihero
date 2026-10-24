// All sound is synthesised: pulse-wave chiptune music on a lookahead sequencer, plus SFX.
// Nothing plays until unlock() runs inside a user gesture (iOS and Chrome autoplay rules).

let ctx = null, master, musicBus, sfxBus, noiseBuf;
let P12, P25;
let musicOn = true, sfxOn = true;
const MUSIC_VOL = 0.32, SFX_VOL = 0.7;

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

function pulse(duty) {
  const n = 48, real = new Float32Array(n), imag = new Float32Array(n);
  for (let k = 1; k < n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(Math.PI * k * duty);
  return ctx.createPeriodicWave(real, imag);
}

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.gain.value = musicOn ? MUSIC_VOL : 0; musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = sfxOn ? SFX_VOL : 0; sfxBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    P12 = pulse(0.125); P25 = pulse(0.25);
    if (wanted) startSong(wanted);
  }
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
}

export function setMusic(on) { musicOn = on; if (musicBus) musicBus.gain.setTargetAtTime(on ? MUSIC_VOL : 0, ctx.currentTime, 0.05); }
export function setSfx(on) { sfxOn = on; if (sfxBus) sfxBus.gain.setTargetAtTime(on ? SFX_VOL : 0, ctx.currentTime, 0.02); }

export function suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); }
export function resume() { if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); }

// ---------- voices ----------
function tone(t, f, dur, { wave = 'square', vol = 0.2, dest = sfxBus, slide = 0, sustain = false } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  if (typeof wave === 'string') o.type = wave; else o.setPeriodicWave(wave);
  o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
  if (sustain) g.gain.setValueAtTime(vol * 0.8, t + Math.max(0.01, dur - 0.03));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise(t, dur, { vol = 0.2, hp = 1000, dest = sfxBus } = {}) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf;
  f.type = 'highpass'; f.frequency.value = hp;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(dest);
  s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}

const kick = (t, d) => tone(t, 160, 0.14, { wave: 'sine', vol: 0.9, slide: 40, dest: d });
const snare = (t, d) => { noise(t, 0.13, { vol: 0.35, hp: 1800, dest: d }); tone(t, 190, 0.06, { wave: 'triangle', vol: 0.3, dest: d }); };
const hat = (t, d, v = 0.12) => noise(t, 0.035, { vol: v, hp: 7500, dest: d });

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
  Am: { root: 45, arp: [69, 72, 76] },
  F:  { root: 41, arp: [65, 69, 72] },
  C:  { root: 48, arp: [67, 72, 76] },
  G:  { root: 43, arp: [67, 71, 74] },
  E:  { root: 40, arp: [68, 71, 76] },
};

const SONGS = {
  title: {
    bpm: 112, style: 'title',
    chords: ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'E'],
    lead: parse([
      'A4 - - - C5 - - - E5 - - - D5 - C5 -',
      'C5 - - - A4 - - - F4 - - - A4 - - -',
      'G4 - - - C5 - - - E5 - - - G5 - - -',
      'F5 - E5 - D5 - - - B4 - - - . . . .',
      'A4 - - - C5 - - - E5 - - - A5 - - -',
      'A5 - G5 - F5 - - - C5 - - - A4 - - -',
      'G4 - - - C5 - E5 - G5 - - - E5 - C5 -',
      'B4 - - - - - - - G#4 - - - - - - -',
    ]),
  },
  game: {
    bpm: 140, style: 'game',
    chords: ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G'],
    lead: parse([
      'E5 - A5 - B5 - C6 - B5 - A5 - E5 - - -',
      'F5 - A5 - C6 - A5 - F5 - C6 - A5 - - -',
      'G5 - E5 - G5 - C6 - D6 - C6 - G5 - E5 -',
      'D6 - - - B5 - G5 - B5 - D6 - G5 - - -',
      'A5 . A5 . C6 - B5 - A5 - G5 - A5 - - -',
      'F5 - G5 - A5 - C6 - A5 - G5 - F5 - - -',
      'E5 - G5 - C6 - E6 - D6 - C6 - B5 - G5 -',
      'B5 - - - D6 - - - G5 - A5 - B5 - D6 -',
    ]),
  },
};

let wanted = null, current = null, songBus = null, timer = null, step = 0, nextTime = 0, bpm = 120, intensity = 0;

function scheduleStep(s, t) {
  const song = SONGS[current];
  const bar = Math.floor(s / 16) % song.lead.length, i = s % 16;
  const ch = CHORDS[song.chords[bar]];
  const sd = 60 / bpm / 4, d = songBus;

  if (song.style === 'game') {
    if (i % 2 === 0) tone(t, mtof(ch.root + (i % 4 === 2 ? 12 : 0)), sd * 1.7, { wave: P25, vol: 0.32, dest: d });
    tone(t, mtof(ch.arp[s % 3] + (i >= 8 ? 12 : 0)), sd * 0.8, { wave: P12, vol: 0.07, dest: d });
    if (i % 4 === 0) kick(t, d);
    if (i === 4 || i === 12) snare(t, d);
    if (i % 4 === 2 || (intensity > 2 && i % 2 === 1)) hat(t, d);
    if (intensity > 4 && i === 14) snare(t, d);
  } else {
    if (i % 4 === 0 || i === 6 || i === 14) tone(t, mtof(ch.root + (i === 6 ? 12 : 0)), sd * 2.5, { wave: 'triangle', vol: 0.55, dest: d });
    if (i % 2 === 0) tone(t, mtof(ch.arp[(s / 2) % 3] + 12), sd * 1.6, { wave: P12, vol: 0.05, dest: d });
    if (i === 0) kick(t, d);
    if (i === 8) snare(t, d);
    if (i % 4 === 2) hat(t, d, 0.07);
  }
  const n = song.lead[bar][i];
  if (n) tone(t, mtof(n[0]), n[1] * sd * 0.92, { wave: P25, vol: song.style === 'game' ? 0.14 : 0.12, dest: d, sustain: true });
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
  songBus = ctx.createGain();
  songBus.connect(musicBus);
  step = 0;
  nextTime = ctx.currentTime + 0.06;
  timer = setInterval(pump, 25);
}

function stopSong() {
  clearInterval(timer); timer = null;
  if (songBus) {
    const b = songBus;
    b.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
    setTimeout(() => b.disconnect(), 400);
    songBus = null;
  }
  current = null;
}

export function playSong(name) {
  wanted = name;
  if (!ctx || current === name) return;
  if (name) startSong(name); else stopSong();
}

export function setLevel(level, hard = false) {
  intensity = level;
  if (current === 'game') bpm = Math.min(196, (hard ? 152 : 140) + (level - 1) * 6);
}

// ---------- SFX ----------
export function sfx(name, n = 0) {
  if (!ctx || !sfxOn) return;
  const t = ctx.currentTime + 0.005;
  switch (name) {
    case 'key': tone(t, 1320, 0.035, { vol: 0.07 }); break;
    case 'select': tone(t, 660, 0.05, { wave: P25, vol: 0.12 }); tone(t + 0.05, 990, 0.08, { wave: P25, vol: 0.12 }); break;
    case 'back': tone(t, 700, 0.05, { wave: P25, vol: 0.1 }); tone(t + 0.05, 470, 0.08, { wave: P25, vol: 0.1 }); break;
    case 'correct': {
      const b = 72 + Math.min(Math.max(n - 1, 0), 15);
      tone(t, mtof(b), 0.06, { wave: P25, vol: 0.2 });
      tone(t + 0.055, mtof(b + 7), 0.12, { wave: P25, vol: 0.2 });
      break;
    }
    case 'wrong':
      tone(t, 200, 0.38, { wave: 'sawtooth', vol: 0.22, slide: 50 });
      tone(t, 140, 0.38, { wave: 'square', vol: 0.12, slide: 40 });
      noise(t, 0.22, { vol: 0.18, hp: 300 });
      break;
    case 'tick': tone(t, 2000, 0.025, { vol: 0.06 }); break;
    case 'combo': [84, 88, 91, 96, 100].forEach((m, i) => tone(t + i * 0.035, mtof(m), 0.08, { wave: P12, vol: 0.12 })); break;
    case 'level': [72, 76, 79, 84, 79, 84, 88].forEach((m, i) => tone(t + i * 0.055, mtof(m), 0.1, { wave: P25, vol: 0.16 })); break;
    case 'oneup': [76, 79, 88, 84, 86, 91].forEach((m, i) => tone(t + i * 0.07, mtof(m), 0.09, { wave: 'square', vol: 0.12 })); break;
    case 'count': tone(t, 440, 0.12, { wave: P25, vol: 0.18 }); break;
    case 'go': tone(t, 880, 0.35, { wave: P25, vol: 0.2, sustain: true }); tone(t, 1320, 0.35, { wave: P12, vol: 0.08, sustain: true }); break;
    case 'gameover': [69, 67, 64, 60, 57, 52, 45].forEach((m, i) => tone(t + i * 0.17, mtof(m), 0.22, { wave: 'square', vol: 0.16 })); break;
    case 'finish': [72, 79, 84].forEach((m, i) => tone(t + i * 0.1, mtof(m), 0.16, { wave: P25, vol: 0.18 })); break;
    case 'tally': tone(t, 1600 + n * 40, 0.03, { vol: 0.05 }); break;
    case 'thud': tone(t, 120, 0.12, { wave: 'square', vol: 0.2, slide: 60 }); noise(t, 0.1, { vol: 0.15, hp: 200 }); break;
    case 'best':
      [[72, 0, 0.1], [72, 0.12, 0.1], [72, 0.24, 0.1], [77, 0.36, 0.3], [76, 0.7, 0.1], [77, 0.82, 0.1], [84, 0.94, 0.55]]
        .forEach(([m, d, l]) => { tone(t + d, mtof(m), l, { wave: P25, vol: 0.18, sustain: true }); tone(t + d, mtof(m - 12), l, { wave: 'triangle', vol: 0.3, sustain: true }); });
      break;
    case 'star': tone(t, mtof(84 + n * 4), 0.18, { wave: P12, vol: 0.16 }); tone(t + 0.06, mtof(91 + n * 4), 0.2, { wave: P12, vol: 0.12 }); break;
  }
}
