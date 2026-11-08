/*
 * Xác minh Cloudflare Turnstile cho API nộp bài (tùy chọn).
 *
 * Chỉ bật khi đã đặt TURNSTILE_SECRET_KEY (server) và TURNSTILE_SITE_KEY
 * (trả cho trình duyệt qua /api/config). Không đặt biến nào thì API hoạt
 * động như trước, chỉ dựa vào rate limit.
 *
 * Không log token hay secret.
 */
'use strict';

import { HttpError } from './http.js';
import { getClientIp } from './rate-limit.js';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_TOKEN_LENGTH = 2048;
const VERIFY_TIMEOUT_MS = 8000;

export function turnstileConfigured(env) {
  // Phải có cả site key (cho trình duyệt) và secret (cho server); thiếu một
  // biến thì tắt hẳn để không làm mọi lượt nộp bị từ chối.
  return Boolean(
    env &&
    typeof env.TURNSTILE_SITE_KEY === 'string' && env.TURNSTILE_SITE_KEY.trim() &&
    typeof env.TURNSTILE_SECRET_KEY === 'string' && env.TURNSTILE_SECRET_KEY.trim()
  );
}

export async function verifyTurnstile(request, env, token) {
  if (!turnstileConfigured(env)) return;

  if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_LENGTH) {
    throw new HttpError(
      403,
      'TURNSTILE_REQUIRED',
      'Vui lòng xác minh bạn không phải robot rồi gửi lại.'
    );
  }

  const form = new URLSearchParams();
  form.set('secret', env.TURNSTILE_SECRET_KEY.trim());
  form.set('response', token);
  const ip = getClientIp(request);
  if (ip) form.set('remoteip', ip);

  let response;
  try {
    response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS)
    });
  } catch (error) {
    throw new HttpError(
      503,
      'TURNSTILE_UNAVAILABLE',
      'Chưa xác minh được với Turnstile. Vui lòng thử lại sau.'
    );
  }

  let result = null;
  try {
    result = await response.json();
  } catch (error) {
    result = null;
  }

  if (!response.ok || !result || result.success !== true) {
    throw new HttpError(
      403,
      'TURNSTILE_FAILED',
      'Xác minh không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.'
    );
  }
}
