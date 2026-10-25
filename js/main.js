import * as Store from './storage.js';
import * as Audio from './audio.js';
import * as FX from './fx.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const fmt = n => n.toLocaleString('en-US');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const vibrate = ms => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };
const coarse = matchMedia('(pointer: coarse)').matches;

// ---------- pixel sprites ----------
function sprite(rows, color) {
  const w = rows[0].length, h = rows.length;
  let r = '';
  rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === 'X') r += `<rect x="${x}" y="${y}" width="1.02" height="1.02"/>`; }));
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" fill="${color}">${r}</svg>`)}`;
}
const HEART = sprite(['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'], '#ff2050');
const STAR_ON = sprite(['...X...', '..XXX..', 'XXXXXXX', '.XXXXX.', '.XXXXX.', 'XX...XX'], '#ffe600');
const STAR_OFF = sprite(['...X...', '..XXX..', 'XXXXXXX', '.XXXXX.', '.XXXXX.', 'XX...XX'], '#3a2a5a');
const starsHTML = n => `<span class="stars">${[0, 1, 2].map(i => `<img src="${i < n ? STAR_ON : STAR_OFF}" alt="">`).join('')}</span>`;

// ---------- screens ----------
let screen = 'splash';
function show(id) {
  screen = id;
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === 's-' + id));
  if (!coarse && id !== 'game') {
    const first = document.querySelector(`#s-${id} [data-focus]`) || document.querySelector(`#s-${id} .btn, #s-${id} .tab, #s-${id} .tables button`);
    first?.focus({ preventScroll: true });
  }
  if (id !== 'game') { FX.setSpeed(0.25); FX.setDanger(false); }
}

function refreshMenu() {
  const p = Store.currentPlayer();
  const el = $('#m-player');
  el.textContent = p ? p.name : '---';
  el.style.color = p ? p.color : '';
  for (const m of ['arcade', 'hardcore']) {
    const best = p ? Store.best(m, p.id) : 0;
    $('#m-best-' + m).textContent = best ? 'BEST ' + fmt(best) : '';
  }
  const s = Store.settings();
  $('#t-music').textContent = s.music ? 'MUSIC ON' : 'MUSIC OFF';
  $('#t-music').classList.toggle('on', s.music);
  $('#t-sfx').textContent = s.sfx ? 'SFX ON' : 'SFX OFF';
  $('#t-sfx').classList.toggle('on', s.sfx);
}

function goMenu() {
  refreshMenu();
  Audio.playSong('title');
  show('menu');
}

// ---------- players ----------
let editing = false;
function renderPlayers() {
  const list = $('#player-list');
  list.classList.toggle('editing', editing);
  $('#b-edit').textContent = editing ? 'DONE' : 'EDIT';
  const cur = Store.currentPlayer();
  list.innerHTML = '';
  for (const p of Store.players()) {
    const best = Store.best('arcade', p.id);
    const row = document.createElement('div');
    row.className = 'prow';
    row.innerHTML = `<button class="btn${p === cur ? ' cur' : ''}" style="color:${p.color}">${p.name}<small>${best ? 'BEST ' + fmt(best) : 'NEW'}</small></button><button class="del" aria-label="Delete">X</button>`;
    row.firstChild.onclick = () => { Audio.sfx('select'); Store.setCurrent(p.id); editing = false; goMenu(); };
    row.lastChild.onclick = () => {
      if (confirm(`Delete ${p.name} and all their scores?`)) { Store.deletePlayer(p.id); renderPlayers(); }
    };
    list.appendChild(row);
  }
  if (!Store.players().length) list.innerHTML = '<p class="hint">NO PLAYERS YET</p>';
}

let initials = '';
function renderInitials() {
  $$('.initials span').forEach((s, i) => { s.textContent = initials[i] || ''; s.classList.toggle('cur', i === initials.length); });
}
function typeLetter(c) {
  if (c === 'DEL') { initials = initials.slice(0, -1); Audio.sfx('back'); }
  else if (initials.length < 3) { initials += c; Audio.sfx('key'); }
  renderInitials();
}
function buildLetters() {
  const box = $('#letters');
  for (const c of [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'DEL']) {
    const k = document.createElement('button');
    k.textContent = c;
    if (c === 'DEL') k.className = 'wide';
    k.addEventListener('pointerdown', e => { e.preventDefault(); press(k); typeLetter(c); });
    box.appendChild(k);
  }
}
function openNew() {
  initials = '';
  renderInitials();
  $('#b-cancelnew').style.visibility = Store.players().length ? 'visible' : 'hidden';
  show('new');
}
function savePlayer() {
  if (!initials) { FX.shake(); Audio.sfx('wrong'); return; }
  const { existed } = Store.addPlayer(initials);
  Audio.sfx(existed ? 'select' : 'level');
  goMenu();
}

