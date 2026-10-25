var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../js/rules.js
var SEASON = 1;
var MODES = {
  arcade: { max: 10, lives: 3, base: 9, step: 0.7, min: 2.2, perLevel: 8, mul: 1, bpm: 138, fx: 0.6 },
  hardcore: { max: 12, lives: 3, base: 7, step: 0.6, min: 2.2, perLevel: 8, mul: 3, bpm: 150, fx: 0.9 },
  practice: { lives: Infinity, base: 6, mul: 1, bpm: 132, fx: 0.6 }
};
var DIFFS = {
  easy: { base: 14, step: 0.8, min: 2.2, mul: 0.35, bpm: 128, fx: 0.4 },
  normal: {},
  hard: { base: 4.5, step: 0.4, min: 2.2, mul: 3.5, bpm: 146, fx: 0.8 }
};
var SPEED_REF = 6;
var MAX_LIVES = 5;
var configFor = /* @__PURE__ */ __name((mode, diff) => mode === "arcade" ? { ...MODES.arcade, ...DIFFS[diff] } : MODES[mode], "configFor");
var multFor = /* @__PURE__ */ __name((streak) => Math.min(8, 1 + Math.floor(streak / 5)), "multFor");
var timeLimit = /* @__PURE__ */ __name((cfg, level) => Math.max(cfg.min, cfg.base - (level - 1) * cfg.step), "timeLimit");
function focusPool(level) {
  if (level <= 1) return [2, 5, 10];
  if (level === 2) return [2, 3, 4, 5, 10];
  if (level === 3) return [2, 3, 4, 5, 6, 9, 10];
  return null;
}
__name(focusPool, "focusPool");
var dropped = /* @__PURE__ */ __name((level) => level >= 6 ? [1, 2, 10] : level >= 4 ? [1, 10] : [], "dropped");
function points(t, streak, level, mul) {
  const frac = Math.min(1, Math.max(0, 1 - t / SPEED_REF));
  return Math.round((100 + 400 * frac) * multFor(streak) * (1 + (level - 1) * 0.25) * mul / 10) * 10;
}
__name(points, "points");
var accuracyBonus = /* @__PURE__ */ __name((score, acc) => Math.round(score * 0.5 * acc * acc / 10) * 10, "accuracyBonus");
var levelGivesLife = /* @__PURE__ */ __name((level) => (level - 1) % 3 === 0, "levelGivesLife");
function replay(mode, diff, log) {
  if (mode !== "arcade" && mode !== "hardcore") return { error: "mode" };
  if (mode === "arcade" && !(diff in DIFFS)) return { error: "diff" };
  if (!Array.isArray(log) || !log.length || log.length > 5e3) return { error: "log" };
  const cfg = configFor(mode, diff);
  let lives = cfg.lives, level = 1, streak = 0, correct = 0, wrong = 0, score = 0;
  for (const e of log) {
    if (lives <= 0) return { error: "after game over" };
    if (!Array.isArray(e) || e.length !== 4) return { error: "entry" };
    const [a, b, ans, t] = e;
    if (![a, b].every((x) => Number.isInteger(x) && x >= 1 && x <= cfg.max)) return { error: "fact" };
    const pool = mode === "arcade" ? focusPool(level) : null;
    if (pool && !pool.includes(a) && !pool.includes(b)) return { error: "fact for level" };
    const drop = dropped(level);
    if (drop.includes(a) || drop.includes(b)) return { error: "fact for level" };
    const limit = timeLimit(cfg, level);
    if (typeof t !== "number" || !(t >= 0) || t > limit + 0.25) return { error: "time" };
    if (ans === a * b) {
      if (t < 0.3) return { error: "too fast" };
      correct++;
      streak++;
      score += points(t, streak, level, cfg.mul);
      if (correct % cfg.perLevel === 0) {
        level++;
        if (levelGivesLife(level) && lives < MAX_LIVES) lives++;
      }
    } else {
      if (ans !== null && !Number.isInteger(ans)) return { error: "answer" };
      wrong++;
      streak = 0;
      lives--;
    }
  }
  const acc = correct / (correct + wrong);
  return { score, total: score + accuracyBonus(score, acc), level, acc: Math.round(acc * 100), over: lives <= 0 };
}
__name(replay, "replay");

