#!/usr/bin/env node
/*
 * Tăng CACHE_VERSION trong sw.js lên 1 đơn vị (v17 -> v18).
 *
 *   node tools/bump-cache-version.js
 *   node tools/bump-cache-version.js --dry-run
 *
 * Cần tăng mỗi lần deploy thay đổi file tĩnh, để Service Worker cài lại
 * cache và người dùng nhận bản mới.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SW_PATH = path.join(__dirname, '..', 'sw.js');
const dryRun = process.argv.indexOf('--dry-run') >= 0;

const text = fs.readFileSync(SW_PATH, 'utf8');
const match = /(CACHE_VERSION\s*=\s*'v)(\d+)(')/.exec(text);

if (!match) {
  console.error('Không tìm thấy CACHE_VERSION dạng \'v<so>\' trong sw.js');
  process.exit(1);
}

const current = Number(match[2]);
const next = current + 1;
const updated = text.replace(match[0], match[1] + next + match[3]);

if (dryRun) {
  console.log('CACHE_VERSION hiện tại: v' + current + ' -> sẽ thành v' + next + ' (dry-run)');
  process.exit(0);
}

if (updated === text) {
  console.log('CACHE_VERSION không đổi: v' + current);
  process.exit(0);
}

fs.writeFileSync(SW_PATH, updated, 'utf8');
console.log('Đã tăng CACHE_VERSION: v' + current + ' -> v' + next);
