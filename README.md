# Thư viện đề thi THPT

Website đề thi chạy trên **Cloudflare Pages** (gói miễn phí): phần giao diện là
tĩnh, phần nhận và quản lý kết quả dùng **Pages Functions + D1**. Mỗi đề vẫn là
một file HTML độc lập, giữ nguyên câu hỏi, cách chấm và giao diện gốc.

- Học sinh làm bài **không cần tài khoản**, vẫn dùng được **ngoại tuyến**.
- **Cache lười**: Service Worker chỉ tải trước phần lõi (trang chủ, CSS/JS,
  icon). Mỗi đề chỉ được tải và lưu khi học sinh mở đề đó; các đề khác không
  bị tải theo, tránh nghẽn Wi-Fi khi cả lớp cùng vào.
- Kết quả được lưu trong `localStorage` trên thiết bị **và** tự đồng bộ lên D1
  khi có mạng; mất mạng thì xếp hàng trong IndexedDB và tự thử lại.
- Giáo viên đăng nhập bằng mật khẩu dùng chung để xem, lọc và xuất CSV toàn bộ
  kết quả.
- Trang giáo viên tự cập nhật mỗi 10 giây và hiển thị số bài đã nộp, nên cả lớp
  nộp xong là giáo viên thấy đủ mà không phải bấm tải lại.
- Giáo viên có thể xóa kết quả ngay trên trang quản trị; bản ghi được chép
  sang `submissions_archive` trước khi xóa nên hoàn tác được.
- Không dùng R2, Supabase, Firebase, VPS, database ngoài hay Worker riêng.
- Điểm do **máy chủ chấm lại** từ bộ đáp án chuẩn; điểm do trình duyệt gửi lên
  bị bỏ qua.

> Đáp án vẫn nằm trong HTML để chấm offline. Máy chủ chấm lại nhằm chống sửa
> điểm, **không** chống người rành kỹ thuật mở mã nguồn xem đáp án.

---

## 1. Cấu trúc thư mục

```text
repository/                        # mở thư mục chỉ thấy 2 mục: Start/ và _system/
├── Start/                         # Giáo viên mở thư mục này để chạy
│   ├── START.bat                  # Mở giao diện quản lý đề (giáo viên)
│   ├── START-CLOUDFLARE.bat       # Deploy trực tiếp bằng terminal (dự phòng)
│   └── START-GITHUB.bat           # Quy trình GitHub Pages cũ
│
│   --- các file web dưới đây vẫn ở gốc repo nhưng bị ẨN (xem ghi chú cuối) ---
├── index.html                     # Trang chủ thư viện
├── teacher.html                   # Trang kết quả cho giáo viên
├── manifest.webmanifest           # Manifest PWA dùng chung
├── sw.js                          # Service Worker ở GỐC (scope toàn site)
├── wrangler.jsonc                 # Cấu hình Pages + binding D1
├── _routes.json                   # Chỉ chạy Functions cho /api/*
├── _headers                       # Header cache/security
├── .dev.vars.example              # Mẫu biến môi trường local (không commit .dev.vars)
│
├── exams/
│   ├── toan/de_toan_01.html        # Mỗi đề là một file độc lập
│   └── ...
│
├── assets/
│   ├── css/
│   │   ├── library.css            # CSS trang chủ
│   │   └── teacher.css            # CSS trang giáo viên
│   ├── js/
│   │   ├── catalog.js             # Danh mục đề — nơi cần sửa khi thêm đề
│   │   ├── library.js             # Tìm kiếm, lọc, đăng ký PWA
│   │   ├── result-queue.js        # Hàng đợi IndexedDB + đồng bộ kết quả
│   │   └── teacher.js             # Đăng nhập, bảng kết quả, xuất CSV
│   └── icons/
│
├── functions/                     # Cloudflare Pages Functions
│   ├── _lib/
│   │   ├── http.js                 # JSON, lỗi, đọc body, giới hạn kích thước
│   │   ├── auth.js                 # PBKDF2 + cookie HMAC HttpOnly
│   │   ├── scoring.js              # Chấm điểm phía máy chủ
│   │   ├── exam-data.js            # Bộ đáp án chuẩn (sinh tự động)
│   │   ├── results-query.js        # Lọc/sắp xếp/phân trang an toàn
│   │   ├── rate-limit.js           # Rate limit nộp bài lưu trong D1
│   │   └── turnstile.js            # Xác minh Turnstile (tùy chọn)
│   └── api/
│       ├── health.js
│       ├── config.js               # Cấu hình công khai (site key Turnstile)
│       ├── exams.js
│       ├── submit.js
│       ├── results.js              # GET danh sách (giáo viên)
│       ├── results/export.js       # GET CSV (giáo viên)
│       ├── results/delete.js       # POST xóa/hoàn tác (giáo viên)
│       └── auth/{login,logout}.js
│
└── _system/                       # FILE HỆ THỐNG — không sửa tay
    ├── migrations/
    │   ├── 0001_create_submissions.sql
    │   ├── 0002_create_submissions_archive.sql
    │   ├── 0003_create_rate_limits.sql
    │   └── README.md
    ├── docs/
    │   ├── DEPLOY.md               # Triển khai Cloudflare Pages + D1
    │   ├── BACKUP.md               # Sao lưu và khôi phục
    │   └── QUAN-LY-DE.md           # Hướng dẫn Local Helper
    ├── ui/
    │   └── add-exam.html           # Giao diện Local Helper (chỉ chạy trên máy)
    └── tools/
        ├── local-helper.js         # Local Helper (127.0.0.1)
        ├── manage-exam.js          # Đổi tên / xóa đề
        ├── import-exam.js          # Nhập đề mới
        ├── check-library.js        # Kiểm tra danh mục/file đề
        ├── check-migrations.js     # Kiểm tra migration trên SQLite in-memory
        ├── build-exam-data.js      # Sinh exam-data.js từ các file đề
        ├── build-cache-manifest.js # Sinh hash đề cho Service Worker
        ├── patch-exams.js          # Tích hợp ô lớp + hàng đợi vào đề
        ├── bump-cache-version.js   # Tăng CACHE_VERSION trong sw.js
        ├── update-and-deploy.ps1   # Cập nhật đề + deploy một lần
        ├── deploy-pages.ps1        # Chỉ deploy file tĩnh đã whitelist
        ├── hash-password.js        # Sinh TEACHER_PASSWORD_HASH
        ├── test-sw-lazy.js         # Kiểm tra cache lười (không tải trước đề)
        ├── test-scoring.js         # Đối chiếu chấm điểm client/server
        └── test-api.js             # Kiểm thử API trên Wrangler local
```