// worker.js
var ORIGINS = ["https://kris-ow.github.io", "http://localhost:8891"];
var TOP_N = 100;
var SUBMITS_PER_HOUR = 60;
var BLOCKED = /* @__PURE__ */ new Set([
  "ASS",
  "FUK",
  "FUC",
  "FCK",
  "FUQ",
  "SEX",
  "CUM",
  "TIT",
  "DIK",
  "DIC",
  "COK",
  "FAG",
  "NIG",
  "NGR",
  "KKK",
  "GAY",
  "JEW",
  "NAZ",
  "SS",
  "PIS",
  "POO",
  "WTF",
  "KUR",
  "HUJ",
  "CHJ",
  "JEB",
  "PIZ",
  "CIP",
  "SUK",
  "DUP",
  "KYS"
]);
var sha = /* @__PURE__ */ __name(async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join(""), "sha");
function cors(req) {
  const o = req.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin"
  };
}
__name(cors, "cors");
var json = /* @__PURE__ */ __name((req, body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(req), ...extra } }), "json");
async function top(req, env, url) {
  const mode = url.searchParams.get("mode"), season = +url.searchParams.get("season") || SEASON;
  if (mode !== "arcade" && mode !== "hardcore") return json(req, { error: "mode" }, 400);
  const { results } = await env.DB.prepare(
    "SELECT name, diff, score, level, acc, created, tag FROM scores WHERE season = ? AND mode = ? ORDER BY score DESC, created ASC LIMIT ?"
  ).bind(season, mode, TOP_N).all();
  return json(req, { season, mode, rows: results }, 200, { "Cache-Control": "public, max-age=30" });
}
__name(top, "top");
async function submit(req, env) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "json" }, 400);
  }
  const { season, mode, diff = null, name, key, log } = body || {};
  if (season !== SEASON) return json(req, { error: "season", season: SEASON }, 409);
  if (typeof name !== "string" || !/^[A-Z]{1,3}$/.test(name)) return json(req, { error: "name" }, 400);
  if (BLOCKED.has(name)) return json(req, { error: "name blocked" }, 400);
  if (typeof key !== "string" || !/^[a-z0-9]{12,40}$/.test(key)) return json(req, { error: "key" }, 400);
  const ip = await sha("ip:" + (req.headers.get("CF-Connecting-IP") || "local"));
  const hour = Math.floor(Date.now() / 36e5);
  const hits = await env.DB.prepare(
    "INSERT INTO hits (ip, hour, n) VALUES (?, ?, 1) ON CONFLICT(ip, hour) DO UPDATE SET n = n + 1 RETURNING n"
  ).bind(ip, hour).first("n");
  if (hits > SUBMITS_PER_HOUR) return json(req, { error: "slow down" }, 429);
  const r = replay(mode, mode === "arcade" ? diff : null, log);
  if (r.error) return json(req, { error: "rejected: " + r.error }, 422);
  if (!r.over) return json(req, { error: "rejected: run not finished" }, 422);
  const tag = (await sha("player:" + key)).slice(0, 10), now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO scores (season, mode, pkey, tag, name, diff, score, level, acc, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(season, mode, pkey) DO UPDATE SET name = excluded.name, diff = excluded.diff, score = excluded.score,
         level = excluded.level, acc = excluded.acc, created = excluded.created WHERE excluded.score > scores.score`
    ).bind(SEASON, mode, key, tag, name, mode === "arcade" ? diff : null, r.total, r.level, r.acc, now),
    env.DB.prepare("DELETE FROM hits WHERE hour < ?").bind(hour - 1)
  ]);
  const best = await env.DB.prepare("SELECT score FROM scores WHERE season = ? AND mode = ? AND pkey = ?").bind(SEASON, mode, key).first("score");
  const rank = 1 + await env.DB.prepare("SELECT COUNT(*) AS n FROM scores WHERE season = ? AND mode = ? AND score > ?").bind(SEASON, mode, best).first("n");
  return json(req, { score: r.total, best, rank, tag });
}
__name(submit, "submit");
async function forget(req, env) {
  let key;
  try {
    ({ key } = await req.json());
  } catch {
    return json(req, { error: "json" }, 400);
  }
  if (typeof key !== "string" || !/^[a-z0-9]{12,40}$/.test(key)) return json(req, { error: "key" }, 400);
  await env.DB.prepare("DELETE FROM scores WHERE pkey = ?").bind(key).run();
  return json(req, { ok: true });
}
__name(forget, "forget");
var worker_default = {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
    try {
      if (req.method === "GET" && url.pathname === "/top") return await top(req, env, url);
      if (req.method === "POST" && url.pathname === "/submit") return await submit(req, env);
      if (req.method === "POST" && url.pathname === "/forget") return await forget(req, env);
      return json(req, { error: "not found" }, 404);
    } catch (e) {
      return json(req, { error: "server" }, 500);
    }
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
