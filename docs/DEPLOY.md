# Triển khai Cloudflare Pages + D1

Hướng dẫn này dùng **gói miễn phí** của Cloudflare Pages và D1. Không cần R2,
Supabase, Firebase, VPS, database ngoài hay Worker riêng.

## 1. Điều kiện

- Tài khoản Cloudflare.
- Repository GitHub chứa project này.
- Wrangler đã đăng nhập trên máy:

```powershell
npx wrangler login
npx wrangler whoami
```

> Nếu `whoami` báo chưa đăng nhập, không thể tạo D1 hay deploy thật. Phần local
> vẫn chạy được bằng D1 local (xem README).

## 2. Tạo D1 database

```powershell
npx wrangler d1 create results-db
```

Lệnh trả về `database_id`. Mở `wrangler.jsonc` và thay giá trị placeholder:

```jsonc
{
  "name": "de-toan-thpt",
  "pages_build_output_dir": ".",
  "compatibility_date": "2026-11-01",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "results-db",
      "database_id": "<database_id thật>"
    }
  ]
}
```

- **Không** đổi `binding` khỏi `DB`: code đọc `env.DB`.
- **Không** tạo/xóa/đổi tên database trong lúc chạy thử.
- Giữ `database_id` placeholder chỉ khi phát triển local.

## 3. Áp migration

```powershell
# Kiểm tra migration trước (không cần Cloudflare)
node tools/check-migrations.js

# Áp lên D1 thật — chỉ sau khi đã xem lại migration
npx wrangler d1 migrations apply results-db --remote
```

Kiểm tra:

```powershell
npx wrangler d1 migrations list results-db --remote
```

> Mỗi thay đổi cấu trúc sau này phải là file mới trong `migrations/`. Không sửa
> file đã chạy trên môi trường thật.

## 4. Tạo Pages project

Cách khuyến nghị: nối GitHub để tự deploy khi push `main`.

1. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git**.
2. Chọn repository.
3. Cấu hình build:
   - **Framework preset**: None
   - **Build command**: để trống
   - **Build output directory**: `/` (thư mục gốc repository)
4. Deploy lần đầu.

Cloudflare tự nhận thư mục `functions/` ở gốc làm Pages Functions và
`migrations/` không bị đưa lên phần tĩnh nhờ `.assetsignore`.

### Deploy thủ công (không qua Git)

```powershell
npx wrangler pages deploy . --project-name de-toan-thpt
```

## 5. Biến môi trường (secrets)

Vào **Pages project → Settings → Environment variables** và thêm cho cả
**Production** (và **Preview** nếu dùng):

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `TEACHER_PASSWORD_HASH` | có | Hash PBKDF2-SHA256 của mật khẩu giáo viên |
| `SESSION_SECRET` | có | Chuỗi ngẫu nhiên ≥ 32 ký tự, ký cookie phiên |
| `TEACHER_SESSION_HOURS` | không | Thời hạn phiên, 1–168 giờ, mặc định 12 |

Sinh giá trị:

```powershell
node tools/hash-password.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Quy tắc an toàn:

- Chỉ lưu trong Cloudflare Environment variables (và `.dev.vars` khi local).
- **Không** commit `.dev.vars`, không dán mật khẩu/hash/secret vào chat, log,
  issue hay mã nguồn.
- Đổi `TEACHER_PASSWORD_HASH` để đổi mật khẩu; đổi `SESSION_SECRET` để hủy toàn
  bộ phiên đang đăng nhập.
- Biến môi trường chỉ có hiệu lực sau khi deploy lại / khởi động lại.

## 6. Kiểm tra sau deploy

```powershell
# Thay bằng domain thật
Invoke-RestMethod https://<project>.pages.dev/api/health
```

Kỳ vọng:

```json
{ "ok": true, "service": "exam-results", "db": "ok", "schema": "ready" }
```

Kiểm tra thêm:

1. Mở trang chủ, làm thử một đề, nộp bài.
2. Mở `teacher.html`, đăng nhập, thấy kết quả vừa nộp.
3. Bấm xuất CSV, mở bằng Excel, kiểm tra tiếng Việt và đủ dòng.
4. Ngắt mạng, nộp một bài, xác nhận kết quả vẫn hiện và có thông báo “đã lưu
   trên máy”; bật mạng lại, xác nhận tự đồng bộ.

## 7. Giới hạn cần biết (gói miễn phí)

- Pages Functions và D1 có hạn mức request/ngày và dung lượng miễn phí; theo dõi
  ở Dashboard → Usage.
- `/api/results/export` giới hạn 50.000 dòng/lần. Vượt quá nên lọc theo lớp/đề
  hoặc dùng `wrangler d1 export` (xem `docs/BACKUP.md`).
- D1 Time Travel có thời hạn khôi phục giới hạn (theo chính sách Cloudflare).
  Vì vậy vẫn cần xuất SQL định kỳ.
- Trang `teacher.html` công khai phần giao diện nhưng mọi API dữ liệu đều yêu
  cầu phiên giáo viên.

## 8. Xử lý sự cố nhanh

| Hiện tượng | Kiểm tra |
|---|---|
| `/api/health` trả `db: missing` | Thiếu binding `DB` hoặc chưa cấu hình `d1_databases` |
| `schema: missing` | Chưa chạy migration `--remote` |
| Login trả 503 | Thiếu `TEACHER_PASSWORD_HASH` hoặc `SESSION_SECRET` |
| Login đúng nhưng vẫn 401 | Cookie bị chặn, domain/HTTPS sai, hoặc secret vừa đổi |
| Nộp bài trả 404 | `exam_id` không khớp `functions/_lib/exam-data.js`; chạy `node tools/build-exam-data.js` |
| Điểm khác client | Chạy `node tools/test-scoring.js` để đối chiếu engine |
| Trang cũ vẫn hiện sau deploy | Tăng `CACHE_VERSION` trong `sw.js` rồi mở online một lần |
