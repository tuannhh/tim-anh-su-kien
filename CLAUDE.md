# MISA - Tìm ảnh AI

Web giúp khách tìm & tải ảnh sự kiện trên Google Drive, **tìm ảnh theo khuôn mặt** bằng AI. Chủ dự án **không biết code** — luôn giải thích bằng tiếng Việt, đơn giản, làm thay mọi thao tác kỹ thuật.

## Tổng quan kỹ thuật
- **Stack:** Node.js + Express + better-sqlite3, frontend thuần HTML/JS/CSS (SPA hash routing) trong `public/`. Cùng khuôn mẫu với dự án `misa-event-checkin`.
- **AI khuôn mặt (TOÀN BỘ ONNX native qua `onnxruntime-node`, KHÔNG dùng face-api/tfjs):** trong `face.js`: (1) **SCRFD** (`scrfd_10g.onnx`, buffalo_l detection) DÒ mặt + 5 điểm mốc; (2) căn chỉnh 5 điểm → warp 112×112; (3) **ArcFace MobileFaceNet** (`arcface_mbf.onnx`, buffalo_s, mặc định) → vector danh tính 512 chiều. Phân biệt ĐÚNG DANH TÍNH (không nhầm theo hình dạng), nhanh (~0.16s/ảnh local). Model `.onnx` gitignore + TỰ TẢI lần đầu (map `MODELS` trong face.js). Đổi recognition qua env `ARC_MODEL` (vd `arcface_w600k_r50.onnx` chính xác hơn chút, chậm hơn).
- **Ảnh:** đọc trực tiếp từ Google Drive public qua Drive API key (Super Admin nhập 1 lần ở tab Cấu hình). KHÔNG lưu bản sao ảnh; chỉ lưu descriptor khuôn mặt ẩn danh (vector 512 số) + drive_file_id.
- **Chạy local:** `npm start` → http://localhost:3000 (hoặc `KHOI-DONG.bat`). DB tự tạo `data/timanh.db`. ⚠️ Máy dev port 3000 bị app khác chiếm → `PORT=3100 node server.js`. Preview qua `~/.claude/launch.json`.
- **Deploy:** Railway project **tim-anh-su-kien**, URL **https://anhsukien.up.railway.app**, volume `/data` (env `DATA_DIR=/data`). Cập nhật: `railway up --detach`. GitHub: **github.com/tuannhh/tim-anh-su-kien** (nhánh `main`). Nhánh **`cloudrun`** có Dockerfile để chạy thử trên Google Cloud Run (xem HUONG-DAN-CLOUDRUN.md).

## Cấu trúc file
- `server.js` — khởi động Express + session
- `config.js` — DATA_DIR/UPLOAD_DIR
- `db.js` — schema SQLite + seed super admin (tuanbui88vn@gmail.com; mật khẩu từ env `SUPER_ADMIN_PASSWORD`, mặc định `Misa@2026`)
- `drive.js` — đọc thư mục Drive public (parse link, kiểm tra public, liệt kê ảnh, URL thumb/full/download)
- `face.js` — SCRFD detect + ArcFace embed (getDescriptors / getSingleDescriptor), similarity (cosine), BLOB<->Float32, tự tải model
- `routes/api.js` — TOÀN BỘ API (auth, users, settings, events, sync Drive, index nền + rescan, version, public gallery/zip/face-search)
- `public/app.js` — toàn bộ giao diện
- `models/` — chỉ chứa `.onnx` (gitignore, tự tải): scrfd_10g, arcface_mbf, (tuỳ chọn) arcface_w600k_r50

## Nghiệp vụ
- **Vai trò:** super_admin (toàn quyền, seed sẵn) / admin (chỉ quản lý sự kiện của mình). Admin tạo mới bị buộc đổi mật khẩu lần đầu (`must_change_password`).
- **Sự kiện:** tên, ngày, mô tả, mật khẩu (bcrypt), thumbnail 16:9, link Drive, ngày hết hạn. Admin dán link Drive → tự `sync` (nạp danh sách ảnh) → tự `startIndexing` (quét khuôn mặt nền, prefetch tải song song PREFETCH=5).
- **Front-end công khai:** lưới 5 cột, sắp A-Z/gần-xa, popup mật khẩu; gallery, slideshow zoom/pan, tải 1/chọn/tất cả (zip khi >10), tìm theo khuôn mặt (upload/dán/chụp selfie, không lưu) + banner hiển thị số ảnh.
- **Tìm khuôn mặt:** cosine `FACE_SIM_THRESHOLD = 0.40` (càng LỚN càng giống). Đo thực tế 608 ảnh: cùng người ≥0.79, người khác ≤0.23 → tách sạch, precision 100% trên test.

## Bẫy kỹ thuật / lịch sử
- Model `.onnx` tự tải lần đầu về `models/` (local) hoặc `DATA_DIR` (cloud). Đổi engine/ngưỡng PHẢI quét lại: `POST /events/:id/rescan`. `GET /api/version` kiểm tra bản deploy.
- Drive bắt buộc "Anyone with the link". Drive giới hạn tốc độ → nạp/zip nhiều ảnh có thể chậm.
- descriptor BLOB: `Buffer.from(Float32Array.buffer)` ↔ `new Float32Array(blob.buffer, blob.byteOffset, len/4)`.
- **Tốc độ quét** = CPU nơi chạy (Railway gói hiện tại bị throttle → cloud chậm ~11x so với máy thường). Nâng CPU/đổi host (Cloud Run/server riêng) sẽ nhanh hơn.
- LỊCH SỬ engine: face-api 128-d (nhận nhầm người mặt hao hao) → ArcFace r50 + face-api detect WASM (chính xác nhưng chậm) → **SCRFD + ArcFace mbf, toàn bộ ONNX (hiện tại: nhanh + chính xác)**.
