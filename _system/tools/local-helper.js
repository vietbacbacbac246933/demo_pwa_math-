#!/usr/bin/env node
/*
 * Local Helper cho giáo viên.
 *
 * Chỉ lắng nghe trên 127.0.0.1. Mỗi lần khởi chạy sinh một token ngẫu nhiên;
 * token chỉ nằm trong URL mở trình duyệt (phần #) và file phiên cục bộ.
 *
 *   node _system/tools/local-helper.js --open
 *   node _system/tools/local-helper.js --shutdown
 *
 * Các API nhạy cảm yêu cầu header X-Helper-Token (hoặc Bearer token), kiểm tra
 * Host/Origin, giới hạn kích thước body và không nhận đường dẫn tùy ý.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const {
  ROOT,
  HOST,
  PORT,
  APP_ID,
  VERSION,
  SESSION_DIR,
  SESSION_FILE,
  HELPER_LOG_FILE,
  STAGING_DIR,
  PUBLIC_URL,
  IDLE_TIMEOUT_MS,
  LIMITS
} = require('./helper/config');

const uploads = require('./helper/uploads');
const repository = require('./helper/repository');
const env = require('./helper/env');
const runner = require('./helper/runner');

const NO_OPEN = process.env.EXAM_HELPER_NO_OPEN === '1' ||
  process.argv.indexOf('--no-open') >= 0;
const SHOULD_OPEN = process.argv.indexOf('--open') >= 0 ||
  (process.argv.indexOf('--no-open') < 0 && process.argv.indexOf('--shutdown') < 0);
const TOKEN = crypto.randomBytes(32).toString('hex');
const TOKEN_BUFFER = Buffer.from(TOKEN, 'utf8');
const STARTED_AT = Date.now();
const ALLOWED_ORIGINS = new Set([
  'http://127.0.0.1:' + PORT,
  'http://localhost:' + PORT
]);
const ALLOWED_HOSTS = new Set([
  '127.0.0.1:' + PORT,
  'localhost:' + PORT
]);

let server = null;
let lastActivity = Date.now();
let shuttingDown = false;
let idleTimer = null;
let helperLogStream = null;

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || '';
  }
}

function ensureSessionDir() {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(STAGING_DIR, { recursive: true });
}

function log(message) {
  const line = '[' + new Date().toISOString() + '] ' + String(message).replace(/\r?\n/g, ' ') + '\n';
  try {
    if (!helperLogStream) {
      ensureSessionDir();
      helperLogStream = fs.createWriteStream(HELPER_LOG_FILE, { flags: 'a' });
    }
    helperLogStream.write(line);
  } catch (error) {
    // Không làm hỏng server.
  }
}

function stripToken(value) {
  return String(value == null ? '' : value).split(TOKEN).join('<token>');
}

function safeEqual(value) {
  const given = Buffer.from(String(value || ''), 'utf8');
  if (given.length !== TOKEN_BUFFER.length) return false;
  return crypto.timingSafeEqual(given, TOKEN_BUFFER);
}

function requestToken(req) {
  const header = req.headers['x-helper-token'];
  if (header) return String(header);
  const auth = String(req.headers.authorization || '');
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function requireToken(req) {
  if (!safeEqual(requestToken(req))) {
    throw new HttpError(401, 'Phiên kết nối không hợp lệ hoặc đã hết hạn.', 'UNAUTHORIZED');
  }
}

function checkRequest(req) {
  const host = String(req.headers.host || '').toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) {
    throw new HttpError(403, 'Host không được phép.', 'BAD_HOST');
  }
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(String(origin))) {
    throw new HttpError(403, 'Origin không được phép.', 'BAD_ORIGIN');
  }
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    throw new HttpError(405, 'Phương thức không được hỗ trợ.', 'METHOD');
  }
  if (method === 'POST' && !origin) {
    throw new HttpError(403, 'Thiếu Origin cho yêu cầu thay đổi dữ liệu.', 'MISSING_ORIGIN');
  }
}

function securityHeaders(extra) {
  return Object.assign({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  }, extra || {});
}

function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  res.writeHead(status, securityHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length
  }));
  res.end(body);
}

function sendText(res, status, text, contentType) {
  const body = Buffer.from(String(text), 'utf8');
  res.writeHead(status, securityHeaders({
    'Content-Type': contentType || 'text/plain; charset=utf-8',
    'Content-Length': body.length
  }));
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > LIMITS.maxBodyBytes) {
        chunks.length = 0;
        fail(new HttpError(413, 'Dữ liệu gửi lên quá lớn.', 'BODY_TOO_LARGE'));
        // Xả phần còn lại để vẫn gửi được phản hồi 413 thay vì ngắt kết nối.
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new HttpError(400, 'JSON không hợp lệ.', 'BAD_JSON'));
      }
    });
    req.on('error', (error) => fail(error));
  });
}

function requireArray(value, name, max) {
  if (!Array.isArray(value) || !value.length) {
    throw new HttpError(400, 'Thiếu danh sách ' + name + '.', 'BAD_INPUT');
  }
  if (value.length > max) {
    throw new HttpError(400, 'Tối đa ' + max + ' mục mỗi lần.', 'TOO_MANY_FILES');
  }
  return value;
}

function normalizeUploadItems(body) {
  const files = requireArray(body && body.files, 'files', LIMITS.maxFiles);
  return files.map((file) => {
    if (!file || typeof file !== 'object') {
      throw new HttpError(400, 'Mục file không hợp lệ.', 'BAD_INPUT');
    }
    const name = String(file.name || '').slice(0, 300);
    const relativePath = String(file.relativePath || name).slice(0, 300);
    const encoding = file.encoding === 'base64' ? 'base64' : 'text';
    const content = String(file.content == null ? '' : file.content);
    if (!name) throw new HttpError(400, 'File thiếu tên.', 'BAD_INPUT');
    if (Buffer.byteLength(content, 'utf8') > LIMITS.maxBodyBytes) {
      throw new HttpError(413, 'File quá lớn.', 'FILE_TOO_LARGE');
    }
    return { name, relativePath, encoding, content };
  });
}

function stageAndValidate(file) {
  const baseName = path.basename(file.name.replace(/\\/g, '/'));
  if (uploads.isZipName(baseName)) {
    if (file.encoding !== 'base64') {
      throw new Error('File zip phải được gửi dạng base64.');
    }
    const buffer = Buffer.from(file.content, 'base64');
    if (!buffer.length) throw new Error('File zip rỗng.');
    const records = uploads.stageZip(baseName, file.relativePath, buffer);
    return records.map((record) => repository.buildValidation({
      id: record.id,
      name: record.name,
      relativePath: record.relativePath,
      content: fs.readFileSync(record.filePath, 'utf8')
    }));
  }

  if (!uploads.isHtmlName(baseName)) {
    return [{
      uploadId: null,
      name: baseName,
      relativePath: file.relativePath,
      size: Buffer.byteLength(file.content, 'utf8'),
      ok: false,
      errors: ['Định dạng không hỗ trợ. Chỉ nhận .html, .htm hoặc .zip.'],
      warnings: [],
      exam: null,
      inferredSubjectId: null,
      subject: null,
      duplicate: null,
      updateAvailable: false,
      suggestion: null
    }];
  }

  const content = file.encoding === 'base64'
    ? Buffer.from(file.content, 'base64').toString('utf8')
    : file.content;
  const record = uploads.stageContent(baseName, file.relativePath, content);
  return [repository.buildValidation({
    id: record.id,
    name: record.name,
    relativePath: record.relativePath,
    content
  })];
}

function loadUploadsForPlan(body) {
  const rawItems = requireArray(body && body.items, 'items', LIMITS.maxFiles);
  const uploadsById = new Map();
  const items = rawItems.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new HttpError(400, 'Mục đề không hợp lệ.', 'BAD_INPUT');
    }
    const upload = uploads.getUpload(item.uploadId);
    if (!upload) {
      throw new HttpError(400, 'File tạm không còn. Hãy chọn lại file.', 'UPLOAD_EXPIRED');
    }
    uploadsById.set(upload.id, upload);
    return {
      uploadId: upload.id,
      name: upload.name,
      relativePath: upload.relativePath,
      content: fs.readFileSync(upload.filePath, 'utf8'),
      mode: item.mode === 'update' ? 'update' : 'new',
      subjectId: item.subjectId ? String(item.subjectId).slice(0, 60) : ''
    };
  });
  return { items, uploadsById };
}

function openBrowser(url) {
  if (NO_OPEN || !SHOULD_OPEN) {
    log('Bỏ qua mở trình duyệt (EXAM_HELPER_NO_OPEN).');
    return;
  }
  try {
    const child = spawn('cmd.exe', ['/d', '/s', '/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();
    log('Đã mở giao diện trong trình duyệt.');
  } catch (error) {
    log('Không mở được trình duyệt: ' + error.message);
  }
}

function getExistingSession() {
  try {
    const raw = fs.readFileSync(SESSION_FILE, 'utf8');
    const session = JSON.parse(raw);
    if (!session || session.app !== APP_ID || !session.port || !session.token) return null;
    return session;
  } catch (error) {
    return null;
  }
}

function checkExistingHelper(session) {
  return new Promise((resolve) => {
    const req = http.get({
      host: HOST,
      port: session.port,
      path: '/api/status',
      timeout: 1200,
      headers: { Host: '127.0.0.1:' + session.port }
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const info = JSON.parse(data);
          resolve(info && info.app === APP_ID);
        } catch (error) {
          resolve(false);
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function writeSession() {
  ensureSessionDir();
  const url = 'http://' + HOST + ':' + PORT + '/add-exam.html#token=' + TOKEN;
  const session = {
    app: APP_ID,
    version: VERSION,
    pid: process.pid,
    port: PORT,
    root: ROOT,
    startedAt: new Date().toISOString(),
    url,
    token: TOKEN
  };
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(SESSION_FILE, 0o600); } catch (error) {}
  return url;
}

function removeSession() {
  try {
    const current = getExistingSession();
    if (current && current.pid === process.pid) fs.rmSync(SESSION_FILE, { force: true });
  } catch (error) {
    // Bỏ qua.
  }
}

function idleShutdown() {
  if (shuttingDown) return;
  if (runner.getActiveJob()) {
    lastActivity = Date.now();
    return;
  }
  if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
    log('Tự tắt sau thời gian không hoạt động.');
    shutdown('idle');
  }
}

function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('Đang tắt Local Helper (' + reason + ').');
  if (idleTimer) clearInterval(idleTimer);
  try { uploads.clearAll(); } catch (error) {}
  removeSession();
  if (server) {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  } else {
    process.exit(0);
  }
}

async function handle(req, res) {
  lastActivity = Date.now();
  checkRequest(req);
  const method = String(req.method || 'GET').toUpperCase();
  const url = new URL(req.url, 'http://' + HOST + ':' + PORT);
  const pathname = url.pathname;

  if (method === 'GET' && (pathname === '/' || pathname === '/add-exam.html')) {
    const file = path.join(ROOT, '_system', 'ui', 'add-exam.html');
    if (!fs.existsSync(file)) {
      sendText(res, 404, 'Không tìm thấy _system/ui/add-exam.html trong thư mục project.');
      return;
    }
    sendText(res, 200, fs.readFileSync(file, 'utf8'), 'text/html; charset=utf-8');
    return;
  }

  if (method === 'GET' && pathname === '/favicon.ico') {
    res.writeHead(204, securityHeaders());
    res.end();
    return;
  }

  if (method === 'GET' && pathname === '/api/status') {
    const active = runner.getActiveJob();
    sendJson(res, 200, {
      ok: true,
      app: APP_ID,
      version: VERSION,
      uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
      activeJob: active ? { id: active.id, state: active.state, progress: active.progress } : null,
      publicUrl: PUBLIC_URL
    });
    return;
  }

  requireToken(req);

  if (method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      app: APP_ID,
      version: VERSION,
      pid: process.pid,
      uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
      activeJob: runner.getActiveJob() ? runner.getActiveJob().id : null
    });
    return;
  }

  if (method === 'GET' && pathname === '/api/env') {
    sendJson(res, 200, env.getEnvironment({ refresh: url.searchParams.get('refresh') === '1' }));
    return;
  }

  if (method === 'GET' && pathname === '/api/library') {
    sendJson(res, 200, repository.getLibraryInfo());
    return;
  }

  if (method === 'POST' && pathname === '/api/files') {
    const body = await readBody(req);
    const items = normalizeUploadItems(body);
    const results = [];
    for (const item of items) {
      try {
        results.push.apply(results, stageAndValidate(item));
      } catch (error) {
        results.push({
          uploadId: null,
          name: path.basename(String(item.name || 'de.html')),
          relativePath: item.relativePath,
          size: 0,
          ok: false,
          errors: [error.message],
          warnings: [],
          exam: null,
          inferredSubjectId: null,
          subject: null,
          duplicate: null,
          updateAvailable: false,
          suggestion: null
        });
      }
    }
    sendJson(res, 200, {
      files: results,
      subjects: repository.getSubjects(),
      limits: {
        maxFiles: LIMITS.maxFiles,
        maxFileBytes: LIMITS.maxFileBytes
      }
    });
    return;
  }

  if (method === 'POST' && pathname === '/api/plan') {
    const body = await readBody(req);
    const loaded = loadUploadsForPlan(body);
    sendJson(res, 200, repository.computePlan(loaded.items));
    return;
  }

  if (method === 'POST' && pathname === '/api/deploy') {
    if (runner.getActiveJob()) {
      sendJson(res, 409, {
        error: 'BUSY',
        message: 'Đang có một tiến trình deploy chạy. Hãy chờ hoàn tất.',
        jobId: runner.getActiveJob().id
      });
      return;
    }
    const body = await readBody(req);
    const loaded = loadUploadsForPlan(body);
    const plan = repository.computePlan(loaded.items);
    if (!plan.summary.canDeploy) {
      sendJson(res, 400, {
        error: 'PLAN_NOT_READY',
        message: plan.summary.nothingToDo
          ? 'Không có đề nào cần thêm hoặc cập nhật.'
          : 'Còn đề lỗi hoặc chưa xác định môn. Hãy sửa danh sách trước khi đăng.',
        plan
      });
      return;
    }
    const job = runner.createJob(plan, loaded.uploadsById);
    sendJson(res, 202, { job: runner.publicJob(job) });
    runner.runJob(job).catch((error) => log('Lỗi không xử lý trong job: ' + error.message));
    return;
  }

  if (method === 'POST' && (pathname === '/api/exams/delete' || pathname === '/api/exams/rename')) {
    if (runner.getActiveJob()) {
      sendJson(res, 409, {
        error: 'BUSY',
        message: 'Đang có một tiến trình chạy. Hãy chờ hoàn tất.',
        jobId: runner.getActiveJob().id
      });
      return;
    }
    const body = await readBody(req);
    const action = pathname === '/api/exams/delete' ? 'delete' : 'rename';
    const examId = String((body && body.examId) || '').trim();
    if (!examId || /\s/.test(examId) || examId.length > 80) {
      sendJson(res, 400, { error: 'BAD_INPUT', message: 'Mã đề không hợp lệ.' });
      return;
    }
    const existing = repository.getExistingExams().get(examId);
    if (!existing) {
      sendJson(res, 404, {
        error: 'EXAM_NOT_FOUND',
        message: 'Không tìm thấy mã đề "' + examId + '" trong thư viện.'
      });
      return;
    }
    let title = '';
    if (action === 'rename') {
      title = String((body && body.title) || '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .trim()
        .slice(0, 160);
      if (!title) {
        sendJson(res, 400, { error: 'BAD_INPUT', message: 'Thiếu tiêu đề mới.' });
        return;
      }
      if (title === existing.title) {
        sendJson(res, 400, { error: 'BAD_INPUT', message: 'Tiêu đề mới giống tiêu đề cũ.' });
        return;
      }
    }
    const job = runner.createMaintenanceJob({ action, examId, title });
    sendJson(res, 202, { job: runner.publicJob(job) });
    runner.runJob(job).catch((error) => log('Lỗi không xử lý trong job: ' + error.message));
    return;
  }

  if (method === 'GET' && pathname === '/api/jobs/current') {
    const job = runner.getActiveJob() || runner.getLastJob();
    sendJson(res, 200, job ? runner.publicJob(job) : null);
    return;
  }

  const jobMatch = pathname.match(/^\/api\/jobs\/([a-z0-9-]{8,40})(\/log|\/cancel)?$/i);
  if (jobMatch) {
    const job = runner.getJob(jobMatch[1]);
    if (!job) {
      sendJson(res, 404, { error: 'JOB_NOT_FOUND', message: 'Không tìm thấy tiến trình.' });
      return;
    }
    const action = jobMatch[2] || '';
    if (method === 'GET' && action === '/log') {
      const text = job.logs.map((entry) => '[' + entry.at + '] ' + entry.text).join('\r\n');
      sendText(res, 200, text);
      return;
    }
    if (method === 'POST' && action === '/cancel') {
      const result = runner.cancelJob(job);
      sendJson(res, result.ok ? 200 : 409, result);
      return;
    }
    if (method === 'GET' && !action) {
      const since = Math.max(0, Number(url.searchParams.get('since') || 0));
      const payload = runner.publicJob(job);
      payload.logs = job.logs.slice(since);
      payload.nextSince = job.logs.length;
      sendJson(res, 200, payload);
      return;
    }
  }

  if (method === 'POST' && pathname === '/api/shutdown') {
    if (runner.getActiveJob()) {
      sendJson(res, 409, { error: 'BUSY', message: 'Không thể tắt khi đang deploy.' });
      return;
    }
    sendJson(res, 200, { ok: true, message: 'Đang tắt Local Helper.' });
    setTimeout(() => shutdown('api'), 120);
    return;
  }

  sendJson(res, 404, { error: 'NOT_FOUND', message: 'Không có API này.' });
}

function startServer() {
  ensureSessionDir();
  if (!fs.existsSync(path.join(ROOT, '_system', 'tools', 'import-exam.js'))) {
    console.error('[LOI] Không tìm thấy _system/tools/import-exam.js. Hãy chạy trong thư mục project.');
    process.exit(1);
  }

  server = http.createServer((req, res) => {
    const started = Date.now();
    handle(req, res).catch((error) => {
      const status = error && error.status ? error.status : 500;
      const message = error && error.message ? error.message : 'Lỗi không xác định.';
      if (!res.headersSent) {
        sendJson(res, status, {
          error: error.code || 'INTERNAL',
          message: status === 500 ? 'Local Helper gặp lỗi. Xem log để biết chi tiết.' : message
        });
      } else {
        try { res.end(); } catch (closeError) {}
      }
      if (status >= 500) log('Lỗi ' + status + ' ' + req.method + ' ' + req.url + ': ' + stripToken(error && error.stack ? error.stack : message));
    }).finally(() => {
      log(req.method + ' ' + req.url.split('?')[0] + ' -> ' + res.statusCode + ' (' + (Date.now() - started) + 'ms)');
    });
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error('[LOI] Cổng ' + PORT + ' đang được dùng. Hãy đóng ứng dụng khác hoặc đặt EXAM_HELPER_PORT.');
    } else {
      console.error('[LOI] Không khởi động được Local Helper: ' + error.message);
    }
    log('Không khởi động được server: ' + error.message);
    process.exit(1);
  });

  server.listen(PORT, HOST, () => {
    const url = writeSession();
    log('Local Helper ' + VERSION + ' chạy tại http://' + HOST + ':' + PORT + ' (pid ' + process.pid + ').');
    log('Project: ' + ROOT);
    openBrowser(url);
    idleTimer = setInterval(idleShutdown, 60 * 1000);
    idleTimer.unref();
  });
}

function shutdownExisting() {
  return new Promise((resolve) => {
    const session = getExistingSession();
    if (!session) {
      console.error('Không tìm thấy Local Helper đang chạy.');
      resolve(2);
      return;
    }
    const body = JSON.stringify({});
    const req = http.request({
      host: HOST,
      port: session.port,
      path: '/api/shutdown',
      method: 'POST',
      timeout: 3000,
      headers: {
        Host: '127.0.0.1:' + session.port,
        Origin: 'http://127.0.0.1:' + session.port,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Helper-Token': session.token
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log(data || 'Đã gửi yêu cầu tắt.');
        resolve(res.statusCode === 200 ? 0 : 1);
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(1); });
    req.on('error', () => resolve(1));
    req.end(body);
  });
}

async function main() {
  if (process.argv.indexOf('--help') >= 0 || process.argv.indexOf('-h') >= 0) {
    console.log([
      'Cách dùng:',
      '  node _system/tools/local-helper.js --open      Khởi chạy và mở giao diện',
      '  node _system/tools/local-helper.js --no-open   Khởi chạy, không mở trình duyệt',
      '  node _system/tools/local-helper.js --shutdown  Tắt Local Helper đang chạy',
      '',
      'Biến môi trường chỉ dùng khi kiểm thử:',
      '  EXAM_HELPER_PORT, EXAM_HELPER_ROOT, EXAM_HELPER_SESSION_DIR,',
      '  EXAM_HELPER_NO_OPEN=1, EXAM_HELPER_NO_DEPLOY=1'
    ].join('\n'));
    return;
  }

  if (process.argv.indexOf('--shutdown') >= 0) {
    process.exitCode = await shutdownExisting();
    return;
  }

  const existing = getExistingSession();
  if (existing && await checkExistingHelper(existing)) {
    console.log('Local Helper đang chạy sẵn. Không khởi động thêm.');
    if (SHOULD_OPEN && !NO_OPEN) openBrowser(existing.url);
    return;
  }

  startServer();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  log('uncaughtException: ' + (error && error.stack ? error.stack : error));
  console.error('[LOI] ' + (error && error.message ? error.message : error));
  process.exitCode = 1;
});
process.on('unhandledRejection', (error) => {
  log('unhandledRejection: ' + (error && error.stack ? error.stack : error));
  console.error('[LOI] ' + (error && error.message ? error.message : error));
});

main().catch((error) => {
  log('Không khởi chạy được: ' + (error && error.stack ? error.stack : error));
  console.error('[LOI] ' + (error && error.message ? error.message : error));
  process.exit(1);
});