// ---------- practice table picker ----------
function renderTables() {
  const box = $('#tables'), p = Store.currentPlayer();
  box.innerHTML = '';
  for (let t = 1; t <= 12; t++) {
    const rec = Store.practiceRecord(p.id, t);
    const b = document.createElement('button');
    if (t > 10) b.className = 'x';
    b.innerHTML = `${t}${starsHTML(rec.stars)}`;
    b.onclick = () => { Audio.sfx('select'); startGame('practice', t); };
    box.appendChild(b);
  }
}

// ---------- game ----------
const MODES = {
  arcade:   { max: 10, lives: 3, base: 9, step: 0.7, min: 2.6, perLevel: 8, mul: 1, bpm: 138, fx: 0.6 },
  hardcore: { max: 12, lives: 3, base: 7, step: 0.6, min: 2.2, perLevel: 8, mul: 1.5, bpm: 150, fx: 0.9 },
  practice: { lives: Infinity, base: 6, mul: 1, bpm: 132, fx: 0.6 },
};
// Arcade difficulty: more thinking time costs points, so all three can share one board.
const DIFFS = {
  easy:   { base: 14, step: 0.8, min: 5, mul: 0.5, bpm: 128, fx: 0.4 },
  normal: {},
  hard:   { base: 4.5, step: 0.4, min: 1.8, mul: 1.5, bpm: 146, fx: 0.8 },
};
const DIFF_TAG = { easy: 'E', normal: 'N', hard: 'H' };
const PRACTICE_LEN = 20;
const MAX_LIVES = 5;
const multFor = streak => Math.min(8, 1 + Math.floor(streak / 5));

let G = null, lastGame = null;

// Arcade eases in: the friendly tables first, the 7s and 8s from level 4.
function focusPool(level) {
  if (level <= 1) return [2, 5, 10];
  if (level === 2) return [2, 3, 4, 5, 10];
  if (level === 3) return [2, 3, 4, 5, 6, 9, 10];
  return null;
}

function pickFact() {
  const max = G.cfg.max, pool = G.mode === 'arcade' ? focusPool(G.level) : null;
  // Once warmed up (arcade and hardcore), the giveaway tables go: x1 and x10 from level 4, x2 from level 6.
  const drop = G.mode === 'practice' ? [] : G.level >= 6 ? [1, 2, 10] : G.level >= 4 ? [1, 10] : [];
  const cands = [];
  let total = 0;
  for (let a = 1; a <= max; a++) for (let b = a; b <= max; b++) {
    if (pool && !pool.includes(a) && !pool.includes(b)) continue;
    if (drop.includes(a) || drop.includes(b)) continue;
    const key = a + 'x' + b;
    if (G.recent.includes(key)) continue;
    let w = Store.factWeight(G.pid, a, b);
    if (a === 1) w *= 0.1;
    if (G.mode === 'hardcore' && b > 10) w *= 1.5;
    cands.push([a, b, w, key]);
    total += w;
  }
  let r = Math.random() * total, pick = cands[cands.length - 1];
  for (const c of cands) { r -= c[2]; if (r <= 0) { pick = c; break; } }
  G.recent.push(pick[3]);
  if (G.recent.length > 5) G.recent.shift();
  return Math.random() < 0.5 ? [pick[0], pick[1]] : [pick[1], pick[0]];
}

function buildDeck(table) {
  const top = table > 10 ? 12 : 10;
  const ms = [];
  while (ms.length < PRACTICE_LEN) {
    const round = [];
    for (let m = 1; m <= top; m++) round.push(m);
    for (let i = round.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [round[i], round[j]] = [round[j], round[i]]; }
    if (ms.length && round[0] === ms[ms.length - 1]) round.push(round.shift());
    ms.push(...round);
  }
  return ms.slice(0, PRACTICE_LEN).map(m => (Math.random() < 0.7 ? [table, m] : [m, table]));
}

