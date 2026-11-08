/*
 * Tiện ích HTTP dùng chung cho Pages Functions.
 * Không log body, mật khẩu, cookie hay dữ liệu học sinh.
 */
'use strict';

const DEFAULT_LIMIT = 64 * 1024;

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export function json(data, status, extraHeaders) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  };
  if (extraHeaders) {
    Object.keys(extraHeaders).forEach(function (key) {
      headers[key] = extraHeaders[key];
    });
  }
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: headers
  });
}

export function errorResponse(status, code, message, extraHeaders) {
  return json({
    ok: false,
    error: {
      code: code,
      message: message
    }
  }, status, extraHeaders);
}

export function methodNotAllowed(allow) {
  return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ.', {
    Allow: allow
  });
}

export function handleError(error) {
  if (error instanceof HttpError) {
    return errorResponse(error.status, error.code, error.message);
  }
  // Chỉ log tên lỗi và message; không log request body / secret.
  const name = error && error.name ? error.name : 'Error';
  const message = error && error.message ? error.message : 'Unknown error';
  console.error('[api] ' + name + ': ' + message);
  return errorResponse(500, 'INTERNAL_ERROR', 'Máy chủ gặp lỗi xử lý.');
}

export async function readJson(request, limit) {
  const max = limit || DEFAULT_LIMIT;
  const type = request.headers.get('Content-Type') || '';
  if (!/^application\/json(?:\s*;|$)/i.test(type)) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Yêu cầu phải dùng Content-Type: application/json.');
  }

  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > max) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Dữ liệu gửi lên quá lớn.');
  }

  const text = await request.text();
  const size = new TextEncoder().encode(text).length;
  if (size > max) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Dữ liệu gửi lên quá lớn.');
  }
  if (!text.trim()) {
    throw new HttpError(400, 'INVALID_JSON', 'Body JSON rỗng.');
  }

  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new HttpError(400, 'INVALID_JSON', 'Body không phải JSON hợp lệ.');
  }
  return value;
}

// Chỉ cho phép request cùng origin khi trình duyệt có gửi Origin.
// Dùng cho login/logout để giảm CSRF; submit là API công khai.
export function assertSameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return;
  let expected;
  try {
    expected = new URL(request.url).origin;
  } catch (error) {
    throw new HttpError(400, 'INVALID_URL', 'URL không hợp lệ.');
  }
  if (origin !== expected) {
    throw new HttpError(403, 'FORBIDDEN_ORIGIN', 'Origin không được phép.');
  }
}

export function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, '\\$&');
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  return '{' + Object.keys(value).sort().map(function (key) {
    return JSON.stringify(key) + ':' + stableStringify(value[key]);
  }).join(',') + '}';
}

export function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

export function nowIso() {
  return new Date().toISOString();
}
