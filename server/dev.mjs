// Local stand-in for `wrangler dev`: runs worker.js on :8787 with bun:sqlite behind a minimal D1 shim.
// Usage: bun server/dev.mjs [db file, default in-memory]
import { Database } from 'bun:sqlite';
import worker from './worker.js';

const db = new Database(process.argv[2] || ':memory:');
db.exec(await Bun.file(new URL('./schema.sql', import.meta.url)).text());
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  all: async () => ({ results: db.query(sql).all(...args) }),
  first: async col => { const r = db.query(sql).get(...args); return r == null ? null : col ? r[col] : r; },
  run: async () => db.query(sql).run(...args),
});
const DB = { prepare: sql => stmt(sql), batch: async list => db.transaction(() => list.map(s => s.run()))() };
Bun.serve({ port: 8787, fetch: req => worker.fetch(req, { DB }) });
console.log('board on http://localhost:8787');
