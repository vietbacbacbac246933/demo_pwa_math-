#!/usr/bin/env node
/*
 * Kiểm tra chấm điểm phía server khớp engine trong từng file đề.
 *
 *   node tools/test-scoring.js
 *
 * Với mỗi đề:
 * - Trích hàm chấm điểm từ chính file HTML (nguồn người dùng nhìn thấy).
 * - So sánh computeResult() của client và functions/_lib/scoring.js
 *   trên nhiều bộ đáp án: rỗng, đúng hết, sai hết, đúng/sai từng phần,
 *   trả lời ngắn có dấu phẩy, và 40 bộ ngẫu nhiên cố định seed.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(name + (detail ? ' — ' + detail : ''));
    console.log('  FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

function loadExamData() {
  const file = path.join(ROOT, 'functions', '_lib', 'exam-data.js');
  const source = fs.readFileSync(file, 'utf8')
    .replace(/export const EXAMS =/, 'const EXAMS =')
    .replace(/export const EXAM_LIST =/, 'const EXAM_LIST =');
  // eslint-disable-next-line no-new-func
  return new Function(source + '\nreturn { EXAMS: EXAMS, EXAM_LIST: EXAM_LIST };')();
}

function loadServerScoring() {
  const file = path.join(ROOT, 'functions', '_lib', 'scoring.js');
  let source = fs.readFileSync(file, 'utf8');
  source = source
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*/m, '')
    .replace(/export function /g, 'function ')
    .replace(/export const /g, 'const ');
  class StubHttpError extends Error {}
  // eslint-disable-next-line no-new-func
  return new Function('HttpError', source +
    '\nreturn { computeResult: computeResult, scoreQuestion: scoreQuestion, hasAnyAnswer: hasAnyAnswer };')(StubHttpError);
}

function listExamFiles() {
  const files = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.html')) files.push(full);
    });
  })(path.join(ROOT, 'exams'));
  return files;
}

