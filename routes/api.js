// TOAN BO API cua ung dung MISA - Tim anh AI
const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const archiver = require('archiver');
const sharp = require('sharp');
const { Readable } = require('stream');
const db = require('../db');
const { UPLOAD_DIR } = require('../config');
const drive = require('../drive');
const face = require('../face');

const router = express.Router();

// Nguong do GIONG cosine cua ArcFace (cang LON cang giong). Tu 0..1. Chinh duoc qua env FACE_SIM_THRESHOLD.
// Can bang: du tach nguoi khac ma van bat duoc nhieu goc mat cua dung nguoi.
const FACE_SIM_THRESHOLD = +process.env.FACE_SIM_THRESHOLD || 0.40;
// Do phan giai anh tai ve khi quet khuon mat (cang lon cang bat duoc mat nho trong anh tap the).
const INDEX_IMG_SIZE = +process.env.INDEX_IMG_SIZE || 2048;
// Thoi gian toi da cho 1 lan tai anh tu Drive (ms). Tranh treo ca tien trinh quet khi 1 anh bi ket mang.
const FETCH_TIMEOUT = +process.env.FETCH_TIMEOUT || 30000;

// ===== Danh chi muc khuon mat chay nen (1 job/su kien) =====
const indexing = new Set(); // id su kien dang chay
async function startIndexing(eventId) {
  if (indexing.has(eventId)) return;
  indexing.add(eventId);
  try {
    // Nap engine truoc (lan dau co the tai mo hinh 174MB) - bao ro cho nguoi dung biet dang lam gi
    db.prepare("UPDATE events SET index_status='indexing', index_message='Đang chuẩn bị engine AI (lần đầu tải mô hình, ~1 phút)...' WHERE id=?").run(eventId);
    await face.loadModels();

    const insFace = db.prepare('INSERT INTO photo_faces (event_id, photo_id, descriptor) VALUES (?,?,?)');
    const setDone = db.prepare("UPDATE event_photos SET face_status=? WHERE id=?");
    const total = db.prepare('SELECT COUNT(*) n FROM event_photos WHERE event_id=?').get(eventId).n;
    const photos = db.prepare("SELECT id, drive_file_id FROM event_photos WHERE event_id=? AND face_status='pending' ORDER BY sort, id").all(eventId);

    // Tai anh song song (prefetch) de chong thoi gian mang len luc CPU xu ly -> nhanh hon
    const PREFETCH = 5;
    // Tai 1 anh: co gioi han thoi gian (AbortController) + thu lai 1 lan. Het thi nem loi -> bo qua anh, quet tiep.
    const dl = async (p) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
        try {
          const r = await fetch(drive.thumbUrl(p.drive_file_id, INDEX_IMG_SIZE), { redirect: 'follow', signal: ctrl.signal });
          if (!r.ok) throw new Error('tai anh loi ' + r.status);
          return Buffer.from(await r.arrayBuffer());
        } catch (e) {
          if (attempt === 1) throw e;
        } finally {
          clearTimeout(timer);
        }
      }
    };
    const inflight = new Array(photos.length);
    const startFetch = (i) => { if (i < photos.length) inflight[i] = dl(photos[i]).catch(() => null); };
    for (let i = 0; i < Math.min(PREFETCH, photos.length); i++) startFetch(i);

    let done = db.prepare("SELECT COUNT(*) n FROM event_photos WHERE event_id=? AND face_status IN ('done','nofocus','error')").get(eventId).n;
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      const buf = await inflight[i]; inflight[i] = null;
      startFetch(i + PREFETCH); // giu hang doi tai luon day
      try {
        if (!buf) throw new Error('khong tai duoc anh');
        const descs = await face.getDescriptors(buf);
        const tx = db.transaction(() => {
          for (const d of descs) insFace.run(eventId, p.id, face.descToBlob(d));
          setDone.run(descs.length ? 'done' : 'nofocus', p.id);
        });
        tx();
      } catch (e) {
        setDone.run('error', p.id);
      }
      done++;
      db.prepare("UPDATE events SET faces_indexed=?, index_message=? WHERE id=?").run(done, `Đã quét ${done}/${total} ảnh`, eventId);
    }
    db.prepare("UPDATE events SET index_status='done', index_message=? WHERE id=?").run(`Hoàn tất: đã quét ${total} ảnh.`, eventId);
  } catch (e) {
    db.prepare("UPDATE events SET index_status='error', index_message=? WHERE id=?").run('Lỗi quét khuôn mặt: ' + e.message, eventId);
  } finally {
    indexing.delete(eventId);
  }
}

