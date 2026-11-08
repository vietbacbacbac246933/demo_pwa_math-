'use strict';

(function () {
  var state = {
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 0,
    exams: []
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

  async function loadResults() {
    setStatus('Đang tải kết quả…');
    try {
      var data = await api('/api/results?' + buildQuery(true));
      state.total = Number(data.total) || 0;
      state.totalPages = Number(data.total_pages) || 0;

      if (state.totalPages && state.page > state.totalPages) {
        state.page = state.totalPages;
        return loadResults();
      }

      renderRows(data.items || []);
      renderPager();
      setStatus('');
    } catch (error) {
      if (error.status === 401) {
        showLogin();
        return;
      }
      setStatus(error.message || 'Không tải được kết quả.', true);
    }
  }

  async function loadAllAfterLogin() {
    try {
      await loadExams();
      showDashboard();
      await loadResults();
    } catch (error) {
      if (error.status === 401) {
        showLogin();
      } else {
        showDashboard();
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
    }
  }

  async function onLogout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch (error) {
      // Dù lỗi mạng, vẫn đưa người dùng về màn hình đăng nhập.
    }
    while (els.resultsBody.firstChild) els.resultsBody.removeChild(els.resultsBody.firstChild);
    els.emptyResults.hidden = false;
    state.total = 0;
    state.totalPages = 0;
    renderPager();
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

  function resetFilters() {
    els.examFilter.value = '';
    els.classFilter.value = '';
    els.nameFilter.value = '';
    els.sortFilter.value = 'submitted_at';
    els.orderFilter.value = 'desc';
    state.page = 1;
    loadResults();
  }

  function onFilterChange() {
    state.page = 1;
    loadResults();
  }

  async function boot() {
    try {
      // Kiểm tra phiên đăng nhập trước khi hiện bảng điều khiển.
      await api('/api/results?page=1&page_size=1');
      await loadExams();
      showDashboard();
      await loadResults();
    } catch (error) {
      if (error.status === 401) {
        showLogin();
      } else {
        showDashboard();
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

    els.loginForm.addEventListener('submit', onLogin);
    els.logoutBtn.addEventListener('click', onLogout);
    els.exportBtn.addEventListener('click', onExport);
    els.resetFilters.addEventListener('click', resetFilters);

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

    boot();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
