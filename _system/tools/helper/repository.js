'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { ROOT, LIMITS } = require('./config');

const CATALOG_REL = 'assets/js/catalog.js';
const EXAMS_DIR = path.join(ROOT, 'exams');

const QUIZ_RE = /(<script\b[^>]*\bid=["']quiz-data["'][^>]*>)([\s\S]*?)(<\/script>)/i;

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
  lich_su: 'su',
  toan: 'toan',
  toanhoc: 'toan',
  toan_hoc: 'toan',
  sinh: 'sinh',
  sinhhoc: 'sinh',
  sinh_hoc: 'sinh',
  van: 'van',
  nguvan: 'van',
  ngu_van: 'van',
  anh: 'anh',
  tienganh: 'anh',
  tieng_anh: 'anh'
};

let catalogCache = null;

function toSlug(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function padNumber(value) {
  const digits = String(value == null ? '' : value).replace(/\D/g, '');
  if (!digits) return '01';
  return digits.length >= 2 ? digits : digits.padStart(2, '0');
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function readCatalogText() {
  return fs.readFileSync(path.join(ROOT, CATALOG_REL), 'utf8');
}

function loadCatalog(force) {
  const file = path.join(ROOT, CATALOG_REL);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (error) {
    throw new Error('Không tìm thấy ' + CATALOG_REL);
  }
  if (!force && catalogCache && catalogCache.mtimeMs === stat.mtimeMs && catalogCache.size === stat.size) {
    return catalogCache.library;
  }

  const sandbox = {};
  try {
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
      self: sandbox,
      window: sandbox,
      console
    }, { filename: CATALOG_REL });
  } catch (error) {
    throw new Error('Không đọc được ' + CATALOG_REL + ': ' + error.message);
  }
  if (!sandbox.EXAM_LIBRARY || !Array.isArray(sandbox.EXAM_LIBRARY.subjects)) {
    throw new Error(CATALOG_REL + ' không có mảng subjects.');
  }
  catalogCache = {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    library: sandbox.EXAM_LIBRARY
  };
  return catalogCache.library;
}

function getSubjects() {
  const library = loadCatalog();
  return library.subjects.map((subject) => ({
    id: subject.id,
    name: subject.name,
    icon: subject.icon || '•',
    description: subject.description || '',
    examCount: Array.isArray(subject.exams) ? subject.exams.length : 0
  }));
}

function getExistingExams() {
  const library = loadCatalog();
  const map = new Map();
  library.subjects.forEach((subject) => {
    (subject.exams || []).forEach((exam) => {
      if (!exam || !exam.id) return;
      map.set(exam.id, {
        id: exam.id,
        title: exam.title || exam.id,
        file: exam.file || '',
        description: exam.description || '',
        questions: exam.questions,
        points: exam.points,
        minutes: exam.minutes,
        mode: exam.mode,
        tags: Array.isArray(exam.tags) ? exam.tags.slice() : [],
        addedAt: exam.addedAt || '',
        subjectId: subject.id,
        subjectName: subject.name
      });
    });
  });
  return map;
}

function getLibraryInfo() {
  const library = loadCatalog();
  let examCount = 0;
  library.subjects.forEach((subject) => {
    examCount += Array.isArray(subject.exams) ? subject.exams.length : 0;
  });
  return {
    title: library.title || 'Thư viện đề thi',
    updatedAt: library.updatedAt || '',
    subjects: getSubjects().map((subject) => {
      const source = library.subjects.find((item) => item.id === subject.id) || {};
      const exams = Array.isArray(source.exams) ? source.exams : [];
      return Object.assign({ exams: [] }, subject, {
        exams: exams.map((exam) => ({
          id: exam.id,
          title: exam.title || exam.id,
          file: exam.file || '',
          questions: exam.questions,
          points: exam.points,
          minutes: exam.minutes,
          mode: exam.mode,
          addedAt: exam.addedAt || ''
        }))
      });
    }),
    examCount
  };
}

function stripBom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

function pointsOfQuestion(question) {
  const n = Number(question && question.points);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(n, 100);
}

function totalPoints(questions) {
  return Math.round(questions.reduce((sum, question) => sum + pointsOfQuestion(question), 0) * 100) / 100;
}

function fileBaseName(name) {
  return path.basename(String(name || '').replace(/\\/g, '/'));
}

function inferSubject(fileName, quizId) {
  const subjectIds = new Set(loadCatalog().subjects.map((subject) => subject.id));
  const base = toSlug(fileBaseName(fileName).replace(/\.(html?|zip)$/i, ''));
  const tokens = base.split('_').filter(Boolean);

  for (let i = 0; i < tokens.length; i += 1) {
    const single = SUBJECT_ALIASES[tokens[i]] || tokens[i];
    if (subjectIds.has(single)) return single;
    if (i + 1 < tokens.length) {
      const pairKey = tokens[i] + '_' + tokens[i + 1];
      const pair = SUBJECT_ALIASES[pairKey] || pairKey;
      if (subjectIds.has(pair)) return pair;
    }
  }

  const idPrefix = toSlug(String(quizId || '')).split('_')[0];
  if (idPrefix && subjectIds.has(idPrefix)) return idPrefix;

  // Mã đề cũ có dạng không chuẩn (ví dụ 71efc4fda2de) thì tra trong catalog.
  const existing = getExistingExams().get(String(quizId || ''));
  if (existing) return existing.subjectId;

  return null;
}

function parseExamContent(name, content) {
  const errors = [];
  const warnings = [];
  const text = stripBom(content);
  const size = Buffer.byteLength(text, 'utf8');

  if (!text.trim()) {
    return { ok: false, errors: ['File rỗng.'], warnings, exam: null, size, inferredSubjectId: null };
  }
  if (size > LIMITS.maxFileBytes) {
    return {
      ok: false,
      errors: ['File lớn hơn giới hạn ' + Math.round(LIMITS.maxFileBytes / 1024 / 1024) + ' MB.'],
      warnings,
      exam: null,
      size,
      inferredSubjectId: null
    };
  }
  if (!/\.html?$/i.test(fileBaseName(name))) {
    errors.push('Chỉ hỗ trợ file .html hoặc .htm (hoặc .zip chứa các file này).');
  }
  if (text.indexOf('\u0000') >= 0) {
    errors.push('File có ký tự nhị phân, không phải HTML văn bản.');
  }

  const match = text.match(QUIZ_RE);
  if (!match) {
    errors.push('Không tìm thấy khối <script id="quiz-data" type="application/json">.');
    return { ok: false, errors, warnings, exam: null, size, inferredSubjectId: null };
  }

  let data;
  try {
    data = JSON.parse(match[2]);
  } catch (error) {
    errors.push('Dữ liệu quiz-data không phải JSON hợp lệ: ' + error.message);
    return { ok: false, errors, warnings, exam: null, size, inferredSubjectId: null };
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    errors.push('quiz-data phải là một đối tượng JSON.');
    return { ok: false, errors, warnings, exam: null, size, inferredSubjectId: null };
  }
  if (!Array.isArray(data.questions) || !data.questions.length) {
    errors.push('Đề không có câu hỏi nào trong mảng questions.');
  }

  const quizId = typeof data.id === 'string' ? data.id.trim() : '';
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  if (!quizId) {
    warnings.push('Đề chưa có mã id; hệ thống sẽ cấp mã mới theo môn và số đề.');
  }
  if (!title) {
    warnings.push('Đề chưa có tiêu đề; hệ thống sẽ tạo tiêu đề theo môn và số đề.');
  }
  if (quizId && !/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(quizId)) {
    warnings.push('Mã đề "' + quizId + '" có ký tự lạ; mã mới sẽ được tạo khi thêm đề.');
  }
  if (!/^de_[a-z0-9_]+_\d{1,4}\.html?$/i.test(fileBaseName(name))) {
    warnings.push('Tên file không theo mẫu de_<môn>_<số>.html; hệ thống sẽ tự đặt tên chuẩn.');
  }

  const questions = Array.isArray(data.questions) ? data.questions : [];
  const settings = data.settings && typeof data.settings === 'object' ? data.settings : {};
  const exam = {
    id: quizId,
    title,
    questions: questions.length,
    points: totalPoints(questions),
    minutes: Number(settings.minutes) || 0,
    mode: settings.mode === 'exam' ? 'exam' : 'practice',
    tags: Array.isArray(data.tags) ? data.tags.filter((tag) => typeof tag === 'string') : []
  };

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    exam,
    size,
    inferredSubjectId: inferSubject(name, quizId),
    hasQuizData: true
  };
}

