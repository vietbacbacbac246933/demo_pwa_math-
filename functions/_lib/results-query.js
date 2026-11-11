/*
 * Phân tích query string cho /api/results và /api/results/export.
 * Chỉ dùng allowlist cho sort/order; mọi giá trị được bind qua prepared statement.
 */
'use strict';

import { HttpError, escapeLike } from './http.js';

const SORT_FIELDS = ['submitted_at', 'score'];
const ORDERS = ['asc', 'desc'];

function parseInteger(value, fallback, min, max, name) {
  if (value == null || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) {
    throw new HttpError(400, 'INVALID_QUERY', 'Tham số ' + name + ' phải là số nguyên.');
  }
  const n = Number(value);
  if (n < min || n > max) {
    throw new HttpError(400, 'INVALID_QUERY', 'Tham số ' + name + ' nằm ngoài phạm vi cho phép.');
  }
  return n;
}

function parseCommon(url) {
  const params = url.searchParams;

  const examId = String(params.get('exam_id') || '').trim();
  if (examId && !/^[A-Za-z0-9_-]{1,64}$/.test(examId)) {
    throw new HttpError(400, 'INVALID_QUERY', 'Mã đề không hợp lệ.');
  }

  const className = String(params.get('class') || '').trim();
  if (className.length > 20) {
    throw new HttpError(400, 'INVALID_QUERY', 'Tên lớp quá dài.');
  }

  const search = String(params.get('q') || '').trim();
  if (search.length > 80) {
    throw new HttpError(400, 'INVALID_QUERY', 'Từ khóa tìm kiếm quá dài.');
  }

  const sort = String(params.get('sort') || 'submitted_at').trim();
  if (SORT_FIELDS.indexOf(sort) < 0) {
    throw new HttpError(400, 'INVALID_QUERY', 'Kiểu sắp xếp không hợp lệ.');
  }

  const order = String(params.get('order') || 'desc').trim().toLowerCase();
  if (ORDERS.indexOf(order) < 0) {
    throw new HttpError(400, 'INVALID_QUERY', 'Thứ tự sắp xếp không hợp lệ.');
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
  if (search) {
    where.push("student_name LIKE ? ESCAPE '\\'");
    bindings.push('%' + escapeLike(search) + '%');
  }

  const orderBy = sort === 'score'
    ? 'score ' + order + ', submitted_at ' + order + ', id DESC'
    : 'submitted_at ' + order + ', id DESC';

  return {
    examId: examId,
    className: className,
    search: search,
    sort: sort,
    order: order,
    whereSql: where.length ? ' WHERE ' + where.join(' AND ') : '',
    bindings: bindings,
    orderBy: orderBy
  };
}

export function parseListQuery(url) {
  const common = parseCommon(url);
  common.page = parseInteger(url.searchParams.get('page'), 1, 1, 100000, 'page');
  common.pageSize = parseInteger(url.searchParams.get('page_size'), 50, 1, 200, 'page_size');
  return common;
}

export function parseExportQuery(url) {
  return parseCommon(url);
}
