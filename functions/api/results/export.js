'use strict';

import { HttpError, handleError, methodNotAllowed } from '../../_lib/http.js';
import { requireTeacher } from '../../_lib/auth.js';
import { parseExportQuery } from '../../_lib/results-query.js';

const SELECT_COLUMNS =
  'submission_id, exam_id, exam_title, student_name, student_class, ' +
  'score, total_score, duration_seconds, submitted_at, exam_mode, ' +
  'exam_version, timed_out';

const HEADER = [
  'STT',
  'Mã lượt nộp',
  'Mã đề',
  'Tên đề',
  'Họ tên',
  'Lớp',
  'Điểm',
  'Tổng điểm',
  'Thời gian (giây)',
  'Hình thức',
  'Hết giờ',
  'Nộp lúc (UTC)',
  'Phiên bản đề'
];

function csvCell(value) {
  let text = String(value == null ? '' : value);
  // Chống CSV formula injection khi mở bằng Excel.
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  if (/[",\r\n]/.test(text)) {
    text = '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

function csvRow(values) {
  return values.map(csvCell).join(',');
}

function fileStamp() {
  const d = new Date();
  const pad = function (n) { return String(n).padStart(2, '0'); };
  return String(d.getUTCFullYear()) + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) +
    '-' + pad(d.getUTCHours()) + pad(d.getUTCMinutes());
}

export async function onRequestGet(context) {
  try {
    await requireTeacher(context);

    const env = context.env || {};
    if (!env.DB) {
      throw new HttpError(503, 'DB_NOT_CONFIGURED', 'Database chưa được cấu hình.');
    }

    const query = parseExportQuery(new URL(context.request.url));
    const stmt = env.DB.prepare(
      'SELECT ' + SELECT_COLUMNS + ' FROM submissions' + query.whereSql +
      ' ORDER BY ' + query.orderBy + ' LIMIT 50001'
    );
    const result = await stmt.bind(...query.bindings).all();
    const rows = result.results || [];

    if (rows.length > 50000) {
      throw new HttpError(413, 'EXPORT_TOO_LARGE', 'Số kết quả quá lớn để xuất trong một lần.');
    }

    const lines = [csvRow(HEADER)];
    rows.forEach(function (row, index) {
      lines.push(csvRow([
        index + 1,
        row.submission_id,
        row.exam_id,
        row.exam_title,
        row.student_name,
        row.student_class,
        Number(row.score),
        Number(row.total_score),
        Number(row.duration_seconds),
        row.exam_mode === 'exam' ? 'Thi' : 'Ôn tập',
        Number(row.timed_out) ? 'Có' : 'Không',
        row.submitted_at,
        row.exam_version || ''
      ]));
    });

    const body = '\uFEFF' + lines.join('\r\n') + '\r\n';
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="ket-qua-' + fileStamp() + '.csv"',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (error) {
    return handleError(error);
  }
}

export function onRequest() {
  return methodNotAllowed('GET');
}
