# ☁️ Hướng dẫn chạy thử trên Google Cloud Run (nhánh `cloudrun`)

> Mục tiêu: chạy thử ứng dụng trên hạ tầng Google (dùng tài khoản trả phí PRApplication) để so tốc độ với Railway.
> **Không cần cài gì trên máy** — deploy thẳng từ GitHub qua giao diện web. Bản Railway hiện tại **không bị ảnh hưởng**.

## Chuẩn bị (đã có sẵn)
- Mã nguồn ở nhánh **`cloudrun`** của repo **github.com/tuannhh/tim-anh-su-kien** (đã có `Dockerfile`).
- Dự án Google: **PRApplication** (đã bật thanh toán).

## Các bước

### 1. Bật API cần thiết
Mở (đã chọn sẵn dự án PRApplication):
- Cloud Run: https://console.cloud.google.com/apis/library/run.googleapis.com → **ENABLE**
- Cloud Build: https://console.cloud.google.com/apis/library/cloudbuild.googleapis.com → **ENABLE**

### 2. Tạo dịch vụ Cloud Run từ GitHub
1. Mở https://console.cloud.google.com/run → **CREATE SERVICE**.
2. Chọn **"Continuously deploy from a repository (source or function)"** → **SET UP WITH CLOUD BUILD**.
3. **Repository provider:** GitHub → bấm **Manage connected repositories** / authorize (lần đầu cài "Google Cloud Build" cho GitHub) → chọn repo **tuannhh/tim-anh-su-kien**.
4. **Branch:** `^cloudrun$` (chọn nhánh cloudrun).
5. **Build type:** **Dockerfile** (đường dẫn `/Dockerfile`). → **SAVE**.

### 3. Cấu hình dịch vụ (QUAN TRỌNG)
- **Region:** chọn gần VN, ví dụ `asia-southeast1` (Singapore).
- **Authentication:** ✅ **Allow unauthenticated invocations** (để ai cũng vào web được; app tự có đăng nhập riêng).
- Mở mục **Container(s), Volumes, Networking, Security** → tab **Container**:
  - **Resources:** CPU = **4**, Memory = **2 GiB**.
  - **CPU allocation:** ⚠️ chọn **"CPU is always allocated"** (BẮT BUỘC — nếu không, việc quét khuôn mặt chạy nền sẽ bị dừng).
  - **Request timeout:** 300 (giây).
- Tab **Variables & Secrets** → thêm biến môi trường:
  - `DATA_DIR` = `/tmp/data`
  - `SESSION_SECRET` = (một chuỗi ngẫu nhiên bất kỳ, ví dụ `misa-gcr-2026-xyz`)
- Mục **Autoscaling:** **Minimum number of instances = 1**, **Maximum = 1**
  (giữ 1 bản chạy liên tục để dữ liệu + đăng nhập ổn định khi chạy thử).

### 4. Bấm **CREATE**
Chờ Cloud Build build (~3–5 phút). Xong sẽ có URL dạng `https://tim-anh-su-kien-xxxx.a.run.app`.

### 5. Dùng thử
- Mở URL → **🔐 Trang quản trị** → đăng nhập Super Admin (mật khẩu mặc định `Misa@2026` vì đây là DB mới, hãy đổi ngay).
- Vào **⚙️ Cấu hình** dán **Khoá API Google Drive** → tạo sự kiện → dán link Drive → so tốc độ quét với Railway.

## ⚠️ Lưu ý cho bản chạy thử
- Dữ liệu lưu ở bộ nhớ tạm `/tmp` → **mất khi dịch vụ khởi động lại / deploy lại** (mô hình AI cũng tải lại). Đây chỉ là bản **thử nghiệm tốc độ**, không dùng cho dữ liệu thật lâu dài.
- Muốn lưu lâu dài trên Cloud Run: cần gắn thêm ổ bền (Filestore/NFS) hoặc chuyển DB sang Cloud SQL — em sẽ làm nếu anh/chị quyết dùng chính thức.
- **Chi phí:** Cloud Run tính theo CPU. Để `min-instances=1` + "CPU always allocated" nghĩa là **chạy liên tục** → có phí kể cả khi không ai dùng. Chạy thử xong nên **xoá dịch vụ** hoặc đặt min-instances=0 để khỏi tốn.

## Dùng Dockerfile này cho nơi khác (AWS / server MISA)
`Dockerfile` ở nhánh này chạy được trên mọi nền tảng Docker:
- **Server MISA / AWS EC2:** `docker build -t timanh . && docker run -p 3000:3000 -v /duong-dan-luu/data:/tmp/data -e DATA_DIR=/tmp/data timanh` (gắn ổ thật vào `/tmp/data` để lưu lâu dài).
- **AWS App Runner / ECS:** trỏ tới repo + Dockerfile tương tự Cloud Run.
