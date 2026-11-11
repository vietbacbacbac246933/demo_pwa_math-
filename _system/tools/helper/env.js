'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, PUBLIC_URL } = require('./config');
const { findWrangler, commandFor } = require('./find-wrangler');

const REQUIRED_FILES = [
  'index.html',
  'teacher.html',
  'sw.js',
  'wrangler.jsonc',
  'assets/js/catalog.js',
  'assets/js/library.js',
  '_system/tools/import-exam.js',
  '_system/tools/update-and-deploy.ps1',
  '_system/tools/deploy-pages.ps1',
  '_system/tools/patch-exams.js',
  '_system/tools/build-exam-data.js',
  '_system/tools/build-cache-manifest.js',
  '_system/tools/check-library.js',
  '_system/tools/test-sw-lazy.js',
  '_system/tools/test-scoring.js',
  '_system/tools/bump-cache-version.js'
];

const CLOUDFLARE_CACHE_MS = 90 * 1000;
let cloudflareCache = null;

function stripAnsi(text) {
  return String(text || '').replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function nodeVersion() {
  const raw = process.versions.node;
  const parts = raw.split('.').map(Number);
  const ok = parts[0] > 22 || (parts[0] === 22 && parts[1] >= 5);
  return {
    version: raw,
    ok,
    required: '>= 22.5'
  };
}

function readWranglerConfig() {
  const file = path.join(ROOT, 'wrangler.jsonc');
  if (!fs.existsSync(file)) {
    return { ok: false, name: '', d1: false, error: 'Không tìm thấy wrangler.jsonc' };
  }
  const text = fs.readFileSync(file, 'utf8');
  const name = (text.match(/"name"\s*:\s*"([^"]+)"/) || [])[1] || '';
  const d1 = /"d1_databases"\s*:\s*\[/.test(text) && /"database_id"\s*:\s*"[^"]+"/.test(text);
  const output = (text.match(/"pages_build_output_dir"\s*:\s*"([^"]*)"/) || [])[1] || '';
  return {
    ok: Boolean(name),
    name,
    d1,
    pagesBuildOutputDir: output,
    error: name ? '' : 'wrangler.jsonc thiếu tên project'
  };
}

function probeCloudflare(force) {
  const now = Date.now();
  if (!force && cloudflareCache && now - cloudflareCache.at < CLOUDFLARE_CACHE_MS) {
    return cloudflareCache.value;
  }

  const wrangler = findWrangler();
  const command = commandFor(wrangler, ['whoami']);
  const result = spawnSync(command.file, command.args, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 25000,
    maxBuffer: 4 * 1024 * 1024,
    env: Object.assign({}, process.env, {
      WRANGLER_SEND_METRICS: 'false',
      NO_COLOR: '1',
      FORCE_COLOR: '0'
    })
  });

  const output = stripAnsi(String(result.stdout || '') + '\n' + String(result.stderr || ''));
  let loggedIn = null;
  let message = '';
  if (/You are logged in|logged in with an OAuth Token/i.test(output)) {
    loggedIn = true;
    message = 'Đã đăng nhập Cloudflare.';
  } else if (/not authenticated|not logged in|You are not logged in|No OAuth token/i.test(output)) {
    loggedIn = false;
    message = 'Chưa đăng nhập Cloudflare.';
  } else if (result.error) {
    message = 'Không kiểm tra được đăng nhập Cloudflare: ' + result.error.message;
  } else if (result.status !== 0) {
    message = 'Wrangler không xác nhận được phiên đăng nhập.';
  } else {
    message = 'Không đọc được trạng thái đăng nhập Cloudflare.';
  }

  const value = {
    loggedIn,
    ok: loggedIn === true,
    message,
    checkedAt: new Date().toISOString()
  };
  cloudflareCache = { at: now, value };
  return value;
}

function getEnvironment(options) {
  const force = Boolean(options && options.refresh);
  const wrangler = findWrangler();
  const wranglerConfig = readWranglerConfig();
  const cloudflare = probeCloudflare(force);
  const missing = REQUIRED_FILES.filter((rel) => !exists(rel));
  const node = nodeVersion();

  let library = { ok: false, subjects: 0, exams: 0, error: '' };
  try {
    // Nạp muộn để tránh vòng lặp module.
    const repo = require('./repository');
    const info = repo.getLibraryInfo();
    library = {
      ok: true,
      subjects: info.subjects.length,
      exams: info.examCount,
      updatedAt: info.updatedAt || '',
      error: ''
    };
  } catch (error) {
    library = { ok: false, subjects: 0, exams: 0, error: error.message };
  }

  const warnings = [];
  const errors = [];
  if (!node.ok) errors.push('Cần Node.js ' + node.required + ' (đang dùng ' + node.version + ').');
  if (missing.length) errors.push('Thiếu file bắt buộc: ' + missing.join(', '));
  if (!wranglerConfig.ok) errors.push(wranglerConfig.error);
  if (!wranglerConfig.d1) warnings.push('wrangler.jsonc chưa có cấu hình D1 đầy đủ.');
  if (!library.ok) errors.push('Không đọc được danh mục đề: ' + library.error);
  if (wrangler.kind === 'npx') warnings.push('Chưa tìm thấy Wrangler cài sẵn; lần deploy đầu có thể cần tải Wrangler.');
  if (cloudflare.loggedIn === false) warnings.push('Chưa đăng nhập Cloudflare. Chạy "npx wrangler login" một lần.');
  if (cloudflare.loggedIn === null) warnings.push(cloudflare.message);

  return {
    ok: errors.length === 0,
    readyForDeploy: errors.length === 0 && cloudflare.loggedIn === true,
    node,
    wrangler: {
      found: wrangler.kind !== 'npx',
      kind: wrangler.kind,
      version: wrangler.version,
      source: wrangler.source
    },
    cloudflare,
    project: {
      name: wranglerConfig.name,
      d1: wranglerConfig.d1,
      pagesBuildOutputDir: wranglerConfig.pagesBuildOutputDir
    },
    library,
    publicUrl: PUBLIC_URL,
    missingFiles: missing,
    warnings,
    errors,
    root: ROOT,
    checkedAt: new Date().toISOString()
  };
}

function clearCloudflareCache() {
  cloudflareCache = null;
}

module.exports = {
  getEnvironment,
  probeCloudflare,
  clearCloudflareCache,
  REQUIRED_FILES
};