function fileExistsFor(subjectId, number) {
  const dir = path.join(EXAMS_DIR, subjectId);
  const candidates = [
    'de_' + subjectId + '_' + number + '.html',
    'de_' + subjectId + '_' + number + '.htm'
  ];
  return candidates.some((name) => fs.existsSync(path.join(dir, name)));
}

function usedNumbersFor(subjectId) {
  const used = new Set();
  const dir = path.join(EXAMS_DIR, subjectId);
  try {
    fs.readdirSync(dir).forEach((name) => {
      const match = name.match(new RegExp('^de_' + escapeRegExp(subjectId) + '_(\\d+)\\.html?$', 'i'));
      if (match) used.add(padNumber(match[1]));
    });
  } catch (error) {
    // Môn mới chưa có thư mục.
  }
  getExistingExams().forEach((exam) => {
    const match = exam.id.match(new RegExp('^' + escapeRegExp(subjectId) + '_(\\d+)$', 'i'));
    if (match) used.add(padNumber(match[1]));
  });
  return used;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function chooseNumber(subjectId, fileName, reserved) {
  const used = usedNumbersFor(subjectId);
  (reserved || []).forEach((number) => used.add(number));

  const base = path.basename(fileBaseName(fileName), path.extname(fileBaseName(fileName)));
  const match = base.match(/(?:^|[_\-\s])(\d{1,4})$/);
  if (match) {
    const suggested = padNumber(match[1]);
    if (!used.has(suggested) && !fileExistsFor(subjectId, suggested)) return suggested;
  }

  let max = 0;
  used.forEach((value) => { max = Math.max(max, Number(value) || 0); });
  let next = max + 1;
  while (used.has(padNumber(next)) || fileExistsFor(subjectId, padNumber(next))) next += 1;
  return padNumber(next);
}

function buildValidation(upload) {
  const parsed = parseExamContent(upload.name, upload.content);
  const existing = parsed.exam && parsed.exam.id ? getExistingExams().get(parsed.exam.id) : null;
  const subject = parsed.inferredSubjectId
    ? getSubjects().find((item) => item.id === parsed.inferredSubjectId)
    : null;

  const warnings = parsed.warnings.slice();
  if (existing) {
    warnings.push('Mã đề "' + parsed.exam.id + '" đã có trong thư viện. Chọn "Cập nhật" để thay bản cũ (có sao lưu), hoặc "Thêm thành đề mới" để giữ nguyên bản cũ.');
  }
  if (!parsed.inferredSubjectId && parsed.ok) {
    warnings.push('Chưa nhận ra môn học từ tên file; hãy chọn môn trước khi đăng.');
  }

  let suggestion = null;
  if (parsed.ok && !existing) {
    const subjectId = parsed.inferredSubjectId || (getSubjects()[0] && getSubjects()[0].id);
    if (subjectId) {
      const number = chooseNumber(subjectId, upload.name, []);
      suggestion = {
        mode: 'new',
        subjectId,
        number,
        id: subjectId + '_' + number,
        file: 'exams/' + subjectId + '/de_' + subjectId + '_' + number + '.html',
        title: parsed.exam.title || ('Đề ' + subjectId + ' số ' + Number(number))
      };
    }
  }
  if (parsed.ok && existing) {
    const parts = existing.id.match(/_(\d+)$/);
    suggestion = {
      mode: 'update',
      subjectId: existing.subjectId,
      number: parts ? padNumber(parts[1]) : '',
      id: existing.id,
      file: existing.file,
      title: existing.title
    };
  }

  return {
    uploadId: upload.id,
    name: upload.name,
    relativePath: upload.relativePath || upload.name,
    size: parsed.size,
    ok: parsed.ok && !existing ? true : parsed.ok,
    errors: parsed.errors,
    warnings,
    exam: parsed.exam,
    inferredSubjectId: parsed.inferredSubjectId,
    subject,
    duplicate: existing ? {
      id: existing.id,
      title: existing.title,
      subjectId: existing.subjectId,
      subjectName: existing.subjectName,
      file: existing.file
    } : null,
    updateAvailable: Boolean(existing),
    suggestion
  };
}

function computePlan(items) {
  const existingById = getExistingExams();
  const subjects = getSubjects();
  const subjectIds = new Set(subjects.map((subject) => subject.id));
  const reservedNumbers = new Map();
  const reservedUpdateIds = new Set();
  const sourceIds = new Map();
  const plans = [];
  const globalWarnings = [];

  items.forEach((item, index) => {
    const parsed = parseExamContent(item.name, item.content);
    const base = {
      index,
      uploadId: item.uploadId,
      name: item.name,
      relativePath: item.relativePath || item.name,
      size: parsed.size,
      mode: item.mode === 'update' ? 'update' : 'new',
      errors: parsed.errors.slice(),
      warnings: parsed.warnings.slice(),
      exam: parsed.exam
    };

    if (parsed.exam && parsed.exam.id) {
      if (!sourceIds.has(parsed.exam.id)) sourceIds.set(parsed.exam.id, []);
      sourceIds.get(parsed.exam.id).push(base);
    }

    if (!parsed.ok) {
      base.action = 'error';
      plans.push(base);
      return;
    }

    if (base.mode === 'update') {
      const target = parsed.exam.id ? existingById.get(parsed.exam.id) : null;
      if (!target) {
        base.action = 'error';
        base.errors.push('Không tìm thấy mã đề "' + (parsed.exam.id || '') + '" trong thư viện để cập nhật.');
        plans.push(base);
        return;
      }
      if (reservedUpdateIds.has(target.id)) {
        base.action = 'error';
        base.errors.push('Có nhiều file cùng yêu cầu cập nhật đề "' + target.id + '".');
        plans.push(base);
        return;
      }
      reservedUpdateIds.add(target.id);

      const currentFile = path.join(ROOT, target.file);
      let sameContent = false;
      try {
        sameContent = fs.existsSync(currentFile) &&
          sha256(fs.readFileSync(currentFile, 'utf8')) === sha256(stripBom(item.content));
      } catch (error) {
        sameContent = false;
      }

      base.action = sameContent ? 'skip' : 'update';
      base.id = target.id;
      base.file = target.file;
      base.subjectId = target.subjectId;
      base.subjectName = target.subjectName;
      base.title = target.title;
      base.questions = target.questions;
      base.points = target.points;
      base.duplicate = true;
      base.updateAvailable = true;
      if (sameContent) {
        base.warnings.push('Nội dung giống hệt bản đang có; đề này sẽ được bỏ qua.');
      }
      plans.push(base);
      return;
    }

    let subjectId = item.subjectId ? toSlug(item.subjectId) : parsed.inferredSubjectId;
    if (!subjectId) {
      base.action = 'error';
      base.errors.push('Chưa xác định được môn học. Hãy chọn môn cho đề này.');
      plans.push(base);
      return;
    }
    if (!subjectIds.has(subjectId)) {
      base.action = 'error';
      base.errors.push('Môn "' + subjectId + '" không có trong danh mục.');
      plans.push(base);
      return;
    }

    const reserved = reservedNumbers.get(subjectId) || [];
    const number = chooseNumber(subjectId, item.name, reserved);
    reserved.push(number);
    reservedNumbers.set(subjectId, reserved);

    const subject = subjects.find((value) => value.id === subjectId);
    const id = subjectId + '_' + number;
    const duplicate = parsed.exam.id ? existingById.get(parsed.exam.id) : null;
    if (duplicate) {
      base.warnings.push('Mã nguồn "' + parsed.exam.id + '" trùng đề cũ. Đề mới sẽ dùng mã "' + id + '"; đề cũ không bị ghi đè.');
    }

    base.action = 'add';
    base.id = id;
    base.file = 'exams/' + subjectId + '/de_' + subjectId + '_' + number + '.html';
    base.number = number;
    base.subjectId = subjectId;
    base.subjectName = subject ? subject.name : subjectId;
    base.title = parsed.exam.title || ('Đề ' + base.subjectName + ' số ' + Number(number));
    base.questions = parsed.exam.questions;
    base.points = parsed.exam.points;
    base.duplicate = Boolean(duplicate);
    base.duplicateWith = duplicate ? {
      id: duplicate.id,
      title: duplicate.title,
      subjectName: duplicate.subjectName
    } : null;
    plans.push(base);
  });

  sourceIds.forEach((list, quizId) => {
    if (list.length < 2) return;
    const updateCount = list.filter((item) => item.mode === 'update').length;
    if (updateCount > 1) {
      list.forEach((item) => {
        item.action = 'error';
        item.errors.push('Mã đề "' + quizId + '" xuất hiện ở nhiều file cập nhật.');
      });
    } else if (list.length > 1 && updateCount === 0) {
      globalWarnings.push('Có ' + list.length + ' file cùng mã nguồn "' + quizId + '". Mỗi file sẽ nhận một mã mới riêng.');
    }
  });

  const summary = {
    add: plans.filter((item) => item.action === 'add').length,
    update: plans.filter((item) => item.action === 'update').length,
    skip: plans.filter((item) => item.action === 'skip').length,
    error: plans.filter((item) => item.action === 'error').length,
    total: plans.length,
    duplicates: plans.filter((item) => item.duplicate).length
  };
  summary.nothingToDo = summary.add + summary.update === 0;
  summary.canDeploy = summary.error === 0 && !summary.nothingToDo;

  const signature = sha256(JSON.stringify(plans.map((item) => [
    item.uploadId,
    item.mode,
    item.action,
    item.id || '',
    item.file || ''
  ])));

  return {
    ok: summary.error === 0,
    summary,
    items: plans,
    warnings: globalWarnings,
    signature
  };
}

module.exports = {
  CATALOG_REL,
  loadCatalog,
  getSubjects,
  getExistingExams,
  getLibraryInfo,
  parseExamContent,
  buildValidation,
  computePlan,
  sha256,
  toSlug,
  padNumber,
  stripBom
};
