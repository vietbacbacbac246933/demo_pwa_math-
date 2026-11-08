/* ==================================================================
   Service Worker cho THƯ VIỆN ĐỀ THI (đặt ở thư mục gốc)
   ------------------------------------------------------------------
   - Phạm vi mặc định là toàn bộ repository, nên kiểm soát được cả
     index.html và exams/<môn>/<đề>.html.
   - Danh sách đề được đọc từ assets/js/catalog.js, vì vậy khi thêm đề
     chỉ cần cập nhật catalog (và tăng CACHE_VERSION bên dưới).
   - Mỗi lần deploy phiên bản mới: tăng CACHE_VERSION, ví dụ v16 -> v17.

   LƯU Ý QUAN TRỌNG (Cloudflare Pages):
   Cloudflare tự chuyển hướng mọi địa chỉ .html sang địa chỉ không có
   .html (ví dụ /index.html -> /, /exams/ly/de_ly_01.html ->
   /exams/ly/de_ly_01). Response sau khi theo redirect có cờ
   "redirected" và KHÔNG được phép dùng để trả về cho một navigation
   request từ Cache Storage (trình duyệt báo ERR_FAILED). Vì vậy mọi
   response trước khi đưa vào cache đều được làm sạch bằng
   makeCleanResponse(), và khi đọc cache cho navigation cũng kiểm tra
   lại. Đây là nguyên nhân trang thư viện không mở được khi ngoại tuyến
   trên Cloudflare Pages nhưng vẫn chạy trên GitHub Pages.
   ================================================================== */
'use strict';

var CACHE_VERSION = 'v20';
var CACHE_PREFIX = 'exam-library-';
var CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;
var LEGACY_CACHE_PREFIX = 'de-toan-thpt-pwa-';

var SCOPE_URL = new URL('./', self.location.href).href;
var SCOPE_PATH = new URL(SCOPE_URL).pathname;
var SW_PATH = new URL('./sw.js', self.location.href).pathname;

var OFFLINE_TIMEOUT_MS = 5000;

var CORE_PATHS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/library.css',
  './assets/js/catalog.js',
  './assets/js/library.js',
  './assets/js/result-queue.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png'
];

