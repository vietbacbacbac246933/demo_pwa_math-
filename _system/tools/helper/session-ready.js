#!/usr/bin/env node
/* Kiểm tra nhanh file phiên + Local Helper đã sẵn sàng chưa. */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const file = process.argv[2] || path.join(
  process.env.LOCALAPPDATA || os.homedir(),
  'ExamLibraryHelper',
  'session.json'
);

let session;
try {
  session = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (error) {
  process.exit(1);
}
if (!session || session.app !== 'exam-library-helper' || !session.port) {
  process.exit(1);
}
try {
  process.kill(Number(session.pid), 0);
} catch (error) {
  process.exit(1);
}

const timeout = AbortSignal.timeout ? AbortSignal.timeout(1800) : undefined;
fetch('http://127.0.0.1:' + session.port + '/api/status', { signal: timeout })
  .then((res) => res.json())
  .then((info) => process.exit(info && info.app === 'exam-library-helper' ? 0 : 1))
  .catch(() => process.exit(1));
