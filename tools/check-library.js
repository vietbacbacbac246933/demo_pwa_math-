#!/usr/bin/env node
/*
 * Kiểm tra nhanh thư viện trước khi deploy:
 *   node tools/check-library.js
 *
 * - Danh mục có bị trùng id / thiếu file không?
 * - Số câu, số điểm, id trong catalog có khớp file đề không?
 * - Manifest và các đường dẫn tài nguyên có tồn tại không?
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const warnings = [];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function fail(message) { errors.push(message); }
function warn(message) { warnings.push(message); }

// 1. Nạp catalog
let library;
try {
  const sandbox = {};
  vm.runInNewContext(read('assets/js/catalog.js'), {
    self: sandbox,
    window: sandbox,
    console
  }, { filename: 'assets/js/catalog.js' });
  library = sandbox.EXAM_LIBRARY;
} catch (error) {
  fail('Không đọc được assets/js/catalog.js: ' + error.message);
}

const examIds = new Set();
const examFiles = new Set();

if (!library || !Array.isArray(library.subjects)) {
  fail('catalog.js thiếu mảng subjects.');
} else {
  library.subjects.forEach(function (subject) {
    if (!subject.id || !subject.name) fail('Có môn học thiếu id hoặc name.');
    (subject.exams || []).forEach(function (exam) {
      const label = (subject.name || subject.id) + ' / ' + (exam.title || exam.file || '?');

      if (!exam.id) fail(label + ': thiếu id.');
      else if (examIds.has(exam.id)) fail(label + ': id bị trùng (' + exam.id + ').');
      else examIds.add(exam.id);

      if (!exam.file) { fail(label + ': thiếu đường dẫn file.'); return; }
      if (examFiles.has(exam.file)) fail(label + ': file bị dùng hai lần (' + exam.file + ').');
      examFiles.add(exam.file);

      if (!exists(exam.file)) { fail(label + ': không tìm thấy ' + exam.file); return; }

      const html = read(exam.file);
      const match = html.match(/<script id="quiz-data" type="application\/json">([\s\S]*?)<\/script>/);
      if (!match) { fail(label + ': file không có khối quiz-data.'); return; }

      let data;
      try { data = JSON.parse(match[1]); }
      catch (error) { fail(label + ': quiz-data không phải JSON hợp lệ (' + error.message + ').'); return; }

      if (data.id !== exam.id) {
        fail(label + ': id trong catalog là "' + exam.id + '" nhưng trong file đề là "' + data.id + '".');
      }
      if (!Array.isArray(data.questions) || !data.questions.length) {
        fail(label + ': không có câu hỏi.');
        return;
      }
      if (typeof exam.questions === 'number' && exam.questions !== data.questions.length) {
        fail(label + ': catalog ghi ' + exam.questions + ' câu nhưng file có ' + data.questions.length + ' câu.');
      }
      const totalPoints = data.questions.reduce(function (sum, q) {
        const n = Number(q.points);
        return sum + (isFinite(n) && n > 0 ? Math.min(n, 100) : 1);
      }, 0);
      if (typeof exam.points === 'number' && exam.points !== totalPoints) {
        warn(label + ': catalog ghi ' + exam.points + ' điểm nhưng file có ' + totalPoints + ' điểm.');
      }
      const minutes = (data.settings && data.settings.minutes) || 0;
      if (typeof exam.minutes === 'number' && exam.minutes !== minutes) {
        warn(label + ': catalog ghi ' + exam.minutes + ' phút nhưng file cấu hình ' + minutes + ' phút.');
      }

      // Các đường dẫn tương đối bắt buộc trong file đề.
      [
        ['../../manifest.webmanifest', 'manifest'],
        ['../../assets/icons/icon-192.png', 'icon'],
        ['../../index.html', 'trang chủ']
      ].forEach(function (pair) {
        if (!html.includes(pair[0])) fail(label + ': thiếu đường dẫn ' + pair[1] + ' (' + pair[0] + ').');
      });
      if (!html.includes("'../../sw.js'")) fail(label + ': chưa đăng ký Service Worker ở thư mục gốc.');
      if (!html.includes("exam_history_'")) warn(label + ': chưa dùng khóa localStorage theo mã đề.');
    });
  });
}

// 2. Tài nguyên dùng chung
['index.html', 'manifest.webmanifest', 'sw.js', 'assets/css/library.css', 'assets/js/library.js', 'assets/js/catalog.js', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png']
  .forEach(function (file) {
    if (!exists(file)) fail('Thiếu file: ' + file);
  });

// 3. Manifest
try {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  if (!manifest.start_url || !manifest.scope) fail('Manifest thiếu start_url hoặc scope.');
  (manifest.icons || []).forEach(function (icon) {
    if (!exists(icon.src)) fail('Manifest trỏ tới icon không tồn tại: ' + icon.src);
  });
  if (JSON.stringify(manifest).includes('/de_toan_thpt_mau2.html')) {
    warn('Manifest vẫn còn trỏ tới file đề cũ.');
  }
} catch (error) {
  fail('manifest.webmanifest không hợp lệ: ' + error.message);
}

// 4. Service Worker
const sw = exists('sw.js') ? read('sw.js') : '';
if (sw && !/CACHE_VERSION\s*=\s*'[^']+'/.test(sw)) fail('sw.js thiếu CACHE_VERSION.');
if (sw && !sw.includes('assets/js/catalog.js')) fail('sw.js chưa đọc catalog để cache đề.');

// 5. Kết quả
console.log('\n== THƯ VIỆN ĐỀ THI: KIỂM TRA ==');
if (library && Array.isArray(library.subjects)) {
  const exams = library.subjects.reduce(function (n, s) { return n + (s.exams || []).length; }, 0);
  console.log('Môn học: ' + library.subjects.length + ' · Đề: ' + exams);
}
warnings.forEach(function (w) { console.log('CẢNH BÁO: ' + w); });
errors.forEach(function (e) { console.log('LỖI: ' + e); });
if (!errors.length) console.log('Kết quả: OK' + (warnings.length ? ' (có cảnh báo)' : '') + '.');
console.log('');
process.exit(errors.length ? 1 : 0);