// ===== Upload thumbnail su kien =====
// Nhan vao bo nho roi NEN bang sharp -> file JPEG nho (~vai chuc KB) ghi rat nhanh.
// Tranh viec multer ghi truc tiep file goc lon xuong volume/GCS mount cham -> request treo/loi 500.
const uploadThumb = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const uploadMem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

// Nen + ghi thumbnail (atomic: ghi .part roi rename). Tra ve ten file, nem loi neu anh hong.
async function saveThumbnail(file) {
  const name = 'thumb_' + crypto.randomBytes(8).toString('hex') + '.jpg';
  const dest = path.join(UPLOAD_DIR, name);
  const tmp = dest + '.part';
  const out = await sharp(file.buffer).rotate()
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 }).toBuffer();
  fs.writeFileSync(tmp, out);
  fs.renameSync(tmp, dest);
  return name;
}

// ===== Tien ich =====
const todayStr = () => new Date().toISOString().slice(0, 10);
const isExpired = (ev) => !!(ev.expires_at && ev.expires_at < todayStr());

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Chua dang nhap' });
  const u = db.prepare('SELECT id, display_name, email, role, must_change_password FROM users WHERE id = ?').get(req.session.userId);
  if (!u) { req.session.destroy(() => {}); return res.status(401).json({ error: 'Phien dang nhap khong hop le' }); }
  req.user = u;
  next();
}
function requireSuper(req, res, next) {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Chi Super Admin moi duoc phep' });
  next();
}
// Admin chi thao tac tren su kien cua minh; Super Admin thao tac moi su kien
function canEditEvent(user, ev) {
  return user.role === 'super_admin' || ev.created_by === user.id;
}

// Phien ban engine (de kiem tra ban deploy da cap nhat chua)
router.get('/version', (req, res) => res.json({
  engine: (process.env.ARC_MODEL || 'arcface_w600k_r50.onnx').replace('.onnx', ''),
  build: '2026-06-15-r50-hires', threshold: FACE_SIM_THRESHOLD,
  det_size: +process.env.DET_SIZE || 1024, index_img: INDEX_IMG_SIZE,
}));

// =====================================================================
//  XAC THUC & DANG NHAP
// =====================================================================
router.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Thieu email hoac mat khau' });
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim());
  if (!u || !bcrypt.compareSync(password, u.password_hash))
    return res.status(401).json({ error: 'Email hoac mat khau khong dung' });
  req.session.userId = u.id;
  res.json({ user: { id: u.id, display_name: u.display_name, email: u.email, role: u.role }, must_change_password: !!u.must_change_password });
});

router.post('/auth/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });

router.get('/auth/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const u = db.prepare('SELECT id, display_name, email, role, must_change_password FROM users WHERE id = ?').get(req.session.userId);
  if (!u) return res.json({ user: null });
  res.json({ user: { id: u.id, display_name: u.display_name, email: u.email, role: u.role }, must_change_password: !!u.must_change_password });
});

