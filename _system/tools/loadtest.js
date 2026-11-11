#!/usr/bin/env node
/*
 * Kiểm thử tải mô phỏng nhiều học sinh vào làm bài cùng lúc.
 *
 * Mặc định chỉ cho phép chạy với localhost để tránh vô tình dội tải vào
 * production. Muốn chạy với site thật, thêm --allow-remote và chỉ chạy trên
 * site của chính bạn.
 *
 * Cách chạy:
 *   node _system/tools/loadtest.js http://127.0.0.1:8788 toan_01 10
 *   node _system/tools/loadtest.js http://127.0.0.1:8788 toan_01 25
 *   node _system/tools/loadtest.js http://127.0.0.1:8788 toan_01 45
 *   node _system/tools/loadtest.js http://127.0.0.1:8788 toan_01 --ramp=10,25,45,100
 *
 * Tùy chọn:
 *   --duplicate          gửi mỗi bài hai lần để kiểm tra chống trùng
 *   --class=TEST         dùng tên lớp cố định (mặc định: tên riêng mỗi lượt)
 *   --delay=3000         thời gian chờ ngẫu nhiên tối đa trước khi nộp (ms)
 *   --concurrency=50     số request chạy song song (mặc định: tất cả cùng lúc)
 *   --ramp=10,25,45      chạy lần lượt nhiều mức n
 *   --timeout=20000      timeout mỗi request (ms)
 *   --allow-remote       cho phép chạy với địa chỉ không phải localhost
 *
 * Lưu ý:
 *   - Dữ liệu test được lưu vào D1 local (hoặc D1 thật nếu chạy remote).
 *   - Mỗi mức n dùng một tên lớp riêng, in ra ở đầu mỗi lượt. Mở teacher.html,
 *     lọc đúng lớp đó để kiểm tra đủ số dòng, rồi xóa theo phạm vi lớp.
 *   - Khi chạy local, request đi từ loopback nên rate limit nộp bài được bỏ
 *     qua. Muốn kiểm tra rate limit, dùng _system/tools/test-api.js.
 */
'use strict';

const DEFAULT_DELAY_MS = 3000;
const DEFAULT_TIMEOUT_MS = 20000;
const MAX_COUNT = 10000;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseInteger(value, name, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    fail('Giá trị ' + name + ' phải là số nguyên từ ' + min + ' đến ' + max + '.');
  }
  return n;
}

function parseLevels(value) {
  const levels = String(value || '')
    .split(',')
    .map(function (part) { return Number(part.trim()); })
    .filter(function (n) { return Number.isFinite(n); });

  if (!levels.length) fail('--ramp cần danh sách số, ví dụ --ramp=10,25,45');

  levels.forEach(function (n) {
    if (!Number.isInteger(n) || n < 1 || n > MAX_COUNT) {
      fail('Mỗi mức trong --ramp phải là số nguyên từ 1 đến ' + MAX_COUNT + '.');
    }
  });

  return levels.sort(function (a, b) { return a - b; });
}

function parseArgs(argv) {
  const options = {
    duplicate: false,
    className: '',
    delayMax: DEFAULT_DELAY_MS,
    concurrency: 0,
    ramp: null,
    timeout: DEFAULT_TIMEOUT_MS,
    allowRemote: false
  };
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--duplicate') {
      options.duplicate = true;
    } else if (arg === '--allow-remote') {
      options.allowRemote = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg.indexOf('--class=') === 0) {
      options.className = arg.slice('--class='.length).trim();
    } else if (arg.indexOf('--delay=') === 0) {
      options.delayMax = parseInteger(arg.slice('--delay='.length), '--delay', 0, 600000);
    } else if (arg.indexOf('--concurrency=') === 0) {
      options.concurrency = parseInteger(arg.slice('--concurrency='.length), '--concurrency', 0, MAX_COUNT);
    } else if (arg.indexOf('--ramp=') === 0) {
      options.ramp = parseLevels(arg.slice('--ramp='.length));
    } else if (arg.indexOf('--timeout=') === 0) {
      options.timeout = parseInteger(arg.slice('--timeout='.length), '--timeout', 1000, 600000);
    } else if (arg.charAt(0) === '-') {
      fail('Tùy chọn không hợp lệ: ' + arg);
    } else {
      positional.push(arg);
    }
  }

  return { options: options, positional: positional };
}

function randomId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let value = 'lt';
  for (let i = 0; i < 18; i += 1) {
    value += chars[Math.floor(Math.random() * chars.length)];
  }
  return value;
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function percentile(values, p) {
  const sorted = values
    .filter(function (value) { return value >= 0; })
    .sort(function (a, b) { return a - b; });

  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[index];
}

function formatMs(value) {
  return value == null ? 'n/a' : value + ' ms';
}