const timeLimit = () => G.cfg.practice || G.mode === 'practice'
  ? G.cfg.base
  : Math.max(G.cfg.min, G.cfg.base - (G.level - 1) * G.cfg.step);

function startGame(mode, table = 0, diff = 'normal') {
  const p = Store.currentPlayer();
  if (!p) { openNew(); return; }
  clearTimeout(G?.timer);
  G = {
    mode, table, diff, cfg: mode === 'arcade' ? { ...MODES.arcade, ...DIFFS[diff] } : MODES[mode], pid: p.id, name: p.name,
    lives: MODES[mode].lives, level: 1, score: 0, streak: 0, bestStreak: 0,
    correct: 0, wrong: 0, times: [], missed: [], recent: [],
    deck: mode === 'practice' ? buildDeck(table) : null, qi: 0, requeued: 0,
    input: '', phase: 'ready', timer: null, token: {},
  };
  lastGame = { mode, table, diff };
  $('#keypad').style.visibility = 'visible';
  $('#g-q').textContent = '';
  $('#g-a').innerHTML = '';
  $('#g-pauseov').classList.remove('on');
  $('.timer').classList.toggle('off', false);
  renderHUD();
  show('game');
  Audio.playSong(mode === 'hardcore' ? 'hardcore' : 'game');
  Audio.setLevel(1, G.cfg.bpm);
  FX.setSpeed(G.cfg.fx);
  countdown(G.token);
}

async function countdown(token) {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const label = G.mode === 'practice' ? `${G.table} TIMES TABLE` : G.mode === 'hardcore' ? 'HARDCORE!' : `${G.diff.toUpperCase()}!`;
  banner(label, G.mode === 'hardcore' || G.diff === 'hard' ? 'red' : G.diff === 'easy' ? 'lime' : 'mag', 900);
  Audio.sfx('count');
  await wait(900);
  if (G?.token !== token) return;
  banner('GO!', 'lime', 600);
  Audio.sfx('go');
  await wait(250);
  if (G?.token !== token) return;
  nextQuestion();
}

function nextQuestion() {
  clearTimeout(G.timer);
  if (G.mode === 'practice' && G.qi >= G.deck.length) { finish(); return; }
  const [a, b] = G.mode === 'practice' ? G.deck[G.qi++] : pickFact();
  G.q = { a, b, ans: a * b };
  G.input = '';
  G.limit = timeLimit();
  G.qStart = performance.now();
  G.lastTick = 0;
  G.phase = 'ask';
  const q = $('#g-q');
  q.className = 'question';
  q.textContent = `${a} × ${b}`;
  void q.offsetWidth;
  q.classList.add('pop');
  $('#g-a').className = 'answer';
  renderAnswer();
}

function renderAnswer() {
  const box = $('#g-a');
  // One fixed-width field: it must not hint how many digits the answer has.
  box.innerHTML = `<span class="field">${G.input}<i class="caret"></i></span>`;
}

function digit(d) {
  if (!G || screen !== 'game') return;
  if (G.phase === 'feedback' && performance.now() >= G.skipAfter && G.lives > 0) nextQuestion();
  if (G.phase !== 'ask') return;
  G.input += d;
  Audio.sfx('key');
  renderAnswer();
  // Judged as soon as enough digits are in: right is instant, and so is wrong.
  if (G.input.length === String(G.q.ans).length) submit(false);
}

function backspace() {
  if (!G || G.phase !== 'ask' || !G.input) return;
  G.input = G.input.slice(0, -1);
  Audio.sfx('back');
  renderAnswer();
}

function submit(timedOut) {
  const t = (performance.now() - G.qStart) / 1000;
  const ok = !timedOut && Number(G.input) === G.q.ans;
  Store.recordFact(G.pid, G.q.a, G.q.b, ok, t);
  if (ok) onCorrect(t); else onWrong(timedOut);
}

function answerCenter() {
  const r = $('#g-a').getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
}

function float(text, color, big = false) {
  const el = document.createElement('div');
  el.className = 'float' + (big ? ' big' : '');
  el.textContent = text;
  el.style.color = color;
  el.style.textShadow = `0 0 10px ${color}`;
  el.addEventListener('animationend', () => el.remove());
  $('#g-float').appendChild(el);
}

