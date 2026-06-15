/* ============================================================
   MISA - Tìm ảnh AI  |  Toàn bộ giao diện (SPA, định tuyến hash)
   ============================================================ */
'use strict';

// ---------- Tiện ích DOM ----------
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'html') e.innerHTML = attrs[k];
    else if (k.startsWith('on') && typeof attrs[k] === 'function') e.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] === false || attrs[k] == null) { /* bo qua */ }
    else if (attrs[k] === true) e.setAttribute(k, '');
    else e.setAttribute(k, attrs[k]);
  }
  for (const kid of kids.flat()) { if (kid == null || kid === false) continue; e.append(kid.nodeType ? kid : document.createTextNode(kid)); }
  return e;
}
const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');

// ---------- Toast ----------
let toastT;
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.style.display = 'block';
  clearTimeout(toastT); toastT = setTimeout(() => (t.style.display = 'none'), ms);
}

// ---------- Modal ----------
function openModal(node) { const r = $('#modal-root'); r.innerHTML = ''; const bg = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) closeModal(); } }, node); r.append(bg); }
function closeModal() { $('#modal-root').innerHTML = ''; }

// ---------- API ----------
async function api(method, path, body, isForm) {
  const opt = { method, headers: {} };
  if (body && isForm) opt.body = body;
  else if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const res = await fetch('/api' + path, opt);
  let data = null; try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error((data && data.error) || ('Lỗi ' + res.status));
  return data;
}

// ---------- Định dạng ngày ----------
function fmtDate(s) {
  if (!s) return '';
  const p = s.slice(0, 10).split('-'); if (p.length !== 3) return s;
  return `${p[2]}/${p[1]}/${p[0]}`;
}

// ---------- Header dùng chung ----------
function topbar(extraRight) {
  return h('div', { class: 'topbar' },
    h('div', { class: 'topbar-inner' },
      h('a', { class: 'brand', href: '#/' },
        h('img', { src: 'misa-logo.jpg', alt: 'MISA' }),
        h('div', {},
          h('div', { class: 't1' }, 'MISA - Tìm ảnh AI'),
          h('div', { class: 't2' }, 'Tìm & tải ảnh sự kiện nhanh chóng'))),
      h('div', { class: 'spacer' }),
      extraRight || h('a', { class: 'link', href: '#/admin' }, '🔐 Trang quản trị')));
}

/* ============================================================
   ĐỊNH TUYẾN
   ============================================================ */
async function route() {
  const hash = location.hash || '#/';
  app.innerHTML = '';
  $('#lightbox-root').innerHTML = '';
  if (hash.startsWith('#/event/')) return viewEvent(hash.split('/')[2]);
  if (hash.startsWith('#/admin')) return viewAdmin();
  return viewHome();
}
window.addEventListener('hashchange', route);
window.addEventListener('load', route);

/* ============================================================
   TRANG CHỦ CÔNG KHAI - danh sách sự kiện
   ============================================================ */
let _homeEvents = [];
async function viewHome() {
  app.append(topbar());
  const c = h('div', { class: 'container' });
  app.append(c);
  c.append(h('div', { class: 'hero' },
    h('h1', {}, '📸 Kho ảnh sự kiện MISA'),
    h('p', {}, 'Chọn sự kiện để xem toàn bộ ảnh, tải về máy, hoặc tìm nhanh ảnh có khuôn mặt của bạn bằng AI.')));

  const head = h('div', { class: 'page-head' },
    h('h2', {}, 'Các sự kiện'),
    h('div', { class: 'toolbar' },
      h('select', { id: 'sortSel', onchange: renderHomeGrid },
        h('option', { value: 'date' }, 'Sắp xếp: Gần → Xa'),
        h('option', { value: 'name' }, 'Sắp xếp: Tên A → Z'))));
  c.append(head);
  const grid = h('div', { id: 'homeGrid' }); c.append(grid);
  grid.append(h('div', { class: 'spinner' }));

  try {
    _homeEvents = await api('GET', '/public/events');
    renderHomeGrid();
  } catch (e) { grid.innerHTML = ''; grid.append(h('div', { class: 'empty' }, 'Không tải được danh sách: ' + e.message)); }
}

function renderHomeGrid() {
  const grid = $('#homeGrid'); if (!grid) return;
  const sort = ($('#sortSel') && $('#sortSel').value) || 'date';
  const list = [..._homeEvents];
  if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  else list.sort((a, b) => (b.event_date || '').localeCompare(a.event_date || ''));

  grid.innerHTML = '';
  if (!list.length) { grid.append(h('div', { class: 'empty' }, h('div', { class: 'big' }, '🗂️'), 'Chưa có sự kiện nào.')); return; }
  const g = h('div', { class: 'events-grid' });
  for (const ev of list) g.append(eventCard(ev));
  grid.append(g);
}

function eventCard(ev) {
  const thumb = h('div', { class: 'ev-thumb', style: ev.thumbnail ? `background-image:url(/uploads/${ev.thumbnail})` : '' });
  if (!ev.thumbnail) thumb.append(h('div', { class: 'ph' }, '🖼️ Chưa có ảnh bìa'));
  if (ev.has_password && !ev.expired) thumb.append(h('div', { class: 'lock' }, '🔒 Mật khẩu'));
  if (ev.expired) thumb.append(h('div', { class: 'expired' }, '⏳ Đã hết hạn'));

  const btn = ev.expired
    ? h('button', { class: 'btn secondary block', disabled: true }, 'Đã hết hạn')
    : h('button', { class: 'btn block', onclick: () => openEvent(ev) }, 'Xem sự kiện');

  return h('div', { class: 'ev-card' }, thumb,
    h('div', { class: 'ev-body' },
      h('div', { class: 'name' }, ev.name),
      h('div', { class: 'date' }, '📅 ' + fmtDate(ev.event_date) + (ev.total_photos ? `  ·  ${ev.total_photos} ảnh` : '')),
      h('div', { class: 'desc' }, ev.description || ''),
      btn));
}

