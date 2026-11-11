/*
 * Giới hạn tần suất nộp bài (rate limit).
 *
 * - Bộ đếm lưu trong D1 (bảng rate_limits) nên có hiệu lực trên mọi
 *   instance/region của Worker, không chỉ trong bộ nhớ của một isolate.
 * - Khóa gồm IP đã băm SHA-256: không lưu IP thô trong database.
 * - Nếu D1 tạm lỗi hoặc chưa chạy migration 0003, tự lùi về bộ đếm trong
 *   bộ nhớ của isolate hiện tại (vẫn chặn được burst ngắn).
 * - Bỏ qua IP loopback/không xác định để không ảnh hưởng `wrangler pages dev`
 *   và kiểm thử local. Trên Cloudflare, CF-Connecting-IP luôn do edge đặt và
 *   client không thể giả mạo.
 */
'use strict';

import { HttpError } from './http.js';

// Ngưỡng mặc định đặt cao vì một lớp (khoảng 45 học sinh) thường dùng chung
// một địa chỉ IP NAT/proxy của trường. Ngưỡng thấp sẽ chặn nhầm chính học sinh
// trong lúc cả lớp cùng nộp bài. Vẫn đủ cao để chặn bơm dữ liệu hàng loạt;
// muốn chặt hơn thì bật Turnstile thay vì hạ ngưỡng IP.
const DEFAULT_WINDOW_SECONDS = 600;
const DEFAULT_MAX = 1000;
const DEFAULT_BURST_WINDOW_SECONDS = 60;
const DEFAULT_BURST_MAX = 300;

const CLEANUP_PROBABILITY = 0.02;
const MEMORY_MAX_ENTRIES = 5000;

const encoder = new TextEncoder();
const memoryBuckets = new Map();

let warnedD1Failure = false;

function readPositiveInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) return fallback;
  return Math.min(n, max);
}

export function getClientIp(request) {
  // Chỉ tin header do Cloudflare edge đặt. Không dùng X-Forwarded-For vì
  // header đó do client gửi và có thể bị giả mạo.
  const cf = request.headers.get('CF-Connecting-IP');
  return cf && cf.trim() ? cf.trim() : '';
}

function isLoopbackIp(ip) {
  if (!ip) return true;
  const value = ip.toLowerCase();
  return value === 'unknown' ||
    value === '127.0.0.1' ||
    value === '::1' ||
    value === '[::1]' ||
    value === '0:0:0:0:0:0:0:1' ||
    /^::ffff:127\./.test(value);
}

// Gom IPv6 theo /64: một thiết bị có thể tự đổi địa chỉ trong cùng /64 rất dễ,
// nên đếm theo từng địa chỉ IPv6 sẽ bị lách. IPv4 giữ nguyên.
function rateLimitAddress(ip) {
  const value = String(ip || '').toLowerCase();
  if (value.indexOf(':') < 0) return value;

  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped) return mapped[1];

  let address = value.split('%')[0];
  const embedded = /(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (embedded) {
    const parts = embedded[1].split('.').map(Number);
    address = address.slice(0, -embedded[1].length) +
      (((parts[0] << 8) | parts[1]).toString(16)) + ':' +
      (((parts[2] << 8) | parts[3]).toString(16));
  }

  const halves = address.split('::');
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  const groups = missing > 0
    ? head.concat(new Array(missing).fill('0')).concat(tail)
    : head.concat(tail);

  if (groups.length < 4) return value;
  return groups.slice(0, 4).map(function (group) {
    return group.replace(/^0+/, '') || '0';
  }).join(':') + '::/64';
}

async function hashKey(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.prototype.map.call(new Uint8Array(digest), function (byte) {
    return byte.toString(16).padStart(2, '0');
  }).join('');
}

