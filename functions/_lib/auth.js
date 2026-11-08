/*
 * Xác thực giáo viên bằng cookie HttpOnly có chữ ký HMAC.
 * Không lưu mật khẩu/token trong localStorage hay JavaScript frontend.
 */
'use strict';

import { HttpError } from './http.js';

export const SESSION_COOKIE = 'teacher_session';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToB64url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlToBytes(value) {
  let text = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (text.length % 4) text += '=';
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function timingSafeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function hexToBytes(value) {
  const text = String(value || '');
  if (!text.length || text.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(text)) return null;
  const bytes = new Uint8Array(text.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return new Uint8Array(signature);
}

export function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const result = {};
  header.split(';').forEach(function (part) {
    const index = part.indexOf('=');
    if (index < 0) return;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) result[name] = value;
  });
  return result;
}

function getSecret(env) {
  const secret = env && env.SESSION_SECRET;
  if (typeof secret !== 'string' || secret.length < 32) return null;
  return secret;
}

export function getSessionHours(env) {
  const n = Number(env && env.TEACHER_SESSION_HOURS);
  if (!Number.isFinite(n) || n < 1) return 12;
  return Math.min(Math.floor(n), 168);
}

export async function createSession(env) {
  const secret = getSecret(env);
  if (!secret) {
    throw new HttpError(503, 'SERVER_NOT_CONFIGURED', 'Máy chủ chưa cấu hình phiên đăng nhập.');
  }

  const maxAge = getSessionHours(env) * 3600;
  const now = Math.floor(Date.now() / 1000);
  const expires = now + maxAge;
  const body = bytesToB64url(encoder.encode(JSON.stringify({
    v: 1,
    iat: now,
    exp: expires
  })));
  const signature = await hmac(secret, body);
  return {
    token: body + '.' + bytesToB64url(signature),
    maxAge: maxAge,
    expiresAt: new Date(expires * 1000).toISOString()
  };
}

export async function verifySessionToken(token, env) {
  const secret = getSecret(env);
  if (!secret || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  let expected;
  let actual;
  try {
    expected = await hmac(secret, parts[0]);
    actual = b64urlToBytes(parts[1]);
  } catch (error) {
    return null;
  }
  if (!timingSafeEqual(actual, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(decoder.decode(b64urlToBytes(parts[0])));
  } catch (error) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (!payload || payload.v !== 1 || !Number.isInteger(payload.exp) || payload.exp <= now) {
    return null;
  }
  return payload;
}

export async function getSession(request, env) {
  const cookies = parseCookies(request);
  return verifySessionToken(cookies[SESSION_COOKIE], env);
}

export async function requireTeacher(context) {
  const session = await getSession(context.request, context.env);
  if (!session) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Cần đăng nhập giáo viên.');
  }
  return session;
}

function cookieParts(request) {
  const url = new URL(request.url);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  const parts = [
    'Path=/',
    'HttpOnly',
    'SameSite=Strict'
  ];
  if (url.protocol === 'https:' && !local) parts.push('Secure');
  return parts;
}

export function sessionCookie(token, maxAge, request) {
  const parts = cookieParts(request);
  parts.unshift(SESSION_COOKIE + '=' + token);
  parts.push('Max-Age=' + maxAge);
  return parts.join('; ');
}

export function clearSessionCookie(request) {
  const parts = cookieParts(request);
  parts.unshift(SESSION_COOKIE + '=');
  parts.push('Max-Age=0');
  return parts.join('; ');
}

export async function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || !password) return false;
  if (typeof storedHash !== 'string' || !storedHash) return false;

  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;

  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 10000 || iterations > 1000000) return false;

  const salt = hexToBytes(parts[2]);
  const expected = hexToBytes(parts[3]);
  if (!salt || !expected || expected.length < 16) return false;

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits({
      name: 'PBKDF2',
      salt: salt,
      iterations: iterations,
      hash: 'SHA-256'
    }, key, expected.length * 8);
    return timingSafeEqual(new Uint8Array(bits), expected);
  } catch (error) {
    return false;
  }
}