// Các tài nguyên bắt buộc phải có để thư viện hiển thị được khi ngoại tuyến.
// Nếu một trong số này không tải được, lần cài đặt sẽ thất bại và Service
// Worker cũ (nếu có) tiếp tục được giữ nguyên, tránh làm mất bản offline cũ.
var CRITICAL_PATHS = [
  './',
  './index.html',
  './assets/css/library.css',
  './assets/js/catalog.js',
  './assets/js/library.js'
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

function absolute(path) {
  return new URL(path, self.location.href).href;
}

function pathOf(url) {
  try { return new URL(url).pathname; } catch (error) { return ''; }
}

var CORE_URLS = CORE_PATHS.map(absolute);
var CRITICAL_URLS = CRITICAL_PATHS.map(absolute);
var EXAM_URLS = EXAM_PATHS.map(absolute);

/* ------------------------------------------------------------------
   Tiện ích cache
   ------------------------------------------------------------------ */

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// Tạo response "sạch": không còn cờ redirected, URL rỗng. Nhờ vậy có thể
// dùng làm kết quả navigation từ Cache Storage trên mọi trình duyệt.
function makeCleanResponse(response, body) {
  var headers = new Headers();
  var contentType = response.headers.get('Content-Type');
  if (contentType) headers.set('Content-Type', contentType);
  var status = response.status && response.status >= 200 && response.status <= 599 ? response.status : 200;
  return new Response(body, {
    status: status,
    statusText: response.statusText || 'OK',
    headers: headers
  });
}

// Đọc response và trả về bản sạch. Tham số asText dùng để kiểm tra nội dung
// đề trước khi cache (tránh cache nhầm trang thư viện do SPA fallback).
function cleanResponse(response, asText) {
  var body = asText ? response.text() : response.blob();
  return body.then(function (value) {
    return makeCleanResponse(response, value);
  });
}

function putInCache(cache, key, response) {
  if (!response || !response.ok) return Promise.resolve(false);
  if (response.type === 'opaque') return Promise.resolve(false);
  return cleanResponse(response, false).then(function (clean) {
    return cache.put(key, clean).then(function () { return true; });
  }).catch(function () {
    return false;
  });
}

// Cache một response lấy từ mạng; lỗi cache không được làm hỏng việc hiển thị.
function storeResponse(key, response) {
  if (!response || !response.ok || response.type === 'opaque') return Promise.resolve(false);
  return caches.open(CACHE_NAME).then(function (cache) {
    return putInCache(cache, key, response.clone());
  }).catch(function () {
    return false;
  });
}

// Các biến thể URL của cùng một trang:
//   /index.html <-> /
//   /exams/x.html <-> /exams/x
// Giúp điều hướng offline hoạt động dù người dùng mở địa chỉ có .html
// (GitHub Pages) hay không có .html (Cloudflare Pages).
function urlVariants(href) {
  var parsed;
  try { parsed = new URL(href); } catch (error) { return [href]; }
  var pathname = parsed.pathname;
  var paths = [pathname];

  function add(value) {
    if (value && paths.indexOf(value) < 0) paths.push(value);
  }

  if (/\/index\.html$/.test(pathname)) {
    add(pathname.replace(/\/index\.html$/, '/'));
  } else if (/\/$/.test(pathname)) {
    add(pathname + 'index.html');
  } else if (/\.html$/.test(pathname)) {
    add(pathname.replace(/\.html$/, ''));
  } else {
    add(pathname + '.html');
  }

  return paths.map(function (item) {
    var copy = new URL(parsed.href);
    copy.pathname = item;
    copy.search = '';
    copy.hash = '';
    return copy.href;
  });
}

function matchIn(cache, urls) {
  var index = 0;
  function next() {
    if (index >= urls.length) return Promise.resolve(null);
    var url = urls[index];
    index += 1;
    return cache.match(url, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return next();
    });
  }
  return next();
}

function compareVersionDesc(a, b) {
  return versionOf(b) - versionOf(a);
}

function versionOf(cacheName) {
  var match = cacheName.match(/^exam-library-v(\d+)/i);
  return match ? Number(match[1]) : -1;
}

// Tìm trong cache hiện tại trước, sau đó tới các cache của phiên bản trước.
// Việc này giúp đề đã tải ở phiên bản cũ vẫn mở được ngay sau khi cập nhật.
function findCached(requestUrl, includeOlder) {
  var urls = urlVariants(requestUrl);
  return caches.open(CACHE_NAME).then(function (cache) {
    return matchIn(cache, urls).then(function (hit) {
      if (hit) return hit;
      if (includeOlder === false) return null;
      return caches.keys().then(function (keys) {
        var older = keys.filter(function (key) {
          return key.indexOf(CACHE_PREFIX) === 0 && key !== CACHE_NAME;
        }).sort(compareVersionDesc);

        var index = 0;
        function next() {
          if (index >= older.length) return null;
          var name = older[index];
          index += 1;
          return caches.open(name).then(function (oldCache) {
            return matchIn(oldCache, urls);
          }).then(function (oldHit) {
            return oldHit || next();
          });
        }
        return next();
      });
    });
  }).catch(function () {
    return null;
  });
}

// Cache cũ có thể chứa response có cờ redirected (do bản Service Worker
// trước lưu nguyên response của Cloudflare). Navigation không được dùng
// trực tiếp response đó, nên tạo lại một bản sạch trước khi trả về.
function navigationSafe(response) {
  if (!response || !response.redirected) return Promise.resolve(response);
  return cleanResponse(response, false);
}

