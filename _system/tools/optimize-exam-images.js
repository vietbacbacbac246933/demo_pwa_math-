#!/usr/bin/env node
/*
 * Tối ưu ảnh nhúng trong đề thi: PNG/JPEG base64 -> WebP base64.
 *
 *   node _system/tools/optimize-exam-images.js
 *   node _system/tools/optimize-exam-images.js --dry-run
 *   node _system/tools/optimize-exam-images.js --check
 *   node _system/tools/optimize-exam-images.js --revert=2026-11-11T12-00-00-000Z
 *
 * Vì sao cần:
 *   Đề xuất từ hệ thống tạo đề thường nhúng ảnh dạng
 *   data:image/png;base64,... ngay trong quiz-data. PNG của ảnh chụp/ sơ đồ
 *   rất nặng, và base64 còn làm phình thêm ~33%. Chuyển sang WebP q90 giảm
 *   ~86% dung lượng ảnh mà mắt thường không phân biệt được.
 *
 * An toàn:
 *   - Chỉ thay phần base64, không đổi cấu trúc HTML/JSON.
 *   - Kiểm tra lại quiz-data vẫn là JSON hợp lệ trước khi ghi.
 *   - Sao lưu nguyên file đề vào backups/exam-images/<mốc thời gian>/.
 *   - Ảnh nào WebP không nhỏ hơn bản gốc thì giữ nguyên.
 *   - Chạy lại nhiều lần không sao: ảnh đã là WebP sẽ được bỏ qua.
 *
 * Cần sharp (chỉ cài một lần):
 *   npm --prefix _system/tools install
 *
 * Tùy chọn:
 *   --dry-run            Chỉ in kết quả, không ghi file
 *   --check              Không ghi; thoát mã 1 nếu còn ảnh PNG/JPEG
 *   --quality=<1-100>    Chất lượng WebP (mặc định 90)
 *   --max-width=<px>     Thu nhỏ ảnh rộng hơn ngưỡng (mặc định 1400, 0 = tắt)
 *   --revert=<mốc>       Khôi phục các file đề từ bản sao lưu
 *   --strict             Thiếu sharp thì thoát mã 2 (mặc định chỉ cảnh báo)
 *   --quiet              Chỉ in dòng tổng kết
 */
'use strict';

const fs = require('fs');
const path = require('path');
const winFile = require('./helper/win-file');

const ROOT = path.resolve(__dirname, '..', '..');
const EXAMS_DIR = path.join(ROOT, 'exams');
const BACKUP_ROOT = path.join(ROOT, 'backups', 'exam-images');

