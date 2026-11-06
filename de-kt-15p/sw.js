/* Service Worker for the offline-capable THPT math quiz. */
'use strict';

// 1) Tên cache riêng cho đề này. Đổi đuôi v1 -> v2 mỗi khi cập nhật nội dung đề.
var CACHE_NAME = 'quiz-kiemtra15p-v1';

// 2) Tiền tố dùng để dọn cache cũ. Phải khớp với CACHE_NAME ở trên
//    và phải KHÁC tiền tố của các đề khác trong cùng tên miền.
var CACHE_PREFIX = 'quiz-kiemtra15p-';

// 3) File HTML chính của đề này.
var APP_FILE = './de_kiem_tra_15p.html';

var APP_FILES = [
  APP_FILE,
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_FILES.map(function (path) {
        return new Request(new URL(path, self.registration.scope).href, { cache: 'reload' });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (key) {
            return key.indexOf(CACHE_PREFIX) === 0 && key !== CACHE_NAME;
          })
          .map(function (key) { return caches.delete(key); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async function () {
    var cache = await caches.open(CACHE_NAME);

    // Mở đúng trang HTML của đề này -> trả bản đã lưu (chạy được khi mất mạng)
    if (request.mode === 'navigate') {
      var appUrl = new URL(APP_FILE, self.registration.scope);
      if (url.pathname === appUrl.pathname) {
        var savedPage = await cache.match(appUrl.href);
        if (savedPage) return savedPage;
      }
    }

    var cached = await cache.match(request);
    if (cached) return cached;

    try {
      return await fetch(request);
    } catch (error) {
      // Mất mạng mà mở link lạ -> trả về trang đề này
      if (request.mode === 'navigate') {
        var fallback = await cache.match(new URL(APP_FILE, self.registration.scope).href);
        if (fallback) return fallback;
      }
      throw error;
    }
  })());
});