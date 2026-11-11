-- =====================================================================
-- 0002_create_submissions_archive.sql
-- ---------------------------------------------------------------------
-- Bảng lưu trữ các kết quả đã bị giáo viên xóa.
--
-- Vì sao cần:
--   Trang giáo viên cho phép xóa kết quả, nhưng xóa nhầm là mất điểm của
--   học sinh. Trước khi xóa, API chép nguyên bản ghi sang bảng này trong
--   cùng một transaction (D1 batch), nên có thể hoàn tác.
--
-- Quy ước:
--   - batch_token: mỗi lần xóa có một mã riêng; hoàn tác theo mã này.
--   - original_id: id gốc trong bảng submissions (chỉ để tham chiếu).
--   - submission_id KHÔNG unique ở đây: một bài có thể bị xóa rồi nộp lại.
--   - Bảng này chỉ thêm, không sửa cấu trúc bảng submissions.
-- =====================================================================

CREATE TABLE IF NOT EXISTS submissions_archive (
  archive_id          INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_token         TEXT    NOT NULL,
  original_id         INTEGER NOT NULL,
  submission_id       TEXT    NOT NULL,
  exam_id             TEXT    NOT NULL,
  exam_title          TEXT    NOT NULL,
  student_name        TEXT    NOT NULL DEFAULT '',
  student_class       TEXT    NOT NULL DEFAULT '',
  score               REAL    NOT NULL,
  total_score         REAL    NOT NULL,
  answers_json        TEXT    NOT NULL,
  duration_seconds    INTEGER NOT NULL DEFAULT 0,
  submitted_at        TEXT    NOT NULL,
  exam_mode           TEXT    NOT NULL DEFAULT 'practice',
  exam_version        TEXT,
  payload_hash        TEXT,
  timed_out           INTEGER NOT NULL DEFAULT 0,
  client_submitted_at TEXT,
  archived_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_reason     TEXT    NOT NULL DEFAULT ''
);

-- Hoàn tác theo mã lần xóa.
CREATE INDEX IF NOT EXISTS idx_archive_batch
  ON submissions_archive (batch_token, archive_id);

-- Tra cứu một bài đã bị xóa.
CREATE INDEX IF NOT EXISTS idx_archive_submission
  ON submissions_archive (submission_id);

-- Xem lịch sử xóa gần nhất.
CREATE INDEX IF NOT EXISTS idx_archive_time
  ON submissions_archive (archived_at DESC);
