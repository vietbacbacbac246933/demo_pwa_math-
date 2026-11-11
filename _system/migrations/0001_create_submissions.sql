-- =====================================================================
-- 0001_create_submissions.sql
-- ---------------------------------------------------------------------
-- Bảng lưu kết quả nộp bài của học sinh.
--
-- Quy ước:
--   - submitted_at là giờ SERVER (Worker), không lấy giờ client.
--   - score / total_score / exam_title / answers_json do server tính và
--     chuẩn hóa; không tin dữ liệu điểm từ trình duyệt.
--   - submission_id UNIQUE toàn cục để chống gửi trùng (idempotency).
--   - Không có lệnh xóa dữ liệu trong migration này.
-- =====================================================================

CREATE TABLE IF NOT EXISTS submissions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id       TEXT    NOT NULL UNIQUE,
  exam_id             TEXT    NOT NULL,
  exam_title          TEXT    NOT NULL,
  student_name        TEXT    NOT NULL DEFAULT '',
  student_class       TEXT    NOT NULL DEFAULT '',
  score               REAL    NOT NULL CHECK (score >= 0),
  total_score         REAL    NOT NULL CHECK (total_score >= 0),
  answers_json        TEXT    NOT NULL,
  duration_seconds    INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  submitted_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  -- Thông tin bổ sung để mở rộng / kiểm toán, không dùng để chấm điểm.
  exam_mode           TEXT    NOT NULL DEFAULT 'practice',
  exam_version        TEXT,
  payload_hash        TEXT,
  timed_out           INTEGER NOT NULL DEFAULT 0 CHECK (timed_out IN (0, 1)),
  client_submitted_at TEXT
);

-- Lọc / sắp xếp theo đề và thời gian nộp.
CREATE INDEX IF NOT EXISTS idx_submissions_exam_time
  ON submissions (exam_id, submitted_at DESC);

-- Bảng điểm của một đề.
CREATE INDEX IF NOT EXISTS idx_submissions_exam_score
  ON submissions (exam_id, score DESC, submitted_at DESC);

-- Lọc theo lớp.
CREATE INDEX IF NOT EXISTS idx_submissions_class_time
  ON submissions (student_class, submitted_at DESC);

-- Tìm theo tên học sinh.
CREATE INDEX IF NOT EXISTS idx_submissions_name
  ON submissions (student_name);

-- Danh sách toàn bộ kết quả sắp xếp theo thời gian (không lọc đề).
CREATE INDEX IF NOT EXISTS idx_submissions_time
  ON submissions (submitted_at DESC);
