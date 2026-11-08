'use strict';

import { json, methodNotAllowed } from '../_lib/http.js';
import { EXAM_LIST } from '../_lib/exam-data.js';
import { getSession } from '../_lib/auth.js';

export async function onRequestGet(context) {
  const env = context.env || {};
  const request = context.request;

  let session = null;
  try {
    session = await getSession(request, env);
  } catch (error) {
    session = null;
  }

  let stats = {};
  if (session && env.DB) {
    try {
      const rows = await env.DB.prepare(
        'SELECT exam_id, COUNT(*) AS submission_count, MAX(submitted_at) AS last_submitted_at ' +
        'FROM submissions GROUP BY exam_id'
      ).all();
      (rows.results || []).forEach(function (row) {
        stats[row.exam_id] = {
          submission_count: Number(row.submission_count) || 0,
          last_submitted_at: row.last_submitted_at || null
        };
      });
    } catch (error) {
      stats = {};
    }
  }

  const exams = EXAM_LIST.map(function (exam) {
    const item = {
      id: exam.id,
      title: exam.title,
      subject_id: exam.subject_id,
      subject_name: exam.subject_name,
      question_count: exam.question_count,
      total_score: exam.total_score,
      mode: exam.mode,
      minutes: exam.minutes
    };
    if (session) {
      const info = stats[exam.id];
      item.submission_count = info ? info.submission_count : 0;
      item.last_submitted_at = info ? info.last_submitted_at : null;
    }
    return item;
  });

  return json({
    ok: true,
    teacher: !!session,
    exams: exams
  });
}

export function onRequest() {
  return methodNotAllowed('GET');
}
