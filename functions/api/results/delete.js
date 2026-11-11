/*
 * Xóa kết quả làm bài (chỉ giáo viên đã đăng nhập).
 *
 *   POST /api/results/delete
 *
 * Chế độ:
 *   { mode: 'one', submission_id }                       xóa 1 bài
 *   { mode: 'filter', exam_id?, student_class?, preview? } xóa theo đề/lớp
 *   { mode: 'all', confirm: 'XOA TAT CA' }               xóa toàn bộ
 *   { mode: 'restore', batch_token }                     hoàn tác một lần xóa
 *
 * An toàn:
 *   - Bắt buộc phiên giáo viên + kiểm tra Origin.
 *   - Mỗi lần xóa chép nguyên bản ghi sang submissions_archive trước, trong
 *     cùng một D1 batch (transaction) với lệnh xóa.
 *   - Giới hạn số dòng mỗi lần để tránh một request xóa quá nhiều.
 *   - Không nhận SQL từ client; mọi giá trị đều bind qua prepared statement.
 */
'use strict';

import {
  HttpError,
  assertSameOrigin,
  handleError,
  json,
  methodNotAllowed,
  readJson
} from '../../_lib/http.js';
import { requireTeacher } from '../../_lib/auth.js';

const MAX_DELETE = 5000;
const BODY_LIMIT = 8 * 1024;

const ARCHIVE_COLUMNS =
  'batch_token, original_id, submission_id, exam_id, exam_title, ' +
  'student_name, student_class, score, total_score, answers_json, ' +
  'duration_seconds, submitted_at, exam_mode, exam_version, payload_hash, ' +
  'timed_out, client_submitted_at, archived_reason';

const ARCHIVE_SELECT =
  '?, id, submission_id, exam_id, exam_title, ' +
  'student_name, student_class, score, total_score, answers_json, ' +
  'duration_seconds, submitted_at, exam_mode, exam_version, payload_hash, ' +
  'timed_out, client_submitted_at, ?';

const RESTORE_COLUMNS =
  'submission_id, exam_id, exam_title, student_name, student_class, ' +
  'score, total_score, answers_json, duration_seconds, submitted_at, ' +
  'exam_mode, exam_version, payload_hash, timed_out, client_submitted_at';

function requireDb(env) {
  if (!env || !env.DB) {
    throw new HttpError(503, 'DB_NOT_CONFIGURED', 'Database chưa được cấu hình.');
  }
  return env.DB;
}

function parseFilters(body) {
  const examId = String(body.exam_id || '').trim();
  if (examId && !/^[A-Za-z0-9_-]{1,64}$/.test(examId)) {
    throw new HttpError(400, 'INVALID_FILTER', 'Mã đề không hợp lệ.');
  }

  const className = String(body.student_class || '').trim();
  if (className.length > 20) {
    throw new HttpError(400, 'INVALID_FILTER', 'Tên lớp quá dài.');
  }

  const where = [];
  const bindings = [];
  if (examId) {
    where.push('exam_id = ?');
    bindings.push(examId);
  }
  if (className) {
    where.push('student_class = ? COLLATE NOCASE');
    bindings.push(className);
  }

  return {
    examId: examId,
    className: className,
    whereSql: where.length ? ' WHERE ' + where.join(' AND ') : '',
    bindings: bindings
  };
}

function randomToken() {
  return crypto.randomUUID();
}

async function countRows(db, whereSql, bindings) {
  const row = await db
    .prepare('SELECT COUNT(*) AS total FROM submissions' + whereSql)
    .bind(...bindings)
    .first();
  return Number(row && row.total) || 0;
}

