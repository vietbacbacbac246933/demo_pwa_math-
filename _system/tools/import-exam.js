#!/usr/bin/env node
/*
 * Nhập một đề mới vào thư viện tĩnh.
 *
 *   node _system/tools/import-exam.js [đường-dẫn-nguồn] [tùy chọn]
 *
 * Việc cần làm (tự động):
 *   1. Tìm file HTML có khối <script id="quiz-data"> trong file/thư mục bạn vừa thêm.
 *   2. Đổi "id" theo tên file đích: de_toan_02.html -> toan_02.
 *   3. Chuyển file vào exams/<môn>/de_<môn>_<số>.html.
 *   4. Sửa đường dẫn PWA sang ../../, thêm nút "Thư viện đề",
 *      đổi khóa lịch sử sang exam_history_<id> (giữ lịch sử cũ qua legacyIds).
 *   5. Thêm mục vào assets/js/catalog.js (và môn mới nếu cần).
 *   6. Tăng CACHE_VERSION trong sw.js.
 *   7. Chạy _system/tools/check-library.js; nếu lỗi thì hoàn tác toàn bộ.
 *
 * Tùy chọn:
 *   --subject <id>          Môn đã có (toan, ly, hoa, sinh, van, su, anh, ...)
 *   --new-subject <id>      Tạo môn mới với id này
 *   --subject-name <tên>    Tên hiển thị của môn mới
 *   --subject-icon <ký tự>  Icon của môn mới
 *   --subject-description <mô tả>
 *   --number <số>           Số đề (1, 2, 02...). Mặc định: lấy từ tên file hoặc số kế tiếp.
 *   --title <tiêu đề>       Tiêu đề hiển thị
 *   --description <mô tả>   Mô tả trên thẻ đề
 *   --tags <a,b,c>          Nhãn tìm kiếm, cách nhau bằng dấu phẩy
 *   --yes                   Không hỏi, dùng mặc định
 *   --update-existing       Ghi đè đúng đề đã có (theo id trong quiz-data).
 *                           Luôn sao lưu bản cũ vào backups/exam-updates/.
 *   --dry-run               Chỉ in kế hoạch, không sửa file
 *   --include-legacy        Quét cả thư mục mẫu cũ (de-kt-15p, de-toan-thpt)
 *   --no-push               Được Start/START.bat truyền vào; importer bỏ qua
 *
 * Chỉ dùng thư viện có sẵn của Node, không cần npm install.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const readline = require('readline');
const { spawnSync } = require('child_process');
// sw.js ở gốc đang mang thuộc tính Hidden (thư mục gọn) nên phải ghi qua wrapper.
const winFile = require('./helper/win-file');

const ROOT = path.resolve(__dirname, '..', '..');
const CATALOG_REL = 'assets/js/catalog.js';
const SW_REL = 'sw.js';
const LIBRARY_REL = 'assets/js/library.js';
const CHECK_REL = '_system/tools/check-library.js';
const EXAMS_DIR = path.join(ROOT, 'exams');

const IGNORED_TOP_DIRS = new Set([
  '.git', 'assets', '_system', 'exams', 'node_modules',
  'de-kt-15p', 'de-toan-thpt' // đề mẫu cũ, đã có sẵn trong repo
]);

const ACCENT_PALETTE = [
  { color: '#4338ca', soft: '#eef0ff' },
  { color: '#15803d', soft: '#e8f7ee' },
  { color: '#b45309', soft: '#fff6e5' },
  { color: '#0f766e', soft: '#e6f7f4' },
  { color: '#be123c', soft: '#ffe9ef' },
  { color: '#6d28d9', soft: '#f2eefe' },
  { color: '#0369a1', soft: '#e5f4fd' },
  { color: '#a16207', soft: '#fdf6e3' }
];

// Tên gọi khác của môn, dùng khi đoán môn từ tên file nguồn.
const SUBJECT_ALIASES = {
  li: 'ly',
  ly: 'ly',
  vatli: 'ly',
  vat_li: 'ly',
  vatly: 'ly',
  vat_ly: 'ly',
  hoa: 'hoa',
  hoahoc: 'hoa',
  hoa_hoc: 'hoa',
  su: 'su',
  lichsu: 'su',
  lich_su: 'su'
};

const QUIZ_RE = /(<script\b[^>]*\bid=["']quiz-data["'][^>]*>)([\s\S]*?)(<\/script>)/i;
const QUIZ_OPEN = '<script id="quiz-data" type="application/json">';

// ---------------------------------------------------------------------------
// Tiện ích chung
// ---------------------------------------------------------------------------

class UserError extends Error {}

function die(message) {
  throw new UserError(message);
}

function readText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function writeText(abs, text) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  winFile.writeFileSync(abs, text, 'utf8');
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

function padNumber(value) {
  const n = String(value).replace(/\D/g, '');
  if (!n) return '01';
  return n.length >= 2 ? n : n.padStart(2, '0');
}

function toSlug(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
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

// ---------------------------------------------------------------------------
// Đọc tham số
// ---------------------------------------------------------------------------

const opts = {
  subject: null,
  newSubject: null,
  subjectName: null,
  subjectIcon: null,
  subjectDescription: null,
  number: null,
  title: null,
  description: null,
  tags: null,
  yes: false,
  dryRun: false,
  updateExisting: false,
  includeLegacy: false,
  help: false
};
const sourceArgs = [];

(function parseArgs() {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) die('Thiếu giá trị sau ' + arg);
      return argv[i];
    };
    switch (arg) {
      case '--subject': opts.subject = toSlug(next()); break;
      case '--new-subject': opts.newSubject = toSlug(next()); break;
      case '--subject-name': opts.subjectName = next(); break;
      case '--subject-icon': opts.subjectIcon = next(); break;
      case '--subject-description': opts.subjectDescription = next(); break;
      case '--number': opts.number = next(); break;
      case '--title': opts.title = next(); break;
      case '--description': opts.description = next(); break;
      case '--tags':
        opts.tags = next().split(',').map((s) => s.trim()).filter(Boolean);
        break;
      case '--yes': case '-y': opts.yes = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--update-existing': opts.updateExisting = true; break;
      case '--include-legacy': opts.includeLegacy = true; break;
      case '--no-push': break; // do Start/START.bat dùng, importer không cần
      case '--help': case '-h': opts.help = true; break;
      default:
        if (arg.indexOf('-') === 0) die('Tham số không hợp lệ: ' + arg + ' (xem --help)');
        sourceArgs.push(arg);
    }
  }
})();

if (opts.help) {
  console.log([
    'Cách dùng: node _system/tools/import-exam.js [nguồn...] [tùy chọn]',
    '',
    'Nguồn có thể là file .html, thư mục export hoặc .zip đặt ở thư mục gốc repo.',
    'Không truyền nguồn: tự quét file/thư mục mới ở thư mục gốc.',
    '',
    'Tùy chọn chính:',
    '  --subject <id>        Môn đã có (toan, ly, hoa, sinh, van, su, anh...)',
    '  --new-subject <id>    Tạo môn mới',
    '  --subject-name <tên>  Tên môn mới',
    '  --number <số>         Số đề, ví dụ 2 hoặc 02',
    '  --title <tiêu đề>',
    '  --description <mô tả>',
    '  --tags <a,b,c>',
    '  --yes                 Không hỏi lại',
    '  --update-existing     Cập nhật đúng đề đã có (theo id trong quiz-data)',
    '  --dry-run             Chỉ xem kế hoạch',
    '  --include-legacy      Quét cả de-kt-15p và de-toan-thpt',
    '',
    'Ví dụ:',
    '  node _system/tools/import-exam.js de_toan_02.html --subject toan --yes',
    '  node _system/tools/import-exam.js "de sinh 3" --subject sinh --title "Đề Sinh số 3"'
  ].join('\n'));
  process.exit(0);
}

if (!opts.yes && (!process.stdin.isTTY || !process.stdout.isTTY)) {
  die('Không có bàn phím để hỏi đáp. Hãy thêm --yes (hoặc chạy trong cửa sổ cmd).');
}

// ---------------------------------------------------------------------------
// Hỏi đáp
// ---------------------------------------------------------------------------

let rl = null;

function ask(question) {
  if (opts.yes) return Promise.resolve('');
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  }
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(String(answer || '').trim()));
  });
}

function closePrompt() {
  if (rl) {
    rl.close();
    rl = null;
  }
}

// ---------------------------------------------------------------------------
// Danh mục hiện tại
// ---------------------------------------------------------------------------

function loadLibrary() {
  const sandbox = {};
  try {
    vm.runInNewContext(readText(CATALOG_REL), {
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

const library = loadLibrary();
const existingSubjectIds = new Set(library.subjects.map((s) => s.id));
const existingExamIds = new Set();
library.subjects.forEach((subject) => {
  (subject.exams || []).forEach((exam) => {
    if (exam && exam.id) existingExamIds.add(exam.id);
  });
});

// ---------------------------------------------------------------------------
// Tìm nguồn cần nhập
// ---------------------------------------------------------------------------

function hasQuizData(abs) {
  try {
    const html = fs.readFileSync(abs, 'utf8');
    return QUIZ_RE.test(html);
  } catch (error) {
    return false;
  }
}

function collectHtmlFiles(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    if (entry.name === '.git' || entry.name === 'node_modules') return;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) collectHtmlFiles(abs, out);
    else if (/\.html?$/i.test(entry.name) && hasQuizData(abs)) out.push(abs);
  });
  return out;
}

function describe(abs) {
  const rel = path.relative(ROOT, abs);
  if (!rel || rel.indexOf('..') === 0 || path.isAbsolute(rel)) return abs;
  return rel.replace(/\\/g, '/');
}

function extractZip(abs) {
  if (process.platform !== 'win32') {
    die('Chỉ hỗ trợ .zip trên Windows. Hãy giải nén thủ công rồi chạy lại.');
  }
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'exam-zip-'));
  const command = "Expand-Archive -LiteralPath '" + abs.replace(/'/g, "''") +
    "' -DestinationPath '" + dest.replace(/'/g, "''") + "' -Force";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    die('Không giải nén được ' + describe(abs) + ': ' + (result.stderr || result.stdout || '').trim());
  }
  return dest;
}

function discoverSources() {
  const found = [];
  const seen = new Set();

  const addCandidate = (candidate) => {
    if (!candidate.htmlFiles.length) {
      if (candidate.extractDir) {
        try { fs.rmSync(candidate.extractDir, { recursive: true, force: true }); } catch (error) {}
      }
      return;
    }
    const key = candidate.absPath;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(candidate);
  };

  sourceArgs.forEach((arg) => {
    const abs = path.resolve(ROOT, arg);
    if (!fs.existsSync(abs)) die('Không tìm thấy nguồn: ' + arg);
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      addCandidate({ kind: 'dir', absPath: abs, htmlFiles: collectHtmlFiles(abs, []), cleanup: true, extractDir: null });
    } else if (/\.zip$/i.test(abs)) {
      const extractDir = extractZip(abs);
      addCandidate({ kind: 'zip', absPath: abs, htmlFiles: collectHtmlFiles(extractDir, []), cleanup: true, extractDir });
    } else if (/\.html?$/i.test(abs)) {
      if (!hasQuizData(abs)) die('File không có khối quiz-data: ' + arg);
      addCandidate({ kind: 'file', absPath: abs, htmlFiles: [abs], cleanup: true, extractDir: null });
    } else {
      die('Nguồn không phải HTML/thư mục/zip: ' + arg);
    }
  });

  if (sourceArgs.length) return found;

  // Tự quét thư mục gốc repo.
  fs.readdirSync(ROOT, { withFileTypes: true }).forEach((entry) => {
    const abs = path.join(ROOT, entry.name);
    if (entry.isFile()) {
      if (entry.name === 'index.html') return;
      if (/\.html?$/i.test(entry.name)) {
        if (hasQuizData(abs)) {
          addCandidate({ kind: 'file', absPath: abs, htmlFiles: [abs], cleanup: true, extractDir: null });
        }
        return;
      }
      if (/\.zip$/i.test(entry.name)) {
        const extractDir = extractZip(abs);
        const htmlFiles = collectHtmlFiles(extractDir, []);
        addCandidate({ kind: 'zip', absPath: abs, htmlFiles, cleanup: true, extractDir });
      }
      return;
    }
    if (!entry.isDirectory()) return;
    if (IGNORED_TOP_DIRS.has(entry.name) && !(opts.includeLegacy && (entry.name === 'de-kt-15p' || entry.name === 'de-toan-thpt'))) {
      return;
    }
    addCandidate({
      kind: 'dir',
      absPath: abs,
      htmlFiles: collectHtmlFiles(abs, []),
      cleanup: true,
      extractDir: null
    });
  });

  return found;
}

// ---------------------------------------------------------------------------
// Sửa nội dung HTML của đề
// ---------------------------------------------------------------------------

function patchResourcePaths(html) {
  let text = html;
  text = text.replace(/<link\b[^>]*rel=["']manifest["'][^>]*>/gi,
    '<link rel="manifest" href="../../manifest.webmanifest">');
  text = text.replace(/<link\b[^>]*rel=["']apple-touch-icon["'][^>]*>/gi,
    '<link rel="apple-touch-icon" href="../../assets/icons/icon-192.png">');
  text = text.replace(
    /navigator\.serviceWorker\.register\(\s*['"][^'"]*['"]\s*(?:,\s*\{[^}]*\}\s*)?\)/g,
    "navigator.serviceWorker.register('../../sw.js', { scope: '../../' })"
  );

  // Bổ sung nếu file nguồn thiếu hẳn thẻ.
  const nl = detectNl(text);
  if (!/<link\b[^>]*rel=["']manifest["']/i.test(text) && text.indexOf('</head>') >= 0) {
    text = text.replace('</head>', '<link rel="manifest" href="../../manifest.webmanifest">' + nl + '</head>');
  }
  if (!/<link\b[^>]*rel=["']apple-touch-icon["']/i.test(text) && text.indexOf('</head>') >= 0) {
    text = text.replace('</head>', '<link rel="apple-touch-icon" href="../../assets/icons/icon-192.png">' + nl + '</head>');
  }
  return text;
}

function ensureServiceWorker(html) {
  if (/serviceWorker\.register\(/.test(html)) return html;
  const nl = detectNl(html);
  const snippet = "<script>if ('serviceWorker' in navigator) { navigator.serviceWorker.register('../../sw.js', { scope: '../../' }); }</script>" + nl;
  if (html.indexOf('</body>') >= 0) return html.replace('</body>', snippet + '</body>');
  return html + nl + snippet;
}

function addBacklink(html) {
  if (/class=["']backlink["']/.test(html)) return html;
  const nl = detectNl(html);
  const link = '<a class="backlink" href="../../index.html"><span aria-hidden="true">←</span> Thư viện đề</a>';
  if (html.indexOf('<div id="app"></div>') >= 0) {
    return html.replace('<div id="app"></div>', link + nl + '<div id="app"></div>');
  }
  return html.replace(/<body([^>]*)>/i, '<body$1>' + nl + link);
}

function addBacklinkCss(html) {
  if (/\.backlink\s*\{/.test(html)) return html;
  if (html.indexOf('</style>') < 0) return html;
  const nl = detectNl(html);
  const css = '.backlink{display:inline-flex;align-items:center;gap:6px;margin:10px auto 0;padding:0 12px;max-width:880px;width:calc(100% - 24px);color:var(--brand,#4338ca);text-decoration:none;font-size:.9rem;font-weight:600}' + nl +
    '.backlink:hover{text-decoration:underline}' + nl;
  return html.replace('</style>', css + '</style>');
}

function patchHistory(html) {
  const nl = detectNl(html);
  let text = html;
  let patchedKey = false;

  if (/var\s+KEY\s*=\s*(['"])offlineQuiz:[^'"]*\1\s*\+\s*DATA\.id\s*;/.test(text)) {
    text = text.replace(/var\s+KEY\s*=\s*(['"])offlineQuiz:[^'"]*\1\s*\+\s*DATA\.id\s*;/,
      "var KEY = 'exam_history_' + DATA.id;");
    patchedKey = true;
  } else if (/var\s+KEY\s*=\s*'exam_history_'/.test(text)) {
    patchedKey = true;
  } else if (/var\s+KEY\s*=\s*(['"])[^'"]*\1\s*\+\s*DATA\.id\s*;/.test(text)) {
    text = text.replace(/var\s+KEY\s*=\s*(['"])[^'"]*\1\s*\+\s*DATA\.id\s*;/,
      "var KEY = 'exam_history_' + DATA.id;");
    patchedKey = true;
  }

  const needsLegacy = patchedKey && !/var\s+LEGACY_KEYS\b/.test(text);
  if (!needsLegacy) return { html: text, patchedKey, addedMigration: false };

  const keyMatch = /var\s+KEY\s*=\s*'exam_history_'\s*\+\s*DATA\.id\s*;/.exec(text);
  if (!keyMatch) return { html: text, patchedKey, addedMigration: false };

  const keyIndex = keyMatch.index;
  const lineStart = text.lastIndexOf('\n', keyIndex) + 1;
  const indent = text.slice(lineStart, keyIndex).replace(/[^\s]/g, '');
  const addition = [
    indent + "var LEGACY_KEYS = (DATA.legacyIds || []).map(function (id) { return 'offlineQuiz:' + id; });",
    indent + '// Chuyển lịch sử của bản xuất cũ sang khóa mới (chạy một lần).',
    indent + '(function migrateLegacyHistory() {',
    indent + '    try {',
    indent + '        if (localStorage.getItem(KEY)) return;',
    indent + '        for (var i = 0; i < LEGACY_KEYS.length; i++) {',
    indent + '            var old = localStorage.getItem(LEGACY_KEYS[i]);',
    indent + '            if (old) { localStorage.setItem(KEY, old); return; }',
    indent + '        }',
    indent + '    } catch (e) {}',
    indent + '})();'
  ].join(nl);

  const insertAt = keyMatch.index + keyMatch[0].length;
  text = text.slice(0, insertAt) + nl + addition + text.slice(insertAt);
  return { html: text, patchedKey, addedMigration: true };
}

function serializeQuizData(data) {
  return JSON.stringify(data).replace(/[<>&\u2028\u2029]/g, (c) =>
    '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

function normalizeExamHtml(html, plan) {
  const match = html.match(QUIZ_RE);
  if (!match) die('File không còn khối quiz-data: ' + plan.sourceRel);
  let data;
  try {
    data = JSON.parse(match[2]);
  } catch (error) {
    die('quiz-data không phải JSON hợp lệ trong ' + plan.sourceRel + ': ' + error.message);
  }

  const originalId = typeof data.id === 'string' ? data.id : '';
  data.id = plan.id;
  data.title = plan.title;
  if (originalId && originalId !== plan.id) {
    // Đề sao chép từ đề khác (id đã chuẩn) thì không kéo lịch sử của đề cũ sang.
    if (/^[a-z0-9]+_\d{1,4}$/i.test(originalId)) {
      delete data.legacyIds;
    } else {
      const legacy = new Set(Array.isArray(data.legacyIds) ? data.legacyIds : []);
      legacy.add(originalId);
      data.legacyIds = Array.from(legacy);
    }
  }
  plan.legacyIds = Array.isArray(data.legacyIds) ? data.legacyIds.slice() : [];
  plan.patchedHistory = false;
  plan.addedMigration = false;

  let text = html.slice(0, match.index) + QUIZ_OPEN + serializeQuizData(data) + '</script>' +
    html.slice(match.index + match[0].length);

  text = patchResourcePaths(text);
  text = ensureServiceWorker(text);
  text = addBacklinkCss(text);
  text = addBacklink(text);

  const history = patchHistory(text);
  text = history.html;
  plan.patchedHistory = history.patchedKey;
  plan.addedMigration = history.addedMigration;

  // <title>, tên app và mô tả (nếu có) theo tiêu đề mới.
  const fullTitle = /Thư viện đề thi THPT/.test(plan.title)
    ? plan.title
    : plan.title + ' | Thư viện đề thi THPT';
  text = text.replace(/<title>[^<]*<\/title>/i, '<title>' + escapeHtml(fullTitle) + '</title>');
  text = text.replace(/(<meta\s+name=["']apple-mobile-web-app-title["']\s+content=["'])[^"']*(["'])/i,
    '$1' + escapeHtml(plan.title) + '$2');
  text = text.replace(/(<meta\s+name=["']description["']\s+content=["'])[^"']*(["'])/i,
    '$1' + escapeHtml(plan.title + ' - ' + plan.questions + ' câu trắc nghiệm, có thể dùng ngoại tuyến sau lần tải đầu tiên.') + '$2');

  return text;
}

// ---------------------------------------------------------------------------
// Sửa catalog.js (giữ nguyên định dạng, chỉ chèn text)
// ---------------------------------------------------------------------------

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

function examEntry(plan, indent, nl) {
  const i = ' '.repeat(indent);
  const f = ' '.repeat(indent + 2);
  return [
    i + '{',
    f + 'id: ' + jsString(plan.id) + ',',
    f + 'title: ' + jsString(plan.title) + ',',
    f + 'file: ' + jsString(plan.destRel) + ',',
    f + 'description: ' + jsString(plan.description) + ',',
    f + 'questions: ' + plan.questions + ',',
    f + 'points: ' + plan.points + ',',
    f + 'minutes: ' + plan.minutes + ',',
    f + 'mode: ' + jsString(plan.mode) + ',',
    f + 'tags: [' + plan.tags.map(jsString).join(', ') + '],',
    f + 'addedAt: ' + jsString(plan.addedAt),
    i + '}'
  ].join(nl);
}

function subjectEntry(meta, plan, nl) {
  return [
    '      {',
    "        id: " + jsString(meta.id) + ',',
    "        name: " + jsString(meta.name) + ',',
    "        icon: " + jsString(meta.icon) + ',',
    "        description: " + jsString(meta.description) + ',',
    '        exams: [',
    examEntry(plan, 10, nl),
    '        ]',
    '      }'
  ].join(nl);
}

function addExamToCatalog(text, plan, subjectMeta, createSubject) {
  const nl = detectNl(text);
  const range = findSubjectRange(text, subjectMeta.id);

  if (range) {
    const examsIndex = text.indexOf('exams:', range.start);
    if (examsIndex < 0 || examsIndex > range.end) {
      die('Không tìm thấy mảng exams của môn "' + subjectMeta.id + '" trong catalog.');
    }
    const arrayStart = text.indexOf('[', examsIndex);
    const arrayEnd = findMatching(text, arrayStart, '[', ']');
    if (arrayEnd < 0) die('Ngoặc của mảng exams môn "' + subjectMeta.id + '" bị lệch.');
    const inner = text.slice(arrayStart + 1, arrayEnd);
    const needsComma = inner.trim().length > 0;
    const before = text.slice(0, arrayEnd).replace(/[ \t\r\n]*$/, '');
    const after = text.slice(arrayEnd);
    return before + (needsComma ? ',' : '') + nl + examEntry(plan, 10, nl) + nl + '        ' + after;
  }

  if (!createSubject) {
    die('Môn "' + subjectMeta.id + '" chưa có trong catalog. Dùng --new-subject để tạo môn mới.');
  }

  const subjectsIndex = text.indexOf('subjects:');
  const arrayStart = text.indexOf('[', subjectsIndex);
  const arrayEnd = findMatching(text, arrayStart, '[', ']');
  if (arrayEnd < 0) die('Không tìm thấy mảng subjects trong catalog.');
  const inner = text.slice(arrayStart + 1, arrayEnd);
  const needsComma = inner.trim().length > 0;
  const before = text.slice(0, arrayEnd).replace(/[ \t\r\n]*$/, '');
  const after = text.slice(arrayEnd);
  return before + (needsComma ? ',' : '') + nl + subjectEntry(subjectMeta, plan, nl) + nl + '    ' + after;
}

function updateExamInCatalog(text, plan) {
  const range = findSubjectRange(text, plan.subjectMeta.id);
  if (!range) {
    die('Không tìm thấy môn "' + plan.subjectMeta.id + '" trong catalog để cập nhật đề.');
  }
  const examsIndex = text.indexOf('exams:', range.start);
  if (examsIndex < 0 || examsIndex > range.end) {
    die('Không tìm thấy mảng exams của môn "' + plan.subjectMeta.id + '".');
  }
  const arrayStart = text.indexOf('[', examsIndex);
  const arrayEnd = findMatching(text, arrayStart, '[', ']');
  if (arrayEnd < 0) die('Ngoặc của mảng exams môn "' + plan.subjectMeta.id + '" bị lệch.');

  const nl = detectNl(text);
  let i = arrayStart + 1;
  while (i < arrayEnd) {
    while (i < arrayEnd && /[\s,]/.test(text[i])) i += 1;
    if (text[i] !== '{') break;
    const end = findMatching(text, i, '{', '}');
    if (end < 0) break;
    const block = text.slice(i, end + 1);
    const idMatch = block.match(/^\{\s*id\s*:\s*['"]([^'"]+)['"]/);
    if (idMatch && idMatch[1] === plan.id) {
      const lineStart = text.lastIndexOf('\n', i) + 1;
      const indent = text.slice(lineStart, i).replace(/[^\s]/g, '');
      const replacement = examEntry(plan, indent.length, nl);
      return text.slice(0, i) + replacement + text.slice(end + 1);
    }
    i = end + 1;
  }
  die('Không tìm thấy đề "' + plan.id + '" trong catalog để cập nhật.');
}

function bumpUpdatedAt(text) {
  return text.replace(/(updatedAt\s*:\s*['"])[^'"]*(['"])/, '$1' + today() + '$2');
}

// ---------------------------------------------------------------------------
// sw.js và library.js
// ---------------------------------------------------------------------------

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

function ensureAccent(text, subjectId) {
  if (new RegExp('(^|[\\s{])' + escapeRegExp(subjectId) + '\\s*:').test(text)) {
    return { text, added: false };
  }
  const used = new Set();
  const colorRe = /color\s*:\s*'(#[0-9a-fA-F]{6})'/g;
  let m;
  while ((m = colorRe.exec(text))) used.add(m[1].toLowerCase());
  const pick = ACCENT_PALETTE.find((c) => !used.has(c.color.toLowerCase())) ||
    ACCENT_PALETTE[Math.abs(subjectId.split('').reduce((n, c) => n + c.charCodeAt(0), 0)) % ACCENT_PALETTE.length];
  const nl = detectNl(text);
  const replaced = text.replace(/(var ACCENTS = \{)/,
    '$1' + nl + "    " + subjectId + ": { color: '" + pick.color + "', soft: '" + pick.soft + "' },");
  return { text: replaced, added: replaced !== text };
}

// ---------------------------------------------------------------------------
// Lập kế hoạch
// ---------------------------------------------------------------------------

function inferSubject(file) {
  const base = path.basename(file, path.extname(file)).toLowerCase();
  const normalized = toSlug(base);
  const tokens = normalized.split('_');
  // Thử từng từ, rồi từng cặp từ liền nhau (vat_li, lich_su...).
  for (let i = 0; i < tokens.length; i += 1) {
    const single = SUBJECT_ALIASES[tokens[i]];
    if (single && existingSubjectIds.has(single)) return single;
    if (i + 1 < tokens.length) {
      const pair = SUBJECT_ALIASES[tokens[i] + '_' + tokens[i + 1]];
      if (pair && existingSubjectIds.has(pair)) return pair;
    }
  }
  const found = tokens.find((p) => existingSubjectIds.has(p));
  return found || null;
}

function inferNumber(file) {
  const base = path.basename(file, path.extname(file));
  const m = base.match(/(?:^|[_\-\s])(\d{1,4})$/);
  return m ? padNumber(m[1]) : null;
}

function nextNumberFor(subjectId) {
  let max = 0;
  const dir = path.join(EXAMS_DIR, subjectId);
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).forEach((name) => {
      const m = name.match(new RegExp('^de_' + escapeRegExp(subjectId) + '_(\\d+)\\.html?$', 'i'));
      if (m) max = Math.max(max, Number(m[1]));
    });
  }
  existingExamIds.forEach((id) => {
    const m = id.match(new RegExp('^' + escapeRegExp(subjectId) + '_(\\d+)$', 'i'));
    if (m) max = Math.max(max, Number(m[1]));
  });
  return padNumber(max + 1);
}

function subjectMetaFromId(id) {
  const found = library.subjects.find((s) => s.id === id);
  if (found) return { ...found };
  return null;
}

const newSubjects = [];
const plannedIds = new Set();
const plannedDests = new Set();

async function pickSubject(sourceRel) {
  if (opts.subject) {
    const meta = subjectMetaFromId(opts.subject);
    if (meta) return { meta, isNew: false };
    die('Môn "' + opts.subject + '" chưa có trong catalog. Dùng --new-subject để tạo môn mới.');
  }

  if (opts.newSubject) {
    if (existingSubjectIds.has(opts.newSubject)) {
      return { meta: subjectMetaFromId(opts.newSubject), isNew: false };
    }
    return { meta: await createSubjectMeta(opts.newSubject), isNew: true };
  }

  const inferred = inferSubject(sourceRel);
  if (opts.yes) {
    if (inferred) return { meta: subjectMetaFromId(inferred), isNew: false };
    die('Không suy ra được môn cho "' + sourceRel + '". Hãy thêm --subject <id>.');
  }

  console.log('');
  console.log('Chọn môn cho "' + path.basename(sourceRel) + '":');
  library.subjects.forEach((subject, index) => {
    const exams = Array.isArray(subject.exams) ? subject.exams.length : 0;
    console.log('  ' + (index + 1) + ') ' + subject.id + ' - ' + subject.name + ' (' + exams + ' đề)');
  });
  console.log('  ' + (library.subjects.length + 1) + ') Tạo môn mới');

  const defaultIndex = inferred
    ? library.subjects.findIndex((s) => s.id === inferred) + 1
    : 1;
  const answer = await ask('Nhập số môn [' + defaultIndex + ']: ');
  const value = answer || String(defaultIndex);

  if (/^\d+$/.test(value)) {
    const index = Number(value) - 1;
    if (index >= 0 && index < library.subjects.length) {
      return { meta: { ...library.subjects[index] }, isNew: false };
    }
    if (index === library.subjects.length) return { meta: await createSubjectMeta(''), isNew: true };
    die('Số môn không hợp lệ: ' + value);
  }

  const byId = subjectMetaFromId(toSlug(value));
  if (byId) return { meta: byId, isNew: false };
  if (value.toLowerCase() === 'new' || value === '+') {
    return { meta: await createSubjectMeta(''), isNew: true };
  }
  die('Không hiểu môn: ' + value);
}

async function createSubjectMeta(idHint) {
  let id = idHint || '';
  let name = opts.subjectName || '';
  let icon = opts.subjectIcon || '';
  let description = opts.subjectDescription || '';

  if (!name) name = await ask('Tên môn mới (vd: Vật lí): ');
  if (!name) die('Thiếu tên môn mới. Dùng --subject-name.');
  if (!id) id = toSlug(name);
  id = toSlug(id);
  if (!id) die('Không tạo được id cho môn "' + name + '".');
  if (!/^[a-z][a-z0-9_]*$/.test(id)) die('Id môn không hợp lệ: ' + id);
  if (!icon) icon = (await ask('Icon môn mới [•]: ')) || '•';
  if (!description) description = (await ask('Mô tả môn mới [Đề trắc nghiệm ' + name + ' THPT.]: ')) ||
    ('Đề trắc nghiệm ' + name + ' THPT.');

  const meta = { id, name, icon, description };
  if (!newSubjects.some((s) => s.id === id)) newSubjects.push(meta);
  return meta;
}

async function planOne(sourceAbs, sourceRel) {
  const html = fs.readFileSync(sourceAbs, 'utf8');
  const match = html.match(QUIZ_RE);
  if (!match) die('Không có quiz-data: ' + sourceRel);

  let data;
  try {
    data = JSON.parse(match[2]);
  } catch (error) {
    die('quiz-data lỗi JSON trong ' + sourceRel + ': ' + error.message);
  }
  if (!Array.isArray(data.questions) || !data.questions.length) {
    die('Đề không có câu hỏi: ' + sourceRel);
  }

  const settings = data.settings || {};
  const questions = data.questions.length;
  const points = Math.round(data.questions.reduce((sum, q) => {
    const n = Number(q.points);
    return sum + (isFinite(n) && n > 0 ? Math.min(n, 100) : 1);
  }, 0) * 100) / 100;
  const generatedDescription = 'Đề trắc nghiệm ';

  let subjectChoice;
  let updateTarget = null;
  if (opts.updateExisting) {
    if (opts.number) die('--number không dùng được với --update-existing.');
    const existingId = typeof data.id === 'string' ? data.id.trim() : '';
    if (!existingId) die('--update-existing cần "id" có sẵn trong quiz-data: ' + sourceRel);
    updateTarget = findExistingExam(existingId);
    if (!updateTarget) {
      die('Không tìm thấy mã đề "' + existingId + '" trong catalog để cập nhật.');
    }
    if (opts.subject && opts.subject !== updateTarget.subject.id) {
      die('Đề "' + existingId + '" thuộc môn ' + updateTarget.subject.id +
        ', không phải môn ' + opts.subject + '.');
    }
    subjectChoice = {
      meta: {
        id: updateTarget.subject.id,
        name: updateTarget.subject.name,
        icon: updateTarget.subject.icon,
        description: updateTarget.subject.description
      },
      isNew: false
    };
  } else {
    subjectChoice = await pickSubject(sourceRel);
  }
  const subjectMeta = subjectChoice.meta;
  const subjectIsNew = subjectChoice.isNew;

  if (opts.updateExisting) {
    const existing = updateTarget.exam;
    const parts = existing.id.match(/_(\d+)$/);
    const number = parts ? padNumber(parts[1]) : '';
    const id = existing.id;
    const destRel = existing.file;
    const destAbs = path.join(ROOT, destRel);
    if (!destRel || !fs.existsSync(destAbs)) {
      die('Không tìm thấy file đề cũ để cập nhật: ' + (destRel || '(catalog thiếu file)'));
    }
    if (isSameSource(destAbs, sourceAbs)) {
      die('File nguồn trùng với file đề đang có. Hãy chọn bản sao khác để tránh tự di chuyển file.');
    }
    if (plannedIds.has(id) || plannedDests.has(destRel)) {
      die('Đề "' + id + '" xuất hiện nhiều lần trong một lần cập nhật.');
    }
    plannedIds.add(id);
    plannedDests.add(destRel);

    const generatedTitle = 'Đề ' + subjectMeta.name + ' số ' + String(Number(number));
    const originalTitle = typeof data.title === 'string' ? data.title.trim() : '';
    const looksLikeId = !originalTitle || originalTitle === data.id ||
      /^[a-f0-9]{10,}$/i.test(originalTitle);
    const title = opts.title || existing.title ||
      (looksLikeId ? generatedTitle : originalTitle) || generatedTitle;
    const description = opts.description || existing.description ||
      (generatedDescription + subjectMeta.name + ': ' + questions + ' câu, ' + points + ' điểm.');
    const tags = opts.tags || (Array.isArray(existing.tags) ? existing.tags : []) ||
      (Array.isArray(data.tags) ? data.tags : []);

    return {
      sourceAbs,
      sourceRel,
      html,
      subjectMeta,
      subjectIsNew: false,
      number,
      id,
      destRel,
      destAbs,
      title,
      description,
      tags,
      questions,
      points,
      minutes: Number(settings.minutes) || 0,
      mode: settings.mode === 'exam' ? 'exam' : 'practice',
      addedAt: existing.addedAt || today(),
      legacyIds: [],
      patchedHistory: patchHistory(html).patchedKey,
      addedMigration: false,
      update: true,
      existingExam: existing
    };
  }

  let number;
  if (opts.number) {
    if (!/\d/.test(opts.number)) die('Số đề không hợp lệ: ' + opts.number);
    number = padNumber(opts.number);
  } else {
    const suggested = inferNumber(sourceRel);
    const defaultNumber = suggested && !fileExistsFor(subjectMeta.id, suggested)
      ? suggested
      : nextNumberFor(subjectMeta.id);
    const answer = await ask('Số đề cho môn ' + subjectMeta.name + ' [' + defaultNumber + ']: ');
    number = padNumber(answer || defaultNumber);
  }

  let id = subjectMeta.id + '_' + number;
  let destRel = 'exams/' + subjectMeta.id + '/de_' + subjectMeta.id + '_' + number + '.html';
  let destAbs = path.join(ROOT, destRel);

  // Tránh ghi đè đề đã có.
  while (fs.existsSync(destAbs) || plannedDests.has(destRel) ||
    (existingExamIds.has(id) && !isSameSource(destAbs, sourceAbs)) || plannedIds.has(id)) {
    console.log('CẢNH BÁO: ' + destRel + ' hoặc id "' + id + '" đã tồn tại.');
    if (opts.yes) {
      number = padNumber(Number(number) + 1);
      id = subjectMeta.id + '_' + number;
      destRel = 'exams/' + subjectMeta.id + '/de_' + subjectMeta.id + '_' + number + '.html';
      destAbs = path.join(ROOT, destRel);
      console.log('  -> Dùng số kế tiếp: ' + number);
      continue;
    }
    const answer = await ask('Nhập số đề khác: ');
    if (!answer) die('Đã hủy vì số đề bị trùng.');
    number = padNumber(answer);
    id = subjectMeta.id + '_' + number;
    destRel = 'exams/' + subjectMeta.id + '/de_' + subjectMeta.id + '_' + number + '.html';
    destAbs = path.join(ROOT, destRel);
  }

  const generatedTitle = 'Đề ' + subjectMeta.name + ' số ' + String(Number(number));
  const originalTitle = typeof data.title === 'string' ? data.title.trim() : '';
  const looksLikeId = !originalTitle || originalTitle === data.id ||
    /^[a-f0-9]{10,}$/i.test(originalTitle);
  const suggestedTitle = looksLikeId ? generatedTitle : originalTitle;
  let title = opts.title || '';
  if (!title && !opts.yes) {
    title = await ask('Tiêu đề [' + suggestedTitle + ']: ');
  }
  title = title || suggestedTitle;
  if (looksLikeId && !opts.title) title = generatedTitle;

  let description = opts.description || '';
  if (!description && !opts.yes) {
    description = await ask('Mô tả ngắn [' + (generatedDescription + subjectMeta.name + ': ' + questions + ' câu, ' + points + ' điểm.') + ']: ');
  }
  description = description || (generatedDescription + subjectMeta.name + ': ' + questions + ' câu, ' + points + ' điểm.');

  const tags = opts.tags || (Array.isArray(data.tags) ? data.tags : []);

  plannedIds.add(id);
  plannedDests.add(destRel);

  return {
    sourceAbs,
    sourceRel,
    html,
    subjectMeta,
    subjectIsNew,
    number,
    id,
    destRel,
    destAbs,
    title,
    description,
    tags,
    questions,
    points,
    minutes: Number(settings.minutes) || 0,
    mode: settings.mode === 'exam' ? 'exam' : 'practice',
    addedAt: today(),
    legacyIds: [],
    patchedHistory: patchHistory(html).patchedKey,
    addedMigration: false,
    update: false
  };
}

function fileExistsFor(subjectId, number) {
  return fs.existsSync(path.join(EXAMS_DIR, subjectId, 'de_' + subjectId + '_' + number + '.html'));
}

function isSameSource(destAbs, sourceAbs) {
  return path.resolve(destAbs).toLowerCase() === path.resolve(sourceAbs).toLowerCase();
}

function findExistingExam(examId) {
  for (const subject of library.subjects) {
    const exams = Array.isArray(subject.exams) ? subject.exams : [];
    const exam = exams.find((item) => item && item.id === examId);
    if (exam) return { subject, exam };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ghi thay đổi + rollback
// ---------------------------------------------------------------------------

function backupFile(abs, store) {
  if (store.has(abs)) return;
  store.set(abs, fs.existsSync(abs) ? fs.readFileSync(abs) : null);
}

function rollback(store) {
  Array.from(store.keys()).reverse().forEach((abs) => {
    const content = store.get(abs);
    try {
      if (content === null) {
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
      } else {
        winFile.writeFileSync(abs, content);
      }
    } catch (error) {
      console.error('Không hoàn tác được ' + abs + ': ' + error.message);
    }
  });
}

function backupExistingForUpdate(plan, stamp) {
  if (!fs.existsSync(plan.destAbs)) return '';
  const backupRoot = path.join(ROOT, 'backups', 'exam-updates', stamp);
  const target = path.resolve(backupRoot, plan.destRel);
  const prefix = path.resolve(backupRoot) + path.sep;
  if (!target.toLowerCase().startsWith(prefix.toLowerCase())) {
    die('Đường dẫn sao lưu không an toàn: ' + plan.destRel);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(plan.destAbs, target);
  return target;
}

function moveOut(abs, stamp) {
  const backupRoot = path.join(os.tmpdir(), 'opencode', 'imported-sources', stamp);
  fs.mkdirSync(backupRoot, { recursive: true });
  let target = path.join(backupRoot, path.basename(abs));
  let n = 1;
  while (fs.existsSync(target)) {
    target = path.join(backupRoot, path.basename(abs) + '-' + n);
    n += 1;
  }
  try {
    fs.renameSync(abs, target);
  } catch (error) {
    fs.cpSync(abs, target, { recursive: true });
    fs.rmSync(abs, { recursive: true, force: true });
  }
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

// ---------------------------------------------------------------------------
// Luồng chính
// ---------------------------------------------------------------------------

async function main() {
  console.log('');
  console.log('== NHẬP ĐỀ MỚI VÀO THƯ VIỆN ==');

  const sources = discoverSources();
  if (!sources.length) {
    console.log('Không tìm thấy đề mới nào ở thư mục gốc.');
    console.log('Hãy chép file .html (hoặc thư mục export / .zip) vào:');
    console.log('  ' + ROOT);
    console.log('rồi chạy lại Start/START.bat hoặc Start/START-CLOUDFLARE.bat.');
    return 0;
  }

  console.log('Tìm thấy ' + sources.length + ' nguồn:');
  sources.forEach((source) => {
    console.log('  - ' + describe(source.absPath) + ' (' + source.htmlFiles.length + ' đề)');
  });

  if (sourceArgs.length === 0 && opts.number && sources.reduce((n, s) => n + s.htmlFiles.length, 0) > 1) {
    die('--number chỉ dùng được khi nhập một đề. Hãy chỉ định nguồn cụ thể.');
  }

  const plans = [];
  for (const source of sources) {
    for (const abs of source.htmlFiles) {
      plans.push(await planOne(abs, describe(abs)));
    }
  }

  console.log('');
  console.log('KẾ HOẠCH IMPORT');
  plans.forEach((plan, index) => {
    console.log('  ' + (index + 1) + '. ' + plan.sourceRel +
      (plan.update ? '   [CẬP NHẬT ĐỀ CŨ]' : ''));
    console.log('     -> ' + plan.destRel + '   (id: ' + plan.id + ')');
    console.log('     Môn: ' + plan.subjectMeta.name + ' (' + plan.subjectMeta.id + ')' +
      (plan.subjectIsNew ? ' [môn mới]' : '') +
      ' · ' + plan.questions + ' câu · ' + plan.points + ' điểm · ' + (plan.mode === 'exam' ? 'Bài thi' : 'Ôn tập'));
    console.log('     Tiêu đề: ' + plan.title);
    console.log('     Lịch sử: exam_history_' + plan.id +
      (plan.legacyIds.length ? ' (giữ lịch sử cũ: ' + plan.legacyIds.join(', ') + ')' : ''));
    if (!plan.patchedHistory) {
      console.log('     CẢNH BÁO: không tìm thấy mẫu khóa lịch sử để chuyển tự động.');
    }
  });

  if (opts.dryRun) {
    console.log('');
    console.log('DRY RUN: chưa sửa file nào.');
    closePrompt();
    return 0;
  }

  if (!opts.yes) {
    const answer = await ask('Tiến hành import? [Y/n]: ');
    if (answer && !/^y(es)?$/i.test(answer)) {
      console.log('Đã hủy. Không sửa file nào.');
      closePrompt();
      return 2;
    }
  }
  closePrompt();

  const store = new Map();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const movedSources = [];

  try {
    let catalogText = readText(CATALOG_REL);
    backupFile(path.join(ROOT, CATALOG_REL), store);
    const swAbs = path.join(ROOT, SW_REL);
    const libraryAbs = path.join(ROOT, LIBRARY_REL);
    let swText = readText(SW_REL);
    let libraryText = readText(LIBRARY_REL);
    backupFile(swAbs, store);
    backupFile(libraryAbs, store);

    for (const plan of plans) {
      backupFile(plan.destAbs, store);
      if (plan.update) {
        const backup = backupExistingForUpdate(plan, stamp);
        if (backup) console.log('Đã sao lưu bản đề cũ: ' + describe(backup));
      }
      const normalized = normalizeExamHtml(plan.html, plan);
      writeText(plan.destAbs, normalized);
      console.log((plan.update ? 'Đã cập nhật ' : 'Đã ghi ') + plan.destRel);

      if (plan.update) {
        catalogText = updateExamInCatalog(catalogText, plan);
      } else {
        catalogText = addExamToCatalog(catalogText, plan, plan.subjectMeta, plan.subjectIsNew);
      }
      if (!existingSubjectIds.has(plan.subjectMeta.id)) {
        existingSubjectIds.add(plan.subjectMeta.id);
      }
      existingExamIds.add(plan.id);

      if (plan.subjectIsNew || !library.subjects.some((s) => s.id === plan.subjectMeta.id)) {
        const accent = ensureAccent(libraryText, plan.subjectMeta.id);
        libraryText = accent.text;
      }
    }

    catalogText = bumpUpdatedAt(catalogText);
    const cache = bumpCacheVersion(swText);
    swText = cache.text;

    writeText(path.join(ROOT, CATALOG_REL), catalogText);
    writeText(swAbs, swText);
    writeText(libraryAbs, libraryText);
    console.log('Đã cập nhật ' + CATALOG_REL + ' (' + plans.length + ' đề)');
    console.log('Đã tăng CACHE_VERSION: ' + cache.from + ' -> ' + cache.to);

    // Chuyển nguồn ra khỏi repo để check-library không báo "đề mồ côi".
    sources.forEach((source) => {
      if (!source.cleanup) return;
      const target = moveOut(source.absPath, stamp);
      movedSources.push({ original: source.absPath, backup: target });
      console.log('Đã chuyển nguồn ra khỏi repo: ' + describe(source.absPath) + ' -> ' + target);
      if (source.extractDir) {
        try { fs.rmSync(source.extractDir, { recursive: true, force: true }); } catch (error) {}
      }
    });

    console.log('');
    console.log('Đang kiểm tra thư viện...');
    if (!runCheck()) {
      throw new UserError('check-library.js báo lỗi.');
    }
  } catch (error) {
    console.error('');
    console.error('LỖI: ' + error.message);
    console.error('Đang hoàn tác các thay đổi...');
    movedSources.forEach((item) => {
      try {
        if (fs.existsSync(item.backup)) fs.renameSync(item.backup, item.original);
      } catch (restoreError) {
        console.error('Không chuyển lại được nguồn: ' + item.original);
      }
    });
    rollback(store);
    console.error('Đã hoàn tác. Thư viện giữ nguyên như trước khi import.');
    return 1;
  }

  console.log('');
  console.log('== HOÀN TẤT ==');
  plans.forEach((plan) => {
    console.log('  ' + (plan.update ? '↻' : '+') + ' ' + plan.destRel +
      '  (id: ' + plan.id + ', ' + plan.questions + ' câu' +
      (plan.update ? ', đã sao lưu bản cũ' : '') + ')');
  });
  console.log('');
  console.log('Bản gốc đã được chuyển tới: ' + path.join(os.tmpdir(), 'opencode', 'imported-sources', stamp));
  console.log('Chạy tiếp: Start/START-CLOUDFLARE.bat (Cloudflare) hoặc Start/START.bat (GitHub Pages).');
  return 0;
}

main().then((code) => {
  closePrompt();
  process.exitCode = code;
}).catch((error) => {
  closePrompt();
  if (error instanceof UserError) {
    console.error('');
    console.error('LỖI: ' + error.message);
  } else {
    console.error('');
    console.error('LỖI KHÔNG MONG MUỐN: ' + (error && error.stack ? error.stack : error));
  }
  console.error('Không có thay đổi nào được giữ lại.');
  process.exitCode = 1;
});
