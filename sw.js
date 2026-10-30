/* ==================================================================
   Service Worker cho THƯ VIỆN ĐỀ THI (đặt ở thư mục gốc)
   ------------------------------------------------------------------
   - Phạm vi mặc định là toàn bộ repository, nên kiểm soát được cả
     index.html và exams/<môn>/<đề>.html.
   - Danh sách đề được đọc từ assets/js/catalog.js, vì vậy khi thêm đề
     chỉ cần cập nhật catalog (và tăng CACHE_VERSION bên dưới).
   - Mỗi lần deploy phiên bản mới: tăng CACHE_VERSION, ví dụ v1 -> v2.
   ================================================================== */
'use strict';

var CACHE_VERSION = 'v1';
var CACHE_PREFIX = 'exam-library-';
var CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

var CORE_PATHS = [
  './',
  './index.html',
  './de_toan_thpt_mau2.html', // trang chuyển hướng cho link cũ (nếu còn)
  './manifest.webmanifest',
  './assets/css/library.css',
  './assets/js/catalog.js',
  './assets/js/library.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png'
];

// Nạp danh mục đề để tự động cache mọi file đề đang có.
try {
  importScripts(new URL('./assets/js/catalog.js', self.location.href).href);
} catch (error) {
  // Nếu catalog lỗi, website vẫn cài được với các file lõi.
}

var EXAM_PATHS = [];
try {
  var subjects = (self.EXAM_LIBRARY && self.EXAM_LIBRARY.subjects) || [];
  subjects.forEach(function (subject) {
    (subject.exams || []).forEach(function (exam) {
      if (!exam || !exam.file) return;
      var file = String(exam.file).replace(/^\.?\//, '');
      if (EXAM_PATHS.indexOf(file) < 0) EXAM_PATHS.push(file);
    });
  });
} catch (error) {}

var PRECACHE_URLS = CORE_PATHS.concat(EXAM_PATHS).map(function (path) {
  return new URL(path, self.location.href).href;
});

// Cài đặt: tải từng file, bỏ qua file lỗi để một đề hỏng không chặn cả app.
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.all(PRECACHE_URLS.map(function (url) {
        return fetch(new Request(url, { cache: 'reload' }))
          .then(function (response) {
            if (response && (response.ok || response.type === 'opaque')) {
              return cache.put(url, response);
            }
          })
          .catch(function () {});
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

// Kích hoạt: xóa cache phiên bản cũ (kể cả cache của bản một đề trước đây).
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        var isOldLibrary = key.indexOf(CACHE_PREFIX) === 0 && key !== CACHE_NAME;
        var isLegacyApp = key.indexOf('de-toan-thpt-pwa-') === 0;
        if (isOldLibrary || isLegacyApp) return caches.delete(key);
        return null;
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url;
  try { url = new URL(request.url); } catch (error) { return; }
  if (url.origin !== self.location.origin) return;

  // Điều hướng trang: ưu tiên mạng để nhận bản mới; mất mạng hoặc lỗi máy chủ
  // (5xx) thì dùng bản đã cache.
  if (request.mode === 'navigate') {
    function fromCache() {
      return caches.match(request, { ignoreSearch: true }).then(function (cached) {
        if (cached) return cached;
        return caches.match(new URL('./index.html', self.location.href).href);
      });
    }

    event.respondWith(
      fetch(request).then(function (response) {
        if (!response || response.status >= 500) return fromCache().then(function (hit) { return hit || response; });
        if (response.ok) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(request, copy);
          }).catch(function () {});
        }
        return response;
      }).catch(fromCache)
    );
    return;
  }

  // Danh mục đề: ưu tiên mạng để đề mới hiện ra ngay sau khi deploy,
  // ngoại tuyến thì dùng bản đã cache.
  if (/\/assets\/js\/catalog\.js$/.test(url.pathname)) {
    event.respondWith(
      fetch(request).then(function (response) {
        if (!response || response.status >= 500) {
          return caches.match(request, { ignoreSearch: true }).then(function (hit) {
            return hit || response;
          });
        }
        if (response.ok) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(request, copy);
          }).catch(function () {});
        }
        return response;
      }).catch(function () {
        return caches.match(request, { ignoreSearch: true }).then(function (hit) {
          return hit || new Response('', { status: 504, statusText: 'Offline' });
        });
      })
    );
    return;
  }

  // Tài nguyên tĩnh: cache trước, sau đó mới lấy mạng và bổ sung cache.
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(request, copy);
          }).catch(function () {});
        }
        return response;
      });
    })
  );
});