async function deleteWhere(db, whereSql, bindings, reason, preview) {
  const total = await countRows(db, whereSql, bindings);

  if (preview) {
    return json({
      ok: true,
      preview: true,
      count: total,
      too_many: total > MAX_DELETE,
      limit: MAX_DELETE
    });
  }

  if (!total) {
    return json({ ok: true, deleted: 0, count: 0, batch_token: null });
  }

  if (total > MAX_DELETE) {
    throw new HttpError(
      413,
      'DELETE_TOO_LARGE',
      'Có ' + total + ' kết quả, vượt giới hạn ' + MAX_DELETE +
        ' mỗi lần. Hãy xóa theo đề hoặc theo lớp.'
    );
  }

  const token = randomToken();
  const insert = db
    .prepare(
      'INSERT INTO submissions_archive (' + ARCHIVE_COLUMNS + ') ' +
      'SELECT ' + ARCHIVE_SELECT + ' FROM submissions' + whereSql + ' LIMIT ?'
    )
    .bind(token, reason, ...bindings, total);

  const remove = db
    .prepare(
      'DELETE FROM submissions WHERE id IN ' +
      '(SELECT original_id FROM submissions_archive WHERE batch_token = ?)'
    )
    .bind(token);

  const results = await db.batch([insert, remove]);
  const removed = results && results[1] && results[1].meta
    ? Number(results[1].meta.changes) || 0
    : 0;

  return json({
    ok: true,
    deleted: removed,
    count: total,
    batch_token: token
  });
}

async function handleOne(db, body) {
  const submissionId = String(body.submission_id || '').trim();
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(submissionId)) {
    throw new HttpError(400, 'INVALID_SUBMISSION_ID', 'Mã bài nộp không hợp lệ.');
  }
  return deleteWhere(
    db,
    ' WHERE submission_id = ?',
    [submissionId],
    'one:' + submissionId.slice(0, 80),
    false
  );
}

async function handleBulk(db, body, mode) {
  if (mode === 'all') {
    if (body.preview !== true && String(body.confirm || '') !== 'XOA TAT CA') {
      throw new HttpError(
        400,
        'CONFIRM_REQUIRED',
        'Để xóa toàn bộ, gửi confirm = "XOA TAT CA".'
      );
    }
    return deleteWhere(db, '', [], 'all', body.preview === true);
  }

  const filters = parseFilters(body);
  if (!filters.examId && !filters.className) {
    throw new HttpError(
      400,
      'FILTER_REQUIRED',
      'Chọn ít nhất một đề hoặc một lớp. Muốn xóa tất cả, dùng chế độ all.'
    );
  }

  if (body.preview !== true && String(body.confirm || '') !== 'XOA') {
    throw new HttpError(400, 'CONFIRM_REQUIRED', 'Gửi confirm = "XOA" để xác nhận xóa.');
  }

  const reason = 'filter' +
    (filters.examId ? ' exam=' + filters.examId : '') +
    (filters.className ? ' class=' + filters.className : '');

  return deleteWhere(
    db,
    filters.whereSql,
    filters.bindings,
    reason.slice(0, 200),
    body.preview === true
  );
}

async function handleRestore(db, body) {
  const token = String(body.batch_token || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    throw new HttpError(400, 'INVALID_BATCH', 'Mã lần xóa không hợp lệ.');
  }

  const row = await db
    .prepare('SELECT COUNT(*) AS total FROM submissions_archive WHERE batch_token = ?')
    .bind(token)
    .first();
  const total = Number(row && row.total) || 0;
  if (!total) {
    return json({ ok: true, restored: 0, archived: 0, batch_token: token });
  }

  const insert = db
    .prepare(
      'INSERT OR IGNORE INTO submissions (' + RESTORE_COLUMNS + ') ' +
      'SELECT ' + RESTORE_COLUMNS + ' FROM submissions_archive ' +
      'WHERE batch_token = ? ORDER BY archive_id'
    )
    .bind(token);

  const results = await db.batch([insert]);
  const restored = results && results[0] && results[0].meta
    ? Number(results[0].meta.changes) || 0
    : 0;

  // Giữ nguyên bản ghi trong archive để làm lịch sử và cho phép thử lại.
  return json({ ok: true, restored: restored, archived: total, batch_token: token });
}

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    await requireTeacher(context);

    const db = requireDb(context.env);
    const body = await readJson(context.request, BODY_LIMIT);
    const mode = String(body.mode || '').trim();

    if (mode === 'one') return await handleOne(db, body);
    if (mode === 'filter' || mode === 'all') return await handleBulk(db, body, mode);
    if (mode === 'restore') return await handleRestore(db, body);

    throw new HttpError(400, 'INVALID_MODE', 'Chế độ xóa không hợp lệ.');
  } catch (error) {
    return handleError(error);
  }
}

export function onRequest() {
  return methodNotAllowed('POST');
}
