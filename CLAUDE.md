# MISA - Tìm ảnh AI

Web giúp khách tìm & tải ảnh sự kiện trên Google Drive, **tìm ảnh theo khuôn mặt** bằng AI. Chủ dự án **không biết code** — luôn giải thích bằng tiếng Việt, đơn giản, làm thay mọi thao tác kỹ thuật.

## Tổng quan kỹ thuật
- **Stack:** Node.js + Express + better-sqlite3, frontend thuần HTML/JS/CSS (SPA hash routing) trong `public/`. Cùng khuôn mẫu với dự án `misa-event-checkin`.
- **AI khuôn mặt (toàn bộ ONNX native qua `onnxruntime-node`):** trong `face.js`: (1) **SCRFD** (`scrfd_10g.onnx`, buffalo_l detection) DÒ mặt + 5 điểm mốc; (2) căn chỉnh 5 điểm → warp 112×112; (3) **ArcFace MobileFaceNet** (`arcface_mbf.onnx`, buffalo_s, mặc định) → vector 512-d. KHÔNG còn dùng face-api/tfjs (đã gỡ — WASM quá chậm trên CPU yếu). Tốc độ ~0.16s/ảnh local (~6x nhanh hơn bản WASM cũ). Tất cả model `.onnx` gitignore + TỰ TẢI lần đầu (map URL `MODELS` trong face.js: scrfd_10g, arcface_mbf, arcface_w600k_r50).
- **Ảnh:** đọc trực tiếp từ Google Drive public qua Drive API key (Super Admin nhập 1 lần ở tab Cấu hình). KHÔNG lưu bản sao ảnh; chỉ lưu descriptor khuôn mặt ẩn danh (vector 128 số) + drive_file_id.
- **Chạy local:** `npm start` → http://localhost:3000 (hoặc nháy đúp `KHOI-DONG.bat`). DB tự tạo tại `data/timanh.db`.
  - ⚠️ Trên máy dev hiện tại port 3000 bị app khác chiếm → dùng `PORT=3100 node server.js`. Preview qua `~/.claude/launch.json` (config "misa-tim-anh").
- **Deploy:** Railway, volume `/data` (env `DATA_DIR=/data`). (Chưa deploy — sẽ làm sau khi test xong.)

## Cấu trúc file
- `server.js` — khởi động Express + session
- `config.js` — DATA_DIR/UPLOAD_DIR
- `db.js` — schema SQLite + seed super admin (tuanbui88vn@gmail.com)
- `drive.js` — đọc thư mục Drive public (parse link, kiểm tra public, liệt kê ảnh, URL thumb/full/download)
- `face.js` — nạp model + tính descriptor (getDescriptors / getSingleDescriptor), distance, BLOB<->Float32
- `routes/api.js` — TOÀN BỘ API (auth, users, settings, events, sync Drive, index khuôn mặt nền, public gallery/zip/face-search)
- `public/app.js` — toàn bộ giao diện
- `models/` — trọng số mô hình face-api (ssdMobilenetv1 + landmark68 + recognition)

## Nghiệp vụ
- **Vai trò:** super_admin (toàn quyền, seed sẵn) / admin (chỉ quản lý sự kiện của mình). Admin tạo mới bị buộc đổi mật khẩu lần đầu (`must_change_password`).
- **Sự kiện:** tên, ngày, mô tả, mật khẩu truy cập (bcrypt), thumbnail 16:9, link Drive, ngày hết hạn (hết hạn → khách chỉ thấy thumbnail). Admin dán link Drive → tự `sync` (nạp danh sách ảnh) → tự `startIndexing` (quét khuôn mặt nền).
- **Front-end công khai:** lưới 5 cột, sắp A-Z/gần-xa, popup mật khẩu; gallery thumbnail, slideshow zoom/pan, tải 1/chọn nhiều/tất cả (zip khi >10), tìm theo khuôn mặt (upload selfie, không lưu).
- **Tìm khuôn mặt (ArcFace):** dùng **độ giống cosine** `FACE_SIM_THRESHOLD = 0.42` (càng LỚN càng giống, vector đã chuẩn hoá). Đo thực tế 608 ảnh: cùng người >0.77, người khác <0.35, người NGOÀI sự kiện max 0.23 → ngưỡng 0.42 tách sạch. Ảnh làm việc 1280px (`WORK_SIZE`), bỏ mặt < `MIN_FACE`=26px. Căn chỉnh 5 điểm (từ 68 mốc) → biến đổi tương tự → warp 112×112 → ArcFace.
  - LỊCH SỬ: ban đầu dùng face-api recognition (128-d) + euclid, nhận nhầm người mặt hao hao (chủ dự án phản hồi đúng) → đã thay bằng ArcFace 512-d. Đổi engine/ngưỡng PHẢI quét lại.

## Bẫy kỹ thuật cần nhớ
- Phải require `@vladmandic/face-api/dist/face-api.node-wasm.js` (KHÔNG require mặc định — bản mặc định đòi `@tensorflow/tfjs-node` native; bản `face-api.js` là browser bundle, crash trong Node).
- Gọi `setWasmPaths(<thư mục dist của tfjs-backend-wasm>)` trước `tf.setBackend('wasm')`.
- Drive bắt buộc chế độ "Anyone with the link" mới đọc được. Drive có giới hạn tốc độ → nạp/zip hàng nghìn ảnh có thể chậm.
- descriptor lưu BLOB: `Buffer.from(Float32Array.buffer)` ↔ `new Float32Array(blob.buffer, blob.byteOffset, len/4)`.