function openEvent(ev) {
  if (ev.has_password) return askPassword(ev);
  location.hash = '#/event/' + ev.id;
}

function askPassword(ev) {
  const inp = h('input', { type: 'password', placeholder: 'Nhập mật khẩu sự kiện', onkeydown: (e) => { if (e.key === 'Enter') go(); } });
  const err = h('div', { class: 'error-msg' });
  async function go() {
    err.textContent = '';
    try { await api('POST', `/public/events/${ev.id}/unlock`, { password: inp.value }); closeModal(); location.hash = '#/event/' + ev.id; }
    catch (e) { err.textContent = e.message; }
  }
  openModal(h('div', { class: 'modal' },
    h('h3', {}, '🔒 ' + ev.name),
    h('p', { class: 'muted' }, 'Sự kiện này yêu cầu mật khẩu để xem ảnh.'),
    h('label', {}, 'Mật khẩu'), inp, err,
    h('div', { class: 'modal-actions' },
      h('button', { class: 'btn secondary', onclick: closeModal }, 'Hủy'),
      h('button', { class: 'btn', onclick: go }, 'Mở sự kiện'))));
  setTimeout(() => inp.focus(), 50);
}

/* ============================================================
   XEM SỰ KIỆN - gallery
   ============================================================ */
let G = null; // trạng thái gallery hiện tại
async function viewEvent(id) {
  app.append(topbar(h('a', { class: 'link', href: '#/' }, '← Tất cả sự kiện')));
  const c = h('div', { class: 'container' }); app.append(c);
  c.append(h('div', { class: 'spinner' }));
  let data;
  try { data = await api('GET', `/public/events/${id}/photos`); }
  catch (e) {
    c.innerHTML = '';
    if (/mật khẩu/i.test(e.message)) { // cần mật khẩu -> quay về trang chủ và mở popup
      c.append(h('div', { class: 'empty' }, h('div', { class: 'big' }, '🔒'), 'Sự kiện yêu cầu mật khẩu.',
        h('div', { style: 'margin-top:14px' }, h('a', { class: 'btn', href: '#/' }, 'Về trang chủ để nhập mật khẩu'))));
    } else {
      c.append(h('div', { class: 'empty' }, h('div', { class: 'big' }, '⚠️'), e.message,
        h('div', { style: 'margin-top:14px' }, h('a', { class: 'btn secondary', href: '#/' }, 'Về trang chủ'))));
    }
    return;
  }
  c.innerHTML = '';
  G = { id, ev: data.event, photos: data.photos, selected: new Set(), selectMode: false, filtered: null };
  renderGallery(c);
}

function renderGallery(c) {
  c.innerHTML = '';
  const ev = G.ev;
  c.append(h('div', { class: 'page-head' },
    h('div', {}, h('h2', {}, ev.name), h('div', { class: 'muted' }, '📅 ' + fmtDate(ev.event_date) + `  ·  ${G.photos.length} ảnh`))));

  const list = G.filtered || G.photos;

  // Thanh công cụ
  const bar = h('div', { class: 'gallery-bar' });
  bar.append(h('button', { class: 'btn', onclick: () => openFaceSearch() }, '🤖 Tìm ảnh của tôi (AI)'));
  bar.append(h('div', { style: 'flex:1' }));
  const selBtn = h('button', { class: 'btn secondary', onclick: () => { G.selectMode = !G.selectMode; if (!G.selectMode) G.selected.clear(); renderGallery(c); } },
    G.selectMode ? '✖ Thoát chọn' : '☑ Chọn ảnh');
  bar.append(selBtn);
  if (G.selectMode) bar.append(h('button', { class: 'btn secondary', onclick: () => downloadSelected() }, `⬇ Tải ảnh đã chọn (${G.selected.size})`));
  bar.append(h('button', { class: 'btn green', onclick: () => downloadAll() }, '⬇ Tải tất cả (.zip)'));
  c.append(bar);

  if (G.filtered) {
    c.append(h('div', { class: 'filter-banner' },
      h('span', {}, `🤖 Tìm thấy `, h('b', {}, String(G.filtered.length)), ` ảnh có khuôn mặt của bạn`),
      h('button', { class: 'btn secondary small', onclick: () => { G.filtered = null; G.selected.clear(); renderGallery(c); } }, '✖ Xem lại tất cả ảnh')));
  }

  if (!list.length) {
    c.append(h('div', { class: 'empty' }, h('div', { class: 'big' }, G.filtered ? '🔍' : '🖼️'),
      G.filtered ? 'Không tìm thấy ảnh nào có khuôn mặt này trong sự kiện.' : 'Chưa có ảnh trong sự kiện này.'));
    return;
  }

  const g = h('div', { class: 'gallery' });
  list.forEach((p, idx) => {
    const cell = h('div', { class: 'photo' + (G.selected.has(p.id) ? ' selected' : ''), 'data-id': p.id },
      h('img', { loading: 'lazy', src: `/api/public/photo/${p.id}/thumb?w=400`, alt: p.name || '' }),
      h('div', { class: 'pick' }, '✓'));
    cell.addEventListener('click', () => {
      if (G.selectMode) { toggleSelect(p.id, cell); }
      else openLightbox(list, idx);
    });
    g.append(cell);
  });
  c.append(g);
}

