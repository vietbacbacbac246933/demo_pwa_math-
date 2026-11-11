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
  "name": "openexam",
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
node _system/tools/check-migrations.js

# Áp lên D1 thật — chỉ sau khi đã xem lại migration
npx wrangler d1 migrations apply results-db --remote
```

Kiểm tra:

```powershell
npx wrangler d1 migrations list results-db --remote
```

> Mỗi thay đổi cấu trúc sau này phải là file mới trong `_system/migrations/`. Không sửa
> file đã chạy trên môi trường thật.

## 4. Tạo Pages project

Cách an toàn nhất cho project này: tạo project rồi deploy bằng script ở dưới.
Lý do: repo còn chứa `_system/tools/`, `_system/migrations/`, `_system/docs/` và các file cấu hình không
nên được phục vụ công khai; deploy thẳng thư mục gốc sẽ đưa tất cả lên web.

Nếu muốn nối GitHub để tự deploy:

1. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git**.
2. Chọn repository.
3. Cấu hình build:
   - **Framework preset**: None
   - **Build command**: phải tạo ra thư mục đầu ra chỉ chứa file tĩnh
     (`index.html`, `teacher.html`, `sw.js`, `manifest.webmanifest`, `assets/`,
     `exams/`, `_headers`, `_routes.json`). Nếu chưa có bước build như vậy,
     dùng script deploy thủ công bên dưới.
   - **Build output directory**: thư mục sạch do build command tạo ra
4. Deploy lần đầu.

Cloudflare tự nhận thư mục `functions/` ở gốc làm Pages Functions. Phần tĩnh
phải được tạo bằng script deploy ở dưới (không deploy thẳng thư mục gốc).

### Cập nhật đề rồi deploy

Cách nhanh nhất — giao diện Local Helper:

1. Nhấp đúp `START.bat`.
2. Kéo thả file `.html` / thư mục export / `.zip` vào giao diện.
3. Kiểm tra kế hoạch rồi bấm **Đăng lên thư viện**.

Trợ lý chỉ chạy trên `127.0.0.1`, mở `add-exam.html` bằng token ngẫu nhiên
theo phiên. Giao diện dùng lại đúng pipeline cũ: `import-exam.js` →
`update-and-deploy.ps1` → `deploy-pages.ps1`, không thêm dịch vụ mới.

- Đề trùng mã mặc định được thêm thành đề mới; chỉ ghi đè khi chọn **Cập nhật**.
  Bản cũ luôn được sao lưu vào `backups/exam-updates/`.
- Deploy lỗi sẽ khôi phục catalog và `exams/` về trạng thái trước khi đăng.
- Snapshot/log của trợ lý nằm trong `%LOCALAPPDATA%\ExamLibraryHelper\`.
- Đóng trình duyệt không dừng tiến trình; mở lại giao diện để xem tiếp.

### Deploy bằng terminal (dự phòng)

1. Chép file `.html` / thư mục export / `.zip` đề mới vào thư mục project.
2. Nhấp đúp `START-CLOUDFLARE.bat`.

Script tự quét file mới ở thư mục gốc, nhập vào `exams/`, rồi chạy
`patch-exams` → `build-exam-data` → `build-cache-manifest` → `check-library`
→ `test-sw-lazy` → `test-scoring` → tăng `CACHE_VERSION` → deploy. Không commit/push GitHub,
không deploy thư mục gốc.

Chỉ sửa đề đã có thì cứ nhấp đúp; script báo "Không tìm thấy đề mới nào" rồi
vẫn cập nhật và deploy.

Hoặc chạy dòng lệnh:

```powershell
# Tự quét file mới trong thư mục project
powershell -ExecutionPolicy Bypass -File _system/tools/update-and-deploy.ps1

