// May chu chinh - chay bang lenh: npm start
const express = require('express');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const path = require('path');
const { UPLOAD_DIR } = require('./config');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_CLOUD = !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RENDER || process.env.NODE_ENV === 'production';

if (IS_CLOUD) app.set('trust proxy', 1); // chay sau proxy HTTPS cua nha cung cap cloud

app.use(express.json({ limit: '4mb' }));
app.use(session({
  // Luu phien vao SQLite (cung DB, duoc litestream sao luu) -> KHONG bi mat dang nhap khi deploy/khoi dong lai.
  store: new SqliteStore({ client: db, expired: { clear: true, intervalMs: 24 * 60 * 60 * 1000 } }),
  secret: process.env.SESSION_SECRET || 'misa-tim-anh-ai-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 12 * 60 * 60 * 1000, secure: IS_CLOUD }, // giu dang nhap 12 tieng
}));

app.use('/api', require('./routes/api'));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// Bo bat loi chung: tra ve JSON ro rang (vd file qua lon) thay vi trang HTML loi 500.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && err.code === 'LIMIT_FILE_SIZE')
    return res.status(413).json({ error: 'File anh qua lon (toi da 15MB).' });
  console.error('Loi may chu:', err && err.message);
  res.status(err.status || 500).json({ error: (err && err.message) || 'Loi may chu' });
});

app.listen(PORT, () => {
  console.log(`✔ MISA - Tim anh AI dang chay tai: http://localhost:${PORT}`);
});