let bannerTimer = 0;
function banner(text, color = '', ms = 1000, hold = false) {
  const el = $('#g-banner');
  clearTimeout(bannerTimer);
  el.className = 'banner';
  el.textContent = text;
  void el.offsetWidth;
  el.className = `banner ${hold ? 'hold' : 'show'} ${color}`;
  el.style.animationDuration = ms + 'ms';
  if (!hold) bannerTimer = setTimeout(() => { el.className = 'banner'; }, ms);
}

const COMBO_COLORS = ['#8a7ab8', '#00f0ff', '#39ff14', '#ffe600', '#ff8a00', '#ff2bd6'];

function onCorrect(t) {
  G.correct++;
  G.streak++;
  G.bestStreak = Math.max(G.bestStreak, G.streak);
  G.times.push(t);
  const mult = multFor(G.streak), prevMult = multFor(G.streak - 1);
  const frac = clamp(1 - t / G.limit, 0, 1);
  const pts = Math.round((100 + 400 * frac) * mult * (1 + (G.level - 1) * 0.25) * G.cfg.mul / 10) * 10;
  G.score += pts;
  G.phase = 'feedback';
  G.skipAfter = 0;

  $('#g-a').classList.add('ok');
  const col = COMBO_COLORS[Math.min(mult, 6) - 1];
  float('+' + fmt(pts), '#ffe600', mult >= 3);
  if (t < 1.2) setTimeout(() => float('LIGHTNING!', '#00f0ff'), 90);
  else if (frac > 0.7) setTimeout(() => float('FAST!', '#39ff14'), 90);
  const [x, y] = answerCenter();
  FX.burst(x, y, col, 12 + mult * 4, 0.8 + mult * 0.1);
  FX.flash('57,255,20', 0.08);
  Audio.sfx('correct', G.streak);
  vibrate(8);
  if (mult > prevMult) { banner(`COMBO x${mult}`, 'mag', 800); Audio.sfx('combo'); }

  if (G.mode !== 'practice' && G.correct % G.cfg.perLevel === 0) levelUp();
  renderHUD(true);
  G.timer = setTimeout(nextQuestion, 280);
}

function onWrong(timedOut) {
  G.wrong++;
  G.streak = 0;
  G.missed.push([G.q.a, G.q.b]);
  G.phase = 'feedback';
  G.skipAfter = performance.now() + 500;
  if (G.mode !== 'practice') G.lives--;
  else if (G.requeued < 6) {
    // Missed facts come back a few questions later in practice.
    G.deck.splice(Math.min(G.qi + 3, G.deck.length), 0, [G.q.a, G.q.b]);
    G.requeued++;
  }

  const q = $('#g-q');
  q.classList.add('reveal');
  q.textContent = `${G.q.a} × ${G.q.b} = ${G.q.ans}`;
  if (timedOut) { G.input = ''; renderAnswer(); }
  $('#g-a').classList.add('bad');
  float(timedOut ? 'TIME!' : 'OOPS!', '#ff2050', true);
  FX.shake();
  FX.flash('255,32,80', 0.32);
  Audio.sfx('wrong');
  vibrate([60, 40, 90]);
  renderHUD();
  if (G.lives <= 0) G.timer = setTimeout(gameOver, 1300);
  else G.timer = setTimeout(nextQuestion, 1400);
}

function levelUp() {
  G.level++;
  banner(`LEVEL ${G.level}`, '', 1100);
  Audio.sfx('level');
  Audio.setLevel(G.level, G.cfg.bpm);
  FX.setSpeed(G.cfg.fx + (G.level - 1) * 0.3);
  if ((G.level - 1) % 3 === 0 && G.lives < MAX_LIVES) {
    G.lives++;
    G.gained = true;
    setTimeout(() => { float('1UP!', '#ff2050', true); Audio.sfx('oneup'); }, 450);
  }
}

function renderHUD(bump = false) {
  const sc = $('#g-score');
  sc.textContent = fmt(G.score);
  if (bump) { sc.classList.remove('bump'); void sc.offsetWidth; sc.classList.add('bump'); }

  const lives = $('#g-lives');
  if (G.mode === 'practice') {
    lives.innerHTML = `<span class="lbl">${Math.min(G.qi, G.deck.length)}/${G.deck.length}</span>`;
    $('#g-level').textContent = `${G.table} TABLE`;
  } else {
    const slots = Math.max(G.cfg.lives, G.lives);
    lives.innerHTML = Array.from({ length: slots }, (_, i) => `<img src="${HEART}" class="${i < G.lives ? '' : 'lost'}${G.gained && i === G.lives - 1 ? ' gain' : ''}" alt="">`).join('');
    G.gained = false;
    $('#g-level').textContent = `LEVEL ${G.level}`;
    FX.setDanger(G.lives === 1);
  }

  const mult = multFor(G.streak), combo = $('#g-combo');
  combo.textContent = `x${mult}`;
  combo.className = 'combo' + (mult > 1 ? ' c' + Math.min(mult, 6) : '');
  $('#g-streak').textContent = G.streak >= 2 ? `STREAK ${G.streak}` : '';
}

