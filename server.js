// May chu chinh - chay bang lenh: npm start
const express = require('express');
const session = require('express-session');
const path = require('path');
const { UPLOAD_DIR } = require('./config');
require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_CLOUD = !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RENDER || process.env.NODE_ENV === 'production';

if (IS_CLOUD) app.set('trust proxy', 1); // chay sau proxy HTTPS cua nha cung cap cloud

app.use(express.json({ limit: '4mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'misa-tim-anh-ai-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 12 * 60 * 60 * 1000, secure: IS_CLOUD }, // giu dang nhap 12 tieng
}));

app.use('/api', require('./routes/api'));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`✔ MISA - Tim anh AI dang chay tai: http://localhost:${PORT}`);
});
