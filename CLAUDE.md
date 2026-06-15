# MISA - Tìm ảnh AI

Web giúp khách tìm & tải ảnh sự kiện trên Google Drive, **tìm ảnh theo khuôn mặt** bằng AI. Chủ dự án **không biết code** — luôn giải thích bằng tiếng Việt, đơn giản, làm thay mọi thao tác kỹ thuật.

## Tổng quan kỹ thuật
- **Stack:** Node.js + Express + better-sqlite3, frontend thuần HTML/JS/CSS (SPA hash routing) trong `public/`. Cùng khuôn mẫu với dự án `misa-event-checkin`.
- **AI khuôn mặt (TOÀN BỘ ONNX native qua `onnxruntime-node`, KHÔNG dùng face-api/tfjs):** trong `face.js`: (1) **SCRFD** (`scrfd_10g.onnx`, buffalo_l detection) DÒ mặt + 5 điểm mốc; (2) căn chỉnh 5 điểm → warp 112×112; (3) **ArcFace r50** (`arcface_w600k_r50.onnx`, buffalo_l, **mặc định từ 2026-06-15** để ưu tiên độ chính xác/recall; chậm hơn mbf) → vector danh tính 512 chiều. Đổi recognition qua env `ARC_MODEL` (vd `arcface_mbf.onnx` nhẹ/nhanh hơn). Model `.onnx` gitignore + TỰ TẢI lần đầu (map `MODELS` trong face.js).
- **Tham số quét (env, để tăng recall — bắt được mặt nhỏ/ở xa trong ảnh tập thể):** `DET_SIZE=1024` (kích thước detector, cao hơn 640 cũ → bắt mặt nhỏ; đã chứng minh 640 sót, 1024 đủ), `WORK_SIZE=2048` (độ phân giải ảnh làm việc), `INDEX_IMG_SIZE=2048` (độ phân giải tải ảnh lúc index, trong `routes/api.js`), `MIN_FACE=16`, `DET_THRESH=0.4`. Tất cả chỉnh được qua biến môi trường. **Đổi bất kỳ tham số nào ở trên → PHẢI quét lại** (`POST /events/:id/rescan`).
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
- **Tìm khuôn mặt:** cosine `FACE_SIM_THRESHOLD = 0.40` (càng LỚN càng giống; chỉnh qua env cùng tên). Muốn tìm "đầy đủ" hơn (chấp nhận đôi khi lẫn người hao hao) → hạ ~0.36. Lưu ý: nếu mặt KHÔNG được dò ở bước index thì ngưỡng nào cũng không cứu được → ưu tiên tăng `DET_SIZE`/`INDEX_IMG_SIZE` trước.
- **Tạo sự kiện / ảnh bìa:** ảnh bìa nhận vào bộ nhớ rồi NÉN bằng `sharp` (JPEG ≤1280px, q82) ghi atomic (`.part`→rename) → tránh lỗi 500 do ghi file lớn lên volume/GCS chậm. Nút "Lưu" khóa khi đang gửi + chống tạo trùng phía server (cùng người tạo+tên+ngày trong 30s → trả sự kiện đã có). `server.js` có error-handler trả JSON (file >15MB → 413).

## Bẫy kỹ thuật / lịch sử
- Model `.onnx` tự tải lần đầu về `models/` (local) hoặc `DATA_DIR` (cloud). Đổi engine/ngưỡng PHẢI quét lại: `POST /events/:id/rescan`. `GET /api/version` kiểm tra bản deploy.
- Drive bắt buộc "Anyone with the link". Drive giới hạn tốc độ → nạp/zip nhiều ảnh có thể chậm.
- descriptor BLOB: `Buffer.from(Float32Array.buffer)` ↔ `new Float32Array(blob.buffer, blob.byteOffset, len/4)`.
- **Tốc độ quét** = CPU nơi chạy (Railway gói hiện tại bị throttle → cloud chậm ~11x so với máy thường). Nâng CPU/đổi host (Cloud Run/server riêng) sẽ nhanh hơn.
- LỊCH SỬ engine: face-api 128-d (nhận nhầm người mặt hao hao) → ArcFace r50 + face-api detect WASM (chính xác nhưng chậm) → SCRFD + ArcFace mbf toàn bộ ONNX (nhanh) → **SCRFD@1024 + ArcFace r50, hi-res index 2048 (hiện tại, từ 2026-06-15: ưu tiên độ chính xác + tìm đầy đủ; chậm hơn mbf, hợp Cloud Run nhiều CPU)**.