> **Vì sao file web vẫn nằm ở gốc?** `index.html`, `assets/`, `exams/`, `functions/`,
> `sw.js` và `wrangler.jsonc` **phải** ở gốc repo: GitHub Pages phục vụ từ gốc,
> Cloudflare đọc `functions/` + `wrangler.jsonc` tại gốc, và Service Worker cần
> scope `/`. Vì vậy **không xóa/di chuyển** các file này.
>
> Để thư mục gọn, chúng được đặt thuộc tính **Hidden** của Windows (chỉ ẩn khi
> xem, không ảnh hưởng web/PWA/deploy). `Start\START.bat` tự đặt lại thuộc tính
> này mỗi lần chạy. Muốn xem lại để sửa file:
>
> ```powershell
> # Hiện lại toàn bộ file web ở gốc
> powershell -ExecutionPolicy Bypass -File _system/tools/hide-runtime.ps1 -Show
>
> # Ẩn lại cho gọn
> powershell -ExecutionPolicy Bypass -File _system/tools/hide-runtime.ps1
> ```
>
> Chỉ các công cụ, tài liệu, migration và giao diện trợ lý được gom vào `_system/`.


---

## 2. API

Tất cả phản hồi là JSON (trừ CSV) và có `Cache-Control: no-store`.

| Phương thức | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| `GET` | `/api/health` | công khai | Kiểm tra DB và bảng `submissions` |
| `GET` | `/api/config` | công khai | Site key Turnstile (nếu đã bật) |
| `GET` | `/api/exams` | công khai | Danh mục đề; giáo viên đã đăng nhập thấy thêm số lượt nộp |
| `POST` | `/api/submit` | công khai | Nhận bài, chấm lại, chống trùng, rate limit |
| `GET` | `/api/results` | giáo viên | Danh sách có lọc/sắp xếp/phân trang |
| `GET` | `/api/results/export` | giáo viên | Xuất CSV toàn bộ kết quả khớp bộ lọc |
| `POST` | `/api/results/delete` | giáo viên | Xóa / hoàn tác kết quả (có lưu trữ) |
| `POST` | `/api/auth/login` | công khai | Đăng nhập, đặt cookie phiên |
| `POST` | `/api/auth/logout` | công khai | Xóa cookie phiên |

