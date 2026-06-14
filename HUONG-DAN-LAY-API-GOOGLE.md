# 🔑 Hướng dẫn lấy Khoá API Google Drive (làm 1 lần duy nhất)

> Khoá API giúp ứng dụng **đọc danh sách ảnh** trong các thư mục Google Drive công khai.
> **Chỉ Super Admin làm 1 lần.** Sau đó các Admin chỉ cần dán link Drive là xong, không phải đụng tới khoá này nữa.

Thời gian: ~5 phút. Hoàn toàn **miễn phí**.

---

## Phần A — Tạo khoá API

### Bước 0. Mở Google Cloud Console & chọn dự án
- Vào: **https://console.cloud.google.com** → đăng nhập Google.
- Nếu **đã có sẵn một dự án** (ví dụ "PRApplication") đang hiển thị trên thanh trên cùng → DÙNG LUÔN, bỏ qua việc tạo dự án mới.
- Nếu chưa có: bấm ô chọn dự án trên cùng → **NEW PROJECT** → đặt tên → **CREATE** → chọn dự án đó.

### Bước 1. Bật "Google Drive API"
Cách 1 (theo menu — khớp giao diện mới):
- Menu bên trái → **APIs & Services** → **Library**.
- Ô tìm kiếm gõ `Google Drive API` → bấm kết quả **Google Drive API** → bấm **ENABLE / BẬT**.

Cách 2 (nhanh — bấm thẳng, tự trỏ vào dự án đang chọn):
- **https://console.cloud.google.com/apis/library/drive.googleapis.com** → bấm **ENABLE**.

### Bước 2. Tạo khoá API
- Menu bên trái → **APIs & Services** → **Credentials**
  (hoặc bấm thẳng: **https://console.cloud.google.com/apis/credentials**).
- Trên cùng bấm **+ CREATE CREDENTIALS** → chọn **API key**.
- Khoá dạng `AIzaSy....` hiện ra → bấm **COPY**.

### Bước 3. (Nên làm) Giới hạn khoá cho an toàn
- Trong cửa sổ vừa hiện bấm **Edit API key** (hoặc vào lại Credentials, bấm tên khoá).
- Mục **API restrictions** → chọn **Restrict key** → tích **Google Drive API** → **SAVE**.
- (Có thể bỏ qua nếu muốn nhanh, nhưng nên làm để khoá không bị lạm dụng.)

---

## Phần B — Nhập khoá vào ứng dụng (1 lần)

1. Vào ứng dụng → **🔐 Trang quản trị** → đăng nhập bằng tài khoản Super Admin.
2. Mở tab **⚙️ Cấu hình**.
3. Dán khoá `AIzaSy...` vào ô **Google API Key** → bấm **Lưu cấu hình**.

✅ Xong! Từ giờ ứng dụng đã có thể đọc ảnh từ Google Drive.

---

## Phần C — Cách Admin dùng hằng ngày (rất đơn giản)

Mỗi khi có sự kiện mới, Admin chỉ cần:

1. Vào thư mục ảnh trên Google Drive → bấm **Chia sẻ (Share)** →
   ở mục "Quyền truy cập chung", chọn **Bất kỳ ai có đường liên kết (Anyone with the link)** →
   vai trò để **Người xem (Viewer)** → **Sao chép liên kết**.
2. Vào **Trang quản trị → Sự kiện → Tạo sự kiện**, **dán link** vào ô *Link thư mục Google Drive* → **Lưu**.
3. Hệ thống tự nạp toàn bộ ảnh. Xong!

> ⚠️ Lưu ý quan trọng: thư mục Drive **phải** ở chế độ **"Bất kỳ ai có đường liên kết"**.
> Nếu để ở chế độ riêng tư, hệ thống sẽ báo lỗi và không đọc được ảnh.

---

## Câu hỏi thường gặp

**Có tốn tiền không?** Không. Hạn mức đọc Drive miễn phí rất lớn, dùng cho sự kiện ảnh thoải mái.

**Khoá API có cần đổi định kỳ không?** Không. Nhập 1 lần là chạy mãi, trừ khi anh/chị tự xoá khoá.

**Nhiều Admin có cần mỗi người 1 khoá không?** KHÔNG. Chỉ 1 khoá chung do Super Admin nhập. Các Admin khác chỉ dán link Drive.

**Lỡ làm sai bước nào?** Cứ vào lại trang Credentials xoá khoá cũ và tạo khoá mới, rồi nhập lại vào Cấu hình.
