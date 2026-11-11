'use strict';

const path = require('path');
const os = require('os');

const ROOT = process.env.EXAM_HELPER_ROOT
  ? path.resolve(process.env.EXAM_HELPER_ROOT)
  : path.resolve(__dirname, '..', '..', '..');

const HOST = '127.0.0.1';
const PORT = Number(process.env.EXAM_HELPER_PORT || 47821);
const APP_ID = 'exam-library-helper';
const VERSION = '1.0.0';

const SESSION_DIR = process.env.EXAM_HELPER_SESSION_DIR
  ? path.resolve(process.env.EXAM_HELPER_SESSION_DIR)
  : path.join(process.env.LOCALAPPDATA || os.homedir(), 'ExamLibraryHelper');

const SESSION_FILE = path.join(SESSION_DIR, 'session.json');
const HELPER_LOG_FILE = path.join(SESSION_DIR, 'helper.log');
const STAGING_DIR = path.join(SESSION_DIR, 'staging');
// Snapshot và log của Local Helper nằm trong thư mục phiên cục bộ, không nằm
// trong repo để tránh bị check-library quét nhầm là đề mồ côi.
const BACKUP_DIR = path.join(SESSION_DIR, 'backups');
const JOB_DIR = path.join(SESSION_DIR, 'jobs');

const PUBLIC_URL = (process.env.EXAM_PUBLIC_URL || 'https://de-toan-thpt.pages.dev/').replace(/\/?$/, '/');
const IDLE_TIMEOUT_MS = Number(process.env.EXAM_HELPER_IDLE_MS || 60 * 60 * 1000);
const DISABLE_DEPLOY = process.env.EXAM_HELPER_NO_DEPLOY === '1';

const LIMITS = {
  maxFiles: 20,
  maxFileBytes: 12 * 1024 * 1024,
  maxBodyBytes: 64 * 1024 * 1024,
  maxExtractedFiles: 40,
  maxExtractedBytes: 80 * 1024 * 1024,
  maxLogLines: 4000
};

module.exports = {
  ROOT,
  HOST,
  PORT,
  APP_ID,
  VERSION,
  SESSION_DIR,
  SESSION_FILE,
  HELPER_LOG_FILE,
  STAGING_DIR,
  BACKUP_DIR,
  JOB_DIR,
  PUBLIC_URL,
  IDLE_TIMEOUT_MS,
  DISABLE_DEPLOY,
  LIMITS
};