function isSpaFallback(requestUrl, responseUrl) {
  if (!responseUrl) return false;
  var requestPath = pathOf(requestUrl);
  var responsePath = pathOf(responseUrl);
  if (responsePath !== SCOPE_PATH) return false;
  if (requestPath === SCOPE_PATH) return false;
  if (/\/index\.html$/.test(requestPath)) return false;
  return true;
}

/* ------------------------------------------------------------------
   Cài đặt: precache có kiểm tra
   ------------------------------------------------------------------ */

function fetchFresh(url) {
  return fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }))
    .catch(function () {
      // Một số trình duyệt/Proxy không chấp nhận cache: 'reload'; thử lại
      // bằng request thường trước khi bỏ cuộc.
      return fetch(new Request(url, { credentials: 'same-origin' }));
    });
}

function precacheUrl(cache, url, isExam) {
  return fetchFresh(url).then(function (response) {
    if (!response || !response.ok) {
      throw new Error('HTTP ' + (response ? response.status : '?') + ' cho ' + url);
    }
    if (isSpaFallback(url, response.url)) {
      throw new Error('SPA fallback cho ' + url);
    }

    var contentType = response.headers.get('Content-Type') || '';
    var isHtml = /text\/html/i.test(contentType);
    var asText = Boolean(isExam && isHtml);

    // Đề phải chứa khối quiz-data. Nếu không, rất có thể Cloudflare đã trả
    // về trang chủ thay cho file đề không tồn tại -> không cache nhầm.
    var bodyPromise = asText ? response.text() : response.blob();
    return bodyPromise.then(function (body) {
      if (asText && String(body).indexOf('id="quiz-data"') < 0) {
        throw new Error('Nội dung không phải file đề: ' + url);
      }
      var clean = makeCleanResponse(response, body);
      return cache.put(url, clean).then(function () { return true; });
    });
  });
}

function criticalFor(url) {
  return CRITICAL_URLS.indexOf(url) >= 0;
}

