-- =====================================================================
-- 0003_create_rate_limits.sql
-- ---------------------------------------------------------------------
-- Bộ đếm giới hạn tần suất nộp bài.
--
-- Quy ước:
--   - bucket_key là "<scope>:<SHA-256(IP)>:<window_start>". Không lưu IP thô.
--   - Mỗi cửa sổ thời gian có một khóa riêng; hết hạn thì xóa dần.
--   - count tăng bằng một câu UPSERT nguyên tử, nên nhiều instance Worker
--     cùng ghi vẫn không làm sai bộ đếm.
--   - Không có dữ liệu học sinh trong bảng này.
--   - Migration chỉ tạo bảng/index, không xóa dữ liệu.
-- =====================================================================

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key   TEXT    PRIMARY KEY,
  count        INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  window_start INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);

-- Dọn các bucket đã hết hạn (chạy ngẫu nhiên từ functions/_lib/rate-limit.js).
CREATE INDEX IF NOT EXISTS idx_rate_limits_expires
  ON rate_limits (expires_at);
