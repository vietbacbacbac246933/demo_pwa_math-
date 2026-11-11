'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const winFile = require('./win-file');
const {
  ROOT,
  BACKUP_DIR,
  JOB_DIR,
  STAGING_DIR,
  LIMITS,
  DISABLE_DEPLOY,
  PUBLIC_URL
} = require('./config');

let activeJob = null;
let lastJob = null;
const jobs = new Map();

const SNAPSHOT_FILES = [
  'assets/js/catalog.js',
  'assets/js/library.js',
  'assets/js/exam-revs.js',
  'sw.js',
  'functions/_lib/exam-data.js'
];
const SNAPSHOT_DIRS = ['exams'];

class CancelledError extends Error {}

function jobId() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return stamp + '-' + crypto.randomBytes(4).toString('hex');
}

function ensureDirs() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.mkdirSync(JOB_DIR, { recursive: true });
  fs.mkdirSync(STAGING_DIR, { recursive: true });
}

function appendLog(job, text, level) {
  const lines = String(text == null ? '' : text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  lines.forEach((line) => {
    const clean = line.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').slice(0, 2000);
    if (!clean.trim() && level === 'raw') return;
    job.logs.push({
      i: job.logs.length,
      at: new Date().toISOString(),
      level: level || 'info',
      text: clean
    });
  });
  if (job.logs.length > LIMITS.maxLogLines) {
    job.logs.splice(0, job.logs.length - LIMITS.maxLogLines);
    job.logs.forEach((entry, index) => { entry.i = index; });
  }
}

function setPhase(job, key, label, progress, message) {
  job.phase = key;
  job.phaseLabel = label;
  job.progress = Math.max(job.progress || 0, Math.min(99, progress));
  job.message = message || label;
  appendLog(job, '▶ ' + label, 'step');
}

function errorLine(line) {
  return /\b(LỖI|ERROR|Error|error|FAIL|fail|thất bại|không tìm thấy|Không tìm thấy)\b/.test(line);
}

function handlePipelineLine(job, line) {
  const text = line.trim();
  if (!text) return;

  if (/===\s*2\/8/.test(text)) {
    setPhase(job, 'patch', 'Tích hợp ô lớp và hàng đợi nộp bài', 30, 'Đang tích hợp đề với hệ thống nộp bài…');
  } else if (/===\s*3\/8/.test(text)) {
    setPhase(job, 'exam-data', 'Cập nhật đáp án chuẩn phía máy chủ', 42, 'Đang cập nhật bộ đáp án chấm điểm…');
  } else if (/===\s*4\/8/.test(text)) {
    setPhase(job, 'cache', 'Cập nhật hash cho Service Worker', 52, 'Đang cập nhật cache trình duyệt…');
  } else if (/===\s*5\/9/.test(text)) {
    setPhase(job, 'check', 'Kiểm tra thư viện đề', 60, 'Đang kiểm tra toàn bộ thư viện…');
  } else if (/===\s*6\/9/.test(text)) {
    setPhase(job, 'sw-lazy', 'Kiểm tra cache lười', 68, 'Đang kiểm tra chế độ tải đề khi cần…');
  } else if (/===\s*7\/9/.test(text)) {
    setPhase(job, 'scoring', 'Đối chiếu chấm điểm', 76, 'Đang đối chiếu cách chấm điểm…');
  } else if (/===\s*8\/9/.test(text)) {
    setPhase(job, 'verify', 'Xác nhận đề đã tích hợp đầy đủ', 84, 'Đang xác nhận lần cuối…');
  } else if (/===\s*9\/9/.test(text)) {
    setPhase(job, 'bump', 'Tăng phiên bản cache', 90, 'Đang tăng phiên bản cache…');
  } else if (/Deploy len Cloudflare Pages/i.test(text)) {
    job.deployStarted = true;
    job.canCancel = false;
    setPhase(job, 'deploy', 'Đang tải lên Cloudflare Pages', 95, 'Đang tải đề lên Cloudflare Pages…');
  } else if (/XONG:\s*da cap nhat de va deploy/i.test(text)) {
    setPhase(job, 'done', 'Hoàn tất', 100, 'Đã đăng đề lên thư viện.');
  } else if (/NO-DEPLOY:/i.test(text)) {
    setPhase(job, 'done', 'Đã chạy xong (chế độ thử)', 100, 'Pipeline đã chạy xong nhưng chưa deploy.');
  }

  appendLog(job, text, errorLine(text) ? 'error' : 'raw');
}

function lineReader(onLine) {
  let buffer = '';
  return {
    push(chunk) {
      buffer += chunk.toString('utf8');
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        onLine(line);
        index = buffer.indexOf('\n');
      }
    },
    flush() {
      if (buffer) {
        onLine(buffer.replace(/\r$/, ''));
        buffer = '';
      }
    }
  };
}

