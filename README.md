# Chấm Công Olive

App chấm công cho Android: tự check in / công tác / check out bằng vùng định vị quanh chỗ làm (kể cả khi app đã tắt), cho bấm và sửa giờ tay, tính giờ làm, OT 150% / 200% / 300% và ước tính lương tháng, xuất Excel và PDF.

## Tải APK

Mỗi lần đẩy code lên nhánh `main`, GitHub Actions tự build APK và tạo một bản phát hành trong mục **Releases**. Mở bản mới nhất trên điện thoại, tải file `.apk` và cài. Bản mới cài đè lên bản cũ, dữ liệu được giữ nguyên.

## Quy tắc tính công

- Giờ làm tính từ check in đến check out, không phụ thuộc giờ hành chính 8h–17h.
- Mốc vào và ra làm tròn xuống theo block 15 phút (6:07 → 6:00, 17:43 → 17:30).
- Trừ 1 tiếng nghỉ trưa khi ca làm đi qua khung 12h–13h. Ngày thường chuẩn 8 tiếng = 1 công; thứ 7 làm 4 tiếng = 1 công; làm nửa ngày = 0,5 công.
- Phần vượt chuẩn từ 30 phút trở lên tính OT 150%, theo bước 30 phút. Chủ nhật 200%, ngày lễ 300%, nghỉ bù 200%.
- Lương ngày = lương tháng ÷ số ngày T2–T7 trong tháng; lương giờ = lương ngày ÷ 8. Lương thử việc và chính thức áp dụng theo ngày bắt đầu.

## Chấm công tự động (geofence)

- Ở trong vùng đủ 5 phút: check in (giờ vào là lúc bước vào vùng).
- Rời vùng trong 60 phút đầu sau check in: tính là đi công tác; quay lại thì kết thúc công tác.
- Rời vùng sau 15:00: check out. Quay lại thì huỷ giờ ra đó.
- Giờ bấm hoặc sửa tay luôn được ưu tiên hơn giờ tự động.

App cần quyền vị trí **"Cho phép mọi lúc"** và nên tắt tối ưu pin cho app (Xiaomi, Oppo, Vivo, Samsung).

## Phát triển

```bash
npm ci
TZ=Asia/Bangkok npm test   # kiểm tra logic tính công
npm run build:web          # tạo www/ (dùng cho app và Netlify) và dist/artifact.html
npx cap sync android       # chép web vào dự án Android
```

Mã nguồn giao diện nằm trong `src/` (`core.js` là phần tính toán thuần, có test trong `tests/`). Phần Android tự viết nằm trong `android/app/src/main/java/vn/olive/chamcong/`.

Build bản ký cần hai secret của repo: `OLIVE_KEYSTORE_BASE64` (file khoá ký mã hoá base64) và `OLIVE_KEYSTORE_PASSWORD`.
