# Thư viện đề thi THPT

Website đề thi chạy trên **Cloudflare Pages** (gói miễn phí): phần giao diện là
tĩnh, phần nhận và quản lý kết quả dùng **Pages Functions + D1**. Mỗi đề vẫn là
một file HTML độc lập, giữ nguyên câu hỏi, cách chấm và giao diện gốc.

- Học sinh làm bài **không cần tài khoản**, vẫn dùng được **ngoại tuyến**.
- Kết quả được lưu trong `localStorage` trên thiết bị **và** tự đồng bộ lên D1
  khi có mạng; mất mạng thì xếp hàng trong IndexedDB và tự thử lại.
- Giáo viên đăng nhập bằng mật khẩu dùng chung để xem, lọc và xuất CSV toàn bộ
  kết quả.
- Không dùng R2, Supabase, Firebase, VPS, database ngoài hay Worker riêng.
- Điểm do **máy chủ chấm lại** từ bộ đáp án chuẩn; điểm do trình duyệt gửi lên
  bị bỏ qua.

> Đáp án vẫn nằm trong HTML để chấm offline. Máy chủ chấm lại nhằm chống sửa
> điểm, **không** chống người rành kỹ thuật mở mã nguồn xem đáp án.

---

## 1. Cấu trúc thư mục

```text
repository/
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
│   │   └── results-query.js        # Lọc/sắp xếp/phân trang an toàn
│   └── api/
│       ├── health.js
│       ├── exams.js
│       ├── submit.js
│       ├── results.js              # GET danh sách (giáo viên)
│       ├── results/export.js       # GET CSV (giáo viên)
│       └── auth/{login,logout}.js
│
├── migrations/
│   ├── 0001_create_submissions.sql
│   └── README.md
│
├── docs/
│   ├── DEPLOY.md                   # Triển khai Cloudflare Pages + D1
│   └── BACKUP.md                   # Sao lưu và khôi phục
│
└── tools/
    ├── check-library.js            # Kiểm tra danh mục/file đề
    ├── check-migrations.js         # Kiểm tra migration trên SQLite in-memory
    ├── build-exam-data.js          # Sinh exam-data.js từ các file đề
    ├── patch-exams.js              # Tích hợp ô lớp + hàng đợi vào đề
    ├── hash-password.js            # Sinh TEACHER_PASSWORD_HASH
    ├── test-scoring.js             # Đối chiếu chấm điểm client/server
    └── test-api.js                 # Kiểm thử API trên Wrangler local
```

---

## 2. API

Tất cả phản hồi là JSON (trừ CSV) và có `Cache-Control: no-store`.

| Phương thức | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| `GET` | `/api/health` | công khai | Kiểm tra DB và bảng `submissions` |
| `GET` | `/api/exams` | công khai | Danh mục đề; giáo viên đã đăng nhập thấy thêm số lượt nộp |
| `POST` | `/api/submit` | công khai | Nhận bài, chấm lại, chống trùng |
| `GET` | `/api/results` | giáo viên | Danh sách có lọc/sắp xếp/phân trang |
| `GET` | `/api/results/export` | giáo viên | Xuất CSV toàn bộ kết quả khớp bộ lọc |
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

---

## 3. Chạy local

Yêu cầu: Node.js >= 22.5 (để `check-migrations.js` dùng `node:sqlite`) và
Wrangler (chạy qua `npx wrangler`).

```powershell
# 1. Tạo biến môi trường local từ mẫu
Copy-Item .dev.vars.example .dev.vars

# 2. Sinh hash mật khẩu giáo viên (nhập mật khẩu ẩn)
node tools/hash-password.js
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
node tools/build-exam-data.js --check
node tools/check-migrations.js
node tools/check-library.js
node tools/patch-exams.js --check
node tools/test-scoring.js

# Cần dev server đang chạy và mật khẩu giáo viên local
$env:TEST_TEACHER_PASSWORD = "mật-khẩu-local"
node tools/test-api.js
```

`test-api.js` chỉ ghi vào D1 **local**. Mỗi lần chạy dùng một lớp riêng
(`T...`/`B...`) để không lẫn với dữ liệu Khác. Bộ test bao phủ: dữ liệu không
hợp lệ, chấm lại phía máy chủ, gửi trùng, hai lượt đồng thời, ~100 lượt nộp,
phân quyền, SQL injection, CSV đầy đủ/BOM/chống formula, và đăng xuất.

> Khi đổi `teacher.js`, `result-queue.js`, `sw.js` hoặc bất kỳ file nào trong
> `CORE_PATHS`, tăng `CACHE_VERSION` trong `sw.js` để trình duyệt cài lại cache.

---

## 4. Triển khai

Xem hướng dẫn chi tiết tại [`docs/DEPLOY.md`](docs/DEPLOY.md). Tóm tắt:

1. Tạo D1 database `results-db` trên Cloudflare.
2. Điền `database_id` thật vào `wrangler.jsonc` (giá trị hiện tại chỉ dùng local).
3. Tạo Pages project nối với repository GitHub.
4. Thêm biến môi trường `TEACHER_PASSWORD_HASH`, `SESSION_SECRET`,
   `TEACHER_SESSION_HOURS` trong **Settings → Environment variables**.
5. Chạy `wrangler d1 migrations apply results-db --remote` một lần.
6. Deploy và kiểm tra `/api/health` trả `{"ok":true,"db":"ok","schema":"ready"}`.

---

## 5. Sao lưu và khôi phục

Xem chi tiết tại [`docs/BACKUP.md`](docs/BACKUP.md). Tóm tắt:

- **D1 Time Travel**: mốc khôi phục theo thời gian của Cloudflare.
- **Xuất SQL định kỳ**: `wrangler d1 export results-db --remote --output backups/...`
- **Xuất CSV của giáo viên**: tiện để xem/đối chiếu, **không** phải bản sao lưu
  đầy đủ của database.
- File backup chứa dữ liệu học sinh: giữ trong `backups/` (đã gitignore), không
  gửi qua chat hay commit.

---

## 6. Thêm đề mới

1. Đặt file vào `exams/<môn>/de_<môn>_<số>.html`, giữ khối
   `<script id="quiz-data" type="application/json">` và đúng `id`.
2. Thêm mục vào `assets/js/catalog.js`.
3. Chạy `node tools/patch-exams.js` để thêm ô lớp + hàng đợi nộp bài.
4. Chạy `node tools/build-exam-data.js` để cập nhật bộ đáp án máy chủ.
5. Chạy `node tools/check-library.js`, `node tools/test-scoring.js`,
   `node tools/patch-exams.js --check`.
6. Tăng `CACHE_VERSION` trong `sw.js`, commit và push.

> Mỗi thay đổi cấu trúc database phải là một file mới trong `migrations/`.
> Không sửa migration đã chạy trên môi trường thật.

---

## 7. Câu hỏi thường gặp

**Thêm đề mà trang chủ không đổi?**
Kiểm tra `assets/js/catalog.js`, chạy `node tools/check-library.js`. Nếu đang
offline, tăng `CACHE_VERSION` rồi mở online một lần.

**Đề mới mở được nhưng không dùng offline?**
Tăng `CACHE_VERSION` trong `sw.js`, mở trang chủ online một lần để Service
Worker cài lại và cache đề.

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