function runProcess(job, file, args, onLine) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(file, args, {
        cwd: ROOT,
        windowsHide: true,
        env: Object.assign({}, process.env, {
          NO_COLOR: '1',
          FORCE_COLOR: '0',
          WRANGLER_SEND_METRICS: 'false'
        })
      });
    } catch (error) {
      reject(error);
      return;
    }
    job.process = child;
    const stdout = lineReader((line) => onLine(line));
    const stderr = lineReader((line) => onLine(line));
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      stdout.flush();
      stderr.flush();
      job.process = null;
      if (job.cancelRequested) {
        reject(new CancelledError('Đã dừng theo yêu cầu.'));
        return;
      }
      resolve(typeof code === 'number' ? code : 1);
    });
  });
}

function killTree(pid) {
  if (!pid) return;
  try {
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      timeout: 10000,
      stdio: 'ignore'
    });
  } catch (error) {
    // Best effort.
  }
}

function copyFileIfExists(source, target) {
  if (!fs.existsSync(source)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return true;
}

function createSnapshot(job) {
  const dir = path.join(BACKUP_DIR, 'job-' + job.id);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = { jobId: job.id, createdAt: new Date().toISOString(), files: [], dirs: [] };

  SNAPSHOT_FILES.forEach((rel) => {
    const source = path.join(ROOT, rel);
    const target = path.join(dir, rel);
    if (copyFileIfExists(source, target)) {
      manifest.files.push(rel);
    }
  });
  SNAPSHOT_DIRS.forEach((rel) => {
    const source = path.join(ROOT, rel);
    const target = path.join(dir, rel);
    if (fs.existsSync(source)) {
      fs.cpSync(source, target, { recursive: true });
      manifest.dirs.push(rel);
    }
  });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  job.snapshotDir = dir;
  appendLog(job, 'Đã sao lưu thư viện hiện tại vào thư mục phiên: backups/job-' + job.id + '.', 'info');
  return dir;
}

function restoreSnapshot(job) {
  if (!job.snapshotDir || !fs.existsSync(job.snapshotDir)) {
    appendLog(job, 'Không tìm thấy bản sao lưu để khôi phục.', 'error');
    return false;
  }
  const manifestPath = path.join(job.snapshotDir, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    appendLog(job, 'Không đọc được manifest sao lưu: ' + error.message, 'error');
    return false;
  }

  try {
    SNAPSHOT_DIRS.forEach((rel) => {
      const source = path.join(job.snapshotDir, rel);
      const target = path.join(ROOT, rel);
      if (fs.existsSync(source)) {
        fs.rmSync(target, { recursive: true, force: true });
        fs.cpSync(source, target, { recursive: true });
      }
    });
    SNAPSHOT_FILES.forEach((rel) => {
      const source = path.join(job.snapshotDir, rel);
      const target = path.join(ROOT, rel);
      if (fs.existsSync(source)) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        winFile.copyFileSync(source, target);
      } else if (!manifest.files.includes(rel)) {
        try { fs.rmSync(target, { force: true }); } catch (error) {}
      }
    });
    appendLog(job, 'Đã khôi phục đề cũ và danh mục về trạng thái trước khi đăng.', 'info');
    return true;
  } catch (error) {
    appendLog(job, 'Khôi phục thất bại: ' + error.message, 'error');
    return false;
  }
}

function cleanupOldBackups(keep) {
  try {
    const dirs = fs.readdirSync(BACKUP_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('job-'))
      .map((entry) => entry.name)
      .sort();
    while (dirs.length > keep) {
      const name = dirs.shift();
      try { fs.rmSync(path.join(BACKUP_DIR, name), { recursive: true, force: true }); } catch (error) {}
    }
  } catch (error) {
    // Không quan trọng.
  }
}