router.post('/auth/change-password', requireAuth, (req, res) => {
  const { old_password, new_password } = req.body || {};
  if (!new_password || new_password.length < 6) return res.status(400).json({ error: 'Mat khau moi can it nhat 6 ky tu' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  // Neu KHONG phai dang bi bat doi mat khau lan dau thi phai nhap dung mat khau cu
  if (!u.must_change_password) {
    if (!old_password || !bcrypt.compareSync(old_password, u.password_hash))
      return res.status(400).json({ error: 'Mat khau hien tai khong dung' });
  }
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    .run(bcrypt.hashSync(new_password, 10), u.id);
  res.json({ ok: true });
});

// =====================================================================
//  QUAN TRI THANH VIEN (chi Super Admin)
// =====================================================================
router.get('/users', requireAuth, requireSuper, (req, res) => {
  const rows = db.prepare('SELECT id, display_name, email, role, must_change_password, created_at FROM users ORDER BY role DESC, display_name').all();
  res.json(rows);
});

router.post('/users', requireAuth, requireSuper, (req, res) => {
  let { email, password, display_name } = req.body || {};
  email = (email || '').trim(); display_name = (display_name || '').trim();
  if (!email || !password || !display_name) return res.status(400).json({ error: 'Can nhap day du Email, mat khau va ten hien thi' });
  if (password.length < 6) return res.status(400).json({ error: 'Mat khau can it nhat 6 ky tu' });
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return res.status(400).json({ error: 'Email nay da ton tai' });
  const info = db.prepare(`INSERT INTO users (display_name, email, password_hash, role, must_change_password)
                           VALUES (?, ?, ?, 'admin', 1)`).run(display_name, email, bcrypt.hashSync(password, 10));
  res.json({ id: info.lastInsertRowid });
});

router.put('/users/:id', requireAuth, requireSuper, (req, res) => {
  const { display_name } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Khong tim thay thanh vien' });
  if (u.role === 'super_admin') return res.status(400).json({ error: 'Khong sua duoc tai khoan Super Admin o day' });
  db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run((display_name || '').trim() || u.display_name, u.id);
  res.json({ ok: true });
});

router.post('/users/:id/reset-password', requireAuth, requireSuper, (req, res) => {
  const { new_password } = req.body || {};
  if (!new_password || new_password.length < 6) return res.status(400).json({ error: 'Mat khau moi can it nhat 6 ky tu' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Khong tim thay thanh vien' });
  if (u.role === 'super_admin') return res.status(400).json({ error: 'Khong reset duoc tai khoan Super Admin o day' });
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(bcrypt.hashSync(new_password, 10), u.id);
  res.json({ ok: true });
});

router.delete('/users/:id', requireAuth, requireSuper, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Khong tim thay thanh vien' });
  if (u.role === 'super_admin') return res.status(400).json({ error: 'Khong the xoa Super Admin' });
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  res.json({ ok: true });
});

// =====================================================================
//  CAU HINH CHUNG (khoa API Google Drive) - chi Super Admin
// =====================================================================
router.get('/settings', requireAuth, requireSuper, (req, res) => {
  const s = db.prepare('SELECT google_api_key FROM app_settings WHERE id = 1').get();
  res.json({ has_google_key: !!(s && s.google_api_key), google_api_key: (s && s.google_api_key) || '' });
});
router.put('/settings', requireAuth, requireSuper, (req, res) => {
  const { google_api_key } = req.body || {};
  db.prepare('UPDATE app_settings SET google_api_key = ? WHERE id = 1').run((google_api_key || '').trim());
  res.json({ ok: true });
});
function getApiKey() {
  const s = db.prepare('SELECT google_api_key FROM app_settings WHERE id = 1').get();
  return (s && s.google_api_key) || '';
}

// =====================================================================
//  QUAN LY SU KIEN (Admin + Super Admin)
// =====================================================================
function eventOut(ev) {
  return {
    id: ev.id, name: ev.name, event_date: ev.event_date, description: ev.description,
    has_password: !!ev.access_password_hash, thumbnail: ev.thumbnail, drive_link: ev.drive_link,
    drive_folder_id: ev.drive_folder_id, expires_at: ev.expires_at, expired: isExpired(ev),
    index_status: ev.index_status, index_message: ev.index_message,
    total_photos: ev.total_photos, faces_indexed: ev.faces_indexed,
    created_by: ev.created_by, created_at: ev.created_at,
  };
}

router.get('/events', requireAuth, (req, res) => {
  const rows = req.user.role === 'super_admin'
    ? db.prepare('SELECT * FROM events ORDER BY event_date DESC, id DESC').all()
    : db.prepare('SELECT * FROM events WHERE created_by = ? ORDER BY event_date DESC, id DESC').all(req.user.id);
  res.json(rows.map(eventOut));
});

router.get('/events/:id', requireAuth, (req, res) => {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Khong tim thay su kien' });
  if (!canEditEvent(req.user, ev)) return res.status(403).json({ error: 'Khong co quyen' });
  res.json(eventOut(ev));
});

router.post('/events', requireAuth, uploadThumb.single('thumbnail'), async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.event_date) return res.status(400).json({ error: 'Can nhap Ten su kien va Ngay dien ra' });

  // Chong tao trung: cung nguoi tao + ten + ngay vua tao trong 30s -> tra ve su kien da co (vd bam Luu nhieu lan).
  const dup = db.prepare(`SELECT id FROM events WHERE created_by=? AND name=? AND event_date=?
    AND created_at >= datetime('now','-30 seconds') ORDER BY id DESC LIMIT 1`)
    .get(req.user.id, b.name.trim(), b.event_date);
  if (dup) return res.json({ id: dup.id, deduped: true });

  let thumbName = '';
  if (req.file) {
    try { thumbName = await saveThumbnail(req.file); }
    catch (e) { return res.status(400).json({ error: 'Anh bia khong hop le: ' + e.message }); }
  }
  const pwHash = b.access_password ? bcrypt.hashSync(b.access_password, 10) : '';
  const folderId = drive.parseFolderId(b.drive_link || '');
  const info = db.prepare(`INSERT INTO events
    (name, event_date, description, access_password_hash, thumbnail, drive_link, drive_folder_id, expires_at, created_by)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    b.name.trim(), b.event_date, (b.description || '').trim(), pwHash,
    thumbName, (b.drive_link || '').trim(), folderId,
    (b.expires_at || '').trim(), req.user.id);
  res.json({ id: info.lastInsertRowid });
});

router.put('/events/:id', requireAuth, uploadThumb.single('thumbnail'), async (req, res) => {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Khong tim thay su kien' });
  if (!canEditEvent(req.user, ev)) return res.status(403).json({ error: 'Khong co quyen' });
  const b = req.body || {};

  // Mat khau: '' = giu nguyen, 'REMOVE' = bo mat khau, khac = dat moi
  let pwHash = ev.access_password_hash;
  if (b.access_password === 'REMOVE') pwHash = '';
  else if (b.access_password) pwHash = bcrypt.hashSync(b.access_password, 10);

  // Neu doi link Drive -> cap nhat folder id (chua nap lai anh; bam "Dong bo anh" de nap)
  let folderId = ev.drive_folder_id, driveLink = ev.drive_link;
  if (b.drive_link !== undefined) { driveLink = (b.drive_link || '').trim(); folderId = drive.parseFolderId(driveLink); }

  // Anh bia moi (neu co) -> nen + ghi, xoa anh cu de khong bo file rac
  let thumbName = ev.thumbnail;
  if (req.file) {
    try { thumbName = await saveThumbnail(req.file); }
    catch (e) { return res.status(400).json({ error: 'Anh bia khong hop le: ' + e.message }); }
    if (ev.thumbnail) fs.unlink(path.join(UPLOAD_DIR, ev.thumbnail), () => {});
  }

  db.prepare(`UPDATE events SET name=?, event_date=?, description=?, access_password_hash=?,
    thumbnail=?, drive_link=?, drive_folder_id=?, expires_at=? WHERE id=?`).run(
    (b.name || ev.name).trim(), b.event_date || ev.event_date, (b.description ?? ev.description).trim(),
    pwHash, thumbName, driveLink, folderId,
    (b.expires_at ?? ev.expires_at).trim(), ev.id);
  res.json({ ok: true });
});

router.delete('/events/:id', requireAuth, (req, res) => {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Khong tim thay su kien' });
  if (!canEditEvent(req.user, ev)) return res.status(403).json({ error: 'Khong co quyen' });
  if (ev.thumbnail) fs.unlink(path.join(UPLOAD_DIR, ev.thumbnail), () => {});
  db.prepare('DELETE FROM events WHERE id = ?').run(ev.id); // cascade xoa photos + faces
  res.json({ ok: true });
});

// ===== Dong bo danh sach anh tu Google Drive =====
router.post('/events/:id/sync', requireAuth, async (req, res) => {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Khong tim thay su kien' });
  if (!canEditEvent(req.user, ev)) return res.status(403).json({ error: 'Khong co quyen' });
  const apiKey = getApiKey();
  if (!apiKey) return res.status(400).json({ error: 'Chua cau hinh Khoa API Google Drive (vao muc Cau hinh).' });
  if (!ev.drive_folder_id) return res.status(400).json({ error: 'Su kien chua co link thu muc Google Drive hop le.' });

  const chk = await drive.checkFolder(ev.drive_folder_id, apiKey);
  if (!chk.ok) return res.status(400).json({ error: chk.error });

  try {
    const files = await drive.listImages(ev.drive_folder_id, apiKey);
    const insert = db.prepare(`INSERT OR IGNORE INTO event_photos (event_id, drive_file_id, name, mime, sort)
                               VALUES (?,?,?,?,?)`);
    const tx = db.transaction((list) => {
      list.forEach((f, i) => insert.run(ev.id, f.id, f.name || '', f.mimeType || '', i));
    });
    tx(files);
    const total = db.prepare('SELECT COUNT(*) n FROM event_photos WHERE event_id = ?').get(ev.id).n;
    db.prepare("UPDATE events SET total_photos = ?, index_message = ? WHERE id = ?")
      .run(total, `Da nap ${files.length} anh (tong ${total}).`, ev.id);
    res.json({ ok: true, count: files.length, total, folder_name: chk.name });
    // Tu dong quet khuon mat o che do nen (khong chan phan hoi)
    startIndexing(ev.id).catch(() => {});
  } catch (e) {
    db.prepare("UPDATE events SET index_status='error', index_message=? WHERE id=?").run(e.message, ev.id);
    res.status(500).json({ error: 'Loi khi nap anh: ' + e.message });
  }
});

// ===== Tien trinh quet khuon mat (Admin theo doi) =====
router.get('/events/:id/index-status', requireAuth, (req, res) => {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Khong tim thay su kien' });
  if (!canEditEvent(req.user, ev)) return res.status(403).json({ error: 'Khong co quyen' });
  res.json({ index_status: ev.index_status, index_message: ev.index_message, total_photos: ev.total_photos, faces_indexed: ev.faces_indexed });
});

// Quet lai khuon mat thu cong (vd: vua bo sung anh) - chi quet anh chua quet
router.post('/events/:id/index-faces', requireAuth, (req, res) => {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Khong tim thay su kien' });
  if (!canEditEvent(req.user, ev)) return res.status(403).json({ error: 'Khong co quyen' });
  startIndexing(ev.id).catch(() => {});
  res.json({ ok: true });
});

// Quet lai TU DAU (xoa het dau van cu + dat lai tat ca ve chua quet) - dung khi doi engine
router.post('/events/:id/rescan', requireAuth, (req, res) => {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Khong tim thay su kien' });
  if (!canEditEvent(req.user, ev)) return res.status(403).json({ error: 'Khong co quyen' });
  if (indexing.has(ev.id)) return res.status(409).json({ error: 'Dang quet, vui long doi xong roi thu lai.' });
  db.prepare('DELETE FROM photo_faces WHERE event_id = ?').run(ev.id);
  db.prepare("UPDATE event_photos SET face_status='pending' WHERE event_id = ?").run(ev.id);
  db.prepare("UPDATE events SET faces_indexed=0, index_status='idle' WHERE id=?").run(ev.id);
  startIndexing(ev.id).catch(() => {});
  res.json({ ok: true });
});

// =====================================================================
//  FRONT-END CONG KHAI (nguoi xem - khong can dang nhap)
// =====================================================================

// Danh sach su kien hien thi cong khai
router.get('/public/events', (req, res) => {
  const rows = db.prepare('SELECT * FROM events ORDER BY event_date DESC').all();
  res.json(rows.map((ev) => ({
    id: ev.id, name: ev.name, event_date: ev.event_date, description: ev.description,
    thumbnail: ev.thumbnail, has_password: !!ev.access_password_hash,
    expired: isExpired(ev), total_photos: ev.total_photos,
  })));
});

// Kiem tra quyen mo su kien
function eventOpenable(req, ev) {
  if (isExpired(ev)) return { ok: false, code: 410, error: 'Su kien da het han.' };
  if (ev.access_password_hash) {
    const unlocked = (req.session.unlocked || {})[ev.id];
    if (!unlocked) return { ok: false, code: 401, error: 'Su kien yeu cau mat khau.' };
  }
  return { ok: true };
}

// Mo khoa su kien bang mat khau
router.post('/public/events/:id/unlock', (req, res) => {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Khong tim thay su kien' });
  if (isExpired(ev)) return res.status(410).json({ error: 'Su kien da het han.' });
  if (!ev.access_password_hash) return res.json({ ok: true }); // khong co mat khau
  const { password } = req.body || {};
  if (!password || !bcrypt.compareSync(password, ev.access_password_hash))
    return res.status(401).json({ error: 'Mat khau khong dung.' });
  req.session.unlocked = req.session.unlocked || {};
  req.session.unlocked[ev.id] = true;
  res.json({ ok: true });
});

// Thong tin + danh sach anh cua su kien
router.get('/public/events/:id/photos', (req, res) => {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Khong tim thay su kien' });
  const gate = eventOpenable(req, ev);
  if (!gate.ok) return res.status(gate.code).json({ error: gate.error });
  const photos = db.prepare('SELECT id, name FROM event_photos WHERE event_id = ? ORDER BY sort, id').all(ev.id);
  res.json({
    event: { id: ev.id, name: ev.name, event_date: ev.event_date, description: ev.description, total: photos.length, has_faces: ev.faces_indexed > 0 },
    photos,
  });
});

// ===== Proxy anh tu Google Drive (an folder id that, kiem soat quyen) =====
async function pipeRemote(url, res, fallbackType = 'image/jpeg') {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok || !r.body) { res.status(502).end(); return; }
  res.set('Content-Type', r.headers.get('content-type') || fallbackType);
  res.set('Cache-Control', 'public, max-age=86400');
  Readable.fromWeb(r.body).pipe(res);
}

function loadPhotoForView(req, res) {
  const p = db.prepare('SELECT * FROM event_photos WHERE id = ?').get(req.params.photoId);
  if (!p) { res.status(404).end(); return null; }
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(p.event_id);
  if (!ev) { res.status(404).end(); return null; }
  const gate = eventOpenable(req, ev);
  if (!gate.ok) { res.status(gate.code).end(); return null; }
  return p;
}

router.get('/public/photo/:photoId/thumb', async (req, res) => {
  const p = loadPhotoForView(req, res); if (!p) return;
  const w = Math.min(parseInt(req.query.w) || 600, 1600);
  try { await pipeRemote(drive.thumbUrl(p.drive_file_id, w), res); } catch { res.status(502).end(); }
});

router.get('/public/photo/:photoId/full', async (req, res) => {
  const p = loadPhotoForView(req, res); if (!p) return;
  try { await pipeRemote(drive.fullUrl(p.drive_file_id), res); } catch { res.status(502).end(); }
});

router.get('/public/photo/:photoId/download', async (req, res) => {
  const p = loadPhotoForView(req, res); if (!p) return;
  try {
    const r = await fetch(drive.downloadUrl(p.drive_file_id), { redirect: 'follow' });
    if (!r.ok || !r.body) return res.status(502).end();
    res.set('Content-Disposition', `attachment; filename="${(p.name || 'anh').replace(/"/g, '')}"`);
    res.set('Content-Type', r.headers.get('content-type') || 'application/octet-stream');
    Readable.fromWeb(r.body).pipe(res);
  } catch { res.status(502).end(); }
});

