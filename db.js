// Co so du lieu SQLite - tu dong tao file data/timanh.db khi chay lan dau
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const { DATA_DIR } = require('./config');

const db = new Database(path.join(DATA_DIR, 'timanh.db'));
db.pragma('journal_mode = WAL');

db.exec(`
-- Thanh vien quan tri: super_admin (toan quyen) / admin
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin','admin')),
  must_change_password INTEGER DEFAULT 0,   -- 1 = bat buoc doi mat khau o lan dang nhap dau tien
  created_at TEXT DEFAULT (datetime('now'))
);

-- Su kien anh
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  event_date TEXT NOT NULL,                 -- ngay dien ra (YYYY-MM-DD)
  description TEXT DEFAULT '',
  access_password_hash TEXT DEFAULT '',     -- rong = khong yeu cau mat khau
  thumbnail TEXT DEFAULT '',                -- ten file thumbnail 16:9 (trong data/uploads)
  drive_link TEXT DEFAULT '',               -- link thu muc Google Drive (public)
  drive_folder_id TEXT DEFAULT '',          -- ma thu muc Drive trich tu link
  expires_at TEXT DEFAULT '',               -- ngay het han (YYYY-MM-DD), rong = khong het han
  index_status TEXT DEFAULT 'idle',         -- idle | listing | indexing | done | error
  index_message TEXT DEFAULT '',            -- thong bao tien trinh / loi
  total_photos INTEGER DEFAULT 0,           -- so anh da nap tu Drive
  faces_indexed INTEGER DEFAULT 0,          -- so anh da quet khuon mat
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Danh muc anh nap tu Drive (chi luu thong tin, KHONG luu anh goc)
CREATE TABLE IF NOT EXISTS event_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  drive_file_id TEXT NOT NULL,
  name TEXT DEFAULT '',
  mime TEXT DEFAULT '',
  sort INTEGER DEFAULT 0,
  face_status TEXT DEFAULT 'pending',       -- pending | done | nofocus | error
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(event_id, drive_file_id)
);

-- Dau van khuon mat (vector 128 so, AN DANH - khong gan ten ai)
CREATE TABLE IF NOT EXISTS photo_faces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  photo_id INTEGER NOT NULL REFERENCES event_photos(id) ON DELETE CASCADE,
  descriptor BLOB NOT NULL,                 -- Float32Array(128) luu duoi dang BLOB
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_faces_event ON photo_faces(event_id);
CREATE INDEX IF NOT EXISTS idx_photos_event ON event_photos(event_id);

-- Cau hinh chung (1 dong duy nhat): khoa API Google Drive
CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  google_api_key TEXT DEFAULT ''
);
`);

// ===== Tao tai khoan Super Admin lan dau =====
const existing = db.prepare('SELECT id FROM users WHERE role = ?').get('super_admin');
if (!existing) {
  // Mat khau khoi tao lay tu bien moi truong (khong de lo trong ma nguon). Mac dinh cho ban cai moi.
  const initPass = process.env.SUPER_ADMIN_PASSWORD || 'Misa@2026';
  const hash = bcrypt.hashSync(initPass, 10);
  db.prepare(`INSERT INTO users (display_name, email, password_hash, role, must_change_password)
              VALUES ('Super Admin', 'tuanbui88vn@gmail.com', ?, 'super_admin', 0)`).run(hash);
  console.log('✔ Da tao tai khoan Super Admin: tuanbui88vn@gmail.com');
}

// Dam bao co 1 dong cau hinh chung
db.prepare('INSERT OR IGNORE INTO app_settings (id) VALUES (1)').run();

module.exports = db;