// Timer bar and timeouts run off one rAF loop.
function tick() {
  requestAnimationFrame(tick);
  if (!G || G.phase !== 'ask') return;
  const el = (performance.now() - G.qStart) / 1000;
  const frac = clamp(1 - el / G.limit, 0, 1);
  const bar = $('#g-timer');
  bar.style.transform = `scaleX(${frac})`;
  bar.style.setProperty('--tc', frac > 0.5 ? '#39ff14' : frac > 0.25 ? '#ffe600' : '#ff2050');
  if (G.mode === 'practice') return;
  const left = G.limit - el;
  $('.timer').classList.toggle('danger', left < 1.5);
  if (left < 1.5 && el - G.lastTick > 0.25) { G.lastTick = el; Audio.sfx('tick'); }
  if (left <= 0) { $('.timer').classList.remove('danger'); submit(true); }
}

function pause() {
  if (!G || screen !== 'game' || G.phase === 'over' || G.phase === 'ready' || G.phase === 'paused') return;
  G.prePhase = G.phase;
  G.pausedAt = performance.now();
  G.phase = 'paused';
  clearTimeout(G.timer);
  $('#g-pauseov').classList.add('on');
  Audio.suspend();
}

function resume() {
  if (!G || G.phase !== 'paused') return;
  Audio.resume();
  $('#g-pauseov').classList.remove('on');
  if (G.prePhase === 'ask') {
    G.qStart += performance.now() - G.pausedAt;
    G.phase = 'ask';
  } else if (G.lives <= 0) gameOver();
  else nextQuestion();
}

function quit() {
  if (!G) return;
  clearTimeout(G.timer);
  G.token = null;
  G.phase = 'over';
  Audio.resume();
  $('#g-pauseov').classList.remove('on');
  goMenu();
}

function gameOver() {
  G.phase = 'over';
  $('#keypad').style.visibility = 'hidden';
  $('.timer').classList.add('off');
  Audio.playSong(null);
  Audio.sfx('gameover');
  FX.setSpeed(0.05);
  banner('GAME OVER', 'red', 1800, true);
  const token = G.token;
  G.timer = setTimeout(() => { if (G.token === token) results(); }, 2000);
}

function finish() {
  G.phase = 'over';
  $('#keypad').style.visibility = 'hidden';
  $('.timer').classList.add('off');
  Audio.playSong(null);
  Audio.sfx('finish');
  banner('FINISH!', 'lime', 1200, true);
  const token = G.token;
  G.timer = setTimeout(() => { if (G.token === token) results(); }, 1300);
}

// ---------- results ----------
function practiceStars(acc, avg) {
  if (acc >= 1 && avg <= 3) return 3;
  if (acc >= 0.9) return 2;
  if (acc >= 0.7) return 1;
  return 0;
}

