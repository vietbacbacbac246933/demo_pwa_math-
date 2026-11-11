#!/usr/bin/env node
/*
 * Tích hợp hàng đợi nộp bài vào tất cả file đề trong exams/.
 *
 *   node _system/tools/patch-exams.js
 *   node _system/tools/patch-exams.js --check
 *
 * Thay đổi:
 * - Thêm ô nhập lớp, bắt buộc họ tên + lớp trước khi bắt đầu.
 * - Gọi ExamResultQueue.enqueue() khi nộp bài (không đổi cách chấm/localStorage).
 * - Nạp assets/js/result-queue.js.
 *
 * Chạy lại nhiều lần không nhân đôi thay đổi.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CHECK = process.argv.indexOf('--check') >= 0;

function eolOf(text) {
  return text.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
}

function indentOf(line) {
  const match = /^[ \t]*/.exec(line);
  return match ? match[0] : '';
}

const LABEL_RE = /'<label class="field">Họ và tên(?: \(không bắt buộc\))?' \+\r?\n[ \t]*'<input id="studentName"[^\r\n]*' \+\r?\n[ \t]*'<\/label>' \+\r?\n[ \t]*'<\/div>' \+/;

function labelBlock(eol, indent) {
  const pad = indent + '    ';
  return [
    "'<label class=\"field\">Họ và tên' +",
    pad + '\'<input id="studentName" class="input" maxlength="80" autocomplete="off" placeholder="Nhập họ tên để hiện trên kết quả" value="\' + esc(state.name || \'\') + \'" required>\' +',
    indent + "'</label>' +",
    indent + "'<label class=\"field\">Lớp' +",
    pad + '\'<input id="studentClass" class="input" maxlength="20" autocomplete="off" placeholder="Ví dụ: 12A1" value="\' + esc(state.studentClass || \'\') + \'" required>\' +',
    indent + "'</label>' +",
    indent + "'</div>' +",
    indent + '\'<div id="studentError" class="warnbox" role="alert" hidden></div>\' +'
  ].join(eol);
}