# Chỉ định rõ file
powershell -ExecutionPolicy Bypass -File _system/tools/update-and-deploy.ps1 -ExamPath "C:\de-moi.html"
```

Truyền tham số `import-exam` qua BAT:

```bat
START-CLOUDFLARE.bat --subject toan --number 3 --title "Đề Toán số 3"
START-CLOUDFLARE.bat --check-only
START-CLOUDFLARE.bat --no-deploy
```

Tùy chọn PowerShell: `-CheckOnly`, `-NoDeploy`, `-Yes`.

> `START-GITHUB.bat` (hoặc `START.bat --github`) là quy trình cũ cho GitHub
> Pages: bắt buộc nhánh `main`, không chạy `build-exam-data` và không deploy
> Cloudflare. Không dùng cho `de-toan-thpt.pages.dev`.

### Deploy thủ công (khuyến nghị cho project này)

> **Chỉ dùng Direct Upload.** Project Pages tên `openexam` (domain
> `de-toan-thpt.pages.dev`) phải **tắt Git integration**. Nhánh `main` chứa
> bản GitHub Pages cũ, **không có `functions/`**; nếu Cloudflare build từ
> `main`, production sẽ mất API, D1 và trang giáo viên.
>
> Vào **Pages project → Settings → Builds & deployments** và Disconnect Git
> nếu mục này đang bật. Sau đó chỉ deploy bằng `START-CLOUDFLARE.bat` hoặc
> `_system/tools/deploy-pages.ps1`.

> **Cảnh báo:** `wrangler pages deploy .` upload **toàn bộ** thư mục hiện tại.
> `.assetsignore` **không** có tác dụng với Pages, nên `.dev.vars`, `backups/`,
> `_system/tools/`, `_system/migrations/`, `_system/docs/`... sẽ bị đưa lên web công khai.
>
> Luôn dùng script chỉ copy file tĩnh:

```powershell
powershell -ExecutionPolicy Bypass -File _system/tools/deploy-pages.ps1
```

Script sẽ tạo thư mục tạm chỉ gồm `index.html`, `teacher.html`, `sw.js`,
`manifest.webmanifest`, `_headers`, `_routes.json` và hai thư mục `assets/`,
`exams/`; kiểm tra danh sách file rồi mới deploy. `functions/` vẫn được
Wrangler đọc từ thư mục gốc để chạy API.

Nếu nối GitHub để tự deploy, cần cấu hình build tạo ra một thư mục đầu ra
sạch tương tự. Nếu chưa chắc, dùng script trên.

## 5. Biến môi trường (secrets)

Vào **Pages project → Settings → Environment variables** và thêm cho cả
**Production** (và **Preview** nếu dùng):

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `TEACHER_PASSWORD_HASH` | có | Hash PBKDF2-SHA256 của mật khẩu giáo viên |
| `SESSION_SECRET` | có | Chuỗi ngẫu nhiên ≥ 32 ký tự, ký cookie phiên |
| `TEACHER_SESSION_HOURS` | không | Thời hạn phiên, 1–168 giờ, mặc định 12 |
| `TURNSTILE_SITE_KEY` | không | Site key Turnstile (đặt cùng `TURNSTILE_SECRET_KEY` để bật) |
| `TURNSTILE_SECRET_KEY` | không | Secret key Turnstile, dùng ở server để xác minh token |
| `SUBMIT_RATE_LIMIT_MAX` | không | Số lượt nộp tối đa mỗi IP trong một cửa sổ, mặc định 1000 |
| `SUBMIT_RATE_LIMIT_WINDOW_SECONDS` | không | Độ dài cửa sổ giới hạn, mặc định 600 giây |
| `SUBMIT_RATE_BURST_MAX` | không | Số lượt nộp tối đa mỗi IP trong cửa sổ ngắn, mặc định 300 |
| `SUBMIT_RATE_BURST_WINDOW_SECONDS` | không | Độ dài cửa sổ burst, mặc định 60 giây |

Sinh giá trị:

```powershell
node _system/tools/hash-password.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> `_system/tools/hash-password.js` dùng **50.000 vòng** PBKDF2-SHA256. Không tăng lên
> vài trăm nghìn vòng trên gói miễn phí: phép tính có thể vượt giới hạn CPU
> của request và đăng nhập sẽ luôn trả `401` dù mật khẩu đúng. Mật khẩu dài,
> ngẫu nhiên (≥ 16 ký tự) quan trọng hơn số vòng.

Quy tắc an toàn:

- Chỉ lưu trong Cloudflare Environment variables (và `.dev.vars` khi local).
- **Không** commit `.dev.vars`, không dán mật khẩu/hash/secret vào chat, log,
  issue hay mã nguồn.
- Đổi `TEACHER_PASSWORD_HASH` để đổi mật khẩu; đổi `SESSION_SECRET` để hủy toàn
  bộ phiên đang đăng nhập.
- Biến môi trường chỉ có hiệu lực sau khi deploy lại / khởi động lại.

### Giới hạn tần suất nộp bài

`/api/submit` có rate limit theo IP, lưu trong bảng `rate_limits` của D1
(migration `0003_create_rate_limits.sql`). Nhờ lưu trong D1, giới hạn có hiệu
lực trên mọi instance Worker, không chỉ một máy.

- Mặc định: **1000 lượt / 10 phút / IP**, và tối đa **300 lượt / phút / IP**.
  Ngưỡng này được đặt cao có chủ đích vì cả lớp (~45 học sinh) thường dùng
  chung một IP NAT/proxy của trường. Đặt thấp sẽ chặn nhầm chính các em.
- Vượt ngưỡng trả `429 SUBMIT_RATE_LIMITED` kèm header `Retry-After`.
- IP được băm SHA-256 trước khi lưu; bảng không chứa IP thô hay dữ liệu học sinh.
- IPv6 được gom theo /64 để không lách được giới hạn bằng cách đổi địa chỉ
  trong cùng một mạng.