function memoryConsume(bucketKey, nowMs, windowMs) {
  const entry = memoryBuckets.get(bucketKey);
  if (!entry || entry.expiresAt <= nowMs) {
    memoryBuckets.set(bucketKey, {
      count: 1,
      expiresAt: nowMs + windowMs
    });
  } else {
    entry.count += 1;
  }

  if (memoryBuckets.size > MEMORY_MAX_ENTRIES) {
    memoryBuckets.forEach(function (value, key) {
      if (value.expiresAt <= nowMs) memoryBuckets.delete(key);
    });
    // Vẫn quá nhiều (ví dụ D1 lỗi lúc bị tấn công nhiều IP): bỏ bucket cũ nhất.
    memoryBuckets.forEach(function (value, key) {
      if (memoryBuckets.size > MEMORY_MAX_ENTRIES) memoryBuckets.delete(key);
    });
  }

  let current = memoryBuckets.get(bucketKey);
  if (!current) {
    // Bucket vừa bị dọn vì vượt hạn mức bộ nhớ: tính lại từ đầu.
    current = { count: 1, expiresAt: nowMs + windowMs };
    memoryBuckets.set(bucketKey, current);
  }
  return { count: current.count, resetAt: current.expiresAt };
}

async function cleanupExpired(env, nowMs) {
  try {
    await env.DB.prepare('DELETE FROM rate_limits WHERE expires_at <= ?')
      .bind(nowMs)
      .run();
  } catch (error) {
    // Bảng chưa tồn tại hoặc D1 bận: không ảnh hưởng việc chặn request.
  }
}

async function consume(env, scope, ip, windowSeconds, nowMs) {
  const windowMs = windowSeconds * 1000;
  const windowStart = Math.floor(nowMs / windowMs) * windowMs;
  const bucketKey = scope + ':' + (await hashKey(rateLimitAddress(ip))) + ':' + windowStart;

  if (env && env.DB) {
    try {
      const row = await env.DB.prepare(
        'INSERT INTO rate_limits (bucket_key, count, window_start, expires_at) ' +
        'VALUES (?, 1, ?, ?) ' +
        'ON CONFLICT(bucket_key) DO UPDATE SET count = rate_limits.count + 1 ' +
        'RETURNING count'
      ).bind(
        bucketKey,
        windowStart,
        windowStart + windowMs + 60000
      ).first();

      const count = Number(row && row.count);
      if (Number.isFinite(count) && count > 0) {
        if (Math.random() < CLEANUP_PROBABILITY) {
          await cleanupExpired(env, nowMs);
        }
        return { count: count, resetAt: windowStart + windowMs };
      }
    } catch (error) {
      if (!warnedD1Failure) {
        warnedD1Failure = true;
        const name = error && error.name ? error.name : 'Error';
        const message = error && error.message ? error.message : 'unknown';
        console.error('[rate-limit] D1 unavailable, using memory fallback: ' + name + ': ' + message);
      }
    }
  }

  const memory = memoryConsume(bucketKey, nowMs, windowMs);
  return { count: memory.count, resetAt: windowStart + windowMs };
}

function tooMany(entry, message) {
  const retryAfter = Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000));
  return new HttpError(429, 'SUBMIT_RATE_LIMITED', message, {
    'Retry-After': String(retryAfter)
  });
}

export function getSubmitRateLimits(env) {
  const config = env || {};
  return {
    windowSeconds: readPositiveInt(config.SUBMIT_RATE_LIMIT_WINDOW_SECONDS, DEFAULT_WINDOW_SECONDS, 10, 86400),
    max: readPositiveInt(config.SUBMIT_RATE_LIMIT_MAX, DEFAULT_MAX, 1, 100000),
    burstWindowSeconds: readPositiveInt(config.SUBMIT_RATE_BURST_WINDOW_SECONDS, DEFAULT_BURST_WINDOW_SECONDS, 1, 3600),
    burstMax: readPositiveInt(config.SUBMIT_RATE_BURST_MAX, DEFAULT_BURST_MAX, 1, 100000)
  };
}

export async function enforceSubmitRateLimit(request, env) {
  const ip = getClientIp(request);
  if (isLoopbackIp(ip)) return null;

  const limits = getSubmitRateLimits(env);
  const now = Date.now();
  const message = 'Bạn đã nộp bài quá nhiều lần. Vui lòng chờ ít phút rồi thử lại.';

  // Cửa sổ dài hạn: tổng số lượt nộp trong 10 phút (mặc định).
  const sustained = await consume(env, 'submit', ip, limits.windowSeconds, now);
  if (sustained.count > limits.max) {
    throw tooMany(sustained, message);
  }

  // Cửa sổ burst: chặn gửi dồn dập trong thời gian ngắn (mặc định 20/phút).
  const burst = await consume(env, 'submit-burst', ip, limits.burstWindowSeconds, now);
  if (burst.count > limits.burstMax) {
    throw tooMany(burst, message);
  }

  return null;
}