function aliasIndexCache(cache) {
  var root = absolute('./');
  var index = absolute('./index.html');
  return cache.match(index, { ignoreSearch: true }).then(function (hit) {
    if (hit) {
      return hit.blob().then(function (body) {
        return cache.put(root, makeCleanResponse(hit, body));
      });
    }
    return cache.match(root, { ignoreSearch: true }).then(function (rootHit) {
      if (!rootHit) return false;
      return rootHit.blob().then(function (body) {
        return cache.put(index, makeCleanResponse(rootHit, body));
      });
    });
  }).then(function () { return true; }).catch(function () { return false; });
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      var coreResults = CORE_URLS.map(function (url) {
        return precacheUrl(cache, url, false).then(function () {
          return { url: url, ok: true };
        }).catch(function () {
          return { url: url, ok: false };
        });
      });

      return Promise.all(coreResults).then(function (results) {
        var failedCritical = results.filter(function (item) {
          return !item.ok && criticalFor(item.url);
        });

        // Nếu chính trang chủ hoặc tài nguyên cốt lõi không tải được thì
        // hủy cài đặt. Service Worker cũ vẫn tiếp tục phục vụ người dùng.
        if (failedCritical.length) {
          throw new Error('Không precache được tài nguyên cốt lõi.');
        }

        // Bảo đảm cả '/' và '/index.html' đều có trong cache.
        return aliasIndexCache(cache);
      }).then(function () {
        // Đề lỗi không chặn cài đặt; các đề khác vẫn dùng offline được.
        return Promise.all(EXAM_URLS.map(function (url) {
          return precacheUrl(cache, url, true).catch(function () { return false; });
        }));
      });
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

/* ------------------------------------------------------------------
   Kích hoạt: chỉ xóa cache cũ khi cache mới đã sẵn sàng
   ------------------------------------------------------------------ */

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      var currentVersion = versionOf(CACHE_NAME);
      var previousKey = null;
      var previousVersion = -1;

      keys.forEach(function (key) {
        var version = versionOf(key);
        if (version < 0 || version >= currentVersion) return;
        if (version > previousVersion) {
          previousVersion = version;
          previousKey = key;
        }
      });

      return Promise.all(keys.map(function (key) {
        // Cache của ứng dụng một-đề trước đây, không còn được đọc.
        if (key.indexOf(LEGACY_CACHE_PREFIX) === 0) return caches.delete(key);

        if (key.indexOf(CACHE_PREFIX) !== 0) return null;
        if (key === CACHE_NAME) return null;
        // Giữ lại cache của phiên bản ngay trước làm phương án dự phòng,
        // để đề đã tải trước đó không biến mất ngay sau khi nâng cấp.
        if (previousKey && key === previousKey) return null;
        return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* ------------------------------------------------------------------
   Điều hướng offline
   ------------------------------------------------------------------ */

function offlinePage(request) {
  var home = SCOPE_URL;
  var path = '';
  try { path = decodeURIComponent(new URL(request.url).pathname); } catch (error) {}
  var html = '<!doctype html>' +
    '<html lang="vi"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
    '<meta name="theme-color" content="#4338ca">' +
    '<title>Chưa lưu để dùng ngoại tuyến | Thư viện đề thi THPT</title>' +
    '<style>' +
    ':root{color-scheme:light}' +
    '*{box-sizing:border-box}' +
    'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
    'padding:24px;background:#eef2f8;color:#172033;' +
    'font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}' +
    '.card{width:100%;max-width:520px;background:#fff;border:1px solid #dbe2ee;' +
    'border-radius:18px;box-shadow:0 18px 44px rgba(23,32,51,.14);padding:28px}' +
    'h1{margin:0 0 8px;font-size:1.3rem;line-height:1.3}' +
    'p{margin:0 0 12px;color:#5b6577;font-size:.94rem}' +
    'code{background:#f4f6fb;border:1px solid #dbe2ee;border-radius:6px;padding:1px 5px;' +
    'font-size:.86em;word-break:break-all}' +
    '.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}' +
    '.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;' +
    'padding:9px 18px;border-radius:11px;border:1px solid #dbe2ee;background:#f4f6fb;' +
    'color:#172033;font:inherit;font-weight:800;text-decoration:none;cursor:pointer}' +
    '.btn.primary{background:#4338ca;border-color:#4338ca;color:#fff}' +
    '</style></head><body><main class="card">' +
    '<h1>Trang này chưa được lưu để dùng ngoại tuyến</h1>' +
    '<p>Đề hoặc trang bạn vừa mở chưa được tải về máy. Hãy kết nối Internet rồi thử lại.</p>' +
    (path ? '<p>Địa chỉ: <code>' + escapeHtml(path) + '</code></p>' : '') +
    '<p>Thư viện và những đề đã mở thành công trước đó vẫn dùng được khi mất mạng.</p>' +
    '<div class="actions">' +
    '<a class="btn primary" href="' + escapeHtml(home) + '">← Về thư viện</a>' +
    '<button class="btn" type="button" onclick="location.reload()">Thử lại</button>' +
    '</div></main></body></html>';
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function offlineNavigation(request) {
  return findCached(request.url).then(function (hit) {
    if (!hit) return offlinePage(request);
    return navigationSafe(hit);
  }).catch(function () {
    return offlinePage(request);
  });
}

function navigationTimeout(event, request) {
  return new Promise(function (resolve) {
    var settled = false;

    // Ghi cache chạy nền nhưng vẫn được Service Worker chờ hoàn tất. Phải gọi
    // waitUntil() ngay lúc event còn hoạt động; gọi trong .then() có thể bị bỏ qua.
    var cacheDone = null;
    var cacheResolve = null;
    try {
      cacheDone = new Promise(function (done) { cacheResolve = done; });
      event.waitUntil(cacheDone);
    } catch (error) {
      cacheDone = null;
      cacheResolve = null;
    }

    function doneCaching() {
      if (cacheResolve) {
        var fn = cacheResolve;
        cacheResolve = null;
        fn();
      }
    }

    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      doneCaching();
      resolve(offlineNavigation(request));
    }, OFFLINE_TIMEOUT_MS);

    function finish(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }

    fetch(request).then(function (response) {
      if (!response) {
        doneCaching();
        finish(offlineNavigation(request));
        return;
      }
      if (response.status >= 500) {
        doneCaching();
        offlineNavigation(request).then(finish);
        return;
      }
      if (response.ok) {
        // Trả bản mạng cho người dùng ngay; lưu bản sạch vào cache ở nền.
        var cacheCopy = null;
        try { cacheCopy = response.clone(); } catch (error) {}
        if (cacheCopy) {
          storeResponse(request.url, cacheCopy).then(doneCaching, doneCaching);
        } else {
          doneCaching();
        }
        finish(response);
        return;
      }
      doneCaching();
      finish(response);
    }).catch(function () {
      doneCaching();
      finish(offlineNavigation(request));
    });
  });
}

/* ------------------------------------------------------------------
   Fetch
   ------------------------------------------------------------------ */

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url;
  try { url = new URL(request.url); } catch (error) { return; }
  if (url.origin !== self.location.origin) return;

  // API kết quả luôn đi thẳng ra mạng: không đọc/ghi cache, không trả dữ liệu
  // giáo viên từ Cache Storage. Nhờ vậy đăng xuất/đổi tài khoản có hiệu lực ngay.
  if (/^\/api(?:\/|$)/.test(url.pathname)) return;

  // Không can thiệp vào file Service Worker; trình duyệt tự kiểm tra bản mới.
  if (url.pathname === SW_PATH) return;

  // Điều hướng trang: ưu tiên mạng, mất mạng thì dùng cache, cuối cùng là
  // trang thông báo "chưa lưu để dùng ngoại tuyến".
  if (request.mode === 'navigate') {
    event.respondWith(navigationTimeout(event, request));
    return;
  }

  // Danh mục đề: ưu tiên mạng để đề mới hiện ra ngay sau khi deploy,
  // ngoại tuyến thì dùng bản đã cache.
  if (/\/assets\/js\/catalog\.js$/.test(url.pathname)) {
    event.respondWith(
      fetch(request).then(function (response) {
        if (!response || response.status >= 500) {
          return findCached(request.url).then(function (hit) { return hit || response; });
        }
        if (response.ok) {
          var copy = null;
          try { copy = response.clone(); } catch (error) {}
          if (copy) {
            return storeResponse(request.url, copy).then(function () { return response; },
              function () { return response; });
          }
        }
        return response;
      }).catch(function () {
        return findCached(request.url).then(function (hit) {
          return hit || new Response('', { status: 504, statusText: 'Offline' });
        });
      })
    );
    return;
  }

  // Tài nguyên tĩnh: cache trước (để mở tức thì và dùng offline), sau đó
  // mới lấy mạng và bổ sung cache cho lần sau.
  //
  // Chỉ đọc cache của CACHE_NAME hiện tại, không đọc cache phiên bản cũ: nếu
  // không, JS/CSS cũ (ví dụ teacher.js trước khi sửa lỗi) có thể tiếp tục được
  // phục vụ sau khi tăng CACHE_VERSION. Cache cũ chỉ dùng làm phương án cuối
  // khi mạng lỗi, để tài nguyên đã tải trước đó vẫn dùng được ngoại tuyến.
  event.respondWith(
    findCached(request.url, false).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (response) {
        if (!response || !response.ok) return response;
        var copy = null;
        try { copy = response.clone(); } catch (error) {}
        if (!copy) return response;
        return storeResponse(request.url, copy).then(function () { return response; },
          function () { return response; });
      }).catch(function () {
        return findCached(request.url, true).then(function (oldHit) {
          return oldHit || new Response('', { status: 504, statusText: 'Offline' });
        });
      });
    }).catch(function () {
      return new Response('', { status: 504, statusText: 'Offline' });
    })
  );
});
