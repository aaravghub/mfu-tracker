// Creates/upgrades tables automatically on first request so no manual D1 steps are needed.
let ready = null;

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS google_oauth_states (state_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS student_skill_progress (id TEXT PRIMARY KEY, student_id TEXT REFERENCES students(id) ON DELETE CASCADE, skill_id TEXT REFERENCES skills(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'not_started' CHECK(status IN ('not_started','learning','mastered')), UNIQUE(student_id,skill_id))`,
  `CREATE TABLE IF NOT EXISTS links (id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL, category TEXT DEFAULT 'Forms', description TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS shop_items (id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL, category TEXT DEFAULT 'Gear', price TEXT DEFAULT '', description TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS parents (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT DEFAULT '', password_hash TEXT, password_salt TEXT, active INTEGER DEFAULT 1, last_login TEXT, invited_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS parent_students (parent_id TEXT NOT NULL REFERENCES parents(id) ON DELETE CASCADE, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE, PRIMARY KEY(parent_id,student_id))`,
  `CREATE TABLE IF NOT EXISTS password_tokens (token_hash TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parents(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS login_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, window_start INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS email_log (id TEXT PRIMARY KEY, subject TEXT, audience TEXT, total INTEGER DEFAULT 0, sent INTEGER DEFAULT 0, failed INTEGER DEFAULT 0, is_test INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`
];

// [table, column, definition]
const COLUMNS = [
  ['events', 'signup_url', 'TEXT'],
  ['events', 'event_time', 'TEXT'],
  ['events', 'location', 'TEXT'],
  ['sessions', 'parent_id', 'TEXT'],
  ['student_attendance', 'drop_in', 'INTEGER DEFAULT 0'],
  ['student_skill_progress', 'started_date', 'TEXT'],
  ['student_skill_progress', 'mastered_date', 'TEXT']
];

export function ensureSchema(env) {
  if (!ready) {
    ready = (async () => {
      for (const sql of STATEMENTS) await env.DB.prepare(sql).run();
      for (const [table, col, def] of COLUMNS) {
        const have = (await env.DB.prepare(`PRAGMA table_info(${table})`).all()).results.map(r => r.name);
        if (have.length && !have.includes(col)) await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`).run();
      }
    })().catch(e => { ready = null; throw e; });
  }
  return ready;
}