### `POST /api/submit`

Body tối đa 64 KB, `Content-Type: application/json`:

```json
{
  "submission_id": "uuid-hoặc-mã-8..64-ký-tự",
  "exam_id": "toan_01",
  "student_name": "Nguyễn Văn A",
  "student_class": "12A1",
  "answers": { "0": 2, "1": [0, 2], "2": [true, false] },
  "duration_seconds": 1234,
  "timed_out": false
}
```

- `submission_id` chỉ gồm `A-Z a-z 0-9 _ -`, dài 8–64 ký tự; dùng để chống gửi
  trùng khi mất mạng.
- `student_name` (≤ 80) và `student_class` (≤ 20) bắt buộc.
- `answers` được chuẩn hóa theo đúng loại câu hỏi của đề; giá trị ngoài phạm vi
  bị từ chối.
- Trả `201` khi lưu mới, `200` + `duplicate: true` khi gửi lặp cùng dữ liệu,
  `409` khi dùng lại `submission_id` với dữ liệu khác.
- `score`, `total_score`, `exam_title`, `submitted_at` do máy chủ tạo.
- Rate limit theo IP (mặc định 1000 lượt/10 phút, 300 lượt/phút) trả
  `429 SUBMIT_RATE_LIMITED` kèm `Retry-After`. Ngưỡng cao để cả lớp dùng chung
  IP của trường vẫn nộp được; không hạ thấp chỉ vì một lớp có ~45 học sinh.
- Nếu bật Turnstile, body có thể kèm `turnstile_token`; thiếu/sai token trả
  `403 TURNSTILE_REQUIRED` hoặc `403 TURNSTILE_FAILED`.

### `GET /api/results` và `/api/results/export`

Tham số dùng chung:

| Tham số | Giá trị | Ghi chú |
|---|---|---|
| `exam_id` | mã đề | lọc chính xác |
| `class` | tên lớp | không phân biệt hoa thường |
| `q` | từ khóa | tìm trong họ tên, tối đa 80 ký tự |
| `sort` | `submitted_at`, `score` | mặc định `submitted_at` |
| `order` | `asc`, `desc` | mặc định `desc` |
| `page` | 1–100000 | chỉ `/api/results`, mặc định 1 |
| `page_size` | 1–200 | chỉ `/api/results`, mặc định 50 |

- Mọi giá trị được bind qua prepared statement; `%` và `_` trong `q` được
  escape nên chỉ tìm theo ký tự thường.
- Export dùng cùng bộ lọc nhưng **không phân trang**, tối đa 50.000 dòng/lần.
- CSV có BOM UTF-8 để Excel hiện đúng tiếng Việt, và chống formula injection
  bằng cách thêm `'` trước ô bắt đầu bằng `= + - @`.

### `POST /api/results/delete`

Chỉ giáo viên đã đăng nhập. Body tối đa 8 KB:

| `mode` | Trường gửi kèm | Tác dụng |
|---|---|---|
| `one` | `submission_id` | Xóa 1 bài |
| `filter` | `exam_id` và/hoặc `student_class`, `confirm: "XOA"` | Xóa theo đề/lớp |
| `all` | `confirm: "XOA TAT CA"` | Xóa toàn bộ |
| `restore` | `batch_token` | Hoàn tác một lần xóa |

- Thêm `preview: true` để chỉ đếm số dòng sẽ xóa, không thay đổi dữ liệu.
- Mỗi lần tối đa 5.000 dòng; vượt giới hạn thì phải lọc theo đề hoặc lớp.
- Trước khi xóa, bản ghi được chép sang `submissions_archive` trong cùng một
  transaction. `restore` chèn lại các bản ghi và **giữ** bản lưu trữ để làm
  lịch sử, nên gọi lại nhiều lần không bị nhân bản.

---

## 3. Chạy local

Yêu cầu: Node.js >= 22.5 (để `check-migrations.js` dùng `node:sqlite`) và
Wrangler (chạy qua `npx wrangler`).

```powershell
# 1. Tạo biến môi trường local từ mẫu
Copy-Item .dev.vars.example .dev.vars

# 2. Sinh hash mật khẩu giáo viên (nhập mật khẩu ẩn)
node _system/tools/hash-password.js
# Dán TEACHER_PASSWORD_HASH vào .dev.vars

# 3. Sinh SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Dán vào .dev.vars

# 4. Áp migration vào D1 local
npx wrangler d1 migrations apply results-db --local

# 5. Chạy dev server
npx wrangler pages dev . --port 8788
```