// ===== Tai nhieu anh dang .zip =====
router.post('/public/events/:id/zip', async (req, res) => {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Khong tim thay su kien' });
  const gate = eventOpenable(req, ev);
  if (!gate.ok) return res.status(gate.code).json({ error: gate.error });

  let ids = (req.body && req.body.photoIds) || [];
  let photos;
  if (Array.isArray(ids) && ids.length) {
    const qs = ids.map(() => '?').join(',');
    photos = db.prepare(`SELECT * FROM event_photos WHERE event_id = ? AND id IN (${qs}) ORDER BY sort, id`).all(ev.id, ...ids);
  } else {
    photos = db.prepare('SELECT * FROM event_photos WHERE event_id = ? ORDER BY sort, id').all(ev.id);
  }
  if (!photos.length) return res.status(400).json({ error: 'Khong co anh de tai.' });

  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', `attachment; filename="${ev.name.replace(/[^a-zA-Z0-9._-]/g, '_')}.zip"`);
  const archive = archiver('zip', { zlib: { level: 0 } }); // anh da nen san -> khong nen lai cho nhanh
  archive.on('error', () => { try { res.status(500).end(); } catch {} });
  archive.pipe(res);

  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    try {
      const r = await fetch(drive.downloadUrl(p.drive_file_id), { redirect: 'follow' });
      if (r.ok && r.body) {
        const ext = path.extname(p.name || '') || '.jpg';
        const fname = p.name || `anh_${String(i + 1).padStart(4, '0')}${ext}`;
        archive.append(Readable.fromWeb(r.body), { name: fname });
      }
    } catch { /* bo qua anh loi */ }
  }
  archive.finalize();
});