const IMG_RE = /data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)/g;
const QUIZ_RE = /(<script\b[^>]*\bid=["']quiz-data["'][^>]*>)([\s\S]*?)(<\/script>)/i;

function parseArgs(argv) {
  const opts = { quality: 90, maxWidth: 1400, dryRun: false, check: false, revert: '', strict: false, quiet: false };
  argv.forEach((arg) => {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--check') opts.check = true;
    else if (arg === '--strict') opts.strict = true;
    else if (arg === '--quiet') opts.quiet = true;
    else if (arg.indexOf('--quality=') === 0) opts.quality = Number(arg.split('=')[1]);
    else if (arg.indexOf('--max-width=') === 0) opts.maxWidth = Number(arg.split('=')[1]);
    else if (arg.indexOf('--revert=') === 0) opts.revert = arg.split('=')[1];
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else {
      console.error('Tham số không hợp lệ: ' + arg);
      process.exit(2);
    }
  });
  if (!Number.isInteger(opts.quality) || opts.quality < 1 || opts.quality > 100) {
    console.error('--quality phải là số nguyên 1..100.');
    process.exit(2);
  }
  if (!Number.isFinite(opts.maxWidth) || opts.maxWidth < 0) {
    console.error('--max-width phải là số >= 0.');
    process.exit(2);
  }
  return opts;
}

function loadSharp(opts) {
  try {
    return require('sharp');
  } catch (error) {
    console.error('[CANH BAO] Chua cai sharp nen khong toi uu duoc anh.');
    console.error('           Cai mot lan:  npm --prefix _system/tools install');
    if (opts.strict) process.exit(2);
    return null;
  }
}

function listExamFiles() {
  const out = [];
  if (!fs.existsSync(EXAMS_DIR)) return out;
  fs.readdirSync(EXAMS_DIR).forEach((subject) => {
    const dir = path.join(EXAMS_DIR, subject);
    let stat;
    try { stat = fs.statSync(dir); } catch (error) { return; }
    if (!stat.isDirectory()) return;
    fs.readdirSync(dir).forEach((name) => {
      if (!/\.html$/i.test(name)) return;
      out.push(path.join(dir, name));
    });
  });
  return out.sort();
}

function kb(bytes) {
  return (bytes / 1024).toFixed(0) + ' KB';
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function quizDataOk(text) {
  const match = QUIZ_RE.exec(text);
  if (!match) return true; // không phải đề có quiz-data -> bỏ qua kiểm tra
  try {
    JSON.parse(match[2]);
    return true;
  } catch (error) {
    return false;
  }
}

function backupFile(abs, stampId) {
  const rel = path.relative(ROOT, abs);
  const dest = path.join(BACKUP_ROOT, stampId, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(abs, dest);
  return dest;
}

function revert(stampId) {
  const dir = path.join(BACKUP_ROOT, stampId);
  if (!stampId || !fs.existsSync(dir)) {
    console.error('Khong tim thay ban sao luu: ' + (dir || '(chua nhap moc)'));
    console.error('Cac moc co san:');
    if (fs.existsSync(BACKUP_ROOT)) {
      fs.readdirSync(BACKUP_ROOT).forEach((name) => console.error('  ' + name));
    }
    process.exit(2);
  }
  let count = 0;
  function walk(current) {
    fs.readdirSync(current).forEach((name) => {
      const full = path.join(current, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) { walk(full); return; }
      const rel = path.relative(dir, full);
      const target = path.join(ROOT, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      winFile.writeFileSync(target, fs.readFileSync(full));
      count++;
      console.log('  khoi phuc ' + rel.split(path.sep).join('/'));
    });
  }
  walk(dir);
  console.log('Da khoi phuc ' + count + ' file tu backups/exam-images/' + stampId + '.');
  console.log('Nho tang CACHE_VERSION va deploy lai.');
}

async function optimizeFile(sharp, abs, opts) {
  const original = fs.readFileSync(abs, 'utf8');
  const matches = [];
  IMG_RE.lastIndex = 0;
  let m;
  while ((m = IMG_RE.exec(original))) {
    matches.push({ index: m.index, length: m[0].length, kind: m[1].toLowerCase(), data: m[2] });
  }
  const declared = (original.match(/data:image\//g) || []).length;
  const result = { rel: path.relative(ROOT, abs).split(path.sep).join('/'), images: 0, before: 0, after: 0, changed: false, skipped: [] };

  if (!matches.length) return result;
  if (declared !== matches.length) {
    result.skipped.push('co ' + declared + ' anh nhung chi doc duoc ' + matches.length + ' (base64 xuong dong?)');
  }

  let text = '';
  let cursor = 0;
  for (const item of matches) {
    const buffer = Buffer.from(item.data, 'base64');
    result.before += item.length;
    let replacement = original.slice(item.index, item.index + item.length);

    try {
      let pipeline = sharp(buffer);
      const meta = await pipeline.metadata();
      if (opts.maxWidth > 0 && meta.width > opts.maxWidth) {
        pipeline = pipeline.resize({ width: opts.maxWidth, withoutEnlargement: true });
      }
      const encoded = await pipeline.webp({ quality: opts.quality, effort: 6 }).toBuffer();
      const candidate = 'data:image/webp;base64,' + encoded.toString('base64');
      if (candidate.length < item.length) {
        replacement = candidate;
        result.images++;
      } else {
        result.skipped.push((meta.width || '?') + 'x' + (meta.height || '?') + ' webp khong nho hon');
      }
    } catch (error) {
      result.skipped.push('loi doc anh: ' + error.message);
    }

    text += original.slice(cursor, item.index) + replacement;
    cursor = item.index + item.length;
    result.after += replacement.length;
  }
  text += original.slice(cursor);

  result.changed = text !== original && result.images > 0;
  if (result.changed && !quizDataOk(text)) {
    result.changed = false;
    result.skipped.push('huy: quiz-data khong con la JSON hop le');
    return result;
  }
  result.text = text;
  return result;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log('node _system/tools/optimize-exam-images.js [--dry-run|--check] [--quality=90] [--max-width=1400] [--revert=<moc>]');
    return;
  }

  if (opts.revert) {
    revert(opts.revert);
    return;
  }

  const sharp = loadSharp(opts);
  if (!sharp) return;

  const files = listExamFiles();
  const stampId = stamp();
  let totalBefore = 0;
  let totalAfter = 0;
  let totalImages = 0;
  let touched = 0;
  let pending = 0;

  for (const file of files) {
    const result = await optimizeFile(sharp, file, opts);
    if (!result.images && !result.skipped.length) continue;

    if (result.images) {
      pending++;
      totalImages += result.images;
      totalBefore += result.before;
      totalAfter += result.after;
      if (!opts.quiet) {
        const saved = result.before - result.after;
        console.log(
          (result.changed ? '  ' : '  (khong doi) ') + result.rel +
          '  ' + result.images + ' anh  ' + kb(result.before) + ' -> ' + kb(result.after) +
          '  (-' + kb(saved) + ')'
        );
      }
      if (result.changed && !opts.dryRun && !opts.check) {
        backupFile(file, stampId);
        winFile.writeFileSync(file, result.text, 'utf8');
        touched++;
      }
    }
    result.skipped.forEach((note) => {
      if (!opts.quiet) console.log('     ! ' + result.rel + ': ' + note);
    });
  }

  if (!pending) {
    if (!opts.quiet) console.log('Khong con anh PNG/JPEG nhung trong de — khong can toi uu.');
    return;
  }

  console.log('');
  console.log('Tong: ' + totalImages + ' anh  ' + kb(totalBefore) + ' -> ' + kb(totalAfter) +
    '  (giam ' + (100 - totalAfter / totalBefore * 100).toFixed(0) + '%)');

  if (opts.check) {
    console.log('CHECK: van con ' + pending + ' file de chua toi uu anh.');
    process.exit(1);
  }
  if (opts.dryRun) {
    console.log('DRY-RUN: khong ghi file nao.');
    return;
  }
  console.log('Da ghi ' + touched + ' file de. Ban sao luu: backups/exam-images/' + stampId + '/');
  console.log('Nho tang CACHE_VERSION va deploy lai de hoc sinh nhan ban nhe hon.');
}

main().catch((error) => {
  console.error('LOI: ' + error.message);
  process.exit(1);
});