function toggleSelect(id, cell) {
  if (G.selected.has(id)) { G.selected.delete(id); cell.classList.remove('selected'); }
  else { G.selected.add(id); cell.classList.add('selected'); }
  const c = $('.container'); const bar = $('.gallery-bar');
  // cập nhật nhãn nút tải đã chọn
  const btns = bar.querySelectorAll('button');
  btns.forEach(b => { if (b.textContent.startsWith('⬇ Tải ảnh đã chọn')) b.textContent = `⬇ Tải ảnh đã chọn (${G.selected.size})`; });
}

/* ---------- Tải ảnh ---------- */
function dl(url) { const a = document.createElement('a'); a.href = url; a.download = ''; document.body.append(a); a.click(); a.remove(); }

function downloadSelected() {
  const ids = [...G.selected];
  if (!ids.length) return toast('Bạn chưa chọn ảnh nào.');
  if (ids.length > 10) return zipDownload(ids);
  ids.forEach((id, i) => setTimeout(() => dl(`/api/public/photo/${id}/download`), i * 350));
  toast(`Đang tải ${ids.length} ảnh...`);
}
function downloadAll() {
  const list = G.filtered || G.photos;
  zipDownload(list.map(p => p.id), true);
}
async function zipDownload(ids, all) {
  const wait = loadingModal(all ? 'Đang nén tất cả ảnh thành file .zip...' : `Đang nén ${ids.length} ảnh thành .zip...`,
    'Với hàng nghìn ảnh có thể mất vài phút, vui lòng đợi.');
  try {
    const res = await fetch(`/api/public/events/${G.id}/zip`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoIds: all ? [] : ids }),
    });
    if (!res.ok) throw new Error('Lỗi khi nén ảnh');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = (G.ev.name || 'anh') + '.zip';
    document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    closeModal(); toast('Đã tải xong file .zip');
  } catch (e) { closeModal(); toast('Lỗi: ' + e.message); }
}
function loadingModal(title, sub) {
  openModal(h('div', { class: 'modal' }, h('h3', {}, title), sub && h('p', { class: 'muted', style: 'margin-top:6px' }, sub), h('div', { class: 'spinner' })));
}

