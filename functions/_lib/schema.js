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
  `CREATE TABLE IF NOT EXISTS email_log (id TEXT PRIMARY KEY, subject TEXT, audience TEXT, total INTEGER DEFAULT 0, sent INTEGER DEFAULT 0, failed INTEGER DEFAULT 0, is_test INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  // Coach accounts, meetings, demos, evaluations, competitions, notes, fitness, photos, requests, announcements.
  `CREATE TABLE IF NOT EXISTS coach_centers (coach_id TEXT NOT NULL REFERENCES coaches(id) ON DELETE CASCADE, center_id TEXT NOT NULL REFERENCES centers(id) ON DELETE CASCADE, PRIMARY KEY(coach_id,center_id))`,
  `CREATE TABLE IF NOT EXISTS coach_password_tokens (token_hash TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES coaches(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS meetings (id TEXT PRIMARY KEY, title TEXT NOT NULL, meeting_date TEXT NOT NULL, start_time TEXT, end_time TEXT, location TEXT, description TEXT DEFAULT '', meet_url TEXT, calendar_event_id TEXT, calendar_url TEXT, attendees TEXT DEFAULT '[]', request_id TEXT, created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS demos (id TEXT PRIMARY KEY, title TEXT NOT NULL, demo_date TEXT NOT NULL, start_time TEXT, end_time TEXT, arrive_time TEXT, location TEXT, center_id TEXT, details TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS demo_students (demo_id TEXT NOT NULL REFERENCES demos(id) ON DELETE CASCADE, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE, status TEXT, PRIMARY KEY(demo_id,student_id))`,
  `CREATE TABLE IF NOT EXISTS demo_routines (id TEXT PRIMARY KEY, demo_id TEXT NOT NULL REFERENCES demos(id) ON DELETE CASCADE, title TEXT NOT NULL, apparatus TEXT DEFAULT 'group', content TEXT DEFAULT '', video_url TEXT, student_ids TEXT DEFAULT '[]', sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS eval_participants (event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE, coach_id TEXT REFERENCES coaches(id) ON DELETE SET NULL, status TEXT, PRIMARY KEY(event_id,student_id))`,
  `CREATE TABLE IF NOT EXISTS eval_reports (id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE, apparatus TEXT NOT NULL, from_level INTEGER, target_level INTEGER NOT NULL, coach_id TEXT REFERENCES coaches(id) ON DELETE SET NULL, outcome TEXT NOT NULL DEFAULT 'not_passed', notes TEXT DEFAULT '', updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(event_id,student_id,apparatus))`,
  `CREATE TABLE IF NOT EXISTS eval_results (report_id TEXT NOT NULL REFERENCES eval_reports(id) ON DELETE CASCADE, skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE, result TEXT NOT NULL CHECK(result IN ('pass','fail')), PRIMARY KEY(report_id,skill_id))`,
  `CREATE TABLE IF NOT EXISTS comp_scores (event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE, apparatus TEXT NOT NULL CHECK(apparatus IN ('pole','rope')), score REAL NOT NULL, PRIMARY KEY(event_id,student_id,apparatus))`,
  `CREATE TABLE IF NOT EXISTS student_photos (id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE, url TEXT NOT NULL, caption TEXT DEFAULT '', taken_date TEXT, added_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS student_notes (id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE, batch_id TEXT REFERENCES batches(id) ON DELETE SET NULL, worked_on TEXT DEFAULT '', next_steps TEXT DEFAULT '', author_name TEXT, coach_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS fitness_records (id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE, batch_id TEXT REFERENCES batches(id) ON DELETE SET NULL, record_date TEXT NOT NULL, metric TEXT NOT NULL, value REAL NOT NULL, added_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(student_id,record_date,metric))`,
  `CREATE TABLE IF NOT EXISTS rep_sessions (id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE, exercise TEXT NOT NULL, record_date TEXT NOT NULL, total INTEGER NOT NULL, duration INTEGER NOT NULL DEFAULT 60, taps TEXT DEFAULT '[]', added_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS parent_requests (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parents(id) ON DELETE CASCADE, student_id TEXT REFERENCES students(id) ON DELETE SET NULL, kind TEXT NOT NULL CHECK(kind IN ('meeting','question')), subject TEXT NOT NULL, message TEXT DEFAULT '', preferred_times TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'open', reply TEXT, replied_by TEXT, replied_at TEXT, meeting_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS announcements (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT DEFAULT '', audience TEXT NOT NULL DEFAULT 'all' CHECK(audience IN ('all','parents','coaches')), center_id TEXT, pinned INTEGER DEFAULT 0, created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`
];

// [table, column, definition]
const COLUMNS = [
  ['events', 'signup_url', 'TEXT'],
  ['events', 'event_time', 'TEXT'],
  ['events', 'location', 'TEXT'],
  ['events', 'sheet_id', 'TEXT'],
  ['events', 'sheet_url', 'TEXT'],
  ['sessions', 'parent_id', 'TEXT'],
  ['student_attendance', 'drop_in', 'INTEGER DEFAULT 0'],
  ['student_skill_progress', 'started_date', 'TEXT'],
  ['student_skill_progress', 'mastered_date', 'TEXT'],
  ['coaches', 'password_hash', 'TEXT'],
  ['coaches', 'password_salt', 'TEXT'],
  ['coaches', 'last_login', 'TEXT'],
  ['coaches', 'invited_at', 'TEXT'],
  ['coaches', 'tour_done', 'INTEGER DEFAULT 0'],
  ['parents', 'tour_done', 'INTEGER DEFAULT 0']
];

// The original sessions table only allowed admin and parent roles. Rebuild it once so coach sessions fit, keeping everyone signed in.
async function upgradeSessions(env) {
  const row = await env.DB.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions'").first();
  if (!row || /coach_id/.test(row.sql)) return;
  const cols = (await env.DB.prepare('PRAGMA table_info(sessions)').all()).results.map(r => r.name);
  await env.DB.batch([
    env.DB.prepare('DROP TABLE IF EXISTS sessions_v2'),
    env.DB.prepare('CREATE TABLE sessions_v2 (token_hash TEXT PRIMARY KEY, role TEXT NOT NULL, student_id TEXT, expires_at INTEGER NOT NULL, parent_id TEXT, coach_id TEXT)'),
    env.DB.prepare(`INSERT INTO sessions_v2(token_hash,role,student_id,expires_at,parent_id) SELECT token_hash,role,student_id,expires_at,${cols.includes('parent_id') ? 'parent_id' : 'NULL'} FROM sessions`),
    env.DB.prepare('DROP TABLE sessions'),
    env.DB.prepare('ALTER TABLE sessions_v2 RENAME TO sessions')
  ]);
}

export function ensureSchema(env) {
  if (!ready) {
    ready = (async () => {
      for (const sql of STATEMENTS) await env.DB.prepare(sql).run();
      for (const [table, col, def] of COLUMNS) {
        const have = (await env.DB.prepare(`PRAGMA table_info(${table})`).all()).results.map(r => r.name);
        if (have.length && !have.includes(col)) await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`).run();
      }
      await upgradeSessions(env);
    })().catch(e => { ready = null; throw e; });
  }
  return ready;
}
