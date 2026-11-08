# Sao lưu và khôi phục dữ liệu kết quả

Dữ liệu kết quả nằm trong D1 `results-db`. Bài làm của học sinh **không** thể
khôi phục từ `localStorage` hay CSV một khi đã mất trên máy chủ, nên cần sao lưu
chủ động.

> File sao lưu chứa họ tên, lớp và bài làm của học sinh. Giữ trong thư mục
> `backups/` (đã gitignore), không commit, không gửi qua chat, không đính kèm
> công khai.

## 1. Ba lớp sao lưu

| Cách | Phạm vi | Dùng khi |
|---|---|---|
| D1 Time Travel | Toàn bộ database tại một mốc thời gian | Khôi phục nhanh sau lỗi/xóa nhầm gần đây |
| Xuất SQL định kỳ | Toàn bộ schema + dữ liệu | Lưu trữ dài hạn, chuyển môi trường |
| Xuất CSV của giáo viên | Các cột hiển thị, theo bộ lọc | Báo cáo/đối chiếu — **không** phải bản sao lưu đầy đủ |

CSV **không** chứa `answers_json`, `payload_hash`, `client_submitted_at` hay
toàn bộ lịch sử cấu trúc, nên không thể dùng để dựng lại database.

> Xóa trên trang giáo viên không xóa vĩnh viễn ngay: bản ghi được chép sang
> bảng `submissions_archive` trong cùng database trước khi xóa, và có thể hoàn
> tác bằng nút **Hoàn tác**. Bảng lưu trữ nằm trong `results-db` nên file xuất
> SQL có cả hai bảng. Đây chỉ là lưới an toàn ngắn hạn — vẫn cần sao lưu định kỳ.

## 2. D1 Time Travel

Cloudflare giữ các mốc khôi phục của D1 trong một khoảng thời gian giới hạn
(theo chính sách của Cloudflare). Cách dùng:

1. Dashboard → **D1** → `results-db` → **Backups** / **Time Travel**.
2. Chọn mốc thời gian trước sự cố.
3. Ghi lại bookmark của mốc đó trước khi khôi phục.

Hoặc qua Wrangler:

```powershell
# Xem thông tin Time Travel
npx wrangler d1 time-travel info results-db --remote

# Khôi phục về một bookmark (thay <bookmark>)
npx wrangler d1 time-travel restore results-db --bookmark <bookmark> --remote
```

**Lưu ý:** khôi phục Time Travel ghi đè trạng thái database. Luôn xuất SQL hiện
tại trước khi khôi phục, và thử trên D1 local/staging nếu có thể.

## 3. Xuất SQL định kỳ

```powershell
# Tạo thư mục (đã gitignore)
New-Item -ItemType Directory -Force -Path backups | Out-Null

# Xuất toàn bộ schema + dữ liệu
npx wrangler d1 export results-db --remote `
  --output "backups/results-db-$(Get-Date -Format yyyyMMdd-HHmm).sql"
```

Kiểm tra file:

```powershell
Get-Item backups\results-db-*.sql | Sort-Object LastWriteTime -Descending | Select-Object -First 3
Select-String -Path backups\results-db-*.sql -Pattern "CREATE TABLE|INSERT INTO" | Select-Object -First 5
```

Tần suất gợi ý:

- Trong đợt kiểm tra/thi: xuất sau mỗi buổi.
- Thời gian bình thường: 1 lần/tuần.
- Trước mọi migration production: xuất ngay.

Giữ ít nhất 4 bản gần nhất; bản cũ hơn có thể nén và lưu ngoài máy.

## 4. Khôi phục từ file SQL

Ưu tiên khôi phục vào một database **mới** để kiểm tra trước, sau đó mới đổi
binding nếu cần.

```powershell
# Tạo database tạm để kiểm tra
npx wrangler d1 create results-db-restore

# Nạp file backup vào database tạm
npx wrangler d1 execute results-db-restore --remote `
  --file "backups/results-db-20260101-1200.sql"
```

Sau khi kiểm tra số dòng và dữ liệu mẫu, có thể:

- Đổi `database_id` trong `wrangler.jsonc` sang database đã khôi phục, deploy
  lại; hoặc
- Dùng Time Travel/bookmark nếu sự cố mới xảy ra.

**Không** chạy `DROP TABLE` hay xóa dữ liệu trên database thật để “làm sạch”
trước khi khôi phục nếu chưa có bản sao lưu mới.

## 5. Kiểm tra sau khôi phục

```powershell
# Sức khỏe API
Invoke-RestMethod https://<project>.pages.dev/api/health

# Đếm số dòng và xem vài bản ghi mới nhất (cần đăng nhập giáo viên)
npx wrangler d1 execute results-db --remote `
  --command "SELECT COUNT(*) AS total, MAX(submitted_at) AS latest FROM submissions"
```

Sau đó mở `teacher.html`, đăng nhập, lọc thử theo lớp/đề và xuất CSV để đối
chiếu.

## 6. Những gì không nằm trong backup

- `TEACHER_PASSWORD_HASH`, `SESSION_SECRET`, `TEACHER_SESSION_HOURS`: lưu trong
  Cloudflare Environment variables. Ghi lại nơi quản lý mật khẩu an toàn, không
  đưa vào file backup SQL.
- Bài đang chờ đồng bộ trong IndexedDB của học sinh (`exam-results-outbox`):
  chỉ nằm trên thiết bị. Nếu xóa dữ liệu trình duyệt trước khi có mạng, bài đó
  sẽ mất.
- Lịch sử `localStorage` trên từng thiết bị: không đồng bộ và không sao lưu.

## 7. Quy trình trước migration production

1. `node tools/check-migrations.js` phải OK.
2. Xuất SQL backup mới.
3. Ghi lại bookmark Time Travel.
4. Chạy `wrangler d1 migrations apply results-db --remote`.
5. Kiểm tra `/api/health` và một lượt nộp thử.
6. Nếu lỗi: khôi phục bookmark hoặc database tạm từ file SQL.