async function results() {
  const g = G;
  const token = g.token;
  const answered = g.correct + g.wrong;
  const acc = answered ? g.correct / answered : 0;
  const bonus = Math.round(g.score * 0.5 * acc * acc / 10) * 10;
  const total = g.score + bonus;
  const avg = g.times.length ? g.times.reduce((a, b) => a + b, 0) / g.times.length : 0;
  const fastest = g.times.length ? Math.min(...g.times) : 0;
  Store.save(); // persists the per-fact stats gathered during play

  let rec, stars = 0;
  if (g.mode === 'practice') {
    stars = practiceStars(acc, avg);
    rec = Store.recordPractice(g.pid, g.table, total, stars);
  } else {
    rec = Store.recordScore(g.mode, { pid: g.pid, name: g.name, score: total, level: g.level, acc: Math.round(acc * 100), ...(g.mode === 'arcade' && { diff: g.diff }) });
  }
  lastGame.entryId = rec.id;

  $('#r-title').textContent = g.mode === 'practice' ? `${g.table} TIMES TABLE` : g.mode === 'hardcore' ? 'HARDCORE RESULTS' : `${g.diff.toUpperCase()} RESULTS`;
  const lines = $('#r-lines'), totalEl = $('#r-total'), badges = $('#r-badges'), missed = $('#r-missed');
  lines.innerHTML = ''; totalEl.textContent = ''; badges.innerHTML = ''; missed.innerHTML = '';
  $('#r-buttons').classList.remove('on');
  show('results');

  const wait = ms => new Promise(r => setTimeout(r, ms));
  const alive = () => G === g && G.token === token && screen === 'results';
  const rows = [
    ['CORRECT', `${g.correct}/${answered}`],
    ['ACCURACY', `${Math.round(acc * 100)}%`],
    ['BEST STREAK', g.bestStreak],
    ['AVG TIME', avg ? avg.toFixed(1) + 's' : '-'],
    ['FASTEST', fastest ? fastest.toFixed(2) + 's' : '-'],
  ];
  if (g.mode !== 'practice') rows.push(['LEVEL', g.level]);
  rows.push(['SCORE', fmt(g.score)], ['ACCURACY BONUS', '+' + fmt(bonus)]);

  await wait(300);
  for (const [k, v] of rows) {
    if (!alive()) return;
    const d = document.createElement('div');
    if (k === 'ACCURACY BONUS') d.className = 'bonus';
    d.innerHTML = `<span>${k}</span><span>${v}</span>`;
    lines.appendChild(d);
    Audio.sfx('thud');
    await wait(170);
  }

  // count the total up
  const steps = 24;
  for (let i = 1; i <= steps; i++) {
    if (!alive()) return;
    totalEl.textContent = fmt(Math.round(total * i / steps / 10) * 10);
    Audio.sfx('tally', i);
    await wait(28);
  }
  totalEl.textContent = fmt(total);
  await wait(250);
  if (!alive()) return;

  // Always find something worth celebrating.
  const add = (text, cls) => { const b = document.createElement('div'); b.className = 'badge ' + cls; b.innerHTML = text; badges.appendChild(b); };
  if (g.mode === 'practice') {
    add(starsHTML(stars), '');
    for (let i = 0; i < stars; i++) setTimeout(() => Audio.sfx('star', i), i * 160);
    if (rec.isPB && rec.prevBest) add('NEW PERSONAL BEST!', 'pb');
    else if (rec.moreStars && rec.prevStars) add('NEW STAR RECORD!', 'pb');
    else if (!rec.prevBest) add('FIRST RUN DONE!', 'gold');
    else add(`YOUR BEST: ${fmt(rec.prevBest)}`, 'dim');
    if (stars < 3) add(stars < 2 ? 'GET 90% FOR 2 STARS' : '100% AND UNDER 3s FOR 3 STARS', 'dim');
    if (stars === 3 || (rec.isPB && rec.prevBest)) celebrate();
  } else {
    if (rec.isPB && !rec.firstGame) { add('NEW PERSONAL BEST!', 'pb'); celebrate(); }
    else if (rec.firstGame) add('FIRST SCORE ON THE BOARD!', 'gold');
    else if (rec.personalRank <= 10) add(`#${rec.personalRank} IN YOUR TOP 10`, 'gold');
    else add(`YOUR BEST: ${fmt(rec.prevBest)}. KEEP GOING!`, 'dim');
    if (rec.deviceRank === 1 && Store.top(g.mode).length > 1) add('DEVICE CHAMPION!', 'cyan');
    else if (rec.deviceRank <= 10) add(`#${rec.deviceRank} ON THE BIG BOARD`, 'cyan');
  }

  const seen = new Set(), list = [];
  for (const [a, b] of g.missed) {
    const k = Math.min(a, b) + 'x' + Math.max(a, b);
    if (!seen.has(k)) { seen.add(k); list.push(`<b>${a} × ${b} = ${a * b}</b>`); }
  }
  if (list.length) missed.innerHTML = 'PRACTISE THESE:<br>' + list.slice(0, 6).join('&nbsp;&nbsp; ');

  await wait(200);
  if (!alive()) return;
  $('#r-buttons').classList.add('on');
  if (!coarse) $('#r-buttons .btn').focus({ preventScroll: true });
  Audio.playSong('title');
}

