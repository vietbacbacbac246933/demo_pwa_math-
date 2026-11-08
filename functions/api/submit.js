'use strict';

import {
  HttpError,
  handleError,
  json,
  methodNotAllowed,
  readJson,
  stableStringify
} from '../_lib/http.js';
import { EXAMS } from '../_lib/exam-data.js';
import { computeResult, normalizeAnswers } from '../_lib/scoring.js';

const MAX_BODY = 64 * 1024;
const MAX_NAME = 80;
const MAX_CLASS = 20;
const MAX_DURATION = 86400;

function cleanText(value, field, max) {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'INVALID_STUDENT', 'Trường ' + field + ' phải là chuỗi.');
  }
  const text = value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) {
    throw new HttpError(400, 'INVALID_STUDENT', 'Vui lòng nhập ' + field + '.');
  }
  if (text.length > max) {
    throw new HttpError(400, 'INVALID_STUDENT', 'Trường ' + field + ' quá dài.');
  }
  return text;
}

function parseDuration(value) {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_DURATION) {
    throw new HttpError(400, 'INVALID_DURATION', 'Thời gian làm bài không hợp lệ.');
  }
  return n;
}

function parseTimedOut(value) {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') {
    throw new HttpError(400, 'INVALID_BODY', 'Trường timed_out phải là boolean.');
  }
  return value;
}

function parseClientTime(value) {
  if (typeof value !== 'string' || value.length > 40) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map(function (byte) {
    return byte.toString(16).padStart(2, '0');
  }).join('');
}

function submissionPayload(row) {
  return {
    submission_id: row.submission_id,
    exam_id: row.exam_id,
    score: Number(row.score),
    total_score: Number(row.total_score),
    submitted_at: row.submitted_at
  };
}

export async function onRequestPost(context) {
  try {
    const request = context.request;
    const env = context.env || {};
    if (!env.DB) {
      throw new HttpError(503, 'DB_NOT_CONFIGURED', 'Database chưa được cấu hình.');
    }

    const body = await readJson(request, MAX_BODY);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new HttpError(400, 'INVALID_BODY', 'Body phải là một object JSON.');
    }

    const submissionId = typeof body.submission_id === 'string' ? body.submission_id.trim() : '';
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(submissionId)) {
      throw new HttpError(400, 'INVALID_SUBMISSION_ID', 'Mã lượt nộp không hợp lệ.');
    }

    const examId = typeof body.exam_id === 'string' ? body.exam_id.trim() : '';
    const exam = EXAMS[examId];
    if (!exam) {
      throw new HttpError(404, 'UNKNOWN_EXAM', 'Đề thi không tồn tại.');
    }

    const studentName = cleanText(body.student_name, 'họ tên', MAX_NAME);
    const studentClass = cleanText(body.student_class, 'lớp', MAX_CLASS);
    const durationSeconds = parseDuration(body.duration_seconds);
    const timedOut = parseTimedOut(body.timed_out);
    const clientSubmittedAt = parseClientTime(body.client_submitted_at);

    const answers = normalizeAnswers(exam.questions, body.answers);
    const result = computeResult(exam.questions, answers);
    const submittedAt = new Date().toISOString();

    const payloadHash = await sha256Hex(stableStringify({
      exam_id: exam.id,
      student_name: studentName,
      student_class: studentClass,
      answers: answers,
      duration_seconds: durationSeconds,
      timed_out: timedOut
    }));

    const insert = await env.DB.prepare(
      'INSERT INTO submissions ' +
      '(submission_id, exam_id, exam_title, student_name, student_class, ' +
      ' score, total_score, answers_json, duration_seconds, submitted_at, ' +
      ' exam_mode, exam_version, payload_hash, timed_out, client_submitted_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(submission_id) DO NOTHING'
    ).bind(
      submissionId,
      exam.id,
      exam.title,
      studentName,
      studentClass,
      result.score,
      result.maxScore,
      JSON.stringify(answers),
      durationSeconds,
      submittedAt,
      exam.mode,
      exam.version,
      payloadHash,
      timedOut ? 1 : 0,
      clientSubmittedAt
    ).run();

    const changed = insert && insert.meta && Number(insert.meta.changes) > 0;
    if (changed) {
      return json({
        ok: true,
        duplicate: false,
        submission: {
          submission_id: submissionId,
          exam_id: exam.id,
          score: result.score,
          total_score: result.maxScore,
          submitted_at: submittedAt
        }
      }, 201);
    }

    // Không insert được vì submission_id đã tồn tại (hoặc một race hiếm).
    const existing = await env.DB.prepare(
      'SELECT submission_id, exam_id, exam_title, student_name, student_class, ' +
      ' score, total_score, submitted_at, payload_hash ' +
      'FROM submissions WHERE submission_id = ?'
    ).bind(submissionId).first();

    if (!existing) {
      throw new HttpError(500, 'INSERT_FAILED', 'Không lưu được kết quả.');
    }

    if (existing.payload_hash && existing.payload_hash !== payloadHash) {
      throw new HttpError(
        409,
        'SUBMISSION_ID_CONFLICT',
        'Mã lượt nộp đã được dùng cho một dữ liệu khác.'
      );
    }

    return json({
      ok: true,
      duplicate: true,
      submission: submissionPayload(existing)
    }, 200);
  } catch (error) {
    return handleError(error);
  }
}

export function onRequest() {
  return methodNotAllowed('POST');
}