function statusSummary(results) {
  const summary = {};
  results.forEach(function (result) {
    summary[result.status] = (summary[result.status] || 0) + 1;
  });
  return summary;
}

async function fetchAndDrain(url, options, timeout) {
  const started = Date.now();
  const response = await fetch(url, Object.assign({}, options, {
    signal: AbortSignal.timeout(timeout)
  }));
  await response.arrayBuffer();
  return {
    status: response.status,
    ok: response.ok,
    ms: Date.now() - started
  };
}

async function checkServer(base, timeout) {
  const waitMs = Math.max(1000, Math.min(timeout, 10000));
  let response;

  try {
    response = await fetch(base + '/api/health', {
      cache: 'no-store',
      signal: AbortSignal.timeout(waitMs)
    });
  } catch (error) {
    fail(
      'Không kết nối được tới ' + base + '.\n' +
      'Hãy mở một cửa sổ khác và chạy:\n' +
      '  npx wrangler pages dev . --port 8788\n' +
      'Đợi dòng "Ready on http://127.0.0.1:8788" rồi chạy lại lệnh load test.'
    );
  }

  if (!response.ok) {
    fail('Server đang chạy nhưng /api/health trả mã ' + response.status + '. Kiểm tra lại Wrangler/D1 local.');
  }
}

async function checkExam(base, examId, timeout) {
  let response;
  try {
    response = await fetch(base + '/api/exams', {
      cache: 'no-store',
      signal: AbortSignal.timeout(Math.max(1000, Math.min(timeout, 10000)))
    });
  } catch (error) {
    return;
  }

  if (!response.ok) return;

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    return;
  }

  const exams = data && Array.isArray(data.exams) ? data.exams : [];
  const ids = exams.map(function (exam) { return exam.id; });
  if (ids.length && ids.indexOf(examId) < 0) {
    fail(
      'Đề "' + examId + '" không tồn tại trên server này.\n' +
      'Các mã đề hợp lệ: ' + ids.join(', ')
    );
  }
}

async function oneStudent(index, config) {
  const result = { page: -1, submit: -1, status: 0, ok: false, duplicate: null, errors: [] };

  try {
    const page = await fetchAndDrain(config.base + '/', { cache: 'no-store' }, config.timeout);
    result.page = page.ms;
  } catch (error) {
    result.page = -1;
    result.errors.push('tải trang: ' + (error && error.message ? error.message : error));
  }

  if (config.delayMax > 0) {
    await sleep(Math.random() * config.delayMax);
  }

  const body = JSON.stringify({
    submission_id: randomId(),
    exam_id: config.examId,
    student_name: 'TEST ' + String(index + 1).padStart(3, '0'),
    student_class: config.className,
    answers: {},
    duration_seconds: 60 + (index % 3000),
    timed_out: false,
    client_submitted_at: new Date().toISOString()
  });

  const submitOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': config.base
    },
    body: body
  };

  try {
    const submit = await fetchAndDrain(config.base + '/api/submit', submitOptions, config.timeout);
    result.status = submit.status;
    result.ok = submit.ok;
    result.submit = submit.ms;
  } catch (error) {
    result.submit = -1;
    result.errors.push('nộp bài: ' + (error && error.message ? error.message : error));
  }

  if (config.duplicate) {
    try {
      const again = await fetchAndDrain(config.base + '/api/submit', submitOptions, config.timeout);
      result.duplicate = again.status;
    } catch (error) {
      result.duplicate = -1;
      result.errors.push('gửi lặp: ' + (error && error.message ? error.message : error));
    }
  }

  return result;
}

async function runLevel(level, config) {
  const results = new Array(level);
  let next = 0;

  async function worker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= level) return;
      results[index] = await oneStudent(index, config);
    }
  }

  const workers = config.concurrency > 0
    ? Math.min(config.concurrency, level)
    : level;

  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

function makeClassName(runId, level) {
  // Tối đa 20 ký tự theo API; ví dụ LTABC123-45.
  return 'LT' + runId + '-' + level;
}