Mở `http://127.0.0.1:8788/`. `.dev.vars` và `.wrangler/` đã nằm trong
`.gitignore`; **không commit** hai thứ này.

### Kiểm thử

```powershell
node _system/tools/build-exam-data.js --check
node _system/tools/build-cache-manifest.js --check
node _system/tools/check-migrations.js
node _system/tools/check-library.js
node _system/tools/patch-exams.js --check
node _system/tools/test-sw-lazy.js
node _system/tools/test-scoring.js

# Cần dev server đang chạy và mật khẩu giáo viên local
$env:TEST_TEACHER_PASSWORD = "mật-khẩu-local"
node _system/tools/test-api.js
```

`test-api.js` chỉ ghi vào D1 **local**. Mỗi lần chạy dùng một lớp riêng
(`T...`/`B...`) để không lẫn với dữ liệu Khác. Bộ test bao phủ: dữ liệu không
hợp lệ, rate limit nộp bài, chấm lại phía máy chủ, gửi trùng, hai lượt đồng
thời, ~100 lượt nộp, phân quyền, SQL injection, CSV đầy đủ/BOM/chống formula,
và đăng xuất.

### Kiểm thử tải tại local

Mở một cửa sổ PowerShell riêng để chạy dev server:

```powershell
npx wrangler pages dev . --port 8788
```

Cửa sổ thứ hai chạy load test, tăng dần số học sinh ảo:

```powershell
# Chạy từng mức riêng
node _system/tools/loadtest.js http://127.0.0.1:8788 toan_01 10
node _system/tools/loadtest.js http://127.0.0.1:8788 toan_01 25
node _system/tools/loadtest.js http://127.0.0.1:8788 toan_01 45
node _system/tools/loadtest.js http://127.0.0.1:8788 toan_01 100

# Hoặc chạy lần lượt nhiều mức trong một lệnh
node _system/tools/loadtest.js http://127.0.0.1:8788 toan_01 --ramp=10,25,45,100

# Gửi lặp mỗi bài 2 lần để kiểm tra chống trùng, bỏ thời gian chờ ngẫu nhiên
node _system/tools/loadtest.js http://127.0.0.1:8788 toan_01 45 --duplicate --delay=0
```

- Mỗi mức dùng một tên lớp riêng (in ra màn hình). Mở `teacher.html`, lọc đúng
  lớp đó để kiểm tra đủ số dòng, rồi dùng chức năng xóa theo lớp.
- Mặc định chờ ngẫu nhiên 0–3 giây như người thật. Dùng `--delay=0` để dồn
  request sát nhau hơn; dùng `--concurrency=50` nếu máy yếu hoặc chạy n rất lớn.
- Script chỉ cho chạy với `localhost`. Muốn chạy với site thật phải thêm
  `--allow-remote` và chỉ chạy trên site của chính bạn.
- Request local đi từ loopback nên được miễn rate limit; muốn kiểm tra
  `429 SUBMIT_RATE_LIMITED`, dùng `test-api.js`.
- Đây là môi trường Wrangler local (một tiến trình, D1 local), không phản ánh
  chính xác hiệu năng mạng/edge của Cloudflare. Chỉ so sánh giữa các lần chạy
  trên cùng một máy.

> Khi đổi `teacher.js`, `result-queue.js`, `sw.js` hoặc bất kỳ file nào trong
> `CORE_PATHS`, tăng `CACHE_VERSION` trong `sw.js` để trình duyệt cài lại cache.

---

## 4. Triển khai

Xem hướng dẫn chi tiết tại [`_system/docs/DEPLOY.md`](_system/docs/DEPLOY.md). Tóm tắt:

1. Tạo D1 database `results-db` trên Cloudflare (hoặc dùng database đã có).
2. Điền `database_id` thật vào `wrangler.jsonc` (file trong repo đã trỏ tới
   database production; chỉ thay nếu tạo database mới).
3. Tạo Pages project nối với repository GitHub.
4. Thêm biến môi trường `TEACHER_PASSWORD_HASH`, `SESSION_SECRET`,
   `TEACHER_SESSION_HOURS` trong **Settings → Environment variables**.
   Tùy chọn: thêm `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` để bật
   Turnstile cho `/api/submit`.
