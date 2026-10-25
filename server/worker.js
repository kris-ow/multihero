// MULTIHERO global board: a Cloudflare Worker with a D1 database (schema.sql).
// Each submission carries the run's answer log; the score is recomputed here with the game's own
// rules (js/rules.js), so a score that could not have been played is refused. Players appear only
// as their profile initials, and only after opting in on the device.

import { SEASON, replay } from '../js/rules.js';

const ORIGINS = ['https://kris-ow.github.io', 'http://localhost:8891'];
const TOP_N = 100, SUBMITS_PER_HOUR = 60;
// Initials that would be rude on a board kids read (English and Polish).
const BLOCKED = new Set(['ASS', 'FUK', 'FUC', 'FCK', 'FUQ', 'SEX', 'CUM', 'TIT', 'DIK', 'DIC', 'COK', 'FAG', 'NIG', 'NGR',
  'KKK', 'GAY', 'JEW', 'NAZ', 'SS', 'PIS', 'POO', 'WTF', 'KUR', 'HUJ', 'CHJ', 'JEB', 'PIZ', 'CIP', 'SUK', 'DUP', 'KYS']);

const sha = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))]
  .map(b => b.toString(16).padStart(2, '0')).join('');

function cors(req) {
  const o = req.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}
const json = (req, body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(req), ...extra } });

// Board rows show a short hash of the player key, so a device can spot its own rows without the
// key itself being public.
async function top(req, env, url) {
  const mode = url.searchParams.get('mode'), season = +url.searchParams.get('season') || SEASON;
  if (mode !== 'arcade' && mode !== 'hardcore') return json(req, { error: 'mode' }, 400);
  const { results } = await env.DB.prepare(
    'SELECT name, diff, score, level, acc, created, tag FROM scores WHERE season = ? AND mode = ? ORDER BY score DESC, created ASC LIMIT ?',
  ).bind(season, mode, TOP_N).all();
  return json(req, { season, mode, rows: results }, 200, { 'Cache-Control': 'public, max-age=30' });
}

async function submit(req, env) {
  let body;
  try { body = await req.json(); } catch { return json(req, { error: 'json' }, 400); }
  const { season, mode, diff = null, name, key, log } = body || {};
  if (season !== SEASON) return json(req, { error: 'season', season: SEASON }, 409);
  if (typeof name !== 'string' || !/^[A-Z]{1,3}$/.test(name)) return json(req, { error: 'name' }, 400);
  if (BLOCKED.has(name)) return json(req, { error: 'name blocked' }, 400);
  if (typeof key !== 'string' || !/^[a-z0-9]{12,40}$/.test(key)) return json(req, { error: 'key' }, 400);

  const ip = await sha('ip:' + (req.headers.get('CF-Connecting-IP') || 'local'));
  const hour = Math.floor(Date.now() / 3600e3);
  const hits = await env.DB.prepare(
    'INSERT INTO hits (ip, hour, n) VALUES (?, ?, 1) ON CONFLICT(ip, hour) DO UPDATE SET n = n + 1 RETURNING n',
  ).bind(ip, hour).first('n');
  if (hits > SUBMITS_PER_HOUR) return json(req, { error: 'slow down' }, 429);

  const r = replay(mode, mode === 'arcade' ? diff : null, log);
  if (r.error) return json(req, { error: 'rejected: ' + r.error }, 422);
  if (!r.over) return json(req, { error: 'rejected: run not finished' }, 422);

  const tag = (await sha('player:' + key)).slice(0, 10), now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO scores (season, mode, pkey, tag, name, diff, score, level, acc, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(season, mode, pkey) DO UPDATE SET name = excluded.name, diff = excluded.diff, score = excluded.score,
         level = excluded.level, acc = excluded.acc, created = excluded.created WHERE excluded.score > scores.score`,
    ).bind(SEASON, mode, key, tag, name, mode === 'arcade' ? diff : null, r.total, r.level, r.acc, now),
    env.DB.prepare('DELETE FROM hits WHERE hour < ?').bind(hour - 1),
  ]);
  const best = await env.DB.prepare('SELECT score FROM scores WHERE season = ? AND mode = ? AND pkey = ?').bind(SEASON, mode, key).first('score');
  const rank = 1 + await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE season = ? AND mode = ? AND score > ?').bind(SEASON, mode, best).first('n');
  return json(req, { score: r.total, best, rank, tag });
}

// A deleted profile takes its rows off the board.
async function forget(req, env) {
  let key;
  try { ({ key } = await req.json()); } catch { return json(req, { error: 'json' }, 400); }
  if (typeof key !== 'string' || !/^[a-z0-9]{12,40}$/.test(key)) return json(req, { error: 'key' }, 400);
  await env.DB.prepare('DELETE FROM scores WHERE pkey = ?').bind(key).run();
  return json(req, { ok: true });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
    try {
      if (req.method === 'GET' && url.pathname === '/top') return await top(req, env, url);
      if (req.method === 'POST' && url.pathname === '/submit') return await submit(req, env);
      if (req.method === 'POST' && url.pathname === '/forget') return await forget(req, env);
      return json(req, { error: 'not found' }, 404);
    } catch (e) {
      return json(req, { error: 'server' }, 500);
    }
  },
};
