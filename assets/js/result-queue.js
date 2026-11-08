/*
 * Hàng đợi nộp bài phía học sinh.
 * - Lưu mỗi lượt nộp vào IndexedDB trước khi gửi.
 * - Không đổi submission_id khi thử lại.
 * - Tự gửi lại khi có mạng / mở lại trang.
 * - Không làm hỏng màn hình kết quả nếu IndexedDB hoặc mạng lỗi.
 */
(function () {
  'use strict';

  var DB_NAME = 'exam-results-outbox';
  var DB_VERSION = 1;
  var STORE = 'submissions';
  var ENDPOINT = '/api/submit';
  try {
    ENDPOINT = new URL('/api/submit', window.location.origin).href;
  } catch (error) {
    // Mở bằng file:// hoặc origin không hợp lệ: vẫn giữ đường dẫn tương đối.
  }
  var RETRY_DELAYS = [5000, 15000, 60000, 300000, 900000, 1800000];
  var SENDING_LEASE_MS = 60000;
  var SYNCED_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

  var dbPromise = null;
  var flushing = false;
  var retryTimer = null;
  var toastTimer = null;

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      try { return window.crypto.randomUUID(); } catch (error) {}
    }
    var bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (var i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = Array.prototype.map.call(bytes, function (b) {
      return b.toString(16).padStart(2, '0');
    }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' +
      hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function clone(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (error) { return {}; }
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB không khả dụng'));
        return;
      }
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        var db = request.result;
        var store;
        if (!db.objectStoreNames.contains(STORE)) {
          store = db.createObjectStore(STORE, { keyPath: 'submission_id' });
        } else {
          store = request.transaction.objectStore(STORE);
        }
        if (!store.indexNames.contains('status')) {
          store.createIndex('status', 'status', { unique: false });
        }
        if (!store.indexNames.contains('created_at')) {
          store.createIndex('created_at', 'created_at', { unique: false });
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('Không mở được IndexedDB')); };
    });
    return dbPromise;
  }

  function getAllEntries() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var request = tx.objectStore(STORE).getAll();
        request.onsuccess = function () {
          resolve(Array.isArray(request.result) ? request.result : []);
        };
        request.onerror = function () { reject(request.error || new Error('Không đọc được IndexedDB')); };
      });
    });
  }

  function putEntry(entry) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(entry);
        tx.oncomplete = function () { resolve(entry); };
        tx.onerror = function () { reject(tx.error || new Error('Không ghi được IndexedDB')); };
        tx.onabort = function () { reject(tx.error || new Error('Ghi IndexedDB bị hủy')); };
      });
    });
  }

  function deleteEntry(id) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error || new Error('Không xóa được IndexedDB')); };
      });
    });
  }

  function buildPayload(data) {
    var duration = Number(data && data.durationSeconds);
    if (!isFinite(duration) || duration < 0) duration = 0;
    duration = Math.min(Math.round(duration), 86400);

    return {
      submission_id: uuid(),
      exam_id: String((data && data.examId) || ''),
      student_name: String((data && data.studentName) || '').trim(),
      student_class: String((data && data.studentClass) || '').trim(),
      answers: clone((data && data.answers) || {}),
      duration_seconds: duration,
      timed_out: !!(data && data.timedOut)
    };
  }

  function newEntry(payload) {
    var now = Date.now();
    return {
      submission_id: payload.submission_id,
      payload: payload,
      status: 'pending',
      attempts: 0,
      last_error: null,
      created_at: now,
      updated_at: now,
      synced_at: null,
      server: null
    };
  }

  function ensureToast() {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    var el = document.getElementById('resultQueueToast');
    if (el) return el;

    el = document.createElement('div');
    el.id = 'resultQueueToast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:16px',
      'left:auto',
      'max-width:min(380px,calc(100vw - 32px))',
      'z-index:2147483000',
      'padding:12px 14px',
      'border-radius:12px',
      'box-shadow:0 12px 34px rgba(15,23,42,.22)',
      'color:#fff',
      'background:#334155',
      'font:600 14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif',
      'display:none'
    ].join(';');
    document.body.appendChild(el);
    return el;
  }

  function hideToast() {
    var el = document.getElementById('resultQueueToast');
    if (el) el.style.display = 'none';
  }

  function showToast(kind, message, options) {
    if (!document.body) return;
    var el = ensureToast();
    var colors = {
      pending: '#b45309',
      success: '#15803d',
      error: '#b91c1c',
      info: '#334155'
    };
    el.style.background = colors[kind] || colors.info;
    el.textContent = '';

    var text = document.createElement('span');
    text.textContent = message;
    el.appendChild(text);

    if (options && options.retry) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Thử lại';
      button.style.cssText = [
        'margin-left:10px',
        'border:0',
        'border-radius:8px',
        'padding:6px 10px',
        'background:rgba(255,255,255,.2)',
        'color:#fff',
        'font:inherit',
        'cursor:pointer'
      ].join(';');
      button.onclick = function () {
        hideToast();
        flush();
      };
      el.appendChild(button);
    }

    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Đóng thông báo');
    close.style.cssText = [
      'margin-left:8px',
      'border:0',
      'background:transparent',
      'color:#fff',
      'font-size:18px',
      'line-height:1',
      'cursor:pointer'
    ].join(';');
    close.onclick = hideToast;
    el.appendChild(close);

    el.style.display = 'block';
    if (!options || options.autoHide !== false) {
      toastTimer = setTimeout(hideToast, 7000);
    }
  }

  function scheduleRetry(attempts) {
    if (retryTimer) clearTimeout(retryTimer);
    var index = Math.max(0, Math.min(attempts - 1, RETRY_DELAYS.length - 1));
    retryTimer = setTimeout(function () {
      retryTimer = null;
      flush();
    }, RETRY_DELAYS[index]);
  }

  function sendPayload(payload) {
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'same-origin',
      cache: 'no-store'
    }).then(function (response) {
      return response.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (error) {}
        return {
          status: response.status,
          ok: response.ok,
          data: data
        };
      });
    });
  }

  function isTransient(status) {
    return status === 429 || status >= 500 || status === 0;
  }

  function markSynced(entry, data) {
    var now = Date.now();
    entry.status = 'synced';
    entry.updated_at = now;
    entry.synced_at = now;
    entry.last_error = null;
    entry.server = data && data.submission ? data.submission : null;
    return putEntry(entry).then(function () {
      var score = entry.server && entry.server.score != null
        ? ' · Điểm máy chủ: ' + entry.server.score + '/' + entry.server.total_score
        : '';
      showToast('success', (data && data.duplicate
        ? 'Máy chủ đã nhận bài này trước đó'
        : 'Đã đồng bộ kết quả lên máy chủ') + score);
    }).catch(function () {
      showToast('success', 'Đã gửi kết quả lên máy chủ.');
    });
  }

  function markRejected(entry, message) {
    entry.status = 'rejected';
    entry.updated_at = Date.now();
    entry.last_error = message || 'Dữ liệu không hợp lệ';
    return putEntry(entry).then(function () {
      showToast('error', 'Không gửi được kết quả: ' + entry.last_error, { autoHide: false });
    }).catch(function () {
      showToast('error', 'Không gửi được kết quả: ' + (message || 'lỗi dữ liệu'), { autoHide: false });
    });
  }

  function markRetry(entry, message) {
    entry.status = 'pending';
    entry.attempts = (entry.attempts || 0) + 1;
    entry.updated_at = Date.now();
    entry.last_error = message || 'Lỗi mạng';
    return putEntry(entry).then(function () {
      showToast('pending', 'Chưa gửi được — đã lưu trên máy. Sẽ tự thử lại khi có mạng.', {
        retry: true,
        autoHide: false
      });
      scheduleRetry(entry.attempts);
    }).catch(function () {
      showToast('pending', 'Chưa gửi được — bài làm vẫn được giữ trên máy.', {
        retry: true,
        autoHide: false
      });
      scheduleRetry(entry.attempts);
    });
  }

  function sendEntry(entry) {
    entry.status = 'sending';
    entry.updated_at = Date.now();
    return putEntry(entry).then(function () {
      return sendPayload(entry.payload);
    }).then(function (result) {
      var data = result.data;

      if (result.ok && data && data.ok) {
        return markSynced(entry, data);
      }

      if (result.status === 409) {
        var conflict = data && data.error && data.error.message
          ? data.error.message
          : 'Mã lượt nộp đã được dùng cho dữ liệu khác.';
        return markRejected(entry, conflict);
      }

      if (result.status === 400 || result.status === 404 || result.status === 413 ||
          result.status === 415 || result.status === 401 || result.status === 403) {
        var message = data && data.error && data.error.message
          ? data.error.message
          : 'Dữ liệu không hợp lệ.';
        return markRejected(entry, message);
      }

      if (isTransient(result.status) || !result.ok) {
        var transient = data && data.error && data.error.message
          ? data.error.message
          : 'Máy chủ chưa nhận được bài.';
        return markRetry(entry, transient);
      }

      return markRetry(entry, 'Phản hồi không hợp lệ từ máy chủ.');
    }).catch(function () {
      return markRetry(entry, 'Mất kết nối mạng.');
    });
  }

  function isLeased(entry) {
    return entry.status === 'sending' && entry.updated_at &&
      (Date.now() - entry.updated_at) < SENDING_LEASE_MS;
  }

  function flush() {
    if (flushing) return Promise.resolve();
    if (navigator.onLine === false) return Promise.resolve();

    flushing = true;
    return getAllEntries().then(function (entries) {
      var queue = entries.filter(function (entry) {
        return entry && entry.status !== 'synced' && entry.status !== 'rejected' && !isLeased(entry);
      }).sort(function (a, b) {
        return (a.created_at || 0) - (b.created_at || 0);
      });

      var chain = Promise.resolve();
      queue.forEach(function (entry) {
        chain = chain.then(function () {
          return sendEntry(entry);
        });
      });
      return chain;
    }).catch(function () {
      // IndexedDB lỗi: không làm treo trang.
    }).then(function () {
      flushing = false;
    });
  }

  function cleanup() {
    var cutoff = Date.now() - SYNCED_KEEP_MS;
    return getAllEntries().then(function (entries) {
      var old = entries.filter(function (entry) {
        return entry.status === 'synced' && entry.synced_at && entry.synced_at < cutoff;
      });
      return Promise.all(old.map(function (entry) {
        return deleteEntry(entry.submission_id).catch(function () { return null; });
      }));
    }).catch(function () { return null; });
  }

  function enqueue(data) {
    var payload = buildPayload(data);
    var entry = newEntry(payload);

    return putEntry(entry).then(function () {
      showToast('pending', 'Đang gửi kết quả…', { autoHide: false });
      return sendEntry(entry);
    }).catch(function () {
      // Không dùng được IndexedDB: vẫn thử gửi trực tiếp để không mất bài.
      showToast('pending', 'Không lưu được ngoại tuyến; đang gửi trực tiếp…', { autoHide: false });
      return sendPayload(payload).then(function (result) {
        if (result.ok && result.data && result.data.ok) {
          showToast('success', 'Đã gửi kết quả lên máy chủ.');
          return result.data;
        }
        showToast('pending', 'Chưa gửi được. Bài làm vẫn còn trong lịch sử trên máy.', {
          retry: true,
          autoHide: false
        });
        return null;
      }).catch(function () {
        showToast('pending', 'Chưa gửi được. Bài làm vẫn còn trong lịch sử trên máy.', {
          retry: true,
          autoHide: false
        });
        return null;
      });
    }).then(function (value) {
      return value == null ? null : value;
    }).catch(function () {
      return null;
    });
  }

  window.ExamResultQueue = {
    enqueue: enqueue,
    flush: flush
  };

  window.addEventListener('online', function () { flush(); });
  window.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') flush();
  });
  setInterval(function () { flush(); }, 5 * 60 * 1000);

  function start() {
    cleanup();
    // Đợi một nhịp để không cạnh tranh với việc render trang.
    setTimeout(function () { flush(); }, 1200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