- Request từ loopback (chỉ có khi chạy local) được bỏ qua để không cản kiểm thử.
- Một lớp học dùng chung NAT/proxy của trường có thể có nhiều học sinh cùng IP.
  Nếu vẫn thường xuyên bị `429` vào giờ cao điểm (ví dụ nhiều lớp thi cùng lúc),
  tăng `SUBMIT_RATE_LIMIT_MAX` và `SUBMIT_RATE_BURST_MAX` thay vì tắt giới hạn.
- Trước lần deploy đầu tiên có tính năng này, chạy migration:
  `npx wrangler d1 migrations apply results-db --remote`.

### Turnstile (tùy chọn, khuyến nghị khi API bị spam)

Rate limit giảm spam từ một IP nhưng không chặn được kẻ tấn công dùng nhiều IP.
Bật Turnstile để yêu cầu mỗi lượt nộp có token xác minh:

1. Cloudflare Dashboard → **Turnstile** → **Add widget**.
2. Thêm hostname của trang (ví dụ `de-toan-thpt.pages.dev`) và lấy
   **Site Key** + **Secret Key**.
3. Đặt `TURNSTILE_SITE_KEY` và `TURNSTILE_SECRET_KEY` trong Environment
   variables (cả Production và Preview nếu dùng), rồi deploy lại.
4. Kiểm tra `GET /api/config` trả `turnstile_site_key` khác `null`.

Khi đã đặt secret, server từ chối request thiếu/sai token bằng
`403 TURNSTILE_REQUIRED` hoặc `403 TURNSTILE_FAILED`. Trình duyệt tự lấy token
mới cho từng lượt gửi; bài đang chờ trong hàng đợi ngoại tuyến vẫn được giữ và
thử lại, không bị mất.

> Không đặt `TURNSTILE_SECRET_KEY` nếu chưa cấu hình widget: khi đó mọi lượt
> nộp sẽ bị từ chối. Nếu chỉ đặt một trong hai biến, Turnstile được coi là tắt.

### Không bật thử thách bot cho trang giáo viên

Trang `teacher.html` tự gọi `/api/results` mỗi 10 giây để cập nhật số bài đã
nộp. Không bật **Bot Fight Mode**, **Managed Challenge** hay Turnstile cho
`/teacher`, `/teacher.html` và `/api/results*`: các chốt này có thể chặn nhầm
phiên của giáo viên và làm bảng kết quả ngừng cập nhật. Trang đã được bảo vệ
bằng cookie phiên `HttpOnly` + `SameSite=Strict`; chỉ dùng Turnstile cho
`/api/submit` nếu cần chống spam. Nếu đang bật bảo vệ bot cho toàn site, tạo
WAF skip rule cho các đường dẫn trên.

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
  hoặc dùng `wrangler d1 export` (xem `_system/docs/BACKUP.md`).
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
| Login luôn 401 dù mật khẩu đúng | Hash tạo bằng quá nhiều vòng PBKDF2 (ví dụ 210.000) vượt giới hạn CPU gói miễn phí — tạo lại bằng `node _system/tools/hash-password.js` (50.000 vòng) |
| Login đúng nhưng vẫn 401 | Cookie bị chặn, domain/HTTPS sai, hoặc secret vừa đổi |
| Nộp bài trả 404 | `exam_id` không khớp `functions/_lib/exam-data.js`; chạy `node _system/tools/build-exam-data.js` |
| Điểm khác client | Chạy `node _system/tools/test-scoring.js` để đối chiếu engine |
| Nộp bài trả `429` | Đã chạm rate limit của IP; chờ theo `Retry-After` hoặc tăng `SUBMIT_RATE_LIMIT_MAX` / `SUBMIT_RATE_BURST_MAX` |
| Nộp bài trả `403 TURNSTILE_*` | Thiếu/sai `TURNSTILE_SITE_KEY`, token hết hạn, hoặc secret không khớp widget |
| `/api/config` trả `turnstile_site_key: null` | Chưa đặt đủ cả `TURNSTILE_SITE_KEY` và `TURNSTILE_SECRET_KEY` |
| Trang cũ vẫn hiện sau deploy | Chạy `node _system/tools/bump-cache-version.js` (hoặc dùng `_system/tools/update-and-deploy.ps1`) rồi mở online một lần |
| File nội bộ (`.dev.vars`, `backups/`) truy cập được | Đã deploy nhầm thư mục gốc. Dùng `_system/tools/deploy-pages.ps1`, xoá deployment cũ; nếu file chứa secret thì đổi mật khẩu và `SESSION_SECRET` ngay |
