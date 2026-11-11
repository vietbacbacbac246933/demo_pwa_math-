#!/usr/bin/env node
/*
 * Xóa hoặc đổi tên một đề đã có trong thư viện tĩnh.
 *
 *   node _system/tools/manage-exam.js delete <ma-de> --yes
 *   node _system/tools/manage-exam.js rename <ma-de> --title "<tieu-de-moi>" --yes
 *
 * Việc cần làm (tự động):
 *   delete:
 *     1. Tìm đề theo mã id trong assets/js/catalog.js.
 *     2. Chuyển file đề vào backups/exam-deletes/<mốc-thời-gian>/ (không xóa hẳn).
 *     3. Bỏ mục đề khỏi catalog; môn học được giữ lại ngay cả khi hết đề.
 *     4. Tăng CACHE_VERSION trong sw.js.
 *     5. Chạy _system/tools/check-library.js; nếu lỗi thì hoàn tác toàn bộ.
 *   rename:
 *     1. Tìm đề theo mã id trong catalog.
 *     2. Sửa tiêu đề trong khối quiz-data, thẻ <title> và meta tên app của file đề.
 *     3. Ghi lại mục đề trong catalog (giữ nguyên các trường khác).
 *     4. Tăng CACHE_VERSION trong sw.js.
 *     5. Chạy _system/tools/check-library.js; nếu lỗi thì hoàn tác toàn bộ.
 *
 * Các thay đổi phía server (đáp án chấm điểm trong functions/_lib/exam-data.js)
 * và deploy được local helper lo tiếp bằng _system/tools/update-and-deploy.ps1:
 * patch-exams, build-exam-data, build-cache-manifest, kiểm tra, deploy.
 *
 * Chỉ dùng thư viện có sẵn của Node, không cần npm install.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const { spawnSync } = require('child_process');

// Có thể trỏ về bản sao project (dùng khi kiểm thử như local-helper).
const ROOT = process.env.EXAM_HELPER_ROOT
  ? path.resolve(process.env.EXAM_HELPER_ROOT)
  : path.resolve(__dirname, '..', '..');

const CATALOG_REL = 'assets/js/catalog.js';
const SW_REL = 'sw.js';
const CHECK_REL = '_system/tools/check-library.js';
const DELETE_BACKUP_DIR = 'backups/exam-deletes';

const QUIZ_RE = /(<script\b[^>]*\bid=["']quiz-data["'][^>]*>)([\s\S]*?)(<\/script>)/i;
const QUIZ_OPEN = '<script id="quiz-data" type="application/json">';

class UserError extends Error {}

function die(message) {
  throw new UserError(message);
}

/* ---------------------------------------------------------------------------
 * Tiện ích chung
 * ------------------------------------------------------------------------- */

function readText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function writeText(rel, text) {
  const abs = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, 'utf8');
}

function detectNl(text) {
  return text.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
}

function jsString(value) {
  return "'" + String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n') + "'";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function normalizeTitle(raw) {
  return String(raw == null ? '' : raw).replace(/\r?\n/g, ' ').trim();
}

