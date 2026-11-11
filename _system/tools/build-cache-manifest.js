'use strict';

/*
 * Sinh assets/js/exam-revs.js: bản đồ "đường dẫn đề -> hash nội dung".
 *
 * Vì sao cần:
 *   Cloudflare Pages trả file .html KHÔNG có ETag/Last-Modified. Manifest này
 *   giúp Service Worker gắn nhãn X-Exam-Rev cho đề khi lưu vào cache, tức là
 *   biết bản đang lưu thuộc nội dung nào.
 *
 *   Việc tải đề là CACHE LƯỜI: chỉ đề học sinh thực sự mở mới được tải và
 *   lưu; không tải trước toàn bộ thư viện.
 *
 * Cách dùng:
 *   node _system/tools/build-cache-manifest.js           # sinh / cập nhật
 *   node _system/tools/build-cache-manifest.js --check   # chỉ kiểm tra, lệch -> exit 1
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const EXAMS_DIR = path.join(ROOT, 'exams');
const OUT_ABS = path.join(ROOT, 'assets', 'js', 'exam-revs.js');
const OUT_REL = 'assets/js/exam-revs.js';
const CHECK = process.argv.indexOf('--check') >= 0;

function walk(dir, list) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
    if (entry.name.startsWith('.')) return;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, list);
      return;
    }
    if (entry.isFile() && /\.html?$/i.test(entry.name)) list.push(abs);
  });
  return list;
}

function hashOf(abs) {
  return crypto.createHash('sha256')
    .update(fs.readFileSync(abs))
    .digest('hex')
    .slice(0, 16);
}

function render(map) {
  const keys = Object.keys(map).sort();
  const lines = keys.map(function (key) {
    return '  ' + JSON.stringify(key) + ': ' + JSON.stringify(map[key]);
  });
  return [
    '/*',
    ' * File này do _system/tools/build-cache-manifest.js sinh tự động.',
    ' * Không sửa tay. Mục đích: gắn nhãn hash nội dung cho đề đã cache.',
    ' * Đề chỉ được tải khi học sinh mở (cache lười), không tải trước.',
    ' */',
    'self.EXAM_REVS = {',
    lines.join(',\n'),
    '};',
    ''
  ].join('\n');
}

function main() {
  if (!fs.existsSync(EXAMS_DIR)) {
    console.error('Không tìm thấy thư mục exams/.');
    return 1;
  }

  const files = walk(EXAMS_DIR, []).sort();
  const map = {};
  files.forEach(function (abs) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    map[rel] = hashOf(abs);
  });

  const content = render(map);
  const current = fs.existsSync(OUT_ABS) ? fs.readFileSync(OUT_ABS, 'utf8') : '';

  if (CHECK) {
    if (current !== content) {
      console.error(OUT_REL + ' chưa đồng bộ. Chạy: node _system/tools/build-cache-manifest.js');
      return 1;
    }
    console.log(OUT_REL + ' đồng bộ: ' + files.length + ' đề.');
    return 0;
  }

  if (current === content) {
    console.log(OUT_REL + ' không đổi (' + files.length + ' đề).');
    return 0;
  }

  fs.mkdirSync(path.dirname(OUT_ABS), { recursive: true });
  fs.writeFileSync(OUT_ABS, content, 'utf8');
  console.log('Đã sinh ' + OUT_REL + ' (' + files.length + ' đề).');
  return 0;
}

process.exitCode = main();