function saveJob(job) {
  try {
    ensureDirs();
    const data = {
      id: job.id,
      state: job.state,
      phase: job.phase,
      phaseLabel: job.phaseLabel,
      progress: job.progress,
      message: job.message,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      result: job.result,
      error: job.error,
      summary: job.summary
    };
    fs.writeFileSync(path.join(JOB_DIR, job.id + '.json'), JSON.stringify(data, null, 2), 'utf8');
    fs.writeFileSync(
      path.join(JOB_DIR, job.id + '.log'),
      job.logs.map((entry) => '[' + entry.at + '] ' + entry.text).join('\r\n'),
      'utf8'
    );
  } catch (error) {
    // Không làm hỏng job chỉ vì không ghi được log.
  }
}

function prepareWorkCopy(job, upload, planItem) {
  const workDir = path.join(STAGING_DIR, 'work-' + job.id);
  fs.mkdirSync(workDir, { recursive: true });
  let fileName;
  if (planItem.action === 'update') {
    fileName = path.basename(upload.name);
  } else {
    fileName = 'de_' + planItem.subjectId + '_' + planItem.number + '.html';
  }
  const target = path.join(workDir, planItem.uploadId + '-' + fileName);
  fs.copyFileSync(upload.filePath, target);
  return target;
}

function cleanupWork(job) {
  try { fs.rmSync(path.join(STAGING_DIR, 'work-' + job.id), { recursive: true, force: true }); } catch (error) {}
}

function publicJob(job) {
  return {
    id: job.id,
    state: job.state,
    phase: job.phase,
    phaseLabel: job.phaseLabel,
    progress: job.progress,
    message: job.message,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    canCancel: job.canCancel,
    cancelRequested: job.cancelRequested,
    deployStarted: job.deployStarted,
    summary: job.summary,
    result: job.result,
    error: job.error,
    actionLabel: job.actionLabel || null,
    maintenance: job.maintenance || null,
    logCount: job.logs.length,
    logs: job.logs,
    publicUrl: PUBLIC_URL
  };
}

function createJob(plan, uploadsById) {
  ensureDirs();
  const job = {
    id: jobId(),
    state: 'running',
    phase: 'prepare',
    phaseLabel: 'Chuẩn bị',
    progress: 2,
    message: 'Đang chuẩn bị đăng đề…',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    canCancel: true,
    cancelRequested: false,
    deployStarted: false,
    summary: plan.summary,
    result: null,
    error: '',
    logs: [],
    process: null,
    snapshotDir: '',
    plan,
    uploadsById
  };
  jobs.set(job.id, job);
  activeJob = job;
  lastJob = job;
  return job;
}

// Job cho thao tác xóa / đổi tên đề (không có file upload).
function createMaintenanceJob(options) {
  ensureDirs();
  const action = options && options.action === 'delete' ? 'delete' : 'rename';
  const examId = String((options && options.examId) || '');
  const title = String((options && options.title) || '');
  const label = action === 'delete' ? 'Xóa đề' : 'Đổi tên đề';
  const job = {
    id: jobId(),
    state: 'running',
    phase: 'prepare',
    phaseLabel: 'Chuẩn bị',
    progress: 2,
    message: 'Đang chuẩn bị ' + label.toLowerCase() + ' đề ' + examId + '…',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    canCancel: true,
    cancelRequested: false,
    deployStarted: false,
    actionLabel: label,
    maintenance: { action, examId, title },
    summary: { add: 0, update: 0, skip: 0, error: 0, total: 1, duplicates: 0, nothingToDo: false, canDeploy: true },
    result: null,
    error: '',
    logs: [],
    process: null,
    snapshotDir: '',
    // plan ảo để phần lỗi/khôi phục dùng chung mã với runJob.
    plan: {
      ok: true,
      items: [],
      warnings: [],
      summary: { add: 0, update: 0, skip: 0, error: 0, total: 1, duplicates: 0, nothingToDo: false, canDeploy: true }
    },
    uploadsById: new Map()
  };
  jobs.set(job.id, job);
  activeJob = job;
  lastJob = job;
  return job;
}

function cancelJob(job) {
  if (!job || job.state !== 'running') {
    return { ok: false, reason: 'Không có tiến trình đang chạy.' };
  }
  if (job.deployStarted) {
    return {
      ok: false,
      reason: 'Đang tải lên Cloudflare. Dừng lúc này có thể để lại bản deploy dở dang, nên hệ thống sẽ để tiến trình hoàn tất.'
    };
  }
  job.cancelRequested = true;
  job.canCancel = false;
  appendLog(job, '⏹ Đã yêu cầu dừng. Đang hủy an toàn…', 'warn');
  if (job.process && job.process.pid) killTree(job.process.pid);
  return { ok: true };
}

