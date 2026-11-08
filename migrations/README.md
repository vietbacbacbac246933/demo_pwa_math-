# Migrations — D1 `results-db`

Thư mục này chứa toàn bộ thay đổi cấu trúc database. Wrangler D1 chạy các file
theo thứ tự tên và ghi lại lịch sử trong bảng `d1_migrations`.

## Quy tắc

1. **Chỉ thêm migration mới**, không sửa file đã chạy trên môi trường thật.
2. Đặt tên theo thứ tự: `0002_mo_ta_ngan.sql`, `0003_...sql`.
3. Không dùng `DROP TABLE`, `DELETE FROM`, `TRUNCATE` hoặc xóa cột — không làm
   mất lịch sử làm bài.
4. Mỗi migration nên giải quyết một thay đổi nhỏ, dễ kiểm tra.
5. Trước khi chạy trên production: xuất backup SQL hoặc ghi lại bookmark D1
   Time Travel.
6. Không chạy migration production trong lúc đang có học sinh nộp bài nếu
   thay đổi đó khóa bảng lâu.

## Kiểm tra cục bộ (không cần Cloudflare)

```bash
node tools/check-migrations.js
```

Lệnh này nạp toàn bộ migration vào SQLite trong bộ nhớ, kiểm tra cột/index/
constraint và chặn các lệnh xóa dữ liệu. Yêu cầu Node.js >= 22.5.

## Áp dụng migration

```bash
# Local (wrangler pages dev / D1 local)
wrangler d1 migrations apply results-db --local

# Production — chỉ sau khi backup và được xác nhận
wrangler d1 migrations apply results-db --remote
```

Kiểm tra danh sách migration đã áp dụng:

```bash
wrangler d1 migrations list results-db --remote
```

## 0001_create_submissions.sql

Bảng `submissions`:

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | Khóa chính nội bộ |
| `submission_id` | TEXT UNIQUE NOT NULL | Mã lượt nộp, chống gửi trùng |
| `exam_id` | TEXT NOT NULL | Mã đề, khớp `quiz-data.id` |
| `exam_title` | TEXT NOT NULL | Tên đề do server lấy tại thời điểm nộp |
| `student_name` | TEXT NOT NULL | Họ tên, đã trim/validate |
| `student_class` | TEXT NOT NULL | Lớp |
| `score` | REAL NOT NULL | Điểm server chấm |
| `total_score` | REAL NOT NULL | Tổng điểm server lấy từ đề |
| `answers_json` | TEXT NOT NULL | Câu trả lời đã chuẩn hóa, không chứa đáp án đúng |
| `duration_seconds` | INTEGER NOT NULL | Thời gian làm bài do client báo |
| `submitted_at` | TEXT NOT NULL | Giờ server, ISO UTC |
| `exam_mode` | TEXT NOT NULL | `practice` hoặc `exam` |
| `exam_version` | TEXT | Phiên bản bộ đáp án đã dùng để chấm |
| `payload_hash` | TEXT | Phát hiện tái sử dụng `submission_id` với dữ liệu khác |
| `timed_out` | INTEGER NOT NULL | 0/1, bài tự nộp do hết giờ |
| `client_submitted_at` | TEXT | Chỉ tham khảo, không dùng để chấm |

Index:

- `idx_submissions_exam_time` — lọc theo đề, sắp xếp thời gian.
- `idx_submissions_exam_score` — bảng điểm theo đề.
- `idx_submissions_class_time` — lọc theo lớp.
- `idx_submissions_name` — tìm theo tên.
- `idx_submissions_time` — danh sách toàn bộ theo thời gian.
- `sqlite_autoindex_submissions_1` — do `UNIQUE(submission_id)`.

## 0003_create_rate_limits.sql

Bảng `rate_limits` — bộ đếm giới hạn tần suất nộp bài:

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `bucket_key` | TEXT PRIMARY KEY | `<scope>:<SHA-256(IP)>:<window_start>`, không có IP thô |
| `count` | INTEGER NOT NULL | Số lượt trong cửa sổ, tăng bằng UPSERT nguyên tử |
| `window_start` | INTEGER NOT NULL | Đầu cửa sổ (epoch ms) |
| `expires_at` | INTEGER NOT NULL | Thời điểm có thể dọn bucket |

Index `idx_rate_limits_expires` phục vụ việc dọn bucket hết hạn. Bảng không
chứa dữ liệu học sinh và không ảnh hưởng bảng `submissions`.

## Ghi chú thiết kế

- `score`, `total_score`, `exam_title`, `answers_json` do server tạo; không
  nhận điểm từ trình duyệt.
- `submitted_at` dùng giờ server. Giá trị mặc định của SQLite cũng là giờ
  server, nhưng Worker sẽ bind tường minh để trả về cùng giá trị đã lưu.
- Không có API xóa kết quả. Dữ liệu cũ được giữ lại.
- Nếu sau này cần nhiều tài khoản giáo viên, thêm bảng riêng bằng migration mới.
