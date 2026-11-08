'use strict';

import { json, methodNotAllowed } from '../_lib/http.js';

export async function onRequestGet(context) {
  const env = context.env || {};
  const time = new Date().toISOString();

  if (!env.DB) {
    return json({
      ok: false,
      service: 'exam-results',
      db: 'missing',
      schema: 'unknown',
      time: time
    }, 503);
  }

  try {
    const table = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'submissions'"
    ).first();

    if (!table) {
      return json({
        ok: false,
        service: 'exam-results',
        db: 'ok',
        schema: 'missing',
        time: time
      }, 503);
    }

    return json({
      ok: true,
      service: 'exam-results',
      db: 'ok',
      schema: 'ready',
      time: time
    });
  } catch (error) {
    return json({
      ok: false,
      service: 'exam-results',
      db: 'error',
      schema: 'unknown',
      time: time
    }, 503);
  }
}

export function onRequest() {
  return methodNotAllowed('GET');
}