const START_RE = /(var btn = document\.getElementById\('startBtn'\);)\r?\n([ \t]*)(if \(btn && !blocked\) btn\.onclick = function \(\) \{)\r?\n[ \t]*var nameEl = document\.getElementById\('studentName'\);\r?\n[ \t]*var name = nameEl \? nameEl\.value\.trim\(\) : '';\r?\n[ \t]*state\.name = name;\r?\n[ \t]*state\.last = null;\r?\n[ \t]*state\.current = \{\r?\n[ \t]*startedAt: Date\.now\(\),\r?\n[ \t]*name: name,/;

function startBlock(match, eol) {
  const pad = match[2];
  const inner = pad + '    ';
  return match[1] + eol + pad + match[3] + eol + [
    "var nameEl = document.getElementById('studentName');",
    "var classEl = document.getElementById('studentClass');",
    "var name = nameEl ? nameEl.value.trim() : '';",
    "var className = classEl ? classEl.value.trim() : '';",
    "var errorEl = document.getElementById('studentError');",
    "if (!name || !className) {",
    "    if (errorEl) {",
    "        errorEl.textContent = (!name && !className)",
    "            ? 'Vui lòng nhập họ tên và lớp trước khi bắt đầu.'",
    "            : (!name ? 'Vui lòng nhập họ tên trước khi bắt đầu.' : 'Vui lòng nhập lớp trước khi bắt đầu.');",
    "        errorEl.hidden = false;",
    "    }",
    "    if (!name && nameEl) nameEl.focus();",
    "    else if (classEl) classEl.focus();",
    "    return;",
    "}",
    "if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }",
    "state.name = name;",
    "state.studentClass = className;",
    "state.last = null;",
    "state.current = {",
    "    startedAt: Date.now(),",
    "    name: name,",
    "    studentClass: className,"
  ].map(function (line) { return inner + line; }).join(eol);
}

const SUBMIT_RE = /(\r?\n)([ \t]*)state\.current = null;\r?\n[ \t]*writeState\(\);\r?\n[ \t]*renderResult\(last\);/;

function submitBlock(match, eol) {
  const pad = match[2];
  return match[1] + [
    "var submitDuration = state.current.startedAt",
    "    ? Math.max(0, Math.round((Date.now() - state.current.startedAt) / 1000))",
    "    : 0;",
    "if (window.ExamResultQueue && typeof window.ExamResultQueue.enqueue === 'function') {",
    "    try {",
    "        window.ExamResultQueue.enqueue({",
    "            examId: DATA.id,",
    "            studentName: last.name || '',",
    "            studentClass: state.current.studentClass || '',",
    "            answers: answers,",
    "            durationSeconds: submitDuration,",
    "            timedOut: last.timedOut",
    "        });",
    "    } catch (error) {}",
    "}",
    "state.current = null;",
    "writeState();",
    "renderResult(last);"
  ].map(function (line) { return pad + line; }).join(eol);
}

function insertQueueScript(text, eol) {
  if (text.indexOf('result-queue.js') >= 0) return text;
  const marker = '<script>(function clientApp(buildOrder) {';
  const index = text.indexOf(marker);
  if (index < 0) return text;
  return text.slice(0, index) +
    '<script src="../../assets/js/result-queue.js"></script>' + eol +
    text.slice(index);
}

function addResultClass(text, eol) {
  if (text.indexOf('last.studentClass') >= 0) return text;
  const lineRe = /(\(last\.name \? '<div class="note">Học sinh: <b>' \+ esc\(last\.name\) \+ '<\/b><\/div>' : ''\) \+)/;
  return text.replace(lineRe, function (full) {
    const lineStart = text.lastIndexOf('\n', text.indexOf(full)) + 1;
    const indent = indentOf(text.slice(lineStart));
    return full + eol + indent +
      "(last.studentClass ? '<div class=\"note\">Lớp: <b>' + esc(last.studentClass) + '</b></div>' : '') +";
  });
}

function addLastClass(text, eol) {
  if (text.indexOf('studentClass: state.current.studentClass') >= 0) return text;
  const needle = 'timedOut: !!auto,';
  const index = text.indexOf(needle);
  if (index < 0) return text;
  const lineStart = text.lastIndexOf('\n', index) + 1;
  const indent = indentOf(text.slice(lineStart));
  const insertAt = index + needle.length;
  return text.slice(0, insertAt) + eol + indent +
    "studentClass: state.current.studentClass || ''," + text.slice(insertAt);
}

function patch(text) {
  const eol = eolOf(text);
  let output = text;

  if (output.indexOf('id="studentClass"') < 0) {
    output = output.replace(LABEL_RE, function (match) {
      const lineStart = output.lastIndexOf('\n', output.indexOf(match)) + 1;
      const indent = indentOf(output.slice(lineStart));
      return labelBlock(eol, indent);
    });
    output = output.replace(START_RE, function (full, g1, g2, g3) {
      return startBlock([full, g1, g2, g3], eol);
    });
  }

  if (output.indexOf('ExamResultQueue.enqueue') < 0) {
    output = output.replace(SUBMIT_RE, function (full, g1, g2) {
      return submitBlock([full, g1, g2], eol);
    });
  }

  output = insertQueueScript(output, eol);
  output = addResultClass(output, eol);
  output = addLastClass(output, eol);
  return output;
}

function listExams() {
  const result = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.html')) result.push(full);
    });
  })(path.join(ROOT, 'exams'));
  return result;
}

const errors = [];

listExams().forEach(function (file) {
  const relative = path.relative(ROOT, file);
  const original = fs.readFileSync(file, 'utf8');
  const updated = patch(original);

  const missing = [];
  if (updated.indexOf('result-queue.js') < 0) missing.push('script result-queue.js');
  if (updated.indexOf('id="studentClass"') < 0) missing.push('ô nhập lớp');
  if (updated.indexOf('ExamResultQueue.enqueue') < 0) missing.push('gọi enqueue');
  if (!/Vui lòng nhập họ tên/.test(updated)) missing.push('kiểm tra họ tên/lớp');

  if (missing.length) {
    errors.push(relative + ': thiếu ' + missing.join(', '));
    return;
  }

  if (CHECK) {
    if (original !== updated) {
      errors.push(relative + ': chưa được tích hợp (chạy node _system/tools/patch-exams.js)');
    }
    return;
  }

  if (original !== updated) {
    fs.writeFileSync(file, updated, 'utf8');
    console.log('Đã cập nhật ' + relative);
  } else {
    console.log('Không đổi ' + relative);
  }
});

if (errors.length) {
  console.error('LỖI:');
  errors.forEach(function (message) { console.error('- ' + message); });
  process.exitCode = 1;
} else if (!CHECK) {
  console.log('Hoàn tất tích hợp hàng đợi nộp bài.');
} else {
  console.log('Tất cả đề đã được tích hợp.');
}