function celebrate() {
  Audio.sfx('best');
  FX.confetti(['#00f0ff', '#ff2bd6', '#ffe600', '#39ff14', '#ff8a00']);
  vibrate([30, 30, 30, 30, 80]);
}

// ---------- high scores ----------
let scMode = 'arcade', scScope = 'me';
function renderScores() {
  $$('#sc-mode .tab').forEach(t => t.classList.toggle('on', t.dataset.mode === scMode));
  $$('#sc-scope .tab').forEach(t => t.classList.toggle('on', t.dataset.scope === scScope));
  const p = Store.currentPlayer();
  const list = Store.top(scMode, scScope === 'me' ? p?.id : null, 10);
  const ol = $('#score-list');
  if (!list.length) { ol.innerHTML = '<li class="empty">NO SCORES YET<br>GO PLAY!</li>'; return; }
  ol.innerHTML = list.map((s, i) => {
    const pl = Store.playerById(s.pid);
    const d = new Date(s.date);
    const date = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    return `<li class="${s.id === lastGame?.entryId ? 'fresh' : ''}"><span class="rk">${i + 1}.</span><span style="color:${pl?.color || '#8a7ab8'}">${s.name}</span><span class="sc">${fmt(s.score)}</span><span class="mt">${s.diff ? DIFF_TAG[s.diff] + ' ' : ''}L${s.level} ${s.acc}%<br>${date}</span></li>`;
  }).join('');
}

// ---------- stats ----------
let statSize = 10;
function renderStats() {
  const p = Store.currentPlayer();
  $('#st-title').textContent = `${p.name}'S STATS`;
  $('#st-size').textContent = statSize === 10 ? '12×12' : '10×10';
  const grid = $('#st-grid');
  grid.style.gridTemplateColumns = `repeat(${statSize + 1}, 1fr)`;
  let html = '<div class="h">×</div>';
  for (let b = 1; b <= statSize; b++) html += `<div class="h">${b}</div>`;
  let aced = 0, seen = 0, tricky = [];
  for (let a = 1; a <= statSize; a++) {
    html += `<div class="h">${a}</div>`;
    for (let b = 1; b <= statSize; b++) {
      const s = Store.factStat(p.id, a, b), c = Store.factClass(s);
      html += `<div class="${c}">${a * b}</div>`;
      if (a <= b && s) { seen++; if (c === 'c-ace') aced++; if (c === 'c-bad') tricky.push(`${a}×${b}`); }
    }
  }
  grid.innerHTML = html;
  const total = statSize * (statSize + 1) / 2;
  $('#st-summary').innerHTML = `ACED ${aced} OF ${total} FACTS` + (seen ? '' : '<br>PLAY A GAME TO FILL THIS IN') +
    (tricky.length ? `<br>TRICKY: ${tricky.slice(0, 6).join(' ')}` : '');
}

// ---------- input wiring ----------
function press(el) {
  el.classList.add('pressed');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('pressed'), 90);
}

function buildKeypad() {
  const pad = $('#keypad');
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'DEL']) {
    const b = document.createElement('button');
    b.className = 'key' + (k === '0' ? ' zero' : '') + (k === 'DEL' ? ' del' : '');
    b.textContent = k;
    b.dataset.key = k;
    // pointerdown, not click: fires on touch contact, which is what makes it feel instant
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      press(b);
      if (k === 'DEL') backspace(); else digit(k);
    });
    pad.appendChild(b);
  }
}

const actions = {
  players: () => { editing = false; renderPlayers(); show('players'); },
  newplayer: openNew,
  editplayers: () => { editing = !editing; renderPlayers(); },
  cancelnew: () => { renderPlayers(); show('players'); },
  saveplayer: savePlayer,
  menu: goMenu,
  arcade: () => {
    if (!Store.currentPlayer()) return openNew();
    show('arcade');
    if (!coarse) $(`#s-arcade [data-diff="${Store.settings().diff || 'normal'}"]`).focus({ preventScroll: true });
  },
  hardcore: () => startGame('hardcore'),
  practice: () => { if (!Store.currentPlayer()) return openNew(); renderTables(); show('practice'); },
  scores: () => { scScope = 'me'; renderScores(); show('scores'); },
  stats: () => { if (!Store.currentPlayer()) return openNew(); renderStats(); show('stats'); },
  statsize: () => { statSize = statSize === 10 ? 12 : 10; renderStats(); },
  music: () => { const v = !Store.settings().music; Store.setSetting('music', v); Audio.setMusic(v); refreshMenu(); },
  sfx: () => { const v = !Store.settings().sfx; Store.setSetting('sfx', v); Audio.setSfx(v); refreshMenu(); },
  pause, resume, quit,
  again: () => startGame(lastGame.mode, lastGame.table, lastGame.diff),
};
const QUIET = new Set(['pause', 'resume', 'quit', 'menu', 'cancelnew', 'saveplayer']);

