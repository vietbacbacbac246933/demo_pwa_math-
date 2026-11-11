/*
 * Cấu hình công khai cho trình duyệt.
 * Chỉ trả site key của Turnstile (không phải secret) và chỉ khi server
 * đã bật xác minh Turnstile.
 */
'use strict';

import { json, methodNotAllowed } from '../_lib/http.js';
import { turnstileConfigured } from '../_lib/turnstile.js';

export function onRequestGet(context) {
  const env = context.env || {};
  const siteKey = turnstileConfigured(env)
    ? env.TURNSTILE_SITE_KEY.trim()
    : '';

  return json({
    ok: true,
    turnstile_site_key: siteKey || null
  });
}

export function onRequest() {
  return methodNotAllowed('GET');
}
