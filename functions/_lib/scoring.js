/*
 * Chấm điểm phía server — port từ engine trong các file đề.
 * Giữ đúng cách chấm hiện tại để điểm server khớp điểm hiển thị trên máy.
 */
'use strict';

import { HttpError } from './http.js';

export function pointsOf(q) {
  const n = Number(q && q.points);
  if (!isFinite(n) || n <= 0) return 1;
  return Math.min(n, 100);
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}

function normNum(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  let s = String(value).trim();
  if (!s || s.length > 50) return null;
  s = s.replace(',', '.');
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!match) return null;
  let intPart = match[2] || '';
  let frac = match[3] || '';
  if (!intPart && !frac) return null;
  intPart = intPart.replace(/^0+/, '') || '0';
  frac = frac.replace(/0+$/, '');
  const negative = match[1] === '-' && !(intPart === '0' && frac === '');
  return (negative ? '-' : '') + intPart + (frac ? '.' + frac : '');
}

function numEquals(a, b) {
  const x = normNum(a);
  const y = normNum(b);
  return !!x && x === y;
}

export function scoreQuestion(q, answer) {
  if (!q) return 0;

  if (q.type === 'single') {
    return answer === q.correct ? 1 : 0;
  }

  if (q.type === 'multi') {
    const given = Array.isArray(answer) ? answer.slice().sort(function (a, b) { return a - b; }) : [];
    const right = Array.isArray(q.correctList)
      ? q.correctList.slice().sort(function (a, b) { return a - b; })
      : [];
    if (given.length !== right.length || !given.length) return 0;
    for (let i = 0; i < given.length; i += 1) {
      if (given[i] !== right[i]) return 0;
    }
    return 1;
  }

  if (q.type === 'truefalse') {
    let correct = 0;
    const total = (q.correctTF || []).length;
    if (!total) return 0;
    for (let i = 0; i < total; i += 1) {
      if (Array.isArray(answer) && answer[i] === q.correctTF[i]) correct += 1;
    }
    if (q.tfScoring === 'equal') return correct / total;
    if (total === 4) return [0, 0.1, 0.25, 0.5, 1][correct];
    return correct / total;
  }

  if (q.type === 'shortanswer') {
    return numEquals(answer, q.correctAnswer) ? 1 : 0;
  }

  return 0;
}

export function hasAnyAnswer(q, answer) {
  if (!q) return false;
  if (q.type === 'single') return typeof answer === 'number' && answer >= 0;
  if (q.type === 'multi') return Array.isArray(answer) && answer.length > 0;
  if (q.type === 'truefalse') {
    return Array.isArray(answer) && answer.some(function (v) {
      return v === true || v === false;
    });
  }
  return String(answer == null ? '' : answer).trim() !== '';
}

export function computeResult(questions, answers) {
  let score = 0;
  let maxScore = 0;
  let correct = 0;
  let partial = 0;
  let wrong = 0;
  let unanswered = 0;

  questions.forEach(function (q, index) {
    const points = pointsOf(q);
    const answer = answers[index];
    const ratio = scoreQuestion(q, answer);
    maxScore += points;
    score += ratio * points;

    if (ratio === 1) correct += 1;
    else if (!hasAnyAnswer(q, answer)) unanswered += 1;
    else if (ratio > 0) partial += 1;
    else wrong += 1;
  });

  return {
    score: round2(score),
    maxScore: round2(maxScore),
    correct: correct,
    partial: partial,
    wrong: wrong,
    unanswered: unanswered
  };
}

/*
 * Kiểm tra và chuẩn hóa câu trả lời từ client.
 * - Chỉ nhận đúng chỉ số câu hỏi hiện có.
 * - Đúng kiểu dữ liệu với từng loại câu.
 * - Bỏ qua câu chưa trả lời.
 * Trả về object mới, không giữ tham chiếu tới dữ liệu client.
 */
export function normalizeAnswers(questions, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpError(400, 'INVALID_ANSWERS', 'Trường answers phải là một object.');
  }

  const keys = Object.keys(raw);
  if (keys.length > questions.length) {
    throw new HttpError(400, 'INVALID_ANSWERS', 'Số câu trả lời nhiều hơn số câu hỏi.');
  }

  const normalized = {};

  keys.forEach(function (key) {
    if (!/^(0|[1-9]\d*)$/.test(key)) {
      throw new HttpError(400, 'INVALID_ANSWERS', 'Có khóa câu trả lời không hợp lệ.');
    }
    const index = Number(key);
    if (index < 0 || index >= questions.length) {
      throw new HttpError(400, 'INVALID_ANSWERS', 'Có câu trả lời nằm ngoài đề.');
    }

    const q = questions[index];
    const value = raw[key];

    if (value === undefined || value === null || value === '') return;

    if (q.type === 'single') {
      if (!Number.isInteger(value) || value < 0 || value >= q.options) {
        throw new HttpError(400, 'INVALID_ANSWERS', 'Đáp án câu ' + (index + 1) + ' không hợp lệ.');
      }
      normalized[index] = value;
      return;
    }

    if (q.type === 'multi') {
      if (!Array.isArray(value) || value.length > q.options) {
        throw new HttpError(400, 'INVALID_ANSWERS', 'Đáp án nhiều lựa chọn câu ' + (index + 1) + ' không hợp lệ.');
      }
      const seen = new Set();
      const picked = [];
      for (const item of value) {
        if (!Number.isInteger(item) || item < 0 || item >= q.options || seen.has(item)) {
          throw new HttpError(400, 'INVALID_ANSWERS', 'Đáp án nhiều lựa chọn câu ' + (index + 1) + ' không hợp lệ.');
        }
        seen.add(item);
        picked.push(item);
      }
      if (picked.length) {
        picked.sort(function (a, b) { return a - b; });
        normalized[index] = picked;
      }
      return;
    }

    if (q.type === 'truefalse') {
      if (!Array.isArray(value) || value.length > q.options) {
        throw new HttpError(400, 'INVALID_ANSWERS', 'Đáp án đúng/sai câu ' + (index + 1) + ' không hợp lệ.');
      }
      let answered = false;
      const list = value.map(function (item) {
        if (item === true || item === false) {
          answered = true;
          return item;
        }
        if (item === null || item === undefined) return null;
        throw new HttpError(400, 'INVALID_ANSWERS', 'Đáp án đúng/sai câu ' + (index + 1) + ' không hợp lệ.');
      });
      if (answered) normalized[index] = list;
      return;
    }

    if (q.type === 'shortanswer') {
      if (typeof value !== 'string' && typeof value !== 'number') {
        throw new HttpError(400, 'INVALID_ANSWERS', 'Đáp án trả lời ngắn câu ' + (index + 1) + ' không hợp lệ.');
      }
      const text = String(value).trim();
      if (text.length > 50) {
        throw new HttpError(400, 'INVALID_ANSWERS', 'Đáp án trả lời ngắn câu ' + (index + 1) + ' quá dài.');
      }
      if (text) normalized[index] = text;
      return;
    }

    throw new HttpError(400, 'INVALID_ANSWERS', 'Loại câu hỏi không được hỗ trợ.');
  });

  return normalized;
}