async function runJob(job) {
  if (job && job.maintenance) {
    return runMaintenanceJob(job);
  }
  appendLog(job, 'Bắt đầu đăng ' + job.plan.summary.total + ' đề lên thư viện.', 'step');
  try {
    setPhase(job, 'prepare', 'Sao lưu dữ liệu hiện tại', 5, 'Đang sao lưu đề cũ và danh mục…');
    createSnapshot(job);

    const actionable = job.plan.items.filter((item) => item.action === 'add' || item.action === 'update');
    let done = 0;
    for (const item of actionable) {
      if (job.cancelRequested) throw new CancelledError('Đã dừng theo yêu cầu.');
      done += 1;
      const upload = job.uploadsById.get(item.uploadId);
      if (!upload) {
        throw new Error('Không tìm thấy file tạm của "' + item.name + '". Hãy chọn lại file.');
      }
      const source = prepareWorkCopy(job, upload, item);
      const isUpdate = item.action === 'update';
      job.phase = 'import';
      job.phaseLabel = isUpdate ? 'Cập nhật đề cũ' : 'Thêm đề mới';
      job.progress = 8 + Math.round((done - 1) / Math.max(1, actionable.length) * 20);
      job.message = (isUpdate ? 'Đang cập nhật ' : 'Đang thêm ') + item.name + '…';
      appendLog(job, (isUpdate ? '↻ Cập nhật ' : '＋ Thêm ') + item.name + ' → ' + item.file, 'step');

      const args = [path.join(ROOT, '_system', 'tools', 'import-exam.js'), source, '--subject', item.subjectId, '--yes'];
      if (isUpdate) args.push('--update-existing');
      else args.push('--number', item.number);

      const code = await runProcess(job, process.execPath, args, (line) => {
        appendLog(job, line, errorLine(line) ? 'error' : 'raw');
      });
      if (code !== 0) {
        throw new Error('Nhập đề "' + item.name + '" thất bại (mã ' + code + ').');
      }
    }

    job.plan.items.filter((item) => item.action === 'skip').forEach((item) => {
      appendLog(job, '↷ Bỏ qua ' + item.name + ': nội dung không thay đổi.', 'info');
    });

    if (job.cancelRequested) throw new CancelledError('Đã dừng theo yêu cầu.');

    await runCheckAndDeploy(job);

    job.state = 'success';
    job.progress = 100;
    job.phase = 'done';
    job.phaseLabel = 'Hoàn tất';
    job.message = DISABLE_DEPLOY
      ? 'Đã chạy xong toàn bộ kiểm tra (chế độ thử, chưa deploy).'
      : 'Đã đăng đề lên thư viện thành công.';
    job.result = {
      added: job.plan.summary.add,
      updated: job.plan.summary.update,
      skipped: job.plan.summary.skip,
      errors: 0,
      deployed: !DISABLE_DEPLOY,
      libraryUrl: PUBLIC_URL,
      message: job.message
    };
    appendLog(job, '✅ ' + job.message, 'success');
    cleanupOldBackups(10);
  } catch (error) {
    const cancelled = error instanceof CancelledError;
    job.state = cancelled ? 'cancelled' : 'failed';
    job.error = error.message;
    job.message = cancelled ? 'Đã dừng an toàn.' : 'Đăng đề thất bại.';
    appendLog(job, (cancelled ? '⏹ ' : '❌ ') + error.message, cancelled ? 'warn' : 'error');
    // Deploy Pages là một lần upload: lỗi nghĩa là chưa có bản mới trên Cloudflare.
    // Khôi phục local để lần thử lại không tạo đề trùng.
    restoreSnapshot(job);
    job.result = {
      added: 0,
      updated: 0,
      skipped: job.plan.summary.skip,
      errors: 1,
      deployed: false,
      libraryUrl: PUBLIC_URL,
      message: job.message
    };
  } finally {
    job.finishedAt = new Date().toISOString();
    job.canCancel = false;
    cleanupWork(job);
    saveJob(job);
    if (activeJob === job) activeJob = null;
    lastJob = job;
    if (job.state === 'success') {
      const uploadIds = job.plan.items.map((item) => item.uploadId);
      try {
        const uploads = require('./uploads');
        uploads.cleanupUploads(uploadIds);
      } catch (error) {}
    }
  }
}