5. Chạy `wrangler d1 migrations apply results-db --remote` một lần (gồm
   migration `0003` tạo bảng rate limit).
6. Deploy và kiểm tra `/api/health` trả `{"ok":true,"db":"ok","schema":"ready"}`.

Bản production hiện tại: <https://de-toan-thpt.pages.dev/>. Deploy bằng script an toàn:

```powershell
powershell -ExecutionPolicy Bypass -File _system/tools/deploy-pages.ps1
```

> **Không chạy `wrangler pages deploy .`**: lệnh đó upload cả `.dev.vars`,
> `backups/`, `_system/tools/`, `_system/migrations/`, `_system/docs/`... lên web. `.assetsignore`
> không có tác dụng với Cloudflare Pages.

> Hash mật khẩu phải dùng 50.000 vòng PBKDF2 (mặc định của
> `_system/tools/hash-password.js`). Hash vài trăm nghìn vòng có thể vượt giới hạn CPU
> của gói miễn phí và làm đăng nhập luôn trả `401`.

---

## 5. Sao lưu và khôi phục

Xem chi tiết tại [`_system/docs/BACKUP.md`](_system/docs/BACKUP.md). Tóm tắt:

- **D1 Time Travel**: mốc khôi phục theo thời gian của Cloudflare.
- **Xuất SQL định kỳ**: `wrangler d1 export results-db --remote --output backups/...`
- **Xuất CSV của giáo viên**: tiện để xem/đối chiếu, **không** phải bản sao lưu
  đầy đủ của database.
- File backup chứa dữ liệu học sinh: giữ trong `backups/` (đã gitignore), không
  gửi qua chat hay commit.

---

## 6. Thêm / cập nhật đề

### Cách nhanh (khuyến nghị) — giao diện Local Helper

1. Mở thư mục `Start\` rồi nhấp đúp `START.bat`.
2. Kéo thả file `.html`, cả thư mục export hoặc `.zip` vào giao diện.
3. Kiểm tra môn, kế hoạch thêm/cập nhật rồi bấm **Đăng lên thư viện**.

Local Helper chỉ lắng nghe trên `127.0.0.1`, dùng token ngẫu nhiên cho mỗi
phiên và mở giao diện `_system/ui/add-exam.html` trong trình duyệt. Giao diện
gọi lại đúng quy trình cũ (`import-exam.js` → `update-and-deploy.ps1` →
`deploy-pages.ps1`), không tạo thêm dịch vụ hay cơ sở dữ liệu nào.

- Đề **trùng mã** mặc định được thêm thành **đề mới** để không ghi đè bản cũ.
  Chỉ khi chủ động chọn **Cập nhật** thì bản cũ mới bị thay thế, và luôn được
  sao lưu vào `backups/exam-updates/`.
- **Đổi tên / xóa đề đã có** (kể cả đề đã đăng Cloudflare từ trước) nằm trong
  thẻ **Quản lý đề đã có**: bấm chip môn để xem danh sách, rồi chọn ✏️ hoặc 🗑.
  Đổi tên chỉ sửa tiêu đề hiển thị (giữ mã đề để không mất lịch sử làm bài);
  xóa thì chuyển file vào `backups/exam-deletes/` trước khi gỡ khỏi catalog.
  Cả hai thao tác đều tự kiểm tra thư viện, tăng `CACHE_VERSION` và deploy.
- Nếu pipeline kiểm tra/deploy lỗi, catalog và thư mục `exams/` được khôi phục
  về trạng thái trước khi đăng.
- Snapshot và log của trợ lý nằm trong `%LOCALAPPDATA%\ExamLibraryHelper\`,
  không nằm trong repo.
- Đóng trình duyệt không làm mất tiến trình đang chạy; mở lại giao diện để
  xem tiếp. Bấm **Tắt trợ lý** hoặc để trợ lý tự tắt sau 60 phút không dùng.

### Deploy bằng terminal (dự phòng)

1. Chép file `.html` (hoặc thư mục export / `.zip`) đề mới vào thư mục project.
2. Mở thư mục `Start\` rồi nhấp đúp `START-CLOUDFLARE.bat`.

Script tự quét file mới ở thư mục gốc, nhập vào `exams/`, rồi chạy
`patch-exams` → `build-exam-data` → `build-cache-manifest` → `check-library`
→ `test-sw-lazy` → `test-scoring` → tăng `CACHE_VERSION` → `deploy-pages.ps1`. Không
commit/push GitHub, không deploy thư mục gốc.

Nếu chỉ sửa đề đã có, cứ nhấp đúp: script báo "Không tìm thấy đề mới nào"
rồi vẫn cập nhật và deploy bình thường.

Chạy bằng dòng lệnh:

```powershell
# Tự quét file mới trong thư mục project
powershell -ExecutionPolicy Bypass -File _system/tools/update-and-deploy.ps1

