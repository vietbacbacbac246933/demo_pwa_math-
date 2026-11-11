#!/usr/bin/env node
/*
 * Sinh dữ liệu đề thi phía server từ các file HTML trong exams/.
 *
 *   node _system/tools/build-exam-data.js
 *   node _system/tools/build-exam-data.js --check
 *
 * File sinh ra: functions/_lib/exam-data.js
 * Chỉ chứa metadata + đáp án tối thiểu để chấm điểm. Không chứa nội dung
 * câu hỏi/đáp án dạng chữ, không được trả ra qua API học sinh.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const CATALOG_PATH = path.join(ROOT, 'assets', 'js', 'catalog.js');
const OUT_PATH = path.join(ROOT, 'functions', '_lib', 'exam-data.js');
const errors = [];

function fail(message) {
  errors.push(message);
}

function pointsOf(q) {
  const n = Number(q.points);
  if (!isFinite(n) || n <= 0) return 1;
  return Math.min(n, 100);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function readCatalog() {
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(CATALOG_PATH, 'utf8'), {
    self: sandbox,
    window: sandbox,
    console
  }, { filename: CATALOG_PATH });
  if (!sandbox.EXAM_LIBRARY || !Array.isArray(sandbox.EXAM_LIBRARY.subjects)) {
    throw new Error('catalog.js thiếu EXAM_LIBRARY.subjects');
  }
  return sandbox.EXAM_LIBRARY;
}

function parseQuizData(html) {
  const match = html.match(/<script id="quiz-data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('không tìm thấy quiz-data');
  return { data: JSON.parse(match[1]), raw: match[1] };
}

function buildKeyQuestions(questions, examLabel) {
  return questions.map(function (q, index) {
    const type = q.type;
    const key = {
      type: type,
      points: pointsOf(q),
      options: Array.isArray(q.options) ? q.options.length : 0
    };

    if (type === 'single') {
      if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= key.options) {
        fail(examLabel + ': câu ' + (index + 1) + ' có correct không hợp lệ.');
      }
      key.correct = q.correct;
    } else if (type === 'multi') {
      const list = Array.isArray(q.correctList) ? q.correctList : [];
      if (!list.length || list.some(function (v) {
        return !Number.isInteger(v) || v < 0 || v >= key.options;
      })) {
        fail(examLabel + ': câu ' + (index + 1) + ' có correctList không hợp lệ.');
      }
      key.correctList = list.slice();
    } else if (type === 'truefalse') {
      const list = Array.isArray(q.correctTF) ? q.correctTF : [];
      if (!list.length || list.length !== key.options || list.some(function (v) {
        return typeof v !== 'boolean';
      })) {
        fail(examLabel + ': câu ' + (index + 1) + ' có correctTF không hợp lệ.');
      }
      key.correctTF = list.slice();
    } else if (type === 'shortanswer') {
      const answer = String(q.correctAnswer == null ? '' : q.correctAnswer).trim();
      if (!answer || answer.length > 50) {
        fail(examLabel + ': câu ' + (index + 1) + ' có correctAnswer không hợp lệ.');
      }
      key.correctAnswer = answer;
    } else {
      fail(examLabel + ': câu ' + (index + 1) + ' có type không hỗ trợ: ' + type);
    }

    if (q.tfScoring) key.tfScoring = String(q.tfScoring);
    return key;
  });
}

let library;
try {
  library = readCatalog();
} catch (error) {
  fail('Không đọc được catalog.js: ' + error.message);
}

const EXAMS = {};
const EXAM_LIST = [];

if (library) {
  library.subjects.forEach(function (subject) {
    (subject.exams || []).forEach(function (exam) {
      const label = subject.id + '/' + exam.id;
      const filePath = path.join(ROOT, exam.file);
      if (!fs.existsSync(filePath)) {
        fail(label + ': không tìm thấy file ' + exam.file);
        return;
      }

      let parsed;
      try {
        parsed = parseQuizData(fs.readFileSync(filePath, 'utf8'));
      } catch (error) {
        fail(label + ': ' + error.message);
        return;
      }

      const data = parsed.data;
      if (data.id !== exam.id) {
        fail(label + ': id trong quiz-data là "' + data.id + '", không khớp catalog.');
        return;
      }

      const questions = Array.isArray(data.questions) ? data.questions : [];
      if (!questions.length) {
        fail(label + ': không có câu hỏi.');
        return;
      }
      if (exam.questions && questions.length !== Number(exam.questions)) {
        fail(label + ': catalog ghi ' + exam.questions + ' câu nhưng file có ' + questions.length + ' câu.');
      }

      const keyQuestions = buildKeyQuestions(questions, label);
      const totalScore = round2(keyQuestions.reduce(function (sum, q) {
        return sum + q.points;
      }, 0));

      if (exam.points != null && Math.abs(totalScore - Number(exam.points)) > 0.001) {
        fail(label + ': catalog ghi ' + exam.points + ' điểm nhưng file có ' + totalScore + ' điểm.');
      }

      const version = crypto.createHash('sha256')
        .update(parsed.raw)
        .digest('hex')
        .slice(0, 12);

      EXAMS[exam.id] = {
        id: exam.id,
        title: data.title || exam.title || '',
        subjectId: subject.id,
        subjectName: subject.name || '',
        mode: (data.settings && data.settings.mode) || exam.mode || 'practice',
        minutes: Number((data.settings && data.settings.minutes) || 0),
        questionCount: questions.length,
        totalScore: totalScore,
        version: version,
        questions: keyQuestions
      };

      EXAM_LIST.push({
        id: exam.id,
        title: data.title || exam.title || '',
        subject_id: subject.id,
        subject_name: subject.name || '',
        question_count: questions.length,
        total_score: totalScore,
        mode: EXAMS[exam.id].mode,
        minutes: EXAMS[exam.id].minutes
      });
    });
  });
}

if (errors.length) {
  console.error('KHÔNG SINH ĐƯỢC exam-data.js:');
  errors.forEach(function (message) {
    console.error('- ' + message);
  });
  process.exitCode = 1;
} else {
  const banner = [
    '/*',
    ' * AUTO-GENERATED — không sửa tay.',
    ' * Sinh bởi _system/tools/build-exam-data.js từ các file trong exams/.',
    ' * File này chỉ dùng phía server (Pages Functions), không được trả ra API.',
    ' */',
    ''
  ].join('\n');

  const content = banner +
    'export const EXAMS = ' + JSON.stringify(EXAMS, null, 2) + ';\n\n' +
    'export const EXAM_LIST = ' + JSON.stringify(EXAM_LIST, null, 2) + ';\n';

  if (process.argv.indexOf('--check') >= 0) {
    const current = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, 'utf8') : '';
    if (current !== content) {
      console.error('exam-data.js chưa đồng bộ. Chạy: node _system/tools/build-exam-data.js');
      process.exitCode = 1;
    } else {
      console.log('exam-data.js đồng bộ: ' + EXAM_LIST.length + ' đề.');
    }
  } else {
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, content, 'utf8');
    console.log('Đã sinh ' + path.relative(ROOT, OUT_PATH) + ' (' + EXAM_LIST.length + ' đề).');
  }
}
