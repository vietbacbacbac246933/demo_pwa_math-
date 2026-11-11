#!/usr/bin/env node
/*
 * Kiểm thử tích hợp Local Helper trên một bản sao dự án.
 *
 * Yêu cầu: Local Helper đang chạy với EXAM_HELPER_ROOT trỏ tới bản sao thử
 * nghiệm và EXAM_HELPER_NO_DEPLOY=1 (không deploy thật lên Cloudflare).
 *
 *   node _system/tools/test-helper.js
 *   node _system/tools/test-helper.js --keep
 *
 * Biến môi trường:
 *   EXAM_HELPER_SESSION_DIR  thư mục chứa session.json (bắt buộc nếu khác mặc định)
 *   EXAM_HELPER_TEST_KEEP=1  không tắt helper sau khi chạy xong
 *   EXAM_HELPER_TEST_ALLOW_ROOT=1  cho phép chạy trên thư mục không phải bản sao
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const SESSION_DIR = process.env.EXAM_HELPER_SESSION_DIR
  ? path.resolve(process.env.EXAM_HELPER_SESSION_DIR)
  : path.join(process.env.LOCALAPPDATA || os.homedir(), 'ExamLibraryHelper');
const SESSION_FILE = path.join(SESSION_DIR, 'session.json');
const KEEP = process.env.EXAM_HELPER_TEST_KEEP === '1' || process.argv.indexOf('--keep') >= 0;

let session = null;
let TOKEN = '';
let ORIGIN = '';
const failures = [];
const passes = [];

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function sha(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashFile(file) {
  return sha(fs.readFileSync(file));
}

function treeHash(dir) {
  const entries = [];
  const walk = (current) => {
    fs.readdirSync(current, { withFileTypes: true }).forEach((entry) => {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) entries.push(path.relative(dir, full).replace(/\\/g, '/') + ':' + hashFile(full));
    });
  };
  if (fs.existsSync(dir)) walk(dir);
  return sha(entries.sort().join('\n'));
}

function loadSession() {
  if (!fs.existsSync(SESSION_FILE)) {
    console.error('[LOI] Không tìm thấy ' + SESSION_FILE);
    console.error('      Hãy khởi chạy Local Helper với EXAM_HELPER_SESSION_DIR trước khi test.');
    process.exit(2);
  }
  session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  if (!session || !session.port || !session.token || !session.root) {
    console.error('[LOI] session.json không hợp lệ.');
    process.exit(2);
  }
  TOKEN = session.token;
  ORIGIN = 'http://127.0.0.1:' + session.port;
}

function request(method, pathname, options) {
  const opts = options || {};
  let body = null;
  if (opts.raw) {
    body = Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(String(opts.body), 'utf8');
  } else if (opts.body !== undefined) {
    body = Buffer.from(JSON.stringify(opts.body), 'utf8');
  }
  const headers = Object.assign({}, opts.headers || {});
  if (body) headers['Content-Length'] = String(body.length);
  if (body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const req = http.request({
      host: '127.0.0.1',
      port: session.port,
      path: pathname,
      method,
      headers,
      timeout: opts.timeout || 120000
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (error) {}
        finish({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Hết thời gian chờ.')));
    req.on('error', (error) => finish({ status: 0, error, text: '', json: null, headers: {} }));
    if (body) req.write(body);
    req.end();
  });
}

function authed(extra) {
  return Object.assign({ 'X-Helper-Token': TOKEN, Origin: ORIGIN }, extra || {});
}

function ok(condition, message, detail) {
  if (condition) return;
  const error = new Error(message + (detail ? ' — ' + detail : ''));
  error.assertion = true;
  throw error;
}

async function step(name, fn) {
  process.stdout.write('• ' + name + ' ... ');
  try {
    await fn();
    passes.push(name);
    console.log('OK');
  } catch (error) {
    failures.push({ name, message: error.message });
    console.log('THẤT BẠI');
    console.log('  ' + error.message);
  }
}

function startCase() {
  return { log: [] };
}

function rewriteQuiz(html, mutate) {
  const match = /(<script\b[^>]*\bid=["']quiz-data["'][^>]*>)([\s\S]*?)(<\/script>)/i.exec(html);
  if (!match) throw new Error('Không tìm thấy quiz-data trong mẫu.');
  const data = JSON.parse(match[2]);
  if (mutate) mutate(data);
  return html.slice(0, match.index) + match[1] + JSON.stringify(data) + match[3] +
    html.slice(match.index + match[0].length);
}

function readQuiz(html) {
  const match = /(<script\b[^>]*\bid=["']quiz-data["'][^>]*>)([\s\S]*?)(<\/script>)/i.exec(html);
  if (!match) throw new Error('Không tìm thấy quiz-data.');
  return JSON.parse(match[2]);
}

function findTemplate(root) {
  const preferred = path.join(root, 'exams', 'toan');
  const dirs = [preferred, path.join(root, 'exams')];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const stack = [dir];
    while (stack.length) {
      const current = stack.shift();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (/^de_.*\.html?$/i.test(entry.name)) return full;
      }
    }
  }
  throw new Error('Không tìm thấy đề mẫu trong exams/.');
}

let uniqueCounter = 0;
function uniqueId(prefix) {
  uniqueCounter += 1;
  return prefix + '_' + Date.now().toString(36) + '_' + uniqueCounter;
}

function runPowerShell(command) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'PowerShell thất bại.').trim());
  }
  return String(result.stdout || '');
}

async function uploadFiles(files, extraHeaders) {
  return request('POST', '/api/files', {
    headers: authed(extraHeaders),
    body: { files }
  });
}

async function planItems(items) {
  return request('POST', '/api/plan', {
    headers: authed(),
    body: { items }
  });
}

async function deployItems(items) {
  return request('POST', '/api/deploy', {
    headers: authed(),
    body: { items }
  });
}

async function pollJob(id, timeoutMs) {
  const started = Date.now();
  let since = 0;
  const logs = [];
  let last = null;
  while (Date.now() - started < (timeoutMs || 300000)) {
    const response = await request('GET', '/api/jobs/' + encodeURIComponent(id) + '?since=' + since, {
      headers: authed()
    });
    if (response.status !== 200 || !response.json) {
      throw new Error('Không đọc được tiến trình: HTTP ' + response.status + ' ' + response.text.slice(0, 200));
    }
    const job = response.json;
    last = job;
    (job.logs || []).forEach((entry) => logs.push(entry));
    since = job.nextSince != null ? job.nextSince : since + (job.logs || []).length;
    if (job.state !== 'running') {
      job.allLogs = logs;
      return job;
    }
    await sleep(800);
  }
  const error = new Error('Tiến trình chưa kết thúc sau ' + Math.round((timeoutMs || 300000) / 1000) + ' giây.');
  error.job = last;
  throw error;
}

async function main() {
  loadSession();
  console.log('');
  console.log('=== KIỂM THỬ LOCAL HELPER ===');
  console.log('Thư mục dự án: ' + session.root);
  console.log('Cổng: ' + session.port);
  console.log('');

  const root = session.root;
  const looksLikeCopy = /exam-helper-test|temp|tmp|test-copy/i.test(root);
  if (!looksLikeCopy && process.env.EXAM_HELPER_TEST_ALLOW_ROOT !== '1') {
    console.error('[LOI] Thư mục test không giống bản sao thử nghiệm: ' + root);
    console.error('      Đặt EXAM_HELPER_TEST_ALLOW_ROOT=1 nếu thực sự muốn chạy trên thư mục này.');
    process.exit(2);
  }

  const catalogPath = path.join(root, 'assets/js/catalog.js');
  const examsDir = path.join(root, 'exams');
  const sinhPath = path.join(examsDir, 'sinh', 'de_sinh_06.html');
  const templatePath = findTemplate(root);
  const template = fs.readFileSync(templatePath, 'utf8');
  const templateHashBefore = sha(template);
  const catalogBefore = hashFile(catalogPath);
  const sinhBefore = fs.existsSync(sinhPath) ? hashFile(sinhPath) : null;
  console.log('Đề mẫu: ' + path.relative(root, templatePath));
  console.log('');

  /* ---------- A. Khởi động, xác thực, bảo mật ---------- */
  await step('A1. Trang giao diện được phục vụ, không lộ token', async () => {
    const response = await request('GET', '/add-exam.html');
    ok(response.status === 200, 'HTTP ' + response.status);
    ok(response.text.indexOf('Quản lý thư viện đề') >= 0, 'Thiếu tiêu đề giao diện.');
    ok(response.text.indexOf(TOKEN) < 0, 'Token xuất hiện trong HTML.');
    ok(response.headers['x-frame-options'] === 'DENY', 'Thiếu X-Frame-Options.');
    ok(/default-src 'self'/.test(response.headers['content-security-policy'] || ''), 'Thiếu CSP.');
  });

  await step('A2. /api/status công khai đúng ứng dụng', async () => {
    const response = await request('GET', '/api/status');
    ok(response.status === 200, 'HTTP ' + response.status);
    ok(response.json && response.json.app === 'exam-library-helper', 'Sai app id.');
    ok(response.json.version, 'Thiếu version.');
  });

  await step('A3. API riêng tư từ chối khi thiếu token', async () => {
    const response = await request('GET', '/api/health');
    ok(response.status === 401, 'Mong đợi 401, nhận ' + response.status);
  });

  await step('A4. API riêng tư từ chối token sai', async () => {
    const response = await request('GET', '/api/health', {
      headers: { 'X-Helper-Token': crypto.randomBytes(32).toString('hex') }
    });
    ok(response.status === 401, 'Mong đợi 401, nhận ' + response.status);
  });

  await step('A5. Token đúng truy cập được /api/health', async () => {
    const response = await request('GET', '/api/health', { headers: authed() });
    ok(response.status === 200, 'HTTP ' + response.status);
    ok(response.json && response.json.app === 'exam-library-helper', 'Sai app id.');
  });

  await step('A6. Từ chối Host không phải loopback', async () => {
    const response = await request('GET', '/api/health', {
      headers: authed({ Host: 'evil.example.com' })
    });
    ok(response.status === 403, 'Mong đợi 403, nhận ' + response.status);
    ok(response.json && response.json.error === 'BAD_HOST', 'Sai mã lỗi.');
  });

  await step('A7. Từ chối Origin lạ khi thay đổi dữ liệu', async () => {
    const response = await request('POST', '/api/plan', {
      headers: { 'X-Helper-Token': TOKEN, Origin: 'https://evil.example.com' },
      body: { items: [] }
    });
    ok(response.status === 403, 'Mong đợi 403, nhận ' + response.status);
    ok(response.json && response.json.error === 'BAD_ORIGIN', 'Sai mã lỗi.');
  });

  await step('A8. Từ chối POST thiếu Origin', async () => {
    const response = await request('POST', '/api/plan', {
      headers: { 'X-Helper-Token': TOKEN },
      body: { items: [] }
    });
    ok(response.status === 403, 'Mong đợi 403, nhận ' + response.status);
    ok(response.json && response.json.error === 'MISSING_ORIGIN', 'Sai mã lỗi.');
  });

  await step('A9. Từ chối danh sách file rỗng', async () => {
    const response = await request('POST', '/api/files', { headers: authed(), body: {} });
    ok(response.status === 400, 'Mong đợi 400, nhận ' + response.status);
  });

  await step('A10. Từ chối định dạng không hỗ trợ', async () => {
    const response = await uploadFiles([{ name: 'de.txt', encoding: 'text', content: 'hello' }]);
    ok(response.status === 200, 'HTTP ' + response.status);
    const file = response.json.files[0];
    ok(file && file.ok === false, 'File .txt không bị đánh dấu lỗi.');
    ok(file.uploadId === null, 'File không hợp lệ vẫn có uploadId.');
  });

  await step('A11. Từ chối HTML thiếu quiz-data', async () => {
    const response = await uploadFiles([{
      name: 'de_toan_9999.html',
      encoding: 'text',
      content: '<!doctype html><html><body><h1>Không có dữ liệu đề</h1></body></html>'
    }]);
    const file = response.json.files[0];
    ok(file && file.ok === false, 'HTML thiếu quiz-data vẫn được chấp nhận.');
    ok((file.errors || []).join(' ').indexOf('quiz-data') >= 0, 'Thiếu thông báo lỗi quiz-data.');
  });

  await step('A12. Không nhận uploadId kiểu path traversal', async () => {
    const response = await planItems([{ uploadId: '../../assets/js/catalog.js', mode: 'new', subjectId: 'toan' }]);
    ok(response.status === 400, 'Mong đợi 400, nhận ' + response.status);
  });

  await step('A13. Môi trường và thư viện đọc được', async () => {
    const env = await request('GET', '/api/env', { headers: authed() });
    ok(env.status === 200, 'HTTP ' + env.status);
    ok(env.json.node && env.json.node.version, 'Thiếu thông tin Node.');
    ok(env.json.project && env.json.project.name, 'Thiếu tên dự án.');
    const library = await request('GET', '/api/library', { headers: authed() });
    ok(library.status === 200, 'HTTP ' + library.status);
    ok(Array.isArray(library.json.subjects) && library.json.subjects.length > 0, 'Thư viện không có môn.');
    ok(library.json.examCount > 0, 'Thư viện không có đề.');
  });

  /* ---------- B. Kiểm tra hợp lệ và kế hoạch ---------- */
  const caseA = { id: uniqueId('helpercheck'), content: '', uploadId: '' };
  await step('B1. Nhận đề hợp lệ và suy ra môn từ tên file', async () => {
    const number = 9000 + Math.floor(Math.random() * 900);
    const fileName = 'de_toan_' + number + '.html';
    caseA.content = rewriteQuiz(template, (data) => {
      data.id = caseA.id;
      data.title = 'Đề kiểm thử Local Helper';
    });
    const response = await uploadFiles([{ name: fileName, encoding: 'text', content: caseA.content }]);
    ok(response.status === 200, 'HTTP ' + response.status);
    const file = response.json.files[0];
    ok(file && file.ok === true, 'Đề hợp lệ bị đánh dấu lỗi: ' + JSON.stringify(file && file.errors));
    ok(file.uploadId && /^[a-f0-9]{32}$/.test(file.uploadId), 'uploadId không hợp lệ.');
    ok(file.inferredSubjectId === 'toan', 'Suy ra môn sai: ' + file.inferredSubjectId);
    caseA.uploadId = file.uploadId;
  });

  await step('B2. Kế hoạch mặc định là thêm mới, không ghi đè', async () => {
    const response = await planItems([{ uploadId: caseA.uploadId, mode: 'new', subjectId: 'toan' }]);
    ok(response.status === 200, 'HTTP ' + response.status);
    const item = response.json.items[0];
    ok(item.action === 'add', 'Hành động mong đợi add, nhận ' + item.action);
    ok(/^toan_\d+$/.test(item.id), 'Mã đề mới không hợp lệ: ' + item.id);
    ok(response.json.summary.canDeploy === true, 'Kế hoạch chưa sẵn sàng.');
    caseA.plan = item;
  });

  await step('B3. Đề trùng mã được cảnh báo và thêm thành mã mới', async () => {
    const number = 9100 + Math.floor(Math.random() * 800);
    const response = await uploadFiles([{
      name: 'de_toan_' + number + '.html',
      encoding: 'text',
      content: template
    }]);
    const file = response.json.files[0];
    ok(file.ok === true, 'Đề mẫu hợp lệ nhưng bị lỗi.');
    ok(file.duplicate && file.duplicate.id, 'Không phát hiện mã đề trùng.');
    const plan = await planItems([{ uploadId: file.uploadId, mode: 'new', subjectId: 'toan' }]);
    const item = plan.json.items[0];
    ok(item.action === 'add', 'Mong đợi add, nhận ' + item.action);
    ok(item.duplicate === true, 'Thiếu cờ duplicate.');
    const originalId = readQuiz(template).id;
    ok(item.id !== originalId, 'Đề mới dùng lại mã cũ: ' + item.id);
    const update = await planItems([{ uploadId: file.uploadId, mode: 'update', subjectId: '' }]);
    const updateItem = update.json.items[0];
    ok(updateItem.action === 'skip', 'Nội dung không đổi nhưng hành động là ' + updateItem.action);
    ok(update.json.summary.canDeploy === false, 'Không có thay đổi nhưng vẫn cho deploy.');
    const deploy = await deployItems([{ uploadId: file.uploadId, mode: 'update', subjectId: '' }]);
    ok(deploy.status === 400, 'Mong đợi 400, nhận ' + deploy.status);
    ok(deploy.json && deploy.json.error === 'PLAN_NOT_READY', 'Sai mã lỗi deploy.');
  });

  await step('B4. Chặn deploy khi còn file lỗi', async () => {
    const bad = await uploadFiles([{ name: 'de_toan_9998.html', encoding: 'text', content: '<html></html>' }]);
    const badFile = bad.json.files[0];
    ok(badFile.ok === false, 'File lỗi không bị phát hiện.');
    const response = await deployItems([{ uploadId: badFile.uploadId || '', mode: 'new', subjectId: 'toan' }]);
    ok(response.status === 400, 'Mong đợi 400, nhận ' + response.status);
  });

  await step('B5. Nhận nhiều file và giải nén ZIP hợp lệ', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helper-zip-'));
    try {
      const zipName = 'de_toan_' + (9700 + Math.floor(Math.random() * 100)) + '.html';
      const zipSource = path.join(dir, zipName);
      fs.writeFileSync(zipSource, rewriteQuiz(template, (data) => {
        data.id = uniqueId('zipcheck');
        data.title = 'Đề kiểm thử ZIP';
      }), 'utf8');
      const zipPath = path.join(dir, 'bo-de.zip');
      const safe = (value) => value.replace(/'/g, "''");
      runPowerShell("Compress-Archive -LiteralPath '" + safe(zipSource) + "' -DestinationPath '" + safe(zipPath) + "' -Force");

      const extraName = 'de_toan_' + (9800 + Math.floor(Math.random() * 100)) + '.html';
      const extra = rewriteQuiz(template, (data) => {
        data.id = uniqueId('multicheck');
        data.title = 'Đề kiểm thử nhiều file';
      });

      const response = await uploadFiles([
        { name: 'bo-de.zip', encoding: 'base64', content: fs.readFileSync(zipPath).toString('base64') },
        { name: extraName, encoding: 'text', content: extra }
      ]);
      ok(response.status === 200, 'HTTP ' + response.status + ' ' + response.text.slice(0, 200));
      const files = response.json.files || [];
      ok(files.length === 2, 'Mong đợi 2 kết quả, nhận ' + files.length);
      ok(files.every((file) => file.ok === true), 'Có file hợp lệ bị đánh dấu lỗi.');
      ok(files.every((file) => /^[a-f0-9]{32}$/.test(file.uploadId || '')), 'Thiếu uploadId.');
      ok(files.every((file) => file.inferredSubjectId === 'toan'), 'Suy ra môn sai.');
      ok(files.some((file) => /bo-de\.zip/.test(file.relativePath || '')), 'Thiếu đường dẫn trong ZIP.');
      const plan = await planItems(files.map((file) => ({ uploadId: file.uploadId, mode: 'new', subjectId: 'toan' })));
      ok(plan.status === 200 && plan.json.summary.add === 2, 'Kế hoạch nhiều file sai.');
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) {}
    }
  });

  await step('B6. Chặn ZIP có đường dẫn thoát thư mục tạm', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helper-badzip-'));
    const escapePath = path.join(SESSION_DIR, 'staging', 'evil.html');
    try {
      const zipPath = path.join(dir, 'doc.zip');
      const safe = (value) => value.replace(/'/g, "''");
      runPowerShell([
        'Add-Type -AssemblyName System.IO.Compression.FileSystem',
        "$zip = [System.IO.Compression.ZipFile]::Open('" + safe(zipPath) + "', 'Create')",
        "$entry = $zip.CreateEntry('../evil.html')",
        '$writer = New-Object System.IO.StreamWriter($entry.Open())',
        "$writer.Write('<html><script id=\"quiz-data\">{}</script></html>')",
        '$writer.Dispose()',
        '$zip.Dispose()'
      ].join('; '));

      const response = await uploadFiles([{
        name: 'doc.zip',
        encoding: 'base64',
        content: fs.readFileSync(zipPath).toString('base64')
      }]);
      ok(response.status === 200, 'HTTP ' + response.status);
      const file = response.json.files[0];
      ok(file && file.ok === false, 'ZIP path traversal không bị chặn.');
      ok(file.uploadId === null, 'ZIP lỗi vẫn có uploadId.');
      ok(!fs.existsSync(escapePath), 'File độc hại đã thoát khỏi thư mục tạm.');
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) {}
    }
  });

  /* ---------- C. Deploy thành công, chống deploy song song ---------- */
  await step('C1. Deploy thành công, chặn deploy song song, có log tiến trình', async () => {
    const items = [{ uploadId: caseA.uploadId, mode: 'new', subjectId: 'toan' }];
    const first = await deployItems(items);
    ok(first.status === 202, 'Mong đợi 202, nhận ' + first.status + ' ' + first.text.slice(0, 200));
    const jobId = first.json.job.id;

    const second = await deployItems(items);
    ok(second.status === 409, 'Deploy song song không bị chặn (HTTP ' + second.status + ').');
    ok(second.json && second.json.error === 'BUSY', 'Sai mã lỗi deploy song song.');
    ok(second.json.jobId === jobId, 'Mã job trả về không khớp.');

    const current = await request('GET', '/api/jobs/current', { headers: authed() });
    ok(current.status === 200 && current.json && current.json.id === jobId, 'Không thấy job đang chạy.');

    const job = await pollJob(jobId);
    caseA.job = job;
    ok(job.state === 'success', 'Job kết thúc với trạng thái "' + job.state + '": ' + job.error);
    ok(job.result && job.result.deployed === false, 'NO_DEPLOY chưa được bật (deployed=' + (job.result && job.result.deployed) + ').');
    ok(job.summary && job.summary.add === 1, 'Tóm tắt thêm mới sai.');
    ok(job.allLogs && job.allLogs.length > 0, 'Không có log.');
    ok(job.allLogs.some((entry) => /NO-DEPLOY/i.test(entry.text || '')), 'Log thiếu dấu hiệu NO-DEPLOY.');
  });

  await step('C2. Đề mới có trong file và catalog, đề cũ không đổi', async () => {
    const dest = path.join(root, caseA.plan.file);
    ok(fs.existsSync(dest), 'Không tìm thấy file đề mới: ' + caseA.plan.file);
    const data = readQuiz(fs.readFileSync(dest, 'utf8'));
    ok(data.id === caseA.plan.id, 'Mã trong đề mới sai: ' + data.id);
    const catalog = fs.readFileSync(catalogPath, 'utf8');
    ok(hashFile(catalogPath) !== catalogBefore, 'Catalog không thay đổi.');
    ok(catalog.indexOf(caseA.plan.id) >= 0, 'Catalog thiếu mã đề mới.');
    ok(hashFile(templatePath) === templateHashBefore, 'Đề mẫu bị thay đổi.');
    if (sinhBefore) ok(hashFile(sinhPath) === sinhBefore, 'Đề sinh chưa theo dõi bị thay đổi.');
  });

  /* ---------- D. Cập nhật đề cũ có sao lưu ---------- */
  const caseB = { content: '', uploadId: '', plan: null };
  await step('D1. Cập nhật nội dung đề cũ, tạo bản sao lưu', async () => {
    const dest = path.join(root, caseA.plan.file);
    const original = fs.readFileSync(dest, 'utf8');
    const originalHash = sha(original);
    const marker = 'Nội dung cập nhật kiểm thử ' + Date.now();
    caseB.content = rewriteQuiz(original, (data) => {
      data.id = caseA.plan.id;
      if (!Array.isArray(data.questions) || !data.questions.length) data.questions = [{ text: '', points: 1 }];
      data.questions[0].text = String(data.questions[0].text || '') + ' ' + marker;
    });
    const response = await uploadFiles([{
      name: 'de_toan_' + (9200 + Math.floor(Math.random() * 500)) + '.html',
      encoding: 'text',
      content: caseB.content
    }]);
    const file = response.json.files[0];
    ok(file && file.duplicate && file.duplicate.id === caseA.plan.id, 'Không nhận ra đề trùng để cập nhật.');
    caseB.uploadId = file.uploadId;

    const plan = await planItems([{ uploadId: caseB.uploadId, mode: 'update', subjectId: '' }]);
    ok(plan.status === 200, 'HTTP ' + plan.status);
    const item = plan.json.items[0];
    ok(item.action === 'update', 'Hành động mong đợi update, nhận ' + item.action);
    ok(item.id === caseA.plan.id, 'Cập nhật sai mã đề.');
    caseB.plan = item;

    const deployed = await deployItems([{ uploadId: caseB.uploadId, mode: 'update', subjectId: '' }]);
    ok(deployed.status === 202, 'Mong đợi 202, nhận ' + deployed.status);
    const job = await pollJob(deployed.json.job.id);
    ok(job.state === 'success', 'Cập nhật thất bại: ' + job.error);
    ok(job.result && job.result.updated === 1, 'Kết quả không ghi nhận cập nhật.');

    const updated = fs.readFileSync(dest, 'utf8');
    ok(sha(updated) !== originalHash, 'File đề không thay đổi sau cập nhật.');
    ok(updated.indexOf(marker) >= 0, 'Nội dung cập nhật không có trong file.');

    const backupRoot = path.join(root, 'backups', 'exam-updates');
    const backup = findFileByHash(backupRoot, originalHash);
    ok(backup, 'Không tìm thấy bản sao lưu đề cũ trong backups/exam-updates/.');
    if (sinhBefore) ok(hashFile(sinhPath) === sinhBefore, 'Đề sinh chưa theo dõi bị thay đổi.');
    caseB.content = updated;
  });

  /* ---------- E. Bỏ qua khi nội dung không đổi ---------- */
  await step('E1. Nội dung không đổi thì bỏ qua và không cho deploy', async () => {
    const response = await uploadFiles([{
      name: 'de_toan_' + (9300 + Math.floor(Math.random() * 400)) + '.html',
      encoding: 'text',
      content: caseB.content
    }]);
    const file = response.json.files[0];
    ok(file.duplicate && file.duplicate.id === caseA.plan.id, 'Không nhận ra đề trùng.');
    const plan = await planItems([{ uploadId: file.uploadId, mode: 'update', subjectId: '' }]);
    const item = plan.json.items[0];
    ok(item.action === 'skip', 'Mong đợi skip, nhận ' + item.action);
    ok(plan.json.summary.canDeploy === false, 'Vẫn cho deploy khi không có thay đổi.');
    const deployed = await deployItems([{ uploadId: file.uploadId, mode: 'update', subjectId: '' }]);
    ok(deployed.status === 400, 'Mong đợi 400, nhận ' + deployed.status);
  });

  /* ---------- F. Rollback khi pipeline lỗi ---------- */
  const caseC = { id: uniqueId('helperrollback'), uploadId: '', plan: null };
  await step('F1. Pipeline lỗi thì khôi phục catalog và đề cũ', async () => {
    const fileName = 'de_toan_' + (9400 + Math.floor(Math.random() * 300)) + '.html';
    const content = rewriteQuiz(template, (data) => {
      data.id = caseC.id;
      data.title = 'Đề kiểm thử rollback';
    });
    const uploaded = await uploadFiles([{ name: fileName, encoding: 'text', content }]);
    const file = uploaded.json.files[0];
    ok(file && file.ok === true, 'Đề rollback không hợp lệ.');
    caseC.uploadId = file.uploadId;
    const plan = await planItems([{ uploadId: caseC.uploadId, mode: 'new', subjectId: 'toan' }]);
    ok(plan.status === 200 && plan.json.summary.canDeploy === true, 'Kế hoạch rollback chưa sẵn sàng.');
    caseC.plan = plan.json.items[0];

    const catalogBaseline = hashFile(catalogPath);
    const examsBaseline = treeHash(examsDir);
    const scriptPath = path.join(root, '_system', 'tools', 'update-and-deploy.ps1');
    const originalScript = fs.readFileSync(scriptPath);
    try {
      fs.writeFileSync(scriptPath, [
        'param([switch]$SkipImport, [switch]$NoDeploy, [switch]$Yes)',
        'Write-Output "SIMULATED-FAILURE"',
        'exit 1',
        ''
      ].join('\r\n'), 'utf8');

      const deployed = await deployItems([{ uploadId: caseC.uploadId, mode: 'new', subjectId: 'toan' }]);
      ok(deployed.status === 202, 'Mong đợi 202, nhận ' + deployed.status);
      const job = await pollJob(deployed.json.job.id);
      ok(job.state === 'failed', 'Job phải thất bại, nhận ' + job.state);
      ok(job.result && job.result.errors === 1, 'Kết quả lỗi không được ghi nhận.');
      ok(fs.existsSync(path.join(root, caseC.plan.file)) === false, 'File đề lỗi vẫn còn sau rollback.');
      ok(hashFile(catalogPath) === catalogBaseline, 'Catalog không được khôi phục.');
      ok(treeHash(examsDir) === examsBaseline, 'Thư mục exams không được khôi phục.');
      if (sinhBefore) ok(hashFile(sinhPath) === sinhBefore, 'Đề sinh chưa theo dõi bị mất khi rollback.');
    } finally {
      fs.writeFileSync(scriptPath, originalScript);
    }
  });

  /* ---------- G. Giới hạn kích thước body ---------- */
  await step('G1. Từ chối body vượt 64 MB và vẫn phục vụ tiếp', async () => {
    const prefix = Buffer.from('{"files":[{"name":"big.html","encoding":"text","content":"');
    const suffix = Buffer.from('"}]}');
    const body = Buffer.concat([prefix, Buffer.alloc(65 * 1024 * 1024, 0x61), suffix]);
    const response = await request('POST', '/api/files', {
      headers: authed({ 'Content-Type': 'application/json' }),
      raw: true,
      body,
      timeout: 120000
    });
    ok(response.status === 413, 'Mong đợi 413, nhận ' + response.status + (response.error ? ' (' + response.error.code + ')' : ''));
    const health = await request('GET', '/api/health', { headers: authed() });
    ok(health.status === 200, 'Helper không phản hồi sau body quá lớn.');
  });

  /* ---------- H. Khởi động lại và log ---------- */
  await step('H1. Không khởi động thêm helper khi đã có phiên', async () => {
    let output = '';
    try {
      output = execFileSync(process.execPath, [path.join(root, '_system', 'tools', 'local-helper.js'), '--no-open'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 30000,
        env: Object.assign({}, process.env, {
          EXAM_HELPER_ROOT: root,
          EXAM_HELPER_SESSION_DIR: SESSION_DIR,
          EXAM_HELPER_PORT: String(session.port),
          EXAM_HELPER_NO_OPEN: '1',
          EXAM_HELPER_NO_DEPLOY: '1'
        })
      });
    } catch (error) {
      throw new Error('Tiến trình thứ hai thoát lỗi: ' + (error.stderr || error.message));
    }
    ok(/đang chạy sẵn/i.test(output), 'Không phát hiện helper đang chạy: ' + output.trim());
    const health = await request('GET', '/api/health', { headers: authed() });
    ok(health.status === 200 && health.json.pid === session.pid, 'Helper gốc không còn phản hồi đúng.');
  });

  await step('H2. Log không chứa token, session không nằm trong repo', async () => {
    const logPath = path.join(SESSION_DIR, 'helper.log');
    ok(fs.existsSync(logPath), 'Không tìm thấy helper.log.');
    const log = fs.readFileSync(logPath, 'utf8');
    ok(log.indexOf(TOKEN) < 0, 'Token bị ghi vào log.');
    ok(log.indexOf('/api/') >= 0, 'Log không ghi nhận API.');
    ok(path.resolve(SESSION_DIR).indexOf(path.resolve(root)) !== 0, 'Session được ghi trong thư mục dự án.');
  });

  /* ---------- Tổng kết ---------- */
  console.log('');
  console.log('=== KẾT QUẢ: ' + passes.length + ' đạt / ' + failures.length + ' lỗi ===');
  if (failures.length) {
    failures.forEach((failure) => console.log('  ✗ ' + failure.name + ': ' + failure.message));
    process.exitCode = 1;
  } else {
    console.log('  Tất cả kiểm thử đạt.');
  }

  if (!KEEP) {
    await step('I1. Tắt helper và xóa session', async () => {
      const response = await request('POST', '/api/shutdown', { headers: authed(), body: {} });
      ok(response.status === 200, 'HTTP ' + response.status);
      await sleep(1200);
      const health = await request('GET', '/api/status');
      ok(health.status === 0, 'Helper vẫn phản hồi sau khi tắt.');
      ok(!fs.existsSync(SESSION_FILE), 'Session file chưa được xóa.');
    });
    console.log('');
    console.log('=== KẾT QUẢ CUỐI: ' + passes.length + ' đạt / ' + failures.length + ' lỗi ===');
    if (failures.length) process.exitCode = 1;
  } else {
    console.log('');
    console.log('Giữ helper chạy để kiểm tra giao diện (--keep).');
  }
}

function findFileByHash(dir, targetHash) {
  if (!fs.existsSync(dir)) return null;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && hashFile(full) === targetHash) return full;
    }
  }
  return null;
}

main().catch((error) => {
  console.error('');
  console.error('[LOI] ' + (error && error.stack ? error.stack : error));
  process.exit(1);
});
