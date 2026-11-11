'use strict';

import { HttpError, handleError, json, methodNotAllowed } from '../_lib/http.js';
import { requireTeacher } from '../_lib/auth.js';
import { parseListQuery } from '../_lib/results-query.js';

const SELECT_COLUMNS =
  'submission_id, exam_id, exam_title, student_name, student_class, ' +
  'score, total_score, duration_seconds, submitted_at, exam_mode, ' +
  'exam_version, timed_out';

export async function onRequestGet(context) {
  try {
    await requireTeacher(context);

    const env = context.env || {};
    if (!env.DB) {
      throw new HttpError(503, 'DB_NOT_CONFIGURED', 'Database chưa được cấu hình.');
    }

    const query = parseListQuery(new URL(context.request.url));
    const offset = (query.page - 1) * query.pageSize;

    const countStmt = env.DB.prepare(
      'SELECT COUNT(*) AS total FROM submissions' + query.whereSql
    );
    const totalRow = await countStmt.bind(...query.bindings).first();

    const total = Number(totalRow && totalRow.total) || 0;

    const listStmt = env.DB.prepare(
      'SELECT ' + SELECT_COLUMNS + ' FROM submissions' + query.whereSql +
      ' ORDER BY ' + query.orderBy + ' LIMIT ? OFFSET ?'
    );
    const rows = await listStmt.bind(...query.bindings, query.pageSize, offset).all();

    const items = (rows.results || []).map(function (row) {
      return {
        submission_id: row.submission_id,
        exam_id: row.exam_id,
        exam_title: row.exam_title,
        student_name: row.student_name,
        student_class: row.student_class,
        score: Number(row.score),
        total_score: Number(row.total_score),
        duration_seconds: Number(row.duration_seconds),
        submitted_at: row.submitted_at,
        exam_mode: row.exam_mode,
        exam_version: row.exam_version,
        timed_out: Number(row.timed_out)
      };
    });

    return json({
      ok: true,
      items: items,
      page: query.page,
      page_size: query.pageSize,
      total: total,
      total_pages: total ? Math.ceil(total / query.pageSize) : 0
    });
  } catch (error) {
    return handleError(error);
  }
}

export function onRequest() {
  return methodNotAllowed('GET');
}