function printLevel(level, className, results, elapsedMs) {
  const okCount = results.filter(function (result) { return result.ok; }).length;
  const pageTimes = results.map(function (result) { return result.page; });
  const submitTimes = results.map(function (result) { return result.submit; });

  console.log('\n--- ' + level + ' học sinh · lớp "' + className + '" ---');
  console.log('Thời gian: ' + (elapsedMs / 1000).toFixed(1) + ' giây');
  console.log('Nộp thành công: ' + okCount + '/' + level);
  console.log('Mã trạng thái: ' + JSON.stringify(statusSummary(results)));
  console.log('Tải trang chủ  p50 ' + formatMs(percentile(pageTimes, 0.5)) +
    ', p95 ' + formatMs(percentile(pageTimes, 0.95)));
  console.log('Nộp bài        p50 ' + formatMs(percentile(submitTimes, 0.5)) +
    ', p95 ' + formatMs(percentile(submitTimes, 0.95)) +
    ', lớn nhất ' + formatMs(percentile(submitTimes, 1)));

  const failedConnection = results.filter(function (result) { return result.status === 0; });
  if (failedConnection.length) {
    console.log('Lỗi kết nối: ' + failedConnection.length + '/' + level +
      ' request không tới được server.');
    const firstError = failedConnection.filter(function (result) {
      return result.errors && result.errors.length;
    })[0];
    if (firstError) console.log('Chi tiết: ' + firstError.errors[0]);
    console.log('Kiểm tra cửa sổ chạy `npx wrangler pages dev . --port 8788` vẫn còn mở.');
  }

  if (results.some(function (result) { return result.duplicate != null; })) {
    const duplicateStatuses = {};
    results.forEach(function (result) {
      if (result.duplicate != null) {
        duplicateStatuses[result.duplicate] = (duplicateStatuses[result.duplicate] || 0) + 1;
      }
    });
    console.log('Gửi lần hai (chống trùng): ' + JSON.stringify(duplicateStatuses));
  }

  return okCount;
}

function usage() {
  console.log('Cách dùng:');
  console.log('  node _system/tools/loadtest.js <http://127.0.0.1:8788> <exam_id> [số học sinh]');
  console.log('  node _system/tools/loadtest.js http://127.0.0.1:8788 toan_01 --ramp=10,25,45,100');
  console.log('');
  console.log('Tùy chọn: --duplicate --class=TEST --delay=3000 --concurrency=50');
  console.log('          --timeout=20000 --allow-remote');
}

(async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const options = parsed.options;
  const positional = parsed.positional;

  if (options.help) {
    usage();
    return;
  }

  const base = (positional[0] || '').replace(/\/+$/, '');
  const examId = positional[1] || '';
  const count = positional[2] ? parseInteger(positional[2], 'số học sinh', 1, MAX_COUNT) : 45;

  if (!base || !examId) {
    usage();
    process.exit(1);
  }

  let baseUrl;
  try {
    baseUrl = new URL(base);
  } catch (error) {
    fail('Địa chỉ trang không hợp lệ: ' + base);
  }

  if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
    fail('Địa chỉ trang phải bắt đầu bằng http:// hoặc https://.');
  }

  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(baseUrl.hostname);
  if (!isLocal && !options.allowRemote) {
    fail(
      'Script chỉ chạy với localhost để tránh dội tải nhầm vào production.\n' +
      'Nếu chắc chắn muốn chạy với site thật, thêm --allow-remote.'
    );
  }

  if (!/^[A-Za-z0-9_-]+$/.test(examId)) {
    fail('Mã đề chỉ gồm chữ, số, dấu gạch dưới và gạch ngang.');
  }

  if (options.className && options.className.length > 20) {
    fail('Tên lớp tối đa 20 ký tự (theo giới hạn API).');
  }

  await checkServer(base, options.timeout);
  await checkExam(base, examId, options.timeout);

  const levels = options.ramp || [count];
  const runId = Date.now().toString(36).slice(-4).toUpperCase() +
    Math.floor(Math.random() * 36).toString(36).toUpperCase();

  console.log('Site: ' + base);
  console.log('Đề: ' + examId);
  console.log('Mức tải: ' + levels.join(' → '));
  console.log('Chờ ngẫu nhiên tối đa: ' + options.delayMax + ' ms');
  console.log('Song song: ' + (options.concurrency > 0 ? options.concurrency : 'tất cả cùng lúc'));

  let totalFailures = 0;

  for (let i = 0; i < levels.length; i += 1) {
    const level = levels[i];
    const className = options.className || makeClassName(runId, level);
    const started = Date.now();
    const results = await runLevel(level, {
      base: base,
      examId: examId,
      className: className,
      delayMax: options.delayMax,
      concurrency: options.concurrency,
      duplicate: options.duplicate,
      timeout: options.timeout
    });
    const okCount = printLevel(level, className, results, Date.now() - started);
    totalFailures += level - okCount;
    console.log('Xem kết quả: mở ' + base + '/teacher.html, lọc lớp "' + className + '".');
  }

  console.log('\nTổng kết: ' + (totalFailures ? totalFailures + ' lượt lỗi' : 'tất cả lượt đều thành công') + '.');
  console.log('Gợi ý: chạy lại với n lớn hơn khi p95 vẫn thấp và không có lỗi.');
  if (totalFailures) process.exitCode = 1;
})().catch(function (error) {
  console.error('Lỗi chạy load test: ' + (error && error.message ? error.message : error));
  process.exitCode = 1;
});
