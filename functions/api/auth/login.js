'use strict';

import {
  HttpError,
  assertSameOrigin,
  handleError,
  json,
  methodNotAllowed,
  readJson
} from '../../_lib/http.js';
import { createSession, sessionCookie, verifyPassword } from '../../_lib/auth.js';

const MAX_LOGIN_BODY = 4 * 1024;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map();

function clientKey(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

function checkRateLimit(request) {
  const key = clientKey(request);
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || entry.reset <= now) {
    attempts.set(key, { count: 1, reset: now + WINDOW_MS });
    return;
  }

  if (entry.count >= MAX_ATTEMPTS) {
    const retry = Math.max(1, Math.ceil((entry.reset - now) / 1000));
    throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Sai mật khẩu quá nhiều lần. Vui lòng thử lại sau.');
  }

  entry.count += 1;
}

function clearRateLimit(request) {
  attempts.delete(clientKey(request));
}

export async function onRequestPost(context) {
  try {
    const request = context.request;
    const env = context.env || {};
    assertSameOrigin(request);
    checkRateLimit(request);

    if (!env.TEACHER_PASSWORD_HASH || !env.SESSION_SECRET) {
      throw new HttpError(503, 'SERVER_NOT_CONFIGURED', 'Máy chủ chưa cấu hình đăng nhập giáo viên.');
    }

    const body = await readJson(request, MAX_LOGIN_BODY);
    // Bàn phím điện thoại hay tự thêm dấu cách ở cuối; bỏ khoảng trắng thừa
    // ở hai đầu để không báo sai mật khẩu oan.
    const password = body && typeof body.password === 'string'
      ? body.password.trim()
      : '';
    if (!password || password.length > 200) {
      throw new HttpError(400, 'INVALID_PASSWORD', 'Mật khẩu không hợp lệ.');
    }

    const ok = await verifyPassword(password, env.TEACHER_PASSWORD_HASH);
    if (!ok) {
      throw new HttpError(
        401,
        'INVALID_CREDENTIALS',
        'Mật khẩu không đúng. Kiểm tra dấu cách thừa hoặc chữ in hoa ở đầu.'
      );
    }

    clearRateLimit(request);
    const session = await createSession(env);

    return json({
      ok: true,
      expires_at: session.expiresAt
    }, 200, {
      'Set-Cookie': sessionCookie(session.token, session.maxAge, request)
    });
  } catch (error) {
    return handleError(error);
  }
}

export function onRequest() {
  return methodNotAllowed('POST');
}
