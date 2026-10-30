/* ==================================================================
   Trang chủ thư viện đề thi
   - Đọc danh mục từ assets/js/catalog.js
   - Tìm kiếm / lọc theo môn
   - Đăng ký Service Worker ở thư mục gốc
   ================================================================== */
(function () {
  'use strict';

  var LIB = window.EXAM_LIBRARY || { subjects: [] };
  var SUBJECTS = Array.isArray(LIB.subjects) ? LIB.subjects : [];
  var ACCENTS = {
    toan: { color: '#4338ca', soft: '#eef0ff' },
    van: { color: '#b45309', soft: '#fff6e5' },
    anh: { color: '#0f766e', soft: '#e6f7f4' }
  };

  var state = { query: '', subject: 'all' };
  var els = {
    title: document.getElementById('library-title'),
    subtitle: document.getElementById('library-subtitle'),
    stats: document.getElementById('stats'),
    search: document.getElementById('search'),
    clear: document.getElementById('clearSearch'),
    filters: document.getElementById('filters'),
    library: document.getElementById('library'),
    empty: document.getElementById('empty'),
    resultCount: document.getElementById('resultCount'),
    reset: document.getElementById('resetFilters'),
    offline: document.getElementById('offline-note'),
    footerTitle: document.getElementById('footer-title'),
    footerUpdated: document.getElementById('footer-updated')
  };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Bỏ dấu tiếng Việt để gõ "de toan" vẫn tìm được "Đề Toán".
  function normalize(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd');
  }

  function examsOf(subject) {
    return Array.isArray(subject.exams) ? subject.exams : [];
  }

  function accentOf(subject) {
    return ACCENTS[subject.id] || ACCENTS.toan;
  }

  function examUrl(exam) {
    return encodeURI(String(exam.file || ''));
  }

  function formatDate(value) {
    if (!value) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
    return m ? m[3] + '/' + m[2] + '/' + m[1] : String(value);
  }

  function matches(exam, subject, query) {
    if (!query) return true;
    var haystack = normalize([
      exam.title, exam.description, subject.name, subject.description,
      (exam.tags || []).join(' '), exam.id
    ].join(' '));
    return query.split(/\s+/).every(function (word) {
      return haystack.indexOf(word) >= 0;
    });
  }

  function renderStats() {
    var totalExams = 0;
    var totalQuestions = 0;
    SUBJECTS.forEach(function (s) {
      examsOf(s).forEach(function (ex) {
        totalExams++;
        totalQuestions += Number(ex.questions) || 0;
      });
    });
    els.stats.innerHTML =
      stat('Môn học', SUBJECTS.length) +
      stat('Đề thi', totalExams) +
      stat('Câu hỏi', totalQuestions);
  }

  function stat(label, value) {
    return '<div class="stat"><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>';
  }

  function renderFilters() {
    var html = filterButton('all', 'Tất cả', SUBJECTS.reduce(function (n, s) {
      return n + examsOf(s).length;
    }, 0));
    SUBJECTS.forEach(function (s) {
      html += filterButton(s.id, s.name, examsOf(s).length);
    });
    els.filters.innerHTML = html;
  }

  function filterButton(id, label, count) {
    return '<button type="button" class="filter" data-subject="' + esc(id) + '"' +
      ' aria-pressed="' + (state.subject === id ? 'true' : 'false') + '">' +
      esc(label) + ' <span class="n">' + count + '</span></button>';
  }

  function examCard(exam, subject) {
    var mode = exam.mode === 'exam' ? 'exam' : 'practice';
    var modeText = mode === 'exam' ? 'Bài thi' : 'Ôn tập';
    var meta = [];
    if (exam.questions) meta.push(exam.questions + ' câu');
    if (exam.points) meta.push(exam.points + ' điểm');
    meta.push(exam.minutes > 0 ? exam.minutes + ' phút' : 'Không giới hạn thời gian');

    return '<a class="exam-card" href="' + esc(examUrl(exam)) + '">' +
      '<div class="exam-top">' +
        '<span class="exam-subject">' + esc(subject.name) + '</span>' +
        '<span class="exam-mode ' + mode + '">' + modeText + '</span>' +
      '</div>' +
      '<h3 class="exam-title">' + esc(exam.title) + '</h3>' +
      (exam.description ? '<p class="exam-desc">' + esc(exam.description) + '</p>' : '') +
      '<div class="exam-meta">' +
        meta.map(function (m) { return '<span class="chip">' + esc(m) + '</span>'; }).join('') +
      '</div>' +
      '<span class="exam-open">Làm bài <span class="arrow" aria-hidden="true">→</span></span>' +
    '</a>';
  }

  function render() {
    var query = normalize(state.query.trim()).replace(/\s+/g, ' ').trim();
    var visible = 0;
    var sections = 0;
    var html = '';

    SUBJECTS.forEach(function (subject) {
      var accent = accentOf(subject);
      var exams = examsOf(subject).filter(function (exam) {
        return matches(exam, subject, query);
      });
      if (state.subject !== 'all' && state.subject !== subject.id) return;
      if (query && !exams.length) return;

      visible += exams.length;
      sections++;
      html += '<section class="subject" id="subject-' + esc(subject.id) + '"' +
        ' style="--accent:' + esc(accent.color) + ';--accent-soft:' + esc(accent.soft) + '">' +
        '<div class="subject-head">' +
          '<span class="subject-icon" aria-hidden="true">' + esc(subject.icon || '•') + '</span>' +
          '<div>' +
            '<h2 class="subject-title">' + esc(subject.name) +
              ' <span class="subject-count">' + examsOf(subject).length + ' đề</span>' +
            '</h2>' +
            (subject.description ? '<p class="subject-desc">' + esc(subject.description) + '</p>' : '') +
          '</div>' +
        '</div>' +
        (exams.length
          ? '<div class="exam-grid">' + exams.map(function (exam) {
              return examCard(exam, subject);
            }).join('') + '</div>'
          : '<div class="subject-empty"><b>Chưa có đề trong môn này.</b> ' +
              'Đề mới sẽ xuất hiện tại đây sau khi được thêm vào danh mục.</div>') +
      '</section>';
    });

    els.library.innerHTML = html;
    els.empty.hidden = sections > 0;

    var subjectName = '';
    if (state.subject !== 'all') {
      SUBJECTS.forEach(function (s) { if (s.id === state.subject) subjectName = s.name; });
    }
    els.resultCount.textContent = SUBJECTS.length
      ? 'Hiển thị ' + visible + ' đề' +
        (subjectName ? ' · ' + subjectName : '') +
        (query ? ' · từ khóa “' + state.query.trim() + '”' : '')
      : 'Chưa có danh mục đề.';
    els.clear.hidden = !state.query;

    Array.prototype.forEach.call(els.filters.querySelectorAll('.filter'), function (btn) {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-subject') === state.subject ? 'true' : 'false');
    });
  }

  function resetFilters() {
    state.query = '';
    state.subject = 'all';
    els.search.value = '';
    render();
    els.search.focus();
  }

  // ---------------- Sự kiện ----------------
  els.search.addEventListener('input', function () {
    state.query = els.search.value;
    render();
  });
  els.search.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') resetFilters();
  });
  els.clear.addEventListener('click', function () {
    state.query = '';
    els.search.value = '';
    render();
    els.search.focus();
  });
  els.filters.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.filter') : null;
    if (!btn) return;
    state.subject = btn.getAttribute('data-subject') || 'all';
    render();
  });
  els.reset.addEventListener('click', resetFilters);

  // ---------------- Khởi tạo nội dung ----------------
  if (LIB.title) {
    els.title.textContent = LIB.title;
    document.title = LIB.title;
    els.footerTitle.textContent = LIB.title;
  }
  if (LIB.subtitle) els.subtitle.textContent = LIB.subtitle;
  if (LIB.updatedAt) {
    els.footerUpdated.textContent = 'Cập nhật ' + formatDate(LIB.updatedAt);
  }
  renderStats();
  renderFilters();
  render();

  // ---------------- PWA / ngoại tuyến ----------------
  function setOfflineStatus(message, status) {
    if (!els.offline) return;
    els.offline.textContent = message;
    els.offline.setAttribute('data-state', status || '');
  }

  function initServiceWorker() {
    var toast = document.getElementById('updateToast');
    var updateBtn = document.getElementById('updateBtn');
    var reloading = false;

    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      setOfflineStatus('Đang mở trực tiếp từ file. Hãy đưa website lên GitHub Pages (HTTPS) để bật chế độ ngoại tuyến.', 'limited');
      return;
    }
    if (!('serviceWorker' in navigator)) {
      setOfflineStatus('Trình duyệt này không hỗ trợ lưu ngoại tuyến. Hãy dùng Safari hoặc Chrome phiên bản mới.', 'limited');
      return;
    }

    function offerUpdate(registration) {
      if (!toast || !registration) return;
      toast.hidden = false;
      if (updateBtn) {
        updateBtn.onclick = function () {
          reloading = true;
          if (registration.waiting) {
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
            setTimeout(function () { if (reloading) location.reload(); }, 2500);
          } else {
            location.reload();
          }
        };
      }
    }

    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (reloading) { location.reload(); return; }
      setOfflineStatus('Chế độ ngoại tuyến đã sẵn sàng. Bạn có thể mở lại thư viện khi mất mạng.', 'ready');
    });

    navigator.serviceWorker.register('sw.js').then(function (registration) {
      setOfflineStatus('Đang lưu bản dùng ngoại tuyến. Giữ trang mở thêm vài giây rồi tải lại một lần.', 'limited');
      if (registration.waiting && navigator.serviceWorker.controller) offerUpdate(registration);

      registration.addEventListener('updatefound', function () {
        var worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', function () {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            offerUpdate(registration);
          }
        });
      });

      window.setTimeout(function () {
        if (navigator.serviceWorker.controller) {
          setOfflineStatus('Chế độ ngoại tuyến đã sẵn sàng. Bạn có thể mở lại thư viện và các đề đã tải khi mất mạng.', 'ready');
        } else {
          setOfflineStatus('Đang lưu bản dùng ngoại tuyến. Hãy mở lại trang một lần khi còn mạng để hoàn tất.', 'limited');
        }
      }, 2500);
    }).catch(function () {
      setOfflineStatus('Chưa bật được chế độ ngoại tuyến trong trình duyệt này. Hãy mở bằng Safari hoặc Chrome.', 'limited');
    });

    window.addEventListener('online', function () {
      setOfflineStatus('Đã có kết nối mạng. Lịch sử làm bài vẫn được lưu trên thiết bị này.', 'ready');
    });
    window.addEventListener('offline', function () {
      setOfflineStatus('Bạn đang ngoại tuyến. Các đề đã lưu trước đó vẫn mở được.', 'ready');
    });
  }

  initServiceWorker();
})();
