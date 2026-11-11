'use strict';

(function () {
  var AUTO_REFRESH_MS = 10000;

  var state = {
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 0,
    exams: [],
    lastBatch: null,
    loading: false,
    requestSeq: 0,
    lastSignature: '',
    autoTimer: null
  };

  var els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(text, isError) {
    if (!els.dashboardStatus) return;
    els.dashboardStatus.textContent = text || '';
    els.dashboardStatus.style.color = isError ? '#b91c1c' : '';
  }

  function showLogin() {
    stopAutoRefresh();
    els.bootStatus.hidden = true;
    els.dashboard.hidden = true;
    els.loginPanel.hidden = false;
    els.loginError.hidden = true;
    setTimeout(function () {
      if (els.password) els.password.focus();
    }, 50);
  }

  function showDashboard() {
    els.bootStatus.hidden = true;
    els.loginPanel.hidden = true;
    els.dashboard.hidden = false;
  }

  async function api(path, options) {
    var config = Object.assign({
      credentials: 'same-origin',
      cache: 'no-store'
    }, options || {});

    var response = await fetch(path, config);
    var text = '';
    var data = null;
    try { text = await response.text(); } catch (error) {}
    try { data = text ? JSON.parse(text) : null; } catch (error) {}

    if (response.status === 401) {
      var unauthorized = new Error(
        data && data.error && data.error.message ? data.error.message : 'Cần đăng nhập giáo viên.'
      );
      unauthorized.status = 401;
      throw unauthorized;
    }

    if (!response.ok || !data || data.ok !== true) {
      var message = data && data.error && data.error.message
        ? data.error.message
        : 'Máy chủ trả về lỗi (' + response.status + ').';
      var error = new Error(message);
      error.status = response.status;
      throw error;
    }

    return data;
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(null, args);
      }, wait);
    };
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function formatScore(value) {
    var n = Number(value);
    if (!isFinite(n)) return String(value == null ? '' : value);
    return String(n).replace('.', ',');
  }

  function formatDuration(value) {
    var total = Math.max(0, Math.round(Number(value) || 0));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    return (h ? h + ':' : '') + pad(m) + ':' + pad(s);
  }

  function formatDate(value) {
    var date = new Date(value);
    if (!value || isNaN(date.getTime())) return value || '';
    return date.toLocaleString('vi-VN', { hour12: false });
  }

  function hasActiveFilters() {
    return Boolean(
      els.examFilter.value ||
      els.classFilter.value.trim() ||
      els.nameFilter.value.trim()
    );
  }

  function renderCount() {
    if (els.countLabel) {
      var label = hasActiveFilters()
        ? 'Kết quả theo bộ lọc:'
        : 'Đã nộp:';
      if (els.countLabel.textContent !== label) {
        els.countLabel.textContent = label;
      }
    }
    if (els.submissionTotal) {
      var total = String(state.total);
      if (els.submissionTotal.textContent !== total) {
        els.submissionTotal.textContent = total;
      }
    }
  }

  function markUpdated() {
    if (!els.refreshNote) return;
    els.refreshNote.textContent = 'Cập nhật lúc ' +
      new Date().toLocaleTimeString('vi-VN', { hour12: false }) +
      ' · tự động mỗi 10 giây';
  }

  function resultsSignature(data) {
    try {
      return JSON.stringify([state.page, data.total, data.items || []]);
    } catch (error) {
      return '';
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    state.autoTimer = setInterval(function () {
      // Không tải khi tab bị ẩn hoặc đang có request khác.
      if (document.hidden) return;
      if (!els.dashboard || els.dashboard.hidden) return;
      if (state.loading) return;
      loadResults({ silent: true });
    }, AUTO_REFRESH_MS);
  }

  function stopAutoRefresh() {
    if (state.autoTimer) {
      clearInterval(state.autoTimer);
      state.autoTimer = null;
    }
  }

  function currentFilters() {
    return {
      exam: els.examFilter.value,
      className: els.classFilter.value.trim(),
      search: els.nameFilter.value.trim(),
      sort: els.sortFilter.value,
      order: els.orderFilter.value
    };
  }

  function buildQuery(includePage) {
    var filters = currentFilters();
    var params = new URLSearchParams();
    if (filters.exam) params.set('exam_id', filters.exam);
    if (filters.className) params.set('class', filters.className);
    if (filters.search) params.set('q', filters.search);
    params.set('sort', filters.sort);
    params.set('order', filters.order);
    if (includePage) {
      params.set('page', state.page);
      params.set('page_size', state.pageSize);
    }
    return params.toString();
  }

  function renderRows(items) {
    var body = els.resultsBody;
    while (body.firstChild) body.removeChild(body.firstChild);

    els.emptyResults.hidden = items.length > 0;

    items.forEach(function (item, index) {
      var tr = document.createElement('tr');

      function cell(text, className) {
        var td = document.createElement('td');
        td.textContent = text == null ? '' : String(text);
        if (className) td.className = className;
        tr.appendChild(td);
        return td;
      }

      cell((state.page - 1) * state.pageSize + index + 1);
      cell(item.student_name);
      cell(item.student_class);
      cell(item.exam_title);
      cell(formatScore(item.score) + ' / ' + formatScore(item.total_score), 'num');
      cell(formatDuration(item.duration_seconds), 'num');
      cell(formatDate(item.submitted_at));
      cell((item.exam_mode === 'exam' ? 'Thi' : 'Ôn tập') + (item.timed_out ? ' · hết giờ' : ''));

      var actions = document.createElement('td');
      actions.className = 'row-actions';
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn ghost small danger-text';
      remove.textContent = 'Xóa';
      remove.setAttribute('aria-label', 'Xóa kết quả của ' + (item.student_name || 'học sinh'));
      remove.addEventListener('click', function () {
        deleteOne(item);
      });
      actions.appendChild(remove);
      tr.appendChild(actions);

      body.appendChild(tr);
    });
  }

  function renderPager() {
    els.pageInfo.textContent = state.total
      ? 'Trang ' + state.page + ' / ' + state.totalPages + ' · ' + state.total + ' kết quả'
      : '0 kết quả';
    els.prevPage.disabled = state.page <= 1;
    els.nextPage.disabled = !state.totalPages || state.page >= state.totalPages;
  }

  async function loadExams() {
    var data = await api('/api/exams');
    state.exams = data.exams || [];

    var select = els.examFilter;
    var current = select.value;
    while (select.firstChild) select.removeChild(select.firstChild);

    var all = document.createElement('option');
    all.value = '';
    all.textContent = 'Tất cả đề';
    select.appendChild(all);

    state.exams.forEach(function (exam) {
      var option = document.createElement('option');
      option.value = exam.id;
      option.textContent = (exam.subject_name ? exam.subject_name + ' · ' : '') + exam.title;
      select.appendChild(option);
    });

    var exists = state.exams.some(function (exam) { return exam.id === current; });
    select.value = exists ? current : '';
  }

  async function loadResults(options) {
    var silent = Boolean(options && options.silent);
    var seq = state.requestSeq + 1;
    state.requestSeq = seq;
    state.loading = true;

    if (!silent) setStatus('Đang tải kết quả…');

    try {
      var data = await api('/api/results?' + buildQuery(true));
      if (seq !== state.requestSeq) return;

      state.total = Number(data.total) || 0;
      state.totalPages = Number(data.total_pages) || 0;

      if (state.totalPages && state.page > state.totalPages) {
        state.page = state.totalPages;
        return loadResults(options);
      }

      // Lần tự cập nhật không đổi dữ liệu: chỉ cập nhật đồng hồ, không dựng
      // lại bảng để tránh nhấp nháy và tránh xô dòng khi giáo viên đang xem.
      var signature = resultsSignature(data);
      if (!silent || signature !== state.lastSignature) {
        renderRows(data.items || []);
        renderPager();
        state.lastSignature = signature;
      }
      renderCount();
      markUpdated();
      if (!silent) setStatus('');
    } catch (error) {
      if (seq !== state.requestSeq) return;
      if (error.status === 401) {
        showLogin();
        return;
      }
      if (silent) {
        if (els.refreshNote) {
          els.refreshNote.textContent = 'Chưa cập nhật được · thử lại sau 10 giây';
        }
      } else {
        setStatus(error.message || 'Không tải được kết quả.', true);
      }
    } finally {
      if (seq === state.requestSeq) state.loading = false;
    }
  }

  async function loadAllAfterLogin() {
    try {
      await loadExams();
      updateDeleteScope();
      showDashboard();
      startAutoRefresh();
      await loadResults();
    } catch (error) {
      if (error.status === 401) {
        showLogin();
      } else {
        showDashboard();
        startAutoRefresh();
        setStatus(error.message || 'Không tải được dữ liệu.', true);
      }
    }
  }

  async function onLogin(event) {
    event.preventDefault();
    els.loginError.hidden = true;
    var password = els.password.value;
    if (!password) {
      els.loginError.textContent = 'Vui lòng nhập mật khẩu.';
      els.loginError.hidden = false;
      return;
    }

    try {
      await api('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password })
      });
      els.password.value = '';
      await loadAllAfterLogin();
    } catch (error) {
      els.loginError.textContent = error.message || 'Đăng nhập không thành công.';
      els.loginError.hidden = false;
      // Chọn sẵn nội dung để lần sau gõ là thay hết, tránh dính ký tự thừa.
      try {
        els.password.select();
        els.password.focus();
      } catch (selectError) {
        // Một số trình duyệt di động không cho select(); bỏ qua.
      }
    }
  }

  async function onLogout() {
    stopAutoRefresh();
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch (error) {
      // Dù lỗi mạng, vẫn đưa người dùng về màn hình đăng nhập.
    }
    while (els.resultsBody.firstChild) els.resultsBody.removeChild(els.resultsBody.firstChild);
    els.emptyResults.hidden = false;
    state.total = 0;
    state.totalPages = 0;
    state.lastBatch = null;
    state.lastSignature = '';
    els.undoBar.hidden = true;
    els.deleteConfirm.value = '';
    els.deletePreview.textContent = '';
    renderPager();
    renderCount();
    showLogin();
  }

  async function onExport() {
    var url = '/api/results/export?' + buildQuery(false);
    setStatus('Đang chuẩn bị file xuất…');
    try {
      var response = await fetch(url, {
        credentials: 'same-origin',
        cache: 'no-store'
      });

      if (response.status === 401) {
        showLogin();
        return;
      }

      if (!response.ok) {
        var message = 'Không xuất được dữ liệu.';
        try {
          var data = await response.json();
          if (data && data.error && data.error.message) message = data.error.message;
        } catch (error) {}
        throw new Error(message);
      }

      var blob = await response.blob();
      var disposition = response.headers.get('Content-Disposition') || '';
      var match = /filename="([^"]+)"/i.exec(disposition);
      var filename = match ? match[1] : 'ket-qua.csv';

      var link = document.createElement('a');
      var objectUrl = URL.createObjectURL(blob);
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 1500);
      setStatus('Đã xuất ' + filename);
    } catch (error) {
      setStatus(error.message || 'Không xuất được dữ liệu.', true);
    }
  }

  function deleteScope() {
    return {
      exam_id: els.examFilter.value,
      student_class: els.classFilter.value.trim()
    };
  }

  function deletePhrase(scope) {
    return scope.exam_id || scope.student_class ? 'XOA' : 'XOA TAT CA';
  }

  function updateDeleteScope() {
    if (!els.deleteScopeLabel) return;
    var scope = deleteScope();
    var parts = [];

    if (scope.exam_id) {
      var exam = state.exams.filter(function (item) {
        return item.id === scope.exam_id;
      })[0];
      parts.push(exam ? exam.title : 'đề ' + scope.exam_id);
    }
    if (scope.student_class) parts.push('lớp ' + scope.student_class);

    els.deleteScopeLabel.textContent = parts.length ? parts.join(' · ') : 'Tất cả kết quả';
    els.deletePhraseHint.textContent = deletePhrase(scope);
  }

  function deleteRequest(mode, extra) {
    var body = Object.assign({ mode: mode }, extra || {});
    return api('/api/results/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  function showUndo(count, token) {
    state.lastBatch = token;
    els.undoText.textContent = 'Đã xóa ' + count + ' kết quả (có thể hoàn tác).';
    els.undoBtn.disabled = false;
    els.undoBar.hidden = false;
  }

  function deleteFailed(error, target) {
    if (error.status === 401) {
      showLogin();
      return;
    }
    target.style.color = '#b91c1c';
    target.textContent = error.message || 'Không xóa được dữ liệu.';
  }

  async function deleteOne(item) {
    var label = item.student_name || 'học sinh';
    if (!window.confirm('Xóa kết quả của "' + label + '"?\nDữ liệu sẽ được lưu vào bảng lưu trữ.')) {
      return;
    }

    try {
      setStatus('Đang xóa…');
      var result = await deleteRequest('one', { submission_id: item.submission_id });
      setStatus('Đã xóa 1 kết quả.');
      if (result.batch_token) showUndo(result.deleted, result.batch_token);
      await loadResults();
    } catch (error) {
      if (error.status === 401) {
        showLogin();
        return;
      }
      setStatus(error.message || 'Không xóa được kết quả.', true);
    }
  }

  async function previewDelete() {
    var scope = deleteScope();
    var mode = scope.exam_id || scope.student_class ? 'filter' : 'all';

    els.deletePreview.style.color = '';
    els.deletePreview.textContent = 'Đang kiểm tra…';
    try {
      var data = await deleteRequest(mode, Object.assign({ preview: true }, scope));
      var count = Number(data.count) || 0;
      if (!count) {
        els.deletePreview.textContent = 'Không có kết quả nào trong phạm vi này.';
      } else if (data.too_many) {
        els.deletePreview.textContent = 'Có ' + count + ' kết quả, vượt giới hạn ' +
          data.limit + ' mỗi lần. Hãy chọn đề hoặc lớp cụ thể.';
      } else {
        els.deletePreview.textContent = 'Sẽ xóa ' + count + ' kết quả.';
      }
    } catch (error) {
      deleteFailed(error, els.deletePreview);
    }
  }

  async function deleteByScope() {
    var scope = deleteScope();
    var phrase = deletePhrase(scope);
    var mode = scope.exam_id || scope.student_class ? 'filter' : 'all';

    if (els.deleteConfirm.value.trim() !== phrase) {
      els.deletePreview.style.color = '#b91c1c';
      els.deletePreview.textContent = 'Gõ đúng "' + phrase + '" để xác nhận.';
      return;
    }

    els.deletePreview.style.color = '';
    els.deletePreview.textContent = 'Đang kiểm tra…';
    try {
      var preview = await deleteRequest(mode, Object.assign({ preview: true }, scope));
      var count = Number(preview.count) || 0;
      if (!count) {
        els.deletePreview.textContent = 'Không có kết quả nào trong phạm vi này.';
        return;
      }
      if (preview.too_many) {
        els.deletePreview.textContent = 'Có ' + count + ' kết quả, vượt giới hạn ' +
          preview.limit + ' mỗi lần. Hãy chọn đề hoặc lớp cụ thể.';
        return;
      }
      if (!window.confirm('Xóa ' + count + ' kết quả? Dữ liệu sẽ được lưu vào bảng lưu trữ.')) {
        return;
      }

      els.deletePreview.textContent = 'Đang xóa…';
      var result = await deleteRequest(mode, Object.assign({ confirm: phrase }, scope));
      els.deletePreview.textContent = 'Đã xóa ' + result.deleted + ' kết quả.';
      if (result.batch_token) showUndo(result.deleted, result.batch_token);
      els.deleteConfirm.value = '';
      state.page = 1;
      await loadResults();
    } catch (error) {
      deleteFailed(error, els.deletePreview);
    }
  }

  async function undoDelete() {
    if (!state.lastBatch) return;
    try {
      els.undoText.textContent = 'Đang khôi phục…';
      var result = await deleteRequest('restore', { batch_token: state.lastBatch });
      els.undoText.textContent = 'Đã khôi phục ' + result.restored + ' kết quả.';
      els.undoBtn.disabled = true;
      state.lastBatch = null;
      state.page = 1;
      await loadResults();
    } catch (error) {
      els.undoText.textContent = error.message || 'Không khôi phục được.';
    }
  }

  function resetFilters() {
    els.examFilter.value = '';
    els.classFilter.value = '';
    els.nameFilter.value = '';
    els.sortFilter.value = 'submitted_at';
    els.orderFilter.value = 'desc';
    state.page = 1;
    updateDeleteScope();
    loadResults();
  }

  function onFilterChange() {
    state.page = 1;
    updateDeleteScope();
    loadResults();
  }

  async function boot() {
    try {
      // Kiểm tra phiên đăng nhập trước khi hiện bảng điều khiển.
      await api('/api/results?page=1&page_size=1');
      await loadExams();
      updateDeleteScope();
      showDashboard();
      startAutoRefresh();
      await loadResults();
    } catch (error) {
      if (error.status === 401) {
        showLogin();
      } else {
        showDashboard();
        startAutoRefresh();
        setStatus(error.message || 'Không tải được dữ liệu.', true);
      }
    }
  }

  function init() {
    els.bootStatus = $('bootStatus');
    els.loginPanel = $('loginPanel');
    els.dashboard = $('dashboard');
    els.loginForm = $('loginForm');
    els.password = $('password');
    els.showPassword = $('showPassword');
    els.loginError = $('loginError');
    els.examFilter = $('examFilter');
    els.classFilter = $('classFilter');
    els.nameFilter = $('nameFilter');
    els.sortFilter = $('sortFilter');
    els.orderFilter = $('orderFilter');
    els.resetFilters = $('resetFilters');
    els.exportBtn = $('exportBtn');
    els.logoutBtn = $('logoutBtn');
    els.dashboardStatus = $('dashboardStatus');
    els.resultsBody = $('resultsBody');
    els.emptyResults = $('emptyResults');
    els.prevPage = $('prevPage');
    els.nextPage = $('nextPage');
    els.pageInfo = $('pageInfo');
    els.deleteScopeLabel = $('deleteScopeLabel');
    els.deletePhraseHint = $('deletePhraseHint');
    els.deleteConfirm = $('deleteConfirm');
    els.previewDeleteBtn = $('previewDeleteBtn');
    els.deleteFilterBtn = $('deleteFilterBtn');
    els.deletePreview = $('deletePreview');
    els.undoBar = $('undoBar');
    els.undoText = $('undoText');
    els.undoBtn = $('undoBtn');

    els.loginForm.addEventListener('submit', onLogin);
    els.logoutBtn.addEventListener('click', onLogout);
    els.exportBtn.addEventListener('click', onExport);
    els.showPassword.addEventListener('change', function () {
      els.password.type = els.showPassword.checked ? 'text' : 'password';
    });
    els.resetFilters.addEventListener('click', resetFilters);
    els.previewDeleteBtn.addEventListener('click', previewDelete);
    els.deleteFilterBtn.addEventListener('click', deleteByScope);
    els.undoBtn.addEventListener('click', undoDelete);

    els.examFilter.addEventListener('change', onFilterChange);
    els.sortFilter.addEventListener('change', onFilterChange);
    els.orderFilter.addEventListener('change', onFilterChange);
    els.classFilter.addEventListener('input', debounce(onFilterChange, 350));
    els.nameFilter.addEventListener('input', debounce(onFilterChange, 350));

    els.prevPage.addEventListener('click', function () {
      if (state.page > 1) {
        state.page -= 1;
        loadResults();
      }
    });
    els.nextPage.addEventListener('click', function () {
      if (state.page < state.totalPages) {
        state.page += 1;
        loadResults();
      }
    });

    // Quay lại tab sau khi bị ẩn: cập nhật ngay thay vì chờ hết chu kỳ 10 giây.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      if (!els.dashboard || els.dashboard.hidden) return;
      if (state.loading) return;
      loadResults({ silent: true });
    });

    boot();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
