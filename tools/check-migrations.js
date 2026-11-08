#!/usr/bin/env node
/*
 * Kiểm tra migration D1 mà không cần kết nối Cloudflare:
 *   node tools/check-migrations.js
 *
 * - Nạp toàn bộ migrations/*.sql vào SQLite trong bộ nhớ.
 * - Kiểm tra bảng, cột, index, UNIQUE và CHECK constraints.
 * - Chặn các lệnh có thể xóa dữ liệu (DROP TABLE, DELETE FROM, ...).
 *
 * Yêu cầu: Node.js >= 22.5 (module node:sqlite).
 * Không đọc/ghi database thật.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'migrations');
const errors = [];

function fail(message) {
  errors.push(message);
}

function check(condition, message) {
  if (!condition) fail(message);
}

// 1. Đọc migration theo thứ tự tên file.
let files = [];
try {
  files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(function (name) { return name.endsWith('.sql'); })
    .sort();
} catch (error) {
  fail('Không đọc được thư mục migrations: ' + error.message);
}

if (!files.length) fail('Chưa có file migration .sql nào.');

const db = new DatabaseSync(':memory:');

try {
  for (const file of files) {
    const sqlPath = path.join(MIGRATIONS_DIR, file);
    const sql = fs.readFileSync(sqlPath, 'utf8');
    const withoutComments = sql.replace(/--[^\n]*/g, '');

    if (/\b(DROP\s+TABLE|DROP\s+COLUMN|DELETE\s+FROM|TRUNCATE)\b/i.test(withoutComments)) {
      fail(file + ': chứa lệnh có thể xóa dữ liệu. Migration phải là forward-only và không xóa lịch sử.');
      continue;
    }

    try {
      db.exec(sql);
    } catch (error) {
      fail(file + ': ' + error.message);
    }
  }

  if (!errors.length) {
    // 2. Bảng và cột bắt buộc.
    const columns = db.prepare('PRAGMA table_info(submissions)').all().map(function (row) {
      return row.name;
    });
    const requiredColumns = [
      'id', 'submission_id', 'exam_id', 'exam_title', 'student_name',
      'student_class', 'score', 'total_score', 'answers_json',
      'duration_seconds', 'submitted_at', 'exam_mode', 'exam_version',
      'payload_hash', 'timed_out', 'client_submitted_at'
    ];
    for (const name of requiredColumns) {
      check(columns.indexOf(name) >= 0, 'Thiếu cột submissions.' + name);
    }

    // 3. Index bắt buộc.
    const indexes = db.prepare('PRAGMA index_list(submissions)').all().map(function (row) {
      return row.name;
    });
    [
      'idx_submissions_exam_time',
      'idx_submissions_exam_score',
      'idx_submissions_class_time',
      'idx_submissions_name',
      'idx_submissions_time'
    ].forEach(function (name) {
      check(indexes.indexOf(name) >= 0, 'Thiếu index ' + name);
    });

    // 4. Insert tối thiểu: submitted_at phải tự sinh theo giờ server.
    db.prepare(
      'INSERT INTO submissions ' +
      '(submission_id, exam_id, exam_title, student_name, student_class, ' +
      ' score, total_score, answers_json, duration_seconds) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('sub-0001', 'toan_01', 'Đề Toán THPT số 1', 'Nguyễn Văn A', '12A1',
      8.5, 50, '{"0":2}', 2450);

    const inserted = db.prepare(
      'SELECT id, submitted_at, exam_mode, timed_out FROM submissions WHERE submission_id = ?'
    ).get('sub-0001');

    check(inserted && inserted.id === 1, 'Không đọc lại được bản ghi vừa insert.');
    check(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(inserted.submitted_at),
      'submitted_at không đúng định dạng ISO UTC: ' + inserted.submitted_at);
    check(inserted.exam_mode === 'practice', 'exam_mode mặc định phải là practice.');
    check(inserted.timed_out === 0, 'timed_out mặc định phải là 0.');

    // 5. UNIQUE submission_id.
    let uniqueFired = false;
    try {
      db.prepare(
        'INSERT INTO submissions ' +
        '(submission_id, exam_id, exam_title, score, total_score, answers_json) ' +
        'VALUES (?, ?, ?, ?, ?, ?)'
      ).run('sub-0001', 'toan_01', 'Đề Toán THPT số 1', 0, 50, '{}');
    } catch (error) {
      uniqueFired = true;
    }
    check(uniqueFired, 'UNIQUE(submission_id) không hoạt động.');

    // 6. CHECK constraints.
    const badRows = [
      ['sub-neg-score', -1, 10, 0, 0],
      ['sub-neg-total', 0, -1, 0, 0],
      ['sub-neg-duration', 0, 10, -1, 0],
      ['sub-bad-timeout', 0, 10, 0, 2]
    ];
    badRows.forEach(function (row) {
      let fired = false;
      try {
        db.prepare(
          'INSERT INTO submissions ' +
          '(submission_id, exam_id, exam_title, score, total_score, answers_json, duration_seconds, timed_out) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(row[0], 'toan_01', 'Đề', row[1], row[2], '{}', row[3], row[4]);
      } catch (error) {
        fired = true;
      }
      check(fired, 'CHECK constraint không chặn được dữ liệu sai: ' + row[0]);
    });

    // 7. Query plan cho các truy vấn chính.
    const plans = [
      ['exam_time', 'SELECT * FROM submissions WHERE exam_id = ? ORDER BY submitted_at DESC LIMIT 50', ['x'], 'idx_submissions_exam_time'],
      ['exam_score', 'SELECT * FROM submissions WHERE exam_id = ? ORDER BY score DESC, submitted_at DESC LIMIT 50', ['x'], 'idx_submissions_exam_score'],
      ['class_time', 'SELECT * FROM submissions WHERE student_class = ? ORDER BY submitted_at DESC LIMIT 50', ['x'], 'idx_submissions_class_time'],
      ['time', 'SELECT * FROM submissions ORDER BY submitted_at DESC LIMIT 50', [], 'idx_submissions_time']
    ];
    plans.forEach(function (item) {
      const planStmt = db.prepare('EXPLAIN QUERY PLAN ' + item[1]);
      const detail = planStmt.all(...item[2]).map(function (row) {
        return row.detail;
      }).join(' ');
      check(detail.indexOf(item[3]) >= 0, 'Query ' + item[0] + ' chưa dùng ' + item[3] + ': ' + detail);
    });

    // 8. Bảng lưu trữ + vòng lặp xóa/hoàn tác.
    const archiveColumns = db.prepare('PRAGMA table_info(submissions_archive)').all().map(function (row) {
      return row.name;
    });
    [
      'archive_id', 'batch_token', 'original_id', 'submission_id', 'exam_id',
      'exam_title', 'student_name', 'student_class', 'score', 'total_score',
      'answers_json', 'duration_seconds', 'submitted_at', 'exam_mode',
      'exam_version', 'payload_hash', 'timed_out', 'client_submitted_at',
      'archived_at', 'archived_reason'
    ].forEach(function (name) {
      check(archiveColumns.indexOf(name) >= 0, 'Thiếu cột submissions_archive.' + name);
    });

    const archiveIndexes = db.prepare('PRAGMA index_list(submissions_archive)').all().map(function (row) {
      return row.name;
    });
    [
      'idx_archive_batch',
      'idx_archive_submission',
      'idx_archive_time'
    ].forEach(function (name) {
      check(archiveIndexes.indexOf(name) >= 0, 'Thiếu index ' + name);
    });

    const batchToken = '11111111-2222-3333-4444-555555555555';
    const archiveColumnsSql =
      'batch_token, original_id, submission_id, exam_id, exam_title, ' +
      'student_name, student_class, score, total_score, answers_json, ' +
      'duration_seconds, submitted_at, exam_mode, exam_version, payload_hash, ' +
      'timed_out, client_submitted_at, archived_reason';
    const archiveSelectSql =
      '?, id, submission_id, exam_id, exam_title, ' +
      'student_name, student_class, score, total_score, answers_json, ' +
      'duration_seconds, submitted_at, exam_mode, exam_version, payload_hash, ' +
      'timed_out, client_submitted_at, ?';

    db.exec('BEGIN');
    db.prepare(
      'INSERT INTO submissions_archive (' + archiveColumnsSql + ') ' +
      'SELECT ' + archiveSelectSql + ' FROM submissions WHERE submission_id = ? LIMIT ?'
    ).run(batchToken, 'check-migrations', 'sub-0001', 1);
    db.prepare(
      'DELETE FROM submissions WHERE id IN ' +
      '(SELECT original_id FROM submissions_archive WHERE batch_token = ?)'
    ).run(batchToken);
    db.exec('COMMIT');

    const afterDelete = db.prepare(
      'SELECT COUNT(*) AS total FROM submissions WHERE submission_id = ?'
    ).get('sub-0001');
    check(afterDelete.total === 0, 'Xóa theo batch_token không xóa đúng bản ghi.');

    db.prepare(
      'INSERT OR IGNORE INTO submissions (' +
      'submission_id, exam_id, exam_title, student_name, student_class, ' +
      'score, total_score, answers_json, duration_seconds, submitted_at, ' +
      'exam_mode, exam_version, payload_hash, timed_out, client_submitted_at' +
      ') SELECT ' +
      'submission_id, exam_id, exam_title, student_name, student_class, ' +
      'score, total_score, answers_json, duration_seconds, submitted_at, ' +
      'exam_mode, exam_version, payload_hash, timed_out, client_submitted_at ' +
      'FROM submissions_archive WHERE batch_token = ? ORDER BY archive_id'
    ).run(batchToken);

    const restored = db.prepare(
      'SELECT student_name, score FROM submissions WHERE submission_id = ?'
    ).get('sub-0001');
    check(restored && restored.student_name === 'Nguyễn Văn A',
      'Hoàn tác không khôi phục đúng bản ghi.');
    check(restored && restored.score === 8.5, 'Hoàn tác làm sai điểm.');

    const stillArchived = db.prepare(
      'SELECT COUNT(*) AS total FROM submissions_archive WHERE batch_token = ?'
    ).get(batchToken);
    check(stillArchived.total === 1, 'Archive phải giữ lại bản ghi sau khi hoàn tác.');

    // 9. Bảng rate limit + UPSERT nguyên tử.
    const rateLimitColumns = db.prepare('PRAGMA table_info(rate_limits)').all().map(function (row) {
      return row.name;
    });
    ['bucket_key', 'count', 'window_start', 'expires_at'].forEach(function (name) {
      check(rateLimitColumns.indexOf(name) >= 0, 'Thiếu cột rate_limits.' + name);
    });

    const rateLimitIndexes = db.prepare('PRAGMA index_list(rate_limits)').all().map(function (row) {
      return row.name;
    });
    check(rateLimitIndexes.indexOf('idx_rate_limits_expires') >= 0,
      'Thiếu index idx_rate_limits_expires');

    const upsertRateLimit = db.prepare(
      'INSERT INTO rate_limits (bucket_key, count, window_start, expires_at) ' +
      'VALUES (?, 1, ?, ?) ' +
      'ON CONFLICT(bucket_key) DO UPDATE SET count = rate_limits.count + 1 ' +
      'RETURNING count'
    );
    const firstRateLimit = upsertRateLimit.get('submit:test:0', 0, 1000);
    check(firstRateLimit && firstRateLimit.count === 1,
      'UPSERT rate_limits lần đầu phải trả count=1.');
    const secondRateLimit = upsertRateLimit.get('submit:test:0', 0, 1000);
    check(secondRateLimit && secondRateLimit.count === 2,
      'UPSERT rate_limits lần hai phải trả count=2.');

    db.prepare('DELETE FROM rate_limits WHERE expires_at <= ?').run(1000);
    const remainingRateLimits = db.prepare('SELECT COUNT(*) AS total FROM rate_limits').get();
    check(remainingRateLimits.total === 0, 'Không dọn được bucket rate limit hết hạn.');

    if (!errors.length) {
      console.log('Đã nạp: ' + files.join(', '));
      console.log('Cột (' + columns.length + '): ' + columns.join(', '));
      console.log('Index: ' + indexes.join(', '));
      console.log('submitted_at mặc định: ' + inserted.submitted_at);
      console.log('Archive: ' + archiveColumns.length + ' cột, xóa/hoàn tác OK');
      console.log('Rate limits: ' + rateLimitColumns.length + ' cột, UPSERT/dọn hết hạn OK');
      console.log('KẾT QUẢ: OK');
    }
  }
} finally {
  db.close();
}

if (errors.length) {
  console.error('KẾT QUẢ: LỖI');
  errors.forEach(function (message) {
    console.error('- ' + message);
  });
  process.exitCode = 1;
}
