# 🚀 Thông tin Deploy (Railway)

## Địa chỉ website chính thức
**https://tim-anh-su-kien-production.up.railway.app**

- Có HTTPS sẵn → dùng tốt trên điện thoại (chụp ảnh tìm khuôn mặt).
- Dữ liệu lưu trên ổ cứng riêng (volume `/data`) — không mất khi cập nhật hay khởi động lại.
- Tài khoản Railway: tuanbui88vn@gmail.com.
- Project: **tim-anh-su-kien** — https://railway.com/project/7c95c6e0-6f54-43ea-943a-52dedf752fc5

## Đăng nhập quản trị (Super Admin)
- Vào website → **🔐 Trang quản trị**.
- Email: `tuanbui88vn@gmail.com` — mật khẩu: như đã đặt ban đầu (NÊN đổi sau lần đăng nhập đầu).
- Sau khi đăng nhập: vào **⚙️ Cấu hình** → dán **Khoá API Google Drive** (xem `HUONG-DAN-LAY-API-GOOGLE.md`).

## Cách cập nhật website khi sửa code
Mở terminal trong thư mục dự án và chạy:
```
railway up --detach
```
Chờ ~2-4 phút (lần đầu lâu hơn vì cài thư viện AI). Lần đầu trên máy mới: chạy `railway login` trước, rồi `railway link` chọn project `tim-anh-su-kien`.

## Cấu hình đã thiết lập sẵn trên Railway
- Biến môi trường: `DATA_DIR=/data`, `NODE_ENV=production`, `SESSION_SECRET` (ngẫu nhiên).
- Volume `tim-anh-su-kien-volume` gắn ở `/data` (chứa cơ sở dữ liệu + ảnh bìa + mô hình AI).
- `PORT` do Railway tự cấp.

## Mô hình AI ArcFace (174MB)
- KHÔNG nằm trong code (vượt giới hạn GitHub). Hệ thống **tự tải về `/data` ở lần quét khuôn mặt đầu tiên** và giữ lại trong volume cho các lần sau.

## Lưu ý chi phí
- Tài khoản mới có credit dùng thử. Khi hết, cần gói **Hobby (~5 USD/tháng)** để web chạy liên tục.
- Xem mức dùng: https://railway.com/account/usage

## Khác biệt bản local và bản cloud
- Hai bản dùng **2 cơ sở dữ liệu riêng**. Làm gì trên local sẽ KHÔNG tự hiện trên cloud và ngược lại.
- Bản cloud là bản chính thức để dùng cho sự kiện thật.