# Chỉ định rõ file
powershell -ExecutionPolicy Bypass -File _system/tools/update-and-deploy.ps1 -ExamPath "C:\de-moi.html"
```

Truyền tham số của `import-exam` qua `Start\START-CLOUDFLARE.bat`:

```bat
Start\START-CLOUDFLARE.bat --subject toan --number 3 --title "Đề Toán số 3"
Start\START-CLOUDFLARE.bat --check-only
Start\START-CLOUDFLARE.bat --no-deploy
```

Tùy chọn của script PowerShell: `-CheckOnly` (chỉ kiểm tra), `-NoDeploy`
(chuẩn bị, chưa deploy), `-Yes` (không hỏi lại).

### Quy trình GitHub Pages cũ

`Start\START-GITHUB.bat` giữ nguyên luồng cũ (yêu cầu nhánh `main`, không chạy
`build-exam-data`, không deploy Cloudflare). `Start\START.bat --github` hoặc
`Start\START.bat --dry-run`/`--no-push` sẽ chuyển tiếp sang script này. Không dùng
luồng GitHub cho `de-toan-thpt.pages.dev`.

### Cách thủ công

1. Đặt file vào `exams/<môn>/de_<môn>_<số>.html`, giữ khối
   `<script id="quiz-data" type="application/json">` và đúng `id`.
2. Thêm mục vào `assets/js/catalog.js`.
3. Chạy `node _system/tools/patch-exams.js` để thêm ô lớp + hàng đợi nộp bài.
4. Chạy `node _system/tools/build-exam-data.js` để cập nhật bộ đáp án máy chủ.
5. Chạy `node _system/tools/build-cache-manifest.js` để cập nhật hash đề.
6. Chạy `node _system/tools/check-library.js`, `node _system/tools/test-scoring.js`,
   `node _system/tools/patch-exams.js --check`.
7. Chạy `node _system/tools/bump-cache-version.js`.

> Mỗi thay đổi cấu trúc database phải là một file mới trong `_system/migrations/`.
> Không sửa migration đã chạy trên môi trường thật.

---

## 7. Câu hỏi thường gặp

**Thêm đề mà trang chủ không đổi?**
Kiểm tra `assets/js/catalog.js`, chạy `node _system/tools/check-library.js`. Nếu đang
offline, tăng `CACHE_VERSION` rồi mở online một lần.

**Đề mới mở được nhưng không dùng offline?**
Mở đề đó một lần khi còn mạng; Service Worker tự lưu đúng đề vừa mở. Không cần
tải trước cả thư viện. Chỉ tăng `CACHE_VERSION` sau khi deploy thay đổi file
tĩnh để trình duyệt cài lại bản mới.

**Kết quả không lên trang giáo viên?**
- Kiểm tra `/api/health`.
- Mở DevTools → Application → IndexedDB → `exam-results-outbox`: bản ghi
  `pending` sẽ tự thử lại khi có mạng hoặc khi quay lại tab.
- Bấm “Thử lại” trên thông báo, hoặc tải lại trang khi đã có mạng.

**Đăng xuất rồi vẫn xem được kết quả?**
Cookie phiên là cookie `HttpOnly`; sau khi `/api/auth/logout` trả về, trình
duyệt mới xóa cookie. Nếu vừa bấm đăng xuất mà gọi API ngay lập tức, hãy đợi
phản hồi đăng xuất hoàn tất. API không lưu cookie trong localStorage.

**Lịch sử của đề cũ biến mất?**
Lịch sử nằm trong `localStorage` của từng trình duyệt/thiết bị. Đổi trình duyệt
hoặc xóa dữ liệu website sẽ mất lịch sử máy đó; kết quả đã đồng bộ vẫn còn trên
trang giáo viên.

**Có thể dùng ảnh trong đề không?**
Có. Đặt ảnh trong `assets/images/` và tham chiếu bằng đường dẫn tương đối
`../../assets/images/ten-anh.png`. Ảnh được cache khi mở đề lần đầu; muốn cache
sẵn thì thêm vào `CORE_PATHS` trong `sw.js`.