function readQuiz(file) {
  const html = fs.readFileSync(file, 'utf8');
  const match = html.match(/<script id="quiz-data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('không có quiz-data');
  return { data: JSON.parse(match[1]), html: html };
}

function clientScoring(html) {
  const start = html.indexOf('function pointsOf');
  const end = html.indexOf('function canStart', start);
  if (start < 0 || end < 0) throw new Error('không tìm thấy khối chấm điểm');
  const block = html.slice(start, end);
  // eslint-disable-next-line no-new-func
  return new Function('QS', block + '\nreturn { computeResult: computeResult };');
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return function () {
    value = (value + 0x6D2B79F5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cloneAnswers(answers) {
  const copy = {};
  Object.keys(answers).forEach(function (key) {
    const value = answers[key];
    copy[key] = Array.isArray(value) ? value.slice() : value;
  });
  return copy;
}

function correctAnswers(questions) {
  const answers = {};
  questions.forEach(function (q, index) {
    if (q.type === 'single') answers[index] = q.correct;
    else if (q.type === 'multi') answers[index] = q.correctList.slice();
    else if (q.type === 'truefalse') answers[index] = q.correctTF.slice();
    else if (q.type === 'shortanswer') answers[index] = q.correctAnswer;
  });
  return answers;
}

function wrongAnswers(questions) {
  const answers = {};
  questions.forEach(function (q, index) {
    if (q.type === 'single') answers[index] = (q.correct + 1) % q.options;
    else if (q.type === 'multi') {
      const set = [];
      for (let i = 0; i < q.options; i += 1) {
        if (q.correctList.indexOf(i) < 0) set.push(i);
      }
      answers[index] = set.length ? [set[0]] : [];
    } else if (q.type === 'truefalse') {
      answers[index] = q.correctTF.map(function (v) { return !v; });
    } else if (q.type === 'shortanswer') {
      answers[index] = 'x' + String(index);
    }
  });
  return answers;
}

function randomAnswers(questions, random) {
  const answers = {};
  questions.forEach(function (q, index) {
    if (random() < 0.12) return;
    if (q.type === 'single') {
      if (random() < 0.55) answers[index] = q.correct;
      else answers[index] = Math.floor(random() * q.options);
    } else if (q.type === 'multi') {
      if (random() < 0.45) answers[index] = q.correctList.slice();
      else {
        const picked = [];
        for (let i = 0; i < q.options; i += 1) {
          if (random() < 0.5) picked.push(i);
        }
        if (picked.length) answers[index] = picked;
      }
    } else if (q.type === 'truefalse') {
      if (random() < 0.45) answers[index] = q.correctTF.slice();
      else {
        answers[index] = q.correctTF.map(function (v) {
          return random() < 0.5 ? v : !v;
        });
      }
    } else if (q.type === 'shortanswer') {
      const roll = random();
      if (roll < 0.45) answers[index] = q.correctAnswer;
      else if (roll < 0.6) answers[index] = String(q.correctAnswer).replace('.', ',');
      else answers[index] = String(Math.floor(random() * 1000));
    }
  });
  return answers;
}

function compare(client, server, answers) {
  const a = client(answers);
  const b = server(answers);
  return ['score', 'maxScore', 'correct', 'partial', 'wrong', 'unanswered'].every(function (key) {
    return a[key] === b[key];
  });
}

function describe(result) {
  return ['score', 'maxScore', 'correct', 'partial', 'wrong', 'unanswered']
    .map(function (key) { return key + '=' + result[key]; }).join(' ');
}

function main() {
  const { EXAMS, EXAM_LIST } = loadExamData();
  const serverScoring = loadServerScoring();
  const files = listExamFiles();

  if (files.length !== EXAM_LIST.length) {
    console.log('Số file đề (' + files.length + ') khác số đề trong exam-data (' + EXAM_LIST.length + ').');
    process.exitCode = 1;
    return;
  }

  files.forEach(function (file) {
    const relative = path.relative(ROOT, file);
    let quiz;
    try {
      quiz = readQuiz(file);
    } catch (error) {
      check(relative + ': đọc quiz-data', false, error.message);
      return;
    }

    const exam = EXAMS[quiz.data.id];
    if (!exam) {
      check(relative + ': có trong exam-data', false, 'id=' + quiz.data.id);
      return;
    }

    let client;
    try {
      const clientEngine = clientScoring(quiz.html)(quiz.data.questions);
      client = function (answers) { return clientEngine.computeResult(answers); };
    } catch (error) {
      check(relative + ': trích engine chấm điểm', false, error.message);
      return;
    }

    const server = function (answers) {
      return serverScoring.computeResult(exam.questions, answers);
    };

    const cases = [
      { name: 'rỗng', answers: {} },
      { name: 'đúng hết', answers: correctAnswers(quiz.data.questions) },
      { name: 'sai hết', answers: wrongAnswers(quiz.data.questions) }
    ];

    // Đúng/sai từng phần cho câu nhiều lựa chọn và đúng-sai.
    const partial = correctAnswers(quiz.data.questions);
    quiz.data.questions.forEach(function (q, index) {
      if (q.type === 'multi' && q.correctList.length > 1) {
        partial[index] = q.correctList.slice(0, 1);
      } else if (q.type === 'truefalse') {
        partial[index] = q.correctTF.map(function (v, i) { return i === 0 ? v : !v; });
      }
    });
    cases.push({ name: 'đúng một phần', answers: partial });

    const random = mulberry32(0x1234 + quiz.data.questions.length);
    for (let i = 0; i < 40; i += 1) {
      cases.push({ name: 'ngẫu nhiên #' + (i + 1), answers: randomAnswers(quiz.data.questions, random) });
    }

    let allMatch = true;
    let firstError = '';
    cases.forEach(function (item) {
      const answers = cloneAnswers(item.answers);
      const a = client(answers);
      const b = server(answers);
      const keys = ['score', 'maxScore', 'correct', 'partial', 'wrong', 'unanswered'];
      const same = keys.every(function (key) { return a[key] === b[key]; });
      if (!same && allMatch) {
        allMatch = false;
        firstError = item.name + ' | client ' + describe(a) + ' | server ' + describe(b);
      }
    });

    check(relative + ' (' + quiz.data.id + '): ' + cases.length + ' bộ đáp án khớp', allMatch, firstError);
  });

  console.log('\nĐạt: ' + passed + ' · Lỗi: ' + failed);
  if (failed) {
    console.log('\nCác mục lỗi:');
    failures.forEach(function (message) { console.log('- ' + message); });
    process.exitCode = 1;
  }
}

main();