let ignoreClicksUntil = 0;
document.addEventListener('click', e => {
  if (performance.now() < ignoreClicksUntil) return;
  const el = e.target.closest('[data-act]');
  if (el && actions[el.dataset.act]) {
    if (!QUIET.has(el.dataset.act)) Audio.sfx('select');
    else if (el.dataset.act !== 'saveplayer') Audio.sfx('back');
    actions[el.dataset.act]();
    return;
  }
  const dif = e.target.closest('[data-diff]');
  if (dif) {
    Audio.sfx('select');
    Store.setSetting('diff', dif.dataset.diff);
    startGame('arcade', 0, dif.dataset.diff);
    return;
  }
  const tab = e.target.closest('.tab');
  if (tab) {
    Audio.sfx('select');
    if (tab.dataset.mode) scMode = tab.dataset.mode;
    if (tab.dataset.scope) scScope = tab.dataset.scope;
    renderScores();
  }
});

function startFromSplash() {
  if (screen !== 'splash') return;
  ignoreClicksUntil = performance.now() + 500; // the release of this tap must not hit a menu button
  Audio.unlock();
  Audio.sfx('go');
  if (Store.players().length) goMenu();
  else { Audio.playSong('title'); openNew(); }
}
$('#s-splash').addEventListener('pointerdown', startFromSplash);

document.addEventListener('keydown', e => {
  if (e.repeat && screen !== 'game') return;
  const k = e.key;
  if (screen === 'splash') { startFromSplash(); return; }
  if (screen === 'game') {
    if (/^[0-9]$/.test(k)) {
      digit(k);
      const b = document.querySelector(`.key[data-key="${k}"]`); if (b) press(b);
    } else if (k === 'Backspace') { backspace(); e.preventDefault(); }
    else if (k === 'Escape' || k === 'p' || k === 'P') { G?.phase === 'paused' ? resume() : pause(); }
    else if (k === 'Enter' && G?.phase === 'paused') resume();
    return;
  }
  if (screen === 'new') {
    if (/^[a-z]$/i.test(k)) typeLetter(k.toUpperCase());
    else if (k === 'Backspace') { typeLetter('DEL'); e.preventDefault(); }
    else if (k === 'Enter') savePlayer();
    else if (k === 'Escape' && Store.players().length) actions.cancelnew();
    return;
  }
  if (k === 'Escape' && screen !== 'menu') { Audio.sfx('back'); goMenu(); return; }
  // arrow keys move focus through the buttons of the current screen
  if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'ArrowLeft' || k === 'ArrowRight') {
    const btns = [...document.querySelectorAll(`#s-${screen} button`)].filter(b => b.offsetParent && getComputedStyle(b).visibility !== 'hidden');
    if (!btns.length) return;
    const i = btns.indexOf(document.activeElement);
    const dir = k === 'ArrowDown' || k === 'ArrowRight' ? 1 : -1;
    btns[(i + dir + btns.length) % btns.length].focus();
    Audio.sfx('key');
    e.preventDefault();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { pause(); Audio.suspend(); }
  else if (screen !== 'game' || G?.phase !== 'paused') Audio.resume();
});
// iOS can drop the audio context after interruptions; any touch revives it
document.addEventListener('pointerdown', () => { if (screen !== 'splash' && G?.phase !== 'paused') Audio.resume(); }, { capture: true });
// iOS only fully unlocks audio on touchend/click, so unlock on those too
for (const ev of ['touchend', 'click']) document.addEventListener(ev, () => { if (screen !== 'splash') Audio.unlock(); }, { capture: true, passive: true });
document.addEventListener('contextmenu', e => e.preventDefault());

// ---------- boot ----------
Store.load();
Audio.setMusic(Store.settings().music);
Audio.setSfx(Store.settings().sfx);
FX.init();
buildKeypad();
buildLetters();
refreshMenu();
requestAnimationFrame(tick);