// Bước dùng chung cho cả thêm đề và xóa/đổi tên đề:
// chạy _system/tools/update-and-deploy.ps1 (kiểm tra toàn bộ + tăng cache + deploy).
async function runCheckAndDeploy(job) {
  setPhase(job, 'pipeline', 'Kiểm tra và deploy', 30, 'Đang chạy kiểm tra và deploy…');
  const scriptPath = path.join(ROOT, '_system', 'tools', 'update-and-deploy.ps1').replace(/'/g, "''");
  const psParts = [
    '$ErrorActionPreference = "Stop";',
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false);',
    '$OutputEncoding = [Console]::OutputEncoding;',
    "& '" + scriptPath + "' -SkipImport -Yes"
  ];
  if (DISABLE_DEPLOY) psParts.push('-NoDeploy');
  const code = await runProcess(job, 'powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-Command', psParts.join(' ')
  ], (line) => handlePipelineLine(job, line));

  if (code !== 0) {
    throw new Error('Quy trình kiểm tra/deploy thất bại (mã ' + code + ').');
  }
}

// Job xóa / đổi tên một đề đã có trong thư viện.
async function runMaintenanceJob(job) {
  const action = job.maintenance.action === 'delete' ? 'delete' : 'rename';
  const label = action === 'delete' ? 'Xóa đề' : 'Đổi tên đề';
  appendLog(job, 'Bắt đầu ' + label.toLowerCase() + ': ' + job.maintenance.examId + '.', 'step');
  try {
    setPhase(job, 'prepare', 'Sao lưu dữ liệu hiện tại', 5, 'Đang sao lưu đề cũ và danh mục…');
    createSnapshot(job);

    setPhase(job, 'import', label, 12,
      'Đang ' + (action === 'delete' ? 'xóa ' : 'đổi tên ') + job.maintenance.examId + '…');
    appendLog(job, action === 'delete'
      ? '🗑 ' + job.maintenance.examId + ' → backups/exam-deletes/'
      : '✏️ ' + job.maintenance.examId + ' → "' + job.maintenance.title + '"', 'step');

    const args = [
      path.join(ROOT, '_system', 'tools', 'manage-exam.js'),
      action,
      job.maintenance.examId,
      '--yes'
    ];
    if (action === 'rename') args.push('--title', job.maintenance.title);

    const code = await runProcess(job, process.execPath, args, (line) => {
      appendLog(job, line, errorLine(line) ? 'error' : 'raw');
    });
    if (code !== 0) {
      throw new Error('Thao tác "' + label.toLowerCase() + ' ' + job.maintenance.examId +
        '" thất bại (mã ' + code + '). Xem log để biết chi tiết.');
    }
    if (job.cancelRequested) throw new CancelledError('Đã dừng theo yêu cầu.');

    await runCheckAndDeploy(job);

    job.state = 'success';
    job.progress = 100;
    job.phase = 'done';
    job.phaseLabel = 'Hoàn tất';
    job.message = DISABLE_DEPLOY
      ? 'Đã ' + label.toLowerCase() + ' thành công (chế độ thử, chưa deploy).'
      : 'Đã ' + label.toLowerCase() + ' và đăng lên thư viện thành công.';
    job.result = {
      added: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      deployed: !DISABLE_DEPLOY,
      libraryUrl: PUBLIC_URL,
      action,
      message: job.message
    };
    appendLog(job, '✅ ' + job.message, 'success');
    cleanupOldBackups(10);
  } catch (error) {
    const cancelled = error instanceof CancelledError;
    job.state = cancelled ? 'cancelled' : 'failed';
    job.error = error.message;
    job.message = cancelled ? 'Đã dừng an toàn.' : label + ' thất bại.';
    appendLog(job, (cancelled ? '⏹ ' : '❌ ') + error.message, cancelled ? 'warn' : 'error');
    restoreSnapshot(job);
    job.result = {
      added: 0,
      updated: 0,
      skipped: 0,
      errors: 1,
      deployed: false,
      libraryUrl: PUBLIC_URL,
      action,
      message: job.message
    };
  } finally {
    job.finishedAt = new Date().toISOString();
    job.canCancel = false;
    saveJob(job);
    if (activeJob === job) activeJob = null;
    lastJob = job;
  }
}

function getJob(id) {
  return jobs.get(id) || null;
}

function getActiveJob() {
  return activeJob;
}

function getLastJob() {
  return lastJob;
}

module.exports = {
  createJob,
  createMaintenanceJob,
  runJob,
  cancelJob,
  getJob,
  getActiveJob,
  getLastJob,
  publicJob,
  appendLog,
  CancelledError
};
