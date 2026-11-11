'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { STAGING_DIR, LIMITS } = require('./config');

const uploads = new Map();
let lastCleanup = 0;
const TTL_MS = 2 * 60 * 60 * 1000;

function ensureStaging() {
  fs.mkdirSync(STAGING_DIR, { recursive: true });
}

function newId() {
  return crypto.randomBytes(16).toString('hex');
}

function cleanDisplayName(value, fallback) {
  return String(value || fallback || 'de.html')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]+/g, '/')
    .slice(0, 300);
}

function displayBaseName(value) {
  return path.basename(cleanDisplayName(value, 'de.html').replace(/\\/g, '/'));
}

function isHtmlName(name) {
  return /\.html?$/i.test(name);
}

function isZipName(name) {
  return /\.zip$/i.test(name);
}

function stageContent(name, relativePath, content) {
  ensureStaging();
  const size = Buffer.byteLength(content, 'utf8');
  if (size > LIMITS.maxFileBytes) {
    throw new Error('File "' + name + '" lớn hơn ' + Math.round(LIMITS.maxFileBytes / 1024 / 1024) + ' MB.');
  }
  const id = newId();
  const target = path.join(STAGING_DIR, id + '.html');
  fs.writeFileSync(target, content, { encoding: 'utf8', flag: 'wx' });
  const record = {
    id,
    name: displayBaseName(name),
    relativePath: cleanDisplayName(relativePath || name, name),
    size,
    sha256: crypto.createHash('sha256').update(content, 'utf8').digest('hex'),
    filePath: target,
    createdAt: Date.now()
  };
  uploads.set(id, record);
  return record;
}

function runZipExtraction(zipPath, destination) {
  const script = path.join(__dirname, 'extract-zip.ps1');
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', script,
    '-ZipPath', zipPath,
    '-Destination', destination,
    '-MaxEntries', String(LIMITS.maxExtractedFiles * 5),
    '-MaxBytes', String(LIMITS.maxExtractedBytes)
  ], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60000,
    maxBuffer: 2 * 1024 * 1024
  });
  if (result.error) throw new Error('Không giải nén được file zip: ' + result.error.message);
  if (result.status !== 0) {
    const message = String(result.stderr || result.stdout || '').trim();
    throw new Error('Không giải nén được file zip: ' + (message || ('mã ' + result.status)));
  }
}

function walkFiles(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else if (entry.isFile()) out.push(full);
  });
  return out;
}

function stageZip(name, relativePath, zipBuffer) {
  ensureStaging();
  if (zipBuffer.length > LIMITS.maxFileBytes) {
    throw new Error('File zip lớn hơn ' + Math.round(LIMITS.maxFileBytes / 1024 / 1024) + ' MB.');
  }
  const zipId = newId();
  const zipPath = path.join(STAGING_DIR, zipId + '.zip');
  const extractDir = path.join(STAGING_DIR, zipId + '-zip');
  fs.writeFileSync(zipPath, zipBuffer, { flag: 'wx' });
  fs.mkdirSync(extractDir, { recursive: true });
  try {
    runZipExtraction(zipPath, extractDir);
    const htmlFiles = walkFiles(extractDir, []).filter((file) => isHtmlName(file));
    if (!htmlFiles.length) {
      throw new Error('File zip không chứa file .html/.htm có đề.');
    }
    if (htmlFiles.length > LIMITS.maxExtractedFiles) {
      throw new Error('File zip có quá nhiều đề (tối đa ' + LIMITS.maxExtractedFiles + ').');
    }
    let total = 0;
    const staged = [];
    htmlFiles.forEach((file) => {
      const content = fs.readFileSync(file, 'utf8');
      total += Buffer.byteLength(content, 'utf8');
      if (total > LIMITS.maxExtractedBytes) {
        throw new Error('Tổng dung lượng đề trong zip vượt quá giới hạn.');
      }
      const rel = path.relative(extractDir, file).replace(/\\/g, '/');
      const record = stageContent(
        path.basename(file),
        displayBaseName(name) + ' › ' + rel,
        content
      );
      record.archive = displayBaseName(name);
      staged.push(record);
    });
    return staged;
  } finally {
    try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch (error) {}
    try { fs.rmSync(zipPath, { force: true }); } catch (error) {}
  }
}

function getUpload(id) {
  if (!/^[a-f0-9]{32}$/.test(String(id || ''))) return null;
  const record = uploads.get(String(id));
  if (!record) return null;
  if (!fs.existsSync(record.filePath)) return null;
  return record;
}

function readUploadContent(id) {
  const record = getUpload(id);
  if (!record) return null;
  return {
    record,
    content: fs.readFileSync(record.filePath, 'utf8')
  };
}

function removeUpload(id) {
  const record = uploads.get(String(id));
  if (!record) return;
  uploads.delete(String(id));
  try { fs.rmSync(record.filePath, { force: true }); } catch (error) {}
}

function cleanupUploads(ids) {
  (ids || []).forEach(removeUpload);
}

function cleanupStale(now) {
  const stamp = now || Date.now();
  if (stamp - lastCleanup < 15 * 60 * 1000) return;
  lastCleanup = stamp;
  uploads.forEach((record, id) => {
    if (stamp - record.createdAt > TTL_MS) removeUpload(id);
  });
}

function clearAll() {
  Array.from(uploads.keys()).forEach(removeUpload);
}

module.exports = {
  stageContent,
  stageZip,
  getUpload,
  readUploadContent,
  cleanupUploads,
  cleanupStale,
  clearAll,
  isHtmlName,
  isZipName,
  newId
};