/* ---------- Lightbox / slideshow ---------- */
function openLightbox(list, startIdx) {
  let idx = startIdx, scale = 1, tx = 0, ty = 0;
  const img = h('img', { src: `/api/public/photo/${list[idx].id}/full`, draggable: false });
  const counter = h('span', { class: 'count' });
  const stage = h('div', { class: 'lb-stage' }, img);

  function apply() { img.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`; }
  function show(i) {
    idx = (i + list.length) % list.length; scale = 1; tx = 0; ty = 0; apply();
    img.src = `/api/public/photo/${list[idx].id}/full`;
    counter.textContent = `${idx + 1} / ${list.length}`;
  }
  function zoom(f) { scale = Math.min(Math.max(scale * f, 1), 5); if (scale === 1) { tx = 0; ty = 0; } apply(); }

  const lb = h('div', { class: 'lb' },
    h('div', { class: 'lb-top' },
      counter, h('div', { class: 'spacer' }),
      h('button', { class: 'ic', onclick: () => dl(`/api/public/photo/${list[idx].id}/download`) }, '⬇ Tải ảnh này'),
      h('button', { class: 'ic', onclick: close }, '✖ Đóng')),
    stage,
    h('button', { class: 'lb-nav prev', onclick: () => show(idx - 1) }, '‹'),
    h('button', { class: 'lb-nav next', onclick: () => show(idx + 1) }, '›'),
    h('div', { class: 'lb-zoom' },
      h('button', { onclick: () => zoom(1 / 1.4) }, '−'),
      h('button', { onclick: () => zoom(1.4) }, '+')));

  // Cuộn chuột để zoom
  stage.addEventListener('wheel', (e) => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
  // Kéo để di chuyển khi đã zoom (chuột + cảm ứng)
  let drag = null;
  const start = (x, y) => { if (scale > 1) drag = { x, y, tx, ty }; };
  const move = (x, y) => { if (drag) { tx = drag.tx + (x - drag.x); ty = drag.ty + (y - drag.y); apply(); } };
  const end = () => { drag = null; };
  stage.addEventListener('mousedown', (e) => start(e.clientX, e.clientY));
  window.addEventListener('mousemove', (e) => move(e.clientX, e.clientY));
  window.addEventListener('mouseup', end);
  // Cảm ứng: 1 ngón kéo, 2 ngón pinch
  let pinchD = 0;
  stage.addEventListener('touchstart', (e) => { if (e.touches.length === 1) start(e.touches[0].clientX, e.touches[0].clientY); else if (e.touches.length === 2) pinchD = dist(e); }, { passive: true });
  stage.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) { const d = dist(e); if (pinchD) zoom(d / pinchD); pinchD = d; e.preventDefault(); }
    else if (e.touches.length === 1) move(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });
  stage.addEventListener('touchend', () => { end(); pinchD = 0; });
  function dist(e) { const a = e.touches[0], b = e.touches[1]; return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }

  function key(e) { if (e.key === 'ArrowLeft') show(idx - 1); else if (e.key === 'ArrowRight') show(idx + 1); else if (e.key === 'Escape') close(); }
  function close() { window.removeEventListener('keydown', key); $('#lightbox-root').innerHTML = ''; }
  window.addEventListener('keydown', key);

  $('#lightbox-root').innerHTML = ''; $('#lightbox-root').append(lb); show(idx);
}

/* ---------- Tìm theo khuôn mặt (Giai đoạn 5) ---------- */
function openFaceSearch() {
  let blob = null;
  const file = h('input', { type: 'file', accept: 'image/*', capture: 'user', style: 'display:none' });
  const preview = h('img', { class: 'fs-preview', alt: '' });
  const hint = h('div', { class: 'fs-hint' },
    h('div', { class: 'big' }, '📷'),
    h('div', {}, 'Bấm để chọn ảnh / chụp ảnh'),
    h('div', { class: 'muted' }, 'hoặc kéo-thả, hoặc dán ảnh (Ctrl/⌘ + V)'));
  const zone = h('div', { class: 'fs-zone', onclick: () => file.click() }, preview, hint);
  const err = h('div', { class: 'error-msg' });
  const goBtn = h('button', { class: 'btn', disabled: true, onclick: go }, '🔍 Tìm ảnh');

  function setImage(b) {
    if (!b || !b.type.startsWith('image/')) return;
    blob = b; preview.src = URL.createObjectURL(b); zone.classList.add('has-img');
    err.textContent = ''; goBtn.disabled = false;
  }
  file.addEventListener('change', () => file.files[0] && setImage(file.files[0]));
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); setImage(e.dataTransfer.files[0]); });
  function onPaste(e) {
    for (const it of (e.clipboardData && e.clipboardData.items) || []) {
      if (it.type && it.type.startsWith('image/')) { const b = it.getAsFile(); if (b) { setImage(b); e.preventDefault(); } return; }
    }
  }
  document.addEventListener('paste', onPaste);
  function cleanup() { document.removeEventListener('paste', onPaste); closeModal(); }

  async function go() {
    if (!blob) { err.textContent = 'Vui lòng chọn hoặc dán 1 ảnh chân dung.'; return; }
    err.textContent = ''; goBtn.disabled = true; goBtn.textContent = 'Đang tìm...';
    const fd = new FormData(); fd.append('selfie', blob, 'selfie.jpg');
    try {
      const r = await api('POST', `/public/events/${G.id}/face-search`, fd, true);
      cleanup();
      G.filtered = r.photos; G.selected.clear();
      renderGallery($('.container'));
      if (!r.photos.length) toast(r.indexing ? 'Hệ thống đang quét khuôn mặt, vui lòng thử lại sau ít phút.' : 'Không tìm thấy ảnh nào có khuôn mặt này.', 4500);
      else toast(`Tìm thấy ${r.photos.length} ảnh!` + (r.indexing ? ' (Đang quét tiếp, thử lại sau để đủ ảnh.)' : ''), r.indexing ? 5000 : 3000);
    } catch (e) { err.textContent = e.message; goBtn.disabled = false; goBtn.textContent = '🔍 Tìm ảnh'; }
  }

  openModal(h('div', { class: 'modal' },
    h('h3', {}, '🤖 Tìm ảnh của tôi'),
    h('p', { class: 'muted' }, 'Chọn, chụp hoặc dán 1 ảnh chân dung rõ mặt, chính diện. AI sẽ lọc ra các ảnh có khuôn mặt của bạn.'),
    zone, file,
    h('div', { class: 'hint' }, '🔒 Ảnh của bạn chỉ dùng để tìm ngay lúc này và KHÔNG được lưu lại.'),
    err,
    h('div', { class: 'modal-actions' },
      h('button', { class: 'btn secondary', onclick: cleanup }, 'Hủy'), goBtn)));
}

/* ============================================================
   TRANG QUẢN TRỊ
   ============================================================ */
let ME = null;
async function viewAdmin() {
  try { const r = await api('GET', '/auth/me'); ME = r.user; if (ME) ME.must_change_password = r.must_change_password; }
  catch { ME = null; }
  if (!ME) return viewLogin();
  if (ME.must_change_password) return viewForceChange();
  return viewDashboard();
}

function viewLogin() {
  const email = h('input', { type: 'email', placeholder: 'email@misa.com.vn', onkeydown: (e) => e.key === 'Enter' && go() });
  const pass = h('input', { type: 'password', placeholder: 'Mật khẩu', onkeydown: (e) => e.key === 'Enter' && go() });
  const err = h('div', { class: 'error-msg' });
  async function go() {
    err.textContent = '';
    try { const r = await api('POST', '/auth/login', { email: email.value, password: pass.value }); ME = r.user; ME.must_change_password = r.must_change_password; route2(); }
    catch (e) { err.textContent = e.message; }
  }
  function route2() { app.innerHTML = ''; if (ME.must_change_password) viewForceChange(); else viewDashboard(); }
  app.innerHTML = '';
  app.append(h('div', { class: 'login-wrap' },
    h('div', { class: 'login-box' },
      h('div', { class: 'brand' }, h('img', { src: 'misa-logo.jpg', alt: 'MISA' })),
      h('h1', {}, 'MISA - Tìm ảnh AI'),
      h('p', { class: 'sub' }, 'Đăng nhập quản trị'),
      h('label', {}, 'Email'), email,
      h('label', {}, 'Mật khẩu'), pass, err,
      h('div', { style: 'margin-top:18px' }, h('button', { class: 'btn block', onclick: go }, 'Đăng nhập')),
      h('div', { style: 'margin-top:14px;text-align:center' }, h('a', { class: 'link', href: '#/' }, '← Về trang xem ảnh')))));
  setTimeout(() => email.focus(), 50);
}

function viewForceChange() {
  const np = h('input', { type: 'password', placeholder: 'Mật khẩu mới (tối thiểu 6 ký tự)' });
  const np2 = h('input', { type: 'password', placeholder: 'Nhập lại mật khẩu mới' });
  const err = h('div', { class: 'error-msg' });
  async function go() {
    err.textContent = '';
    if (np.value.length < 6) return err.textContent = 'Mật khẩu cần ít nhất 6 ký tự.';
    if (np.value !== np2.value) return err.textContent = 'Hai mật khẩu không khớp.';
    try { await api('POST', '/auth/change-password', { new_password: np.value }); ME.must_change_password = 0; toast('Đã đổi mật khẩu thành công!'); app.innerHTML = ''; viewDashboard(); }
    catch (e) { err.textContent = e.message; }
  }
  app.innerHTML = '';
  app.append(h('div', { class: 'login-wrap' },
    h('div', { class: 'login-box' },
      h('div', { class: 'brand' }, h('img', { src: 'misa-logo.jpg', alt: 'MISA' })),
      h('h1', {}, 'Đổi mật khẩu lần đầu'),
      h('p', { class: 'sub' }, 'Vì đây là lần đăng nhập đầu tiên, bạn cần đặt mật khẩu mới.'),
      h('label', {}, 'Mật khẩu mới'), np,
      h('label', {}, 'Nhập lại mật khẩu mới'), np2, err,
      h('div', { style: 'margin-top:18px' }, h('button', { class: 'btn block', onclick: go }, 'Lưu mật khẩu mới')))));
}

function adminTopbar() {
  return topbar(h('div', { style: 'display:flex;align-items:center;gap:10px' },
    h('a', { class: 'link', href: '#/' }, '👁 Xem trang công khai'),
    h('span', { class: 'muted', style: 'font-size:13px' }, ME.display_name + (ME.role === 'super_admin' ? ' (Super Admin)' : '')),
    h('button', { class: 'btn secondary small', onclick: async () => { await api('POST', '/auth/logout'); ME = null; location.hash = '#/admin'; route(); } }, 'Đăng xuất')));
}

let ADMIN_TAB = 'events';
function viewDashboard() {
  app.innerHTML = '';
  app.append(adminTopbar());
  const c = h('div', { class: 'container' }); app.append(c);
  const tabs = h('div', { class: 'tabs' });
  const mk = (key, label) => h('button', { class: ADMIN_TAB === key ? 'active' : '', onclick: () => { ADMIN_TAB = key; viewDashboard(); } }, label);
  tabs.append(mk('events', '🗓️ Sự kiện'));
  if (ME.role === 'super_admin') { tabs.append(mk('users', '👥 Thành viên')); tabs.append(mk('settings', '⚙️ Cấu hình')); }
  tabs.append(mk('account', '🔑 Tài khoản'));
  c.append(tabs);
  const body = h('div', { id: 'tabBody' }); c.append(body);
  if (ADMIN_TAB === 'events') tabEvents(body);
  else if (ADMIN_TAB === 'users') tabUsers(body);
  else if (ADMIN_TAB === 'settings') tabSettings(body);
  else tabAccount(body);
}

/* ---------- Tab: Sự kiện ---------- */
async function tabEvents(body) {
  body.innerHTML = '';
  body.append(h('div', { class: 'page-head' },
    h('h2', {}, 'Quản lý sự kiện'),
    h('button', { class: 'btn', onclick: () => eventForm(null) }, '+ Tạo sự kiện')));
  body.append(h('div', { class: 'spinner' }));
  let list;
  try { list = await api('GET', '/events'); } catch (e) { body.lastChild.remove(); body.append(h('div', { class: 'empty' }, e.message)); return; }
  body.lastChild.remove();
  if (!list.length) { body.append(h('div', { class: 'empty' }, h('div', { class: 'big' }, '🗂️'), 'Chưa có sự kiện. Bấm "Tạo sự kiện" để bắt đầu.')); return; }

  const wrap = h('div', { class: 'table-wrap' });
  const table = h('table');
  table.append(h('thead', {}, h('tr', {},
    h('th', {}, 'Sự kiện'), h('th', {}, 'Ngày'), h('th', {}, 'Ảnh'), h('th', {}, 'Quét khuôn mặt'), h('th', {}, 'Trạng thái'), h('th', {}, ''))));
  const tb = h('tbody');
  for (const ev of list) {
    const status = ev.expired ? h('span', { class: 'badge red' }, 'Đã hết hạn')
      : ev.has_password ? h('span', { class: 'badge orange' }, '🔒 Có mật khẩu')
      : h('span', { class: 'badge green' }, 'Đang mở');
    const faceCell = h('td', { 'data-face': ev.id }); renderFaceCell(faceCell, ev);
    tb.append(h('tr', {},
      h('td', {}, h('b', {}, ev.name), ev.description ? h('div', { class: 'muted' }, ev.description.slice(0, 60)) : ''),
      h('td', {}, fmtDate(ev.event_date)),
      h('td', {}, String(ev.total_photos || 0)),
      faceCell,
      h('td', {}, status),
      h('td', { style: 'white-space:nowrap;text-align:right' },
        h('button', { class: 'btn secondary small', onclick: () => location.hash = '#/event/' + ev.id }, 'Xem'),
        ' ',
        h('button', { class: 'btn secondary small', onclick: () => syncEvent(ev.id, true) }, 'Nạp lại ảnh'),
        ' ',
        h('button', { class: 'btn secondary small', onclick: () => eventForm(ev) }, 'Sửa'),
        ' ',
        h('button', { class: 'btn danger small', onclick: () => delEvent(ev) }, 'Xóa'))));
    if (ev.index_status === 'indexing') pollIndex(ev.id);
  }
  table.append(tb); wrap.append(table); body.append(wrap);
}

function renderFaceCell(cell, ev) {
  cell.innerHTML = '';
  if (!ev.total_photos) { cell.append(h('span', { class: 'muted' }, '—')); return; }
  if (ev.index_status === 'indexing') {
    cell.append(h('span', { class: 'badge blue' }, '⏳ ' + (ev.index_message || 'Đang quét...')));
    cell.append(h('div', { class: 'bar', style: 'width:120px' }, h('i', { style: `width:${Math.round((ev.faces_indexed / ev.total_photos) * 100)}%` })));
  } else if (ev.index_status === 'done') {
    cell.append(h('span', { class: 'badge green' }, '✓ Đã quét'));
  } else if (ev.index_status === 'error') {
    cell.append(h('span', { class: 'badge red', title: ev.index_message }, '⚠ Lỗi'));
    cell.append(' ', h('button', { class: 'btn secondary small', onclick: () => reindex(ev.id) }, 'Quét lại'));
  } else {
    cell.append(h('button', { class: 'btn secondary small', onclick: () => reindex(ev.id) }, '🤖 Quét khuôn mặt'));
  }
}

async function reindex(id) { try { await api('POST', `/events/${id}/index-faces`); toast('Đã bắt đầu quét khuôn mặt.'); pollIndex(id); } catch (e) { toast(e.message); } }

const _polling = new Set();
async function pollIndex(id) {
  if (_polling.has(id)) return; _polling.add(id);
  while (true) {
    await new Promise(r => setTimeout(r, 2000));
    let s; try { s = await api('GET', `/events/${id}/index-status`); } catch { break; }
    const cell = document.querySelector(`[data-face="${id}"]`);
    if (!cell) break; // đã rời trang
    renderFaceCell(cell, { id, total_photos: s.total_photos, faces_indexed: s.faces_indexed, index_status: s.index_status, index_message: s.index_message });
    if (s.index_status !== 'indexing') break;
  }
  _polling.delete(id);
}

function delEvent(ev) {
  openModal(h('div', { class: 'modal' },
    h('h3', {}, 'Xóa sự kiện?'),
    h('p', { class: 'muted', style: 'margin-top:6px' }, `Bạn chắc chắn muốn xóa "${ev.name}"? Toàn bộ danh sách ảnh và dữ liệu khuôn mặt của sự kiện sẽ bị xóa (ảnh gốc trên Google Drive không bị ảnh hưởng).`),
    h('div', { class: 'modal-actions' },
      h('button', { class: 'btn secondary', onclick: closeModal }, 'Hủy'),
      h('button', { class: 'btn danger', onclick: async () => { try { await api('DELETE', '/events/' + ev.id); closeModal(); toast('Đã xóa sự kiện'); viewDashboard(); } catch (e) { toast(e.message); } } }, 'Xóa'))));
}

function eventForm(ev) {
  const isEdit = !!ev;
  const f = {};
  const inp = (key, attrs) => (f[key] = h('input', attrs));
  const name = inp('name', { value: ev ? ev.name : '', placeholder: 'VD: Hội nghị Khách hàng 2026' });
  const date = inp('event_date', { type: 'date', value: ev ? ev.event_date : '' });
  const desc = h('textarea', { placeholder: 'Mô tả ngắn về sự kiện' }, ev ? ev.description : '');
  const drive = inp('drive', { value: ev ? ev.drive_link : '', placeholder: 'Dán link thư mục Google Drive (công khai)' });
  const expire = inp('expires', { type: 'date', value: ev ? ev.expires_at : '' });
  const pass = inp('pass', { type: 'text', placeholder: isEdit ? (ev.has_password ? '(Để trống = giữ nguyên)' : '(Để trống = không đặt mật khẩu)') : '(Tùy chọn) mật khẩu xem ảnh' });
  const thumb = h('input', { type: 'file', accept: 'image/*' });
  const removePw = isEdit && ev.has_password ? h('label', { style: 'font-weight:500;display:flex;gap:8px;align-items:center;margin-top:8px' }, h('input', { type: 'checkbox', style: 'width:auto', id: 'rmpw' }), 'Bỏ mật khẩu sự kiện này') : null;
  const err = h('div', { class: 'error-msg' });

  const saveBtn = h('button', { class: 'btn', onclick: save }, 'Lưu');

  async function save() {
    err.textContent = '';
    if (!name.value.trim() || !date.value) { err.textContent = 'Cần nhập Tên sự kiện và Ngày diễn ra.'; return; }
    // Khóa nút ngay để tránh bấm nhiều lần -> tạo sự kiện trùng lặp
    if (saveBtn.disabled) return;
    saveBtn.disabled = true; saveBtn.textContent = 'Đang lưu...';
    const fd = new FormData();
    fd.append('name', name.value.trim());
    fd.append('event_date', date.value);
    fd.append('description', desc.value.trim());
    fd.append('drive_link', drive.value.trim());
    fd.append('expires_at', expire.value || '');
    if (removePw && $('#rmpw').checked) fd.append('access_password', 'REMOVE');
    else if (pass.value) fd.append('access_password', pass.value);
    if (thumb.files[0]) fd.append('thumbnail', thumb.files[0]);
    try {
      if (isEdit) await api('PUT', '/events/' + ev.id, fd, true);
      else { const r = await api('POST', '/events', fd, true); ev = { id: r.id }; }
      closeModal(); toast('Đã lưu sự kiện');
      // Gợi ý đồng bộ ảnh nếu có link Drive
      if (drive.value.trim()) syncEvent(ev.id, true);
      else viewDashboard();
    } catch (e) { err.textContent = e.message; saveBtn.disabled = false; saveBtn.textContent = 'Lưu'; }
  }

  const m = h('div', { class: 'modal wide' },
    h('h3', {}, isEdit ? 'Sửa sự kiện' : 'Tạo sự kiện mới'),
    h('div', { class: 'row2' },
      h('div', {}, h('label', {}, 'Tên sự kiện *'), name),
      h('div', {}, h('label', {}, 'Ngày diễn ra *'), date)),
    h('label', {}, 'Mô tả ngắn'), desc,
    h('label', {}, 'Link thư mục Google Drive (công khai)'), drive,
    h('div', { class: 'hint' }, 'Thư mục Drive phải ở chế độ "Bất kỳ ai có đường liên kết" (Anyone with the link). Sau khi lưu, hệ thống sẽ tự nạp danh sách ảnh.'),
    h('div', { class: 'row2' },
      h('div', {}, h('label', {}, 'Mật khẩu xem ảnh'), pass, removePw),
      h('div', {}, h('label', {}, 'Ngày hết hạn'), expire,
        h('div', { class: 'muted', style: 'margin-top:4px' }, 'Sau ngày này khách chỉ thấy ảnh bìa, không mở được sự kiện.'))),
    h('label', {}, 'Ảnh bìa (tỷ lệ 16:9)'), thumb,
    isEdit && ev.thumbnail ? h('div', { class: 'muted', style: 'margin-top:4px' }, 'Đang dùng ảnh bìa hiện tại. Chọn file mới để thay.') : '',
    err,
    h('div', { class: 'modal-actions' },
      h('button', { class: 'btn secondary', onclick: closeModal }, 'Hủy'),
      saveBtn));
  openModal(m);
}

async function syncEvent(id, thenDashboard) {
  loadingModal('Đang nạp danh sách ảnh từ Google Drive...', 'Vui lòng đợi trong giây lát.');
  try {
    const r = await api('POST', `/events/${id}/sync`);
    closeModal(); toast(`Đã nạp ${r.count} ảnh (tổng ${r.total}).`);
  } catch (e) { closeModal(); toast('Nạp ảnh lỗi: ' + e.message, 4000); }
  if (thenDashboard) viewDashboard();
}

/* ---------- Tab: Thành viên (Super Admin) ---------- */
async function tabUsers(body) {
  body.innerHTML = '';
  body.append(h('div', { class: 'page-head' },
    h('h2', {}, 'Quản lý thành viên'),
    h('button', { class: 'btn', onclick: () => userForm() }, '+ Tạo Admin mới')));
  body.append(h('div', { class: 'spinner' }));
  let list; try { list = await api('GET', '/users'); } catch (e) { body.lastChild.remove(); body.append(h('div', { class: 'empty' }, e.message)); return; }
  body.lastChild.remove();
  const wrap = h('div', { class: 'table-wrap' });
  const table = h('table');
  table.append(h('thead', {}, h('tr', {}, h('th', {}, 'Tên hiển thị'), h('th', {}, 'Email'), h('th', {}, 'Vai trò'), h('th', {}, ''))));
  const tb = h('tbody');
  for (const u of list) {
    const isSuper = u.role === 'super_admin';
    tb.append(h('tr', {},
      h('td', {}, h('b', {}, u.display_name), u.must_change_password ? h('span', { class: 'badge orange', style: 'margin-left:6px' }, 'Chưa đổi MK') : ''),
      h('td', {}, u.email),
      h('td', {}, isSuper ? h('span', { class: 'badge blue' }, 'Super Admin') : h('span', { class: 'badge gray' }, 'Admin')),
      h('td', { style: 'text-align:right;white-space:nowrap' },
        isSuper ? h('span', { class: 'muted' }, '—') : [
          h('button', { class: 'btn secondary small', onclick: () => userForm(u) }, 'Sửa tên'), ' ',
          h('button', { class: 'btn secondary small', onclick: () => resetPw(u) }, 'Reset MK'), ' ',
          h('button', { class: 'btn danger small', onclick: () => delUser(u) }, 'Xóa')])));
  }
  table.append(tb); wrap.append(table); body.append(wrap);
}

function userForm(u) {
  const isEdit = !!u;
  const name = h('input', { value: u ? u.display_name : '', placeholder: 'VD: Nguyễn Văn A' });
  const email = h('input', { type: 'email', value: u ? u.email : '', placeholder: 'email@misa.com.vn', disabled: isEdit });
  const pass = h('input', { type: 'text', placeholder: 'Mật khẩu khởi tạo (tối thiểu 6 ký tự)' });
  const err = h('div', { class: 'error-msg' });
  async function save() {
    err.textContent = '';
    try {
      if (isEdit) await api('PUT', '/users/' + u.id, { display_name: name.value });
      else await api('POST', '/users', { display_name: name.value, email: email.value, password: pass.value });
      closeModal(); toast('Đã lưu'); viewDashboard();
    } catch (e) { err.textContent = e.message; }
  }
  openModal(h('div', { class: 'modal' },
    h('h3', {}, isEdit ? 'Sửa thành viên' : 'Tạo Admin mới'),
    h('label', {}, 'Tên hiển thị'), name,
    h('label', {}, 'Email'), email,
    !isEdit ? h('label', {}, 'Mật khẩu khởi tạo') : '', !isEdit ? pass : '',
    !isEdit ? h('div', { class: 'hint' }, 'Admin sẽ bị yêu cầu đổi mật khẩu ở lần đăng nhập đầu tiên.') : '',
    err,
    h('div', { class: 'modal-actions' },
      h('button', { class: 'btn secondary', onclick: closeModal }, 'Hủy'),
      h('button', { class: 'btn', onclick: save }, 'Lưu'))));
}

function resetPw(u) {
  const np = h('input', { type: 'text', placeholder: 'Mật khẩu mới (tối thiểu 6 ký tự)' });
  const err = h('div', { class: 'error-msg' });
  async function go() { err.textContent = ''; try { await api('POST', `/users/${u.id}/reset-password`, { new_password: np.value }); closeModal(); toast('Đã reset mật khẩu. Admin sẽ phải đổi khi đăng nhập.'); } catch (e) { err.textContent = e.message; } }
  openModal(h('div', { class: 'modal' },
    h('h3', {}, 'Reset mật khẩu: ' + u.display_name),
    h('label', {}, 'Mật khẩu mới'), np, err,
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn secondary', onclick: closeModal }, 'Hủy'), h('button', { class: 'btn', onclick: go }, 'Reset'))));
}

function delUser(u) {
  openModal(h('div', { class: 'modal' },
    h('h3', {}, 'Xóa thành viên?'),
    h('p', { class: 'muted', style: 'margin-top:6px' }, `Xóa "${u.display_name}" (${u.email})? Các sự kiện do người này tạo vẫn được giữ lại.`),
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn secondary', onclick: closeModal }, 'Hủy'),
      h('button', { class: 'btn danger', onclick: async () => { try { await api('DELETE', '/users/' + u.id); closeModal(); toast('Đã xóa'); viewDashboard(); } catch (e) { toast(e.message); } } }, 'Xóa'))));
}

/* ---------- Tab: Cấu hình (Super Admin) ---------- */
async function tabSettings(body) {
  body.innerHTML = '';
  body.append(h('div', { class: 'page-head' }, h('h2', {}, 'Cấu hình hệ thống')));
  let s; try { s = await api('GET', '/settings'); } catch (e) { body.append(h('div', { class: 'empty' }, e.message)); return; }
  const key = h('input', { type: 'text', value: s.google_api_key || '', placeholder: 'AIza...' });
  const err = h('div', { class: 'error-msg' });
  const ok = h('div', { class: 'ok-msg' });
  async function save() { err.textContent = ''; ok.textContent = ''; try { await api('PUT', '/settings', { google_api_key: key.value }); ok.textContent = 'Đã lưu khóa API.'; } catch (e) { err.textContent = e.message; } }
  body.append(h('div', { class: 'card' },
    h('h3', { style: 'color:var(--primary-dark);margin-bottom:6px' }, '🔑 Khóa API Google Drive'),
    h('div', { class: 'hint' }, 'Cần để hệ thống đọc danh sách ảnh từ thư mục Drive công khai. Lấy miễn phí tại Google Cloud Console → APIs & Services → Credentials → Create API key (bật "Google Drive API"). Hướng dẫn chi tiết trong file HUONG-DAN.md.'),
    h('label', {}, 'Google API Key'), key, err, ok,
    h('div', { style: 'margin-top:14px' }, h('button', { class: 'btn', onclick: save }, 'Lưu cấu hình'))));
}

/* ---------- Tab: Tài khoản ---------- */
function tabAccount(body) {
  body.innerHTML = '';
  body.append(h('div', { class: 'page-head' }, h('h2', {}, 'Tài khoản của tôi')));
  const op = h('input', { type: 'password', placeholder: 'Mật khẩu hiện tại' });
  const np = h('input', { type: 'password', placeholder: 'Mật khẩu mới' });
  const np2 = h('input', { type: 'password', placeholder: 'Nhập lại mật khẩu mới' });
  const err = h('div', { class: 'error-msg' }); const ok = h('div', { class: 'ok-msg' });
  async function go() {
    err.textContent = ''; ok.textContent = '';
    if (np.value.length < 6) return err.textContent = 'Mật khẩu mới cần ít nhất 6 ký tự.';
    if (np.value !== np2.value) return err.textContent = 'Hai mật khẩu không khớp.';
    try { await api('POST', '/auth/change-password', { old_password: op.value, new_password: np.value }); ok.textContent = 'Đã đổi mật khẩu.'; op.value = np.value = np2.value = ''; } catch (e) { err.textContent = e.message; }
  }
  body.append(h('div', { class: 'card' },
    h('p', {}, h('b', {}, ME.display_name), ' — ', ME.email, '  ',
      ME.role === 'super_admin' ? h('span', { class: 'badge blue' }, 'Super Admin') : h('span', { class: 'badge gray' }, 'Admin'))));
  body.append(h('div', { class: 'card' },
    h('h3', { style: 'color:var(--primary-dark);margin-bottom:6px' }, 'Đổi mật khẩu'),
    h('label', {}, 'Mật khẩu hiện tại'), op,
    h('label', {}, 'Mật khẩu mới'), np,
    h('label', {}, 'Nhập lại mật khẩu mới'), np2, err, ok,
    h('div', { style: 'margin-top:14px' }, h('button', { class: 'btn', onclick: go }, 'Đổi mật khẩu'))));
}
