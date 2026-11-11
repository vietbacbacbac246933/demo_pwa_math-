#!/usr/bin/env node
/*
 * Kiểm thử API trên môi trường local (wrangler pages dev + D1 local).
 *
 *   $env:TEST_TEACHER_PASSWORD = "..."    # PowerShell
 *   node _system/tools/test-api.js
 *
 * Biến môi trường:
 *   TEST_BASE_URL            mặc định http://127.0.0.1:8788
 *   TEST_TEACHER_PASSWORD    bắt buộc để chạy nhóm kiểm thử giáo viên
 *
 * Chỉ ghi vào D1 local. Mọi bản ghi dùng lớp riêng của lần chạy để lọc/xuất.
 * Không in mật khẩu, cookie hay nội dung bài làm.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = (process.env.TEST_BASE_URL || 'http://127.0.0.1:8788').replace(/\/+$/, '');
const PASSWORD = process.env.TEST_TEACHER_PASSWORD || '';
const ROOT = path.resolve(__dirname, '..', '..');
const IS_LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(new URL(BASE).hostname);

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log('  ok   ' + name);
  } else {
    failed += 1;
    failures.push(name + (detail ? ' — ' + detail : ''));
    console.log('  FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

function section(name) {
  console.log('\n== ' + name + ' ==');
}

function loadExamData() {
  const file = path.join(ROOT, 'functions', '_lib', 'exam-data.js');
  let source = fs.readFileSync(file, 'utf8');
  source = source
    .replace(/export const EXAMS =/, 'const EXAMS =')
    .replace(/export const EXAM_LIST =/, 'const EXAM_LIST =');
  // eslint-disable-next-line no-new-func
  return new Function(source + '\nreturn { EXAMS: EXAMS, EXAM_LIST: EXAM_LIST };')();
}

const { EXAMS, EXAM_LIST } = loadExamData();

function uuid() {
  return crypto.randomUUID();
}

async function request(pathname, options) {
  const config = Object.assign({ method: 'GET', headers: {} }, options || {});
  if (config.body && !config.headers['Content-Type']) {
    config.headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(BASE + pathname, config);
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (error) {}
  const cookieHeader = response.headers.get('set-cookie') || '';
  const cookie = cookieHeader ? cookieHeader.split(';')[0] : '';
  return {
    status: response.status,
    headers: response.headers,
    text: text,
    json: json,
    cookie: cookie,
    cookieHeader: cookieHeader
  };
}

function submitBody(examId, answers, extra) {
  return Object.assign({
    submission_id: uuid(),
    exam_id: examId,
    student_name: 'Học sinh kiểm thử',
    student_class: 'TEST',
    answers: answers || {},
    duration_seconds: 600,
    timed_out: false
  }, extra || {});
}

function correctAnswers(exam) {
  const answers = {};
  exam.questions.forEach(function (q, index) {
    if (q.type === 'single') answers[index] = q.correct;
    else if (q.type === 'multi') answers[index] = q.correctList.slice();
    else if (q.type === 'truefalse') answers[index] = q.correctTF.slice();
    else if (q.type === 'shortanswer') answers[index] = q.correctAnswer;
  });
  return answers;
}

function mixedAnswers(exam, seed) {
  const answers = {};
  exam.questions.forEach(function (q, index) {
    const pick = (seed + index) % 4;
    if (q.type === 'single') {
      answers[index] = pick === 0 ? q.correct : (q.correct + 1 + pick) % q.options;
    } else if (q.type === 'multi') {
      answers[index] = pick === 0 ? q.correctList.slice() : [0].filter(function (v) {
        return v < q.options;
      });
    } else if (q.type === 'truefalse') {
      answers[index] = pick === 0
        ? q.correctTF.slice()
        : q.correctTF.map(function (v) { return !v; });
    } else if (q.type === 'shortanswer') {
      answers[index] = pick === 0 ? q.correctAnswer : '999999';
    }
  });
  return answers;
}

function csvRows(text) {
  const body = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\r') { /* skip */ }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function main() {
  console.log('API test: ' + BASE);
  if (!IS_LOCAL) {
    console.log('CẢNH BÁO: test-api chỉ dành cho dev server local. Trên production,');
    console.log('Cloudflare tự đặt CF-Connecting-IP nên không giả lập được IP để test rate limit.');
  }
  const runId = 'T' + Date.now().toString(36).toUpperCase();
  const bulkClass = ('B' + runId).slice(0, 20);
  const exam = EXAMS[EXAM_LIST[0].id];
  const examId = exam.id;

  /* ---------------------------------------------------------------- */
  section('Health & dữ liệu công khai');

  const health = await request('/api/health');
  check('GET /api/health trả 200', health.status === 200, 'status=' + health.status);
  check('health báo DB sẵn sàng', !!health.json && health.json.ok === true && health.json.db === 'ok' && health.json.schema === 'ready');

  const exams = await request('/api/exams');
  check('GET /api/exams công khai trả 200', exams.status === 200, 'status=' + exams.status);
  check('có đủ ' + EXAM_LIST.length + ' đề',
    !!exams.json && Array.isArray(exams.json.exams) && exams.json.exams.length === EXAM_LIST.length,
    'count=' + (exams.json && exams.json.exams ? exams.json.exams.length : '?'));
  check('không lộ đáp án qua /api/exams', exams.text.indexOf('"correct"') < 0 && exams.text.indexOf('correctList') < 0);
  check('không lộ danh sách câu hỏi', exams.text.indexOf('"questions"') < 0);

  /* ---------------------------------------------------------------- */
  section('Kiểm tra dữ liệu nộp không hợp lệ');

  const empty = await request('/api/submit', { method: 'POST', body: JSON.stringify({}) });
  check('body rỗng bị từ chối 400', empty.status === 400, 'status=' + empty.status);

  const noName = await request('/api/submit', {
    method: 'POST',
    body: JSON.stringify(submitBody(examId, {}, { student_name: '' }))
  });
  check('thiếu họ tên bị từ chối 400', noName.status === 400, 'status=' + noName.status);

  const noClass = await request('/api/submit', {
    method: 'POST',
    body: JSON.stringify(submitBody(examId, {}, { student_class: '   ' }))
  });
  check('thiếu lớp bị từ chối 400', noClass.status === 400, 'status=' + noClass.status);

  const badExam = await request('/api/submit', {
    method: 'POST',
    body: JSON.stringify(submitBody('khong_ton_tai', {}))
  });
  check('đề không tồn tại trả 404', badExam.status === 404, 'status=' + badExam.status);

  const badAnswer = await request('/api/submit', {
    method: 'POST',
    body: JSON.stringify(submitBody(examId, { 0: 999 }))
  });
  check('đáp án ngoài phạm vi bị từ chối 400', badAnswer.status === 400, 'status=' + badAnswer.status);

  const badId = await request('/api/submit', {
    method: 'POST',
    body: JSON.stringify(submitBody(examId, {}, { submission_id: 'x' }))
  });
  check('submission_id sai định dạng bị từ chối 400', badId.status === 400, 'status=' + badId.status);

  const badType = await request('/api/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(submitBody(examId, {}))
  });
  check('Content-Type sai trả 415', badType.status === 415, 'status=' + badType.status);

  const big = await request('/api/submit', {
    method: 'POST',
    body: JSON.stringify(submitBody(examId, {}, { student_name: 'A'.repeat(70000) }))
  });
  check('body quá lớn trả 413', big.status === 413, 'status=' + big.status);

  const badJson = await request('/api/submit', {
    method: 'POST',
    body: '{not-json'
  });
  check('JSON hỏng trả 400', badJson.status === 400, 'status=' + badJson.status);

  const config = await request('/api/config');
  check('GET /api/config trả 200', config.status === 200, 'status=' + config.status);
  check('config chỉ trả site key công khai',
    !!config.json && (config.json.turnstile_site_key === null ||
      typeof config.json.turnstile_site_key === 'string'));
  check('config không lộ secret Turnstile',
    config.text.indexOf('TURNSTILE_SECRET') < 0 && config.text.indexOf('secret') < 0);

  /* ---------------------------------------------------------------- */
  section('Giới hạn tần suất nộp bài');

  if (!IS_LOCAL) {
    console.log('  (bỏ qua kiểm thử rate limit: cần dev server local để giả lập IP)');
  } else {
    // Header CF-Connecting-IP chỉ dùng được ở local (Cloudflare edge ghi đè
    // header này trên production). Nhờ vậy kiểm thử được rate limit mà không
    // ảnh hưởng các request loopback khác trong bộ test.
    let rateIp = '';
    let limited = null;
    let beforeLimit = 0;
    let onlyBadRequests = true;

    // Thử tối đa 3 IP ngẫu nhiên (phòng trường hợp IP trùng lần chạy trước).
    for (let round = 0; round < 3 && !limited; round += 1) {
      rateIp = '198.51.100.' + (1 + Math.floor(Math.random() * 254));
      beforeLimit = 0;
      onlyBadRequests = true;

      // Ngưỡng burst mặc định là 300 lượt/phút; gửi thêm để chắc chắn chạm 429.
      for (let i = 0; i < 400; i += 1) {
        const attempt = await request('/api/submit', {
          method: 'POST',
          headers: { 'CF-Connecting-IP': rateIp },
          body: JSON.stringify({})
        });
        if (attempt.status === 429) {
          limited = attempt;
          break;
        }
        beforeLimit += 1;
        if (attempt.status !== 400) onlyBadRequests = false;
      }

      // 429 ngay request đầu nghĩa là IP này còn bộ đếm cũ; thử IP khác.
      if (limited && beforeLimit === 0) limited = null;
    }

    check('bơm nhiều lượt từ một IP bị chặn 429', !!limited,
      'không thấy 429 sau ' + beforeLimit + ' request');
    check('request trước ngưỡng bị từ chối vì dữ liệu rỗng (400)',
      !!limited && beforeLimit > 0 && onlyBadRequests, 'count=' + beforeLimit);
    check('429 có header Retry-After hợp lệ',
      !!limited && /^\d+$/.test(limited.headers.get('retry-after') || ''),
      limited ? 'retry-after=' + limited.headers.get('retry-after') : 'không có');

    const afterLimit = await request('/api/submit', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': rateIp },
      body: JSON.stringify({})
    });
    check('IP đã vượt ngưỡng tiếp tục bị chặn 429', afterLimit.status === 429,
      'status=' + afterLimit.status);

    const escapedIp = '203.0.113.' + (1 + Math.floor(Math.random() * 254));
    const otherIp = await request('/api/submit', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': escapedIp },
      body: JSON.stringify({})
    });
    check('IP khác không bị chặn nhầm', otherIp.status !== 429, 'status=' + otherIp.status);
  }

  /* ---------------------------------------------------------------- */
  section('Nộp bài, chấm điểm phía máy chủ, chống trùng');

  const allCorrect = correctAnswers(exam);
  const firstId = uuid();
  const first = await request('/api/submit', {
    method: 'POST',
    body: JSON.stringify(submitBody(examId, allCorrect, {
      submission_id: firstId,
      student_name: 'Nguyễn Kiểm Thử',
      student_class: runId,
      score: 9999,
      total_score: 9999,
      submitted_at: '2000-01-01T00:00:00.000Z'
    }))
  });
  check('nộp hợp lệ trả 201', first.status === 201, 'status=' + first.status);
  check('máy chủ bỏ qua điểm client', !!first.json && first.json.submission && first.json.submission.score === exam.totalScore,
    'score=' + (first.json && first.json.submission ? first.json.submission.score : '?'));
  check('tổng điểm đúng', !!first.json && first.json.submission.total_score === exam.totalScore);
  check('submitted_at do máy chủ sinh (không phải 2000)', !!first.json && first.json.submission.submitted_at.indexOf('2000-01-01') !== 0);
  check('phản hồi nộp bài không lộ đáp án', first.text.indexOf('"correct"') < 0 && first.text.indexOf('correctList') < 0);

  const duplicate = await request('/api/submit', {
    method: 'POST',
    body: JSON.stringify(submitBody(examId, allCorrect, {
      submission_id: firstId,
      student_name: 'Nguyễn Kiểm Thử',
      student_class: runId
    }))
  });
  check('nộp trùng cùng dữ liệu trả 200', duplicate.status === 200, 'status=' + duplicate.status);
  check('nộp trùng được đánh dấu duplicate', !!duplicate.json && duplicate.json.duplicate === true);
  check('nộp trùng không tạo điểm mới', !!duplicate.json && duplicate.json.submission.score === exam.totalScore);

  const conflict = await request('/api/submit', {
    method: 'POST',
    body: JSON.stringify(submitBody(examId, allCorrect, {
      submission_id: firstId,
      student_name: 'Người Khác',
      student_class: runId
    }))
  });
  check('dùng lại mã nộp với dữ liệu khác trả 409', conflict.status === 409, 'status=' + conflict.status);

  const concurrent = await Promise.all([
    request('/api/submit', {
      method: 'POST',
      body: JSON.stringify(submitBody(examId, allCorrect, { student_class: runId, student_name: 'Song Song A' }))
    }),
    request('/api/submit', {
      method: 'POST',
      body: JSON.stringify(submitBody(examId, allCorrect, { student_class: runId, student_name: 'Song Song B' }))
    })
  ]);
  check('hai lượt nộp đồng thời đều thành công', concurrent.every(function (r) { return r.status === 201; }),
    concurrent.map(function (r) { return r.status; }).join(','));

  /* ---------------------------------------------------------------- */
  section('Tải ~100 lượt nộp');

  const BULK = 100;
  const bulkIds = [];
  let bulkOk = 0;
  const started = Date.now();

  for (let offset = 0; offset < BULK; offset += 10) {
    const batch = [];
    for (let index = offset; index < Math.min(offset + 10, BULK); index += 1) {
      const id = uuid();
      bulkIds.push(id);
      batch.push(request('/api/submit', {
        method: 'POST',
        body: JSON.stringify(submitBody(examId, mixedAnswers(exam, index), {
          submission_id: id,
          student_name: 'Học sinh ' + String(index + 1).padStart(3, '0'),
          student_class: bulkClass,
          duration_seconds: 300 + index
        }))
      }));
    }
    const results = await Promise.all(batch);
    bulkOk += results.filter(function (r) { return r.status === 201; }).length;
  }

  const elapsed = Date.now() - started;
  console.log('  → ' + bulkOk + '/' + BULK + ' lượt trong ' + elapsed + ' ms');
  check('tất cả lượt nộp hàng loạt thành công', bulkOk === BULK, bulkOk + '/' + BULK);
  check('thời gian 100 lượt hợp lý (<30s)', elapsed < 30000, elapsed + 'ms');

  /* ---------------------------------------------------------------- */
  section('Phân quyền giáo viên');

  const deniedResults = await request('/api/results?class=' + encodeURIComponent(bulkClass));
  check('học sinh không xem được /api/results', deniedResults.status === 401, 'status=' + deniedResults.status);

  const deniedExport = await request('/api/results/export');
  check('học sinh không xuất được CSV', deniedExport.status === 401, 'status=' + deniedExport.status);

  const badOrigin = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: JSON.stringify({ password: PASSWORD || 'x' })
  });
  check('login từ origin lạ bị chặn 403', badOrigin.status === 403, 'status=' + badOrigin.status);

  if (!PASSWORD) {
    console.log('  (bỏ qua kiểm thử đăng nhập: chưa đặt TEST_TEACHER_PASSWORD)');
  } else {
    const wrong = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password: 'sai-mat-khau-' + Date.now() })
    });
    check('mật khẩu sai trả 401', wrong.status === 401, 'status=' + wrong.status);
    check('mật khẩu sai không cấp cookie', !wrong.cookie);

    const login = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password: PASSWORD })
    });
    check('mật khẩu đúng trả 200', login.status === 200, 'status=' + login.status);
    check('cookie có HttpOnly', /HttpOnly/i.test(login.cookieHeader));
    check('cookie có SameSite=Strict', /SameSite=Strict/i.test(login.cookieHeader));
    check('cookie có Path=/', /Path=\//.test(login.cookieHeader));

    const auth = { headers: { Cookie: login.cookie } };

    const list = await request('/api/results?class=' + encodeURIComponent(bulkClass) + '&page=1&page_size=10', auth);
    check('giáo viên xem được danh sách', list.status === 200 && !!list.json && list.json.ok === true, 'status=' + list.status);
    check('lọc lớp trả đúng 100 kết quả', !!list.json && list.json.total === BULK, 'total=' + (list.json && list.json.total));
    check('phân trang trả tối đa 10 dòng', !!list.json && Array.isArray(list.json.items) && list.json.items.length === 10);
    check('tổng số trang = 10', !!list.json && list.json.total_pages === 10, 'pages=' + (list.json && list.json.total_pages));

    const page2 = await request('/api/results?class=' + encodeURIComponent(bulkClass) + '&page=2&page_size=10', auth);
    check('trang 2 khác trang 1', !!page2.json && page2.json.items.length === 10 &&
      page2.json.items[0].submission_id !== list.json.items[0].submission_id);

    const sorted = await request('/api/results?class=' + encodeURIComponent(bulkClass) + '&sort=score&order=desc&page_size=100', auth);
    let monotonic = true;
    if (sorted.json && Array.isArray(sorted.json.items)) {
      for (let i = 1; i < sorted.json.items.length; i += 1) {
        if (sorted.json.items[i - 1].score < sorted.json.items[i].score) monotonic = false;
      }
    }
    check('sắp xếp theo điểm giảm dần', monotonic);

    const search = await request('/api/results?class=' + encodeURIComponent(bulkClass) + '&q=005&page_size=10', auth);
    check('tìm theo tên hoạt động', search.status === 200 && !!search.json && search.json.total === 1, 'total=' + (search.json && search.json.total));

    const wildcard = await request('/api/results?q=%25&page_size=10', auth);
    check('ký tự % được xử lý là ký tự thường', wildcard.status === 200 && wildcard.json.total === 0, 'total=' + (wildcard.json && wildcard.json.total));

    const injection = await request('/api/results?q=' + encodeURIComponent("' OR 1=1 --") + '&page_size=10', auth);
    check('thử SQL injection không lỗi và không trả toàn bộ', injection.status === 200 && injection.json.total === 0, 'total=' + (injection.json && injection.json.total));

    const badSort = await request('/api/results?sort=drop_table', auth);
    check('sort lạ bị từ chối 400', badSort.status === 400, 'status=' + badSort.status);

    const teacherExams = await request('/api/exams', auth);
    check('giáo viên thấy thống kê lượt nộp', !!teacherExams.json && teacherExams.json.teacher === true &&
      typeof teacherExams.json.exams[0].submission_count === 'number');

    /* -------------------------------------------------------------- */
    section('Xuất CSV đầy đủ');

    const formulaName = "=cmd|' /C calc'!A0";
    const formulaSubmit = await request('/api/submit', {
      method: 'POST',
      body: JSON.stringify(submitBody(examId, mixedAnswers(exam, 7), {
        student_name: formulaName,
        student_class: bulkClass
      }))
    });
    check('thêm bản ghi tên bắt đầu bằng =', formulaSubmit.status === 201, 'status=' + formulaSubmit.status);

    const expectedTotal = BULK + 1;
    const exportRes = await request('/api/results/export?class=' + encodeURIComponent(bulkClass), auth);
    check('xuất CSV trả 200', exportRes.status === 200, 'status=' + exportRes.status);

    // response.text() tự bỏ BOM, nên kiểm tra byte thô của file tải về.
    const rawExport = await fetch(BASE + '/api/results/export?class=' + encodeURIComponent(bulkClass), {
      headers: { Cookie: login.cookie }
    });
    const rawBytes = new Uint8Array(await rawExport.arrayBuffer());
    check('CSV có BOM UTF-8', rawBytes[0] === 0xEF && rawBytes[1] === 0xBB && rawBytes[2] === 0xBF,
      'bytes=' + Array.from(rawBytes.slice(0, 3)).join(','));
    check('CSV đúng content-type', /text\/csv/.test(exportRes.headers.get('content-type') || ''));
    check('CSV có tên file đính kèm', /attachment;/.test(exportRes.headers.get('content-disposition') || ''));

    const rows = csvRows(exportRes.text);
    const dataRows = rows.slice(1).filter(function (row) { return row.some(function (cell) { return cell !== ''; }); });
    check('CSV xuất đủ ' + expectedTotal + ' dòng (không chỉ trang đầu)', dataRows.length === expectedTotal,
      'rows=' + dataRows.length);

    const exportedIds = new Set(dataRows.map(function (row) { return row[1]; }));
    check('CSV chứa cả bản ghi ngoài trang đầu', bulkIds.every(function (id) { return exportedIds.has(id); }));

    const formulaRow = dataRows.filter(function (row) { return row[4].indexOf(formulaName) >= 0; })[0];
    check('CSV chống formula injection', !!formulaRow && formulaRow[4].charAt(0) === "'" && formulaRow[4].indexOf(formulaName) > 0,
      formulaRow ? 'cell=' + formulaRow[4].slice(0, 12) : 'không thấy dòng');

    const exportPage = await request('/api/results?class=' + encodeURIComponent(bulkClass) + '&page=1&page_size=10', auth);
    check('danh sách trang 1 vẫn chỉ 10 dòng', !!exportPage.json && exportPage.json.items.length === 10);

    /* -------------------------------------------------------------- */
    section('Đăng xuất');

    const logout = await request('/api/auth/logout', { method: 'POST', headers: { Cookie: login.cookie } });
    check('logout trả 200', logout.status === 200, 'status=' + logout.status);
    check('logout xóa cookie', /Max-Age=0/.test(logout.cookieHeader));

    // Trình duyệt chỉ xóa cookie khi tên + Path + Domain + SameSite khớp cookie đã đặt.
    // Đây là nguyên nhân khiến "đăng xuất" không có hiệu lực nếu thiếu thuộc tính.
    check('cookie xóa đúng tên cookie đăng nhập',
      logout.cookieHeader.indexOf('teacher_session=') === 0,
      logout.cookieHeader.slice(0, 40));
    check('cookie xóa cùng Path=/ với cookie đăng nhập',
      /Path=\//.test(logout.cookieHeader) && /Path=\//.test(login.cookieHeader));
    check('cookie xóa cùng SameSite=Strict với cookie đăng nhập',
      /SameSite=Strict/i.test(logout.cookieHeader) && /SameSite=Strict/i.test(login.cookieHeader));

    // Giả lập cookie jar của trình duyệt: sau logout, không còn cookie nào để gửi.
    const afterLogout = await request('/api/results');
    check('sau đăng xuất không còn cookie nên 401', afterLogout.status === 401, 'status=' + afterLogout.status);
  }

  /* ---------------------------------------------------------------- */
  section('Tổng kết');
  console.log('Đạt: ' + passed + ' · Lỗi: ' + failed);
  if (failed) {
    console.log('\nCác mục lỗi:');
    failures.forEach(function (message) { console.log('- ' + message); });
    process.exitCode = 1;
  }
}

main().catch(function (error) {
  console.error('Lỗi chạy kiểm thử: ' + (error && error.message ? error.message : error));
  process.exitCode = 1;
});