// Bỏ qua chuỗi và comment khi dò cặp ngoặc trong file JS.
function findMatching(text, start, open, close) {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i += 1;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === quote) break;
        i += 1;
      }
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      if (end < 0) return -1;
      i = end;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) return -1;
      i = end + 1;
      continue;
    }
    if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function serializeQuizData(data) {
  return JSON.stringify(data).replace(/[<>&\u2028\u2029]/g, (c) =>
    '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

/* ---------------------------------------------------------------------------
 * Catalog
 * ------------------------------------------------------------------------- */

function loadLibrary() {
  const text = readText(CATALOG_REL);
  const sandbox = {};
  try {
    vm.runInNewContext(text, {
      self: sandbox,
      window: sandbox,
      console
    }, { filename: CATALOG_REL });
  } catch (error) {
    die('Không đọc được ' + CATALOG_REL + ': ' + error.message);
  }
  if (!sandbox.EXAM_LIBRARY || !Array.isArray(sandbox.EXAM_LIBRARY.subjects)) {
    die(CATALOG_REL + ' không có mảng subjects.');
  }
  return sandbox.EXAM_LIBRARY;
}

function findExam(examId) {
  const library = loadLibrary();
  for (const subject of library.subjects) {
    const exams = Array.isArray(subject.exams) ? subject.exams : [];
    const exam = exams.find((item) => item && item.id === examId);
    if (exam) return { subject, exam };
  }
  return null;
}

function findSubjectRange(text, subjectId) {
  const subjectsIndex = text.indexOf('subjects:');
  if (subjectsIndex < 0) return null;
  const arrayStart = text.indexOf('[', subjectsIndex);
  if (arrayStart < 0) return null;
  const arrayEnd = findMatching(text, arrayStart, '[', ']');
  if (arrayEnd < 0) return null;

  let i = arrayStart + 1;
  while (i < arrayEnd) {
    while (i < arrayEnd && /[\s,]/.test(text[i])) i += 1;
    if (text[i] !== '{') break;
    const end = findMatching(text, i, '{', '}');
    if (end < 0) break;
    const block = text.slice(i, end + 1);
    const idMatch = block.match(/^\{\s*id\s*:\s*['"]([^'"]+)['"]/);
    if (idMatch && idMatch[1] === subjectId) {
      return { start: i, end: end + 1 };
    }
    i = end + 1;
  }
  return null;
}

function examsArrayRange(text, subjectId) {
  const range = findSubjectRange(text, subjectId);
  if (!range) die('Không tìm thấy môn "' + subjectId + '" trong catalog.');
  const examsIndex = text.indexOf('exams:', range.start);
  if (examsIndex < 0 || examsIndex > range.end) {
    die('Không tìm thấy mảng exams của môn "' + subjectId + '".');
  }
  const arrayStart = text.indexOf('[', examsIndex);
  const arrayEnd = findMatching(text, arrayStart, '[', ']');
  if (arrayStart < 0 || arrayEnd < 0) {
    die('Ngoặc của mảng exams môn "' + subjectId + '" bị lệch.');
  }
  return { subjectRange: range, arrayStart, arrayEnd };
}

// Xóa mục đề khỏi catalog nhưng giữ nguyên định dạng file.
function removeExamFromCatalog(text, subjectId, examId) {
  const range = examsArrayRange(text, subjectId);
  let i = range.arrayStart + 1;
  while (i < range.arrayEnd) {
    while (i < range.arrayEnd && /[\s,]/.test(text[i])) i += 1;
    if (text[i] !== '{') break;
    const end = findMatching(text, i, '{', '}');
    if (end < 0) break;
    const block = text.slice(i, end + 1);
    const idMatch = block.match(/^\{\s*id\s*:\s*['"]([^'"]+)['"]/);
    if (idMatch && idMatch[1] === examId) {
      let cutStart = text.lastIndexOf('\n', i) + 1;
      let cutEnd = end + 1;

      // Mục kế ngay sau có dấu phẩy: cắt luôn phẩy + xuống dòng theo sau.
      let j = cutEnd;
      while (j < text.length && /[ \t\r]/.test(text[j])) j += 1;
      if (text[j] === ',') {
        cutEnd = j + 1;
        j += 1;
        while (j < text.length && /[ \t\r]/.test(text[j])) j += 1;
        if (text[j] === '\n') cutEnd = j + 1;
      } else {
        // Mục cuối: bỏ luôn dấu phẩy của mục đứng ngay trước.
        let k = cutStart - 1;
        while (k >= 0 && /[ \t\r\n]/.test(text[k])) k -= 1;
        if (k >= 0 && text[k] === ',') cutStart = k + 1;
      }
      return text.slice(0, cutStart) + text.slice(cutEnd);
    }
    i = end + 1;
  }
  die('Không tìm thấy đề "' + examId + '" trong catalog để xóa.');
}

function examEntry(entry, indent, nl) {
  const i = ' '.repeat(indent);
  const f = ' '.repeat(indent + 2);
  return [
    i + '{',
    f + 'id: ' + jsString(entry.id) + ',',
    f + 'title: ' + jsString(entry.title) + ',',
    f + 'file: ' + jsString(entry.file) + ',',
    f + 'description: ' + jsString(entry.description || '') + ',',
    f + 'questions: ' + (Number(entry.questions) || 0) + ',',
    f + 'points: ' + (Number(entry.points) || 0) + ',',
    f + 'minutes: ' + (Number(entry.minutes) || 0) + ',',
    f + 'mode: ' + jsString(entry.mode || 'practice') + ',',
    f + 'tags: [' + (Array.isArray(entry.tags) ? entry.tags : []).map(jsString).join(', ') + '],',
    f + 'addedAt: ' + jsString(entry.addedAt || today()),
    i + '}'
  ].join(nl);
}

// Ghi đè lại mục đề (dùng cho rename) nhưng giữ các trường khác nguyên.
function updateExamInCatalog(text, subjectId, examId, newEntry) {
  const range = examsArrayRange(text, subjectId);
  let i = range.arrayStart + 1;
  while (i < range.arrayEnd) {
    while (i < range.arrayEnd && /[\s,]/.test(text[i])) i += 1;
    if (text[i] !== '{') break;
    const end = findMatching(text, i, '{', '}');
    if (end < 0) break;
    const block = text.slice(i, end + 1);
    const idMatch = block.match(/^\{\s*id\s*:\s*['"]([^'"]+)['"]/);
    if (idMatch && idMatch[1] === examId) {
      const lineStart = text.lastIndexOf('\n', i) + 1;
      const indent = text.slice(lineStart, i).replace(/[^\s]/g, '');
      const replacement = examEntry(newEntry, indent.length, detectNl(text));
      // Thay từ đầu dòng để không nhân đôi khoảng thụt lề.
      return text.slice(0, lineStart) + replacement + text.slice(end + 1);
    }
    i = end + 1;
  }
  die('Không tìm thấy đề "' + examId + '" trong catalog để cập nhật.');
}

function bumpUpdatedAt(text) {
  return text.replace(/(updatedAt\s*:\s*['"])[^'"]*(['"])/, '$1' + today() + '$2');
}

function bumpCacheVersion(text) {
  const match = text.match(/CACHE_VERSION\s*=\s*'([^']*)'/);
  if (!match) die('sw.js không có CACHE_VERSION.');
  const current = match[1];
  const numbered = current.match(/^v(\d+)$/i);
  const next = numbered ? 'v' + (Number(numbered[1]) + 1) : current + '-' + Date.now().toString(36);
  const replaced = text.slice(0, match.index) +
    match[0].replace(current, next) +
    text.slice(match.index + match[0].length);
  return { text: replaced, from: current, to: next };
}

/* ---------------------------------------------------------------------------
 * Sao lưu + hoàn tác
 * ------------------------------------------------------------------------- */

function backupFile(abs, store) {
  if (store.has(abs)) return;
  store.set(abs, fs.existsSync(abs) ? fs.readFileSync(abs) : null);
}

function rollback(store, movedBackups) {
  Array.from(store.keys()).reverse().forEach((abs) => {
    const content = store.get(abs);
    try {
      if (content === null) {
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
      } else {
        fs.writeFileSync(abs, content);
      }
    } catch (error) {
      console.error('Không hoàn tác được ' + abs + ': ' + error.message);
    }
  });
  (movedBackups || []).forEach((item) => {
    try {
      if (!fs.existsSync(item.original) && fs.existsSync(item.backup)) {
        fs.mkdirSync(path.dirname(item.original), { recursive: true });
        fs.renameSync(item.backup, item.original);
      }
    } catch (error) {
      console.error('Không chuyển lại được file đề: ' + item.original);
    }
  });
}

// Ch("#{root}/backups/exam-deletes/<stamp>/<rel path>"). Đường dẫn an toàn.
function backupDeletePath(stamp, examFileRel) {
  const backupRoot = path.join(ROOT, DELETE_BACKUP_DIR, stamp);
  const target = path.resolve(backupRoot, examFileRel);
  const prefix = path.resolve(backupRoot) + path.sep;
  if (!target.toLowerCase().startsWith(prefix.toLowerCase())) {
    die('Đường dẫn sao lưu không an toàn: ' + examFileRel);
  }
  return target;
}

function moveOut(abs, stamp, examFileRel, movedBackups) {
  const target = backupDeletePath(stamp, examFileRel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(abs, target);
  movedBackups.push({ original: abs, backup: target });
  return target;
}

function runCheck() {
  const result = spawnSync(process.execPath, [path.join(ROOT, CHECK_REL)], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.status === 0;
}

/* ---------------------------------------------------------------------------
 * Hành động: delete / rename
 * ------------------------------------------------------------------------- */

function readExamData(abs) {
  const html = fs.readFileSync(abs, 'utf8');
  const match = html.match(QUIZ_RE);
  if (!match) die('File đề không còn khối quiz-data: ' + abs);
  let data;
  try {
    data = JSON.parse(match[2]);
  } catch (error) {
    die('quiz-data không phải JSON hợp lệ trong file đề: ' + error.message);
  }
  return { html, match, data };
}

function doDelete(ctx) {
  const destAbs = path.join(ROOT, ctx.exam.file);
  if (!fs.existsSync(destAbs)) {
    die('Không tìm thấy file đề để xóa: ' + ctx.exam.file);
  }

  const store = new Map();
  const movedBackups = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  try {
    backupFile(path.join(ROOT, CATALOG_REL), store);
    backupFile(path.join(ROOT, SW_REL), store);

    const backupTarget = moveOut(destAbs, stamp, ctx.exam.file, movedBackups);
    console.log('Đã chuyển file đề vào bản sao lưu: ' + path.relative(ROOT, backupTarget)
      .split('\\').join('/'));
    if (fs.existsSync(destAbs)) die('Không di chuyển được file đề cũ.');

    let catalogText = readText(CATALOG_REL);
    catalogText = removeExamFromCatalog(catalogText, ctx.subject.id, ctx.exam.id);
    catalogText = bumpUpdatedAt(catalogText);
    writeText(CATALOG_REL, catalogText);
    console.log('Đã xóa mục đề khỏi ' + CATALOG_REL);

    const remaining = (loadLibrary().subjects
      .find((s) => s.id === ctx.subject.id) || { exams: [] }).exams || [];
    if (!remaining.length) {
      console.log('Môn "' + ctx.subject.name + '" hiện không còn đề (môn được giữ lại).');
    }

    const swText = readText(SW_REL);
    const cache = bumpCacheVersion(swText);
    writeText(SW_REL, cache.text);
    console.log('Đã tăng CACHE_VERSION: ' + cache.from + ' -> ' + cache.to);

    console.log('Đang kiểm tra thư viện...');
    if (!runCheck()) throw new UserError('check-library.js báo lỗi.');
  } catch (error) {
    console.error('LỖI: ' + error.message);
    console.error('Đang hoàn tác các thay đổi...');
    rollback(store, movedBackups);
    console.error('Đã hoàn tác. Thư viện giữ nguyên như trước khi xóa.');
    return 1;
  }

  console.log('ĐÃ XÓA: ' + ctx.exam.id + ' (' + (ctx.exam.title || ctx.exam.id) + ')');
  return 0;
}

function doRename(ctx) {
  const title = ctx.title;
  const destAbs = path.join(ROOT, ctx.exam.file);
  if (!fs.existsSync(destAbs)) {
    die('Không tìm thấy file đề để đổi tên: ' + ctx.exam.file);
  }

  const store = new Map();
  try {
    backupFile(destAbs, store);
    backupFile(path.join(ROOT, CATALOG_REL), store);
    backupFile(path.join(ROOT, SW_REL), store);

    const { html, match, data } = readExamData(destAbs);
    data.title = title;
    const renamed = html.slice(0, match.index) + QUIZ_OPEN + serializeQuizData(data) +
      '</script>' + html.slice(match.index + match[0].length);

    const fullTitle = /Thư viện đề thi THPT/.test(title)
      ? title
      : title + ' | Thư viện đề thi THPT';
    let text = renamed;
    if (/<title>[^<]*<\/title>/i.test(text)) {
      text = text.replace(/<title>[^<]*<\/title>/i, '<title>' + escapeHtml(fullTitle) + '</title>');
    }
    text = text.replace(/(<meta\s+name=["']apple-mobile-web-app-title["']\s+content=["'])[^"']*(["'])/i,
      '$1' + escapeHtml(title) + '$2');

    fs.writeFileSync(destAbs, text, 'utf8');
    console.log('Đã sửa tiêu đề quiz-data và <title> trong ' + ctx.exam.file);

    let catalogText = readText(CATALOG_REL);
    catalogText = updateExamInCatalog(catalogText, ctx.subject.id, ctx.exam.id, {
      id: ctx.exam.id,
      title,
      file: ctx.exam.file,
      description: ctx.exam.description,
      questions: ctx.exam.questions,
      points: ctx.exam.points,
      minutes: ctx.exam.minutes,
      mode: ctx.exam.mode,
      tags: ctx.exam.tags,
      addedAt: ctx.exam.addedAt
    });
    catalogText = bumpUpdatedAt(catalogText);
    writeText(CATALOG_REL, catalogText);
    console.log('Đã cập nhật ' + CATALOG_REL);

    const swText = readText(SW_REL);
    const cache = bumpCacheVersion(swText);
    writeText(SW_REL, cache.text);
    console.log('Đã tăng CACHE_VERSION: ' + cache.from + ' -> ' + cache.to);

    console.log('Đang kiểm tra thư viện...');
    if (!runCheck()) throw new UserError('check-library.js báo lỗi.');
  } catch (error) {
    console.error('LỖI: ' + error.message);
    console.error('Đang hoàn tác các thay đổi...');
    rollback(store, []);
    console.error('Đã hoàn tác. Thư viện giữ nguyên như trước khi đổi tên.');
    return 1;
  }

  console.log('ĐÃ ĐỔI TÊN: ' + ctx.exam.id + ' "' + ctx.exam.title + '" -> "' + title + '"');
  return 0;
}

/* ---------------------------------------------------------------------------
 * Luồng chính
 * ------------------------------------------------------------------------- */

const args = process.argv.slice(2);

function optValue(flag) {
  const index = args.indexOf(flag);
  if (index < 0 || index + 1 >= args.length) return null;
  return args[index + 1];
}

function main() {
  console.log('');
  const actionRaw = args[0] || '';
  const action = String(actionRaw).toLowerCase();
  if (args.indexOf('--help') >= 0 || args.indexOf('-h') >= 0 ||
    !action || (action !== 'delete' && action !== 'rename')) {
    console.log([
      'Quản lý đề đã có trong thư viện:',
      '  node _system/tools/manage-exam.js delete <ma-de> --yes          Xóa đề',
      '  node _system/tools/manage-exam.js rename <ma-de> --title "..."  Đổi tiêu đề',
      '',
      'Ví dụ ma-de: su_02, toan_01 (ma id trong catalog.js).'
    ].join('\n'));
    return action ? 1 : 0;
  }

  const hasYes = args.indexOf('--yes') >= 0 || args.indexOf('-y') >= 0;
  if (!hasYes) {
    // Giao diện local-helper luôn gửi --yes; khong hoi truc tiep de an toan.
    die('Thiếu --yes (không hỏi tương tác trong chế độ tự động).');
  }

  const examId = String(args[1] || '').trim();
  if (!examId || /\s/.test(examId) || examId.length > 80) {
    die('Mã đề không hợp lệ: "' + examId + '".');
  }

  const found = findExam(examId);
  if (!found) die('Không tìm thấy mã đề "' + examId + '" trong catalog.');
  const subject = found.subject;
  const exam = found.exam;

  if (action === 'delete') {
    console.log('== XÓA ĐỀ KHỎI THƯ VIỆN ==');
    console.log('  Mã đề: ' + exam.id);
    console.log('  Tiêu đề: ' + (exam.title || '(không có)'));
    console.log('  Môn: ' + (subject.name || subject.id) + ' (' + subject.id + ')');
    console.log('  File: ' + exam.file);
    console.log('  File cũ vẫn được giữ trong ' + DELETE_BACKUP_DIR + '/.');
    return doDelete({ subject, exam, args });
  }

  if (action === 'rename') {
    const raw = optValue('--title');
    if (!raw) die('rename cần --title "<tên mới>".');
    const title = normalizeTitle(raw);
    if (!title) die('Tiêu đề mới không được để trống.');
    if (title.length > 160) die('Tiêu đề mới quá dài (tối đa 160 ký tự).');
    if (title === String(exam.title || '').trim()) {
      console.log('Tiêu đề mới giống tiêu đề cũ; không cần sửa.');
      return 0;
    }
    console.log('== ĐỔI TIÊU ĐỀ ĐỀ THI ==');
    console.log('  Mã đề: ' + exam.id);
    console.log('  Tiêu đề cũ: ' + (exam.title || '(không có)'));
    console.log('  Tiêu đề mới: ' + title);
    console.log('  Môn: ' + (subject.name || subject.id) + ' (' + subject.id + ')');
    return doRename({ subject, exam, title, args });
  }

  die('Hành động không hỗ trợ: ' + action);
  return 1;
}

if (require.main === module) {
  let code;
  try {
    code = main();
  } catch (error) {
    const message = error instanceof UserError ? error.message : (error && error.stack ? error.stack : error);
    console.error('');
    console.error('LỖI: ' + message);
    console.error('Không có thay đổi nào được giữ lại.');
    code = 1;
  }
  process.exitCode = code;
}

module.exports = {
  removeExamFromCatalog,
  updateExamInCatalog,
  examEntry,
  examsArrayRange,
  findSubjectRange,
  loadLibrary,
  bumpUpdatedAt,
  bumpCacheVersion
};