// ===== Tim anh theo khuon mat (khach upload anh chan dung) =====
// Anh chan dung CHI dung tam de tinh toan, KHONG luu lai bat ky dau.
router.post('/public/events/:id/face-search', uploadMem.single('selfie'), async (req, res) => {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Khong tim thay su kien' });
  const gate = eventOpenable(req, ev);
  if (!gate.ok) return res.status(gate.code).json({ error: gate.error });
  if (!req.file) return res.status(400).json({ error: 'Vui long tai len 1 anh chan dung.' });

  // Tinh dau van khuon mat cua anh chan dung (xong la bo, khong luu)
  let query;
  try { query = await face.getSingleDescriptor(req.file.buffer); }
  catch (e) { return res.status(500).json({ error: 'Khong xu ly duoc anh: ' + e.message }); }
  if (!query) return res.status(422).json({ error: 'Khong tim thay khuon mat ro trong anh ban tai len. Hay chon anh chinh dien, ro mat.' });

  // So khop voi toan bo khuon mat da luu cua su kien (do giong cosine)
  const rows = db.prepare('SELECT photo_id, descriptor FROM photo_faces WHERE event_id = ?').all(ev.id);
  const best = new Map(); // photo_id -> do giong lon nhat
  for (const row of rows) {
    const sim = face.similarity(query, face.blobToDesc(row.descriptor));
    if (sim >= FACE_SIM_THRESHOLD && (!best.has(row.photo_id) || sim > best.get(row.photo_id))) best.set(row.photo_id, sim);
  }
  const matchIds = [...best.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const photos = matchIds.map((id) => db.prepare('SELECT id, name FROM event_photos WHERE id = ?').get(id)).filter(Boolean);

  res.json({
    count: photos.length,
    indexed: ev.index_status === 'done',
    indexing: ev.index_status === 'indexing',
    photos,
  });
});

module.exports = router;
