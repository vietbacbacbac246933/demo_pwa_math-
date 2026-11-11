#!/usr/bin/env node
/*
 * Kiểm tra môi trường trước khi mở giao diện quản lý đề.
 *
 *   node _system/tools/check-environment.js
 *   node _system/tools/check-environment.js --json
 *
 * Mã thoát:
 *   0 = sẵn sàng deploy
 *   2 = chạy được giao diện nhưng còn cảnh báo (ví dụ chưa đăng nhập Cloudflare)
 *   1 = lỗi bắt buộc, không nên tiếp tục
 */
'use strict';

const env = require('./helper/env');

const asJson = process.argv.indexOf('--json') >= 0;
const info = env.getEnvironment({ refresh: process.argv.indexOf('--refresh') >= 0 });

if (asJson) {
  process.stdout.write(JSON.stringify(info, null, 2) + '\n');
} else {
  console.log('');
  console.log('=== KIỂM TRA MÔI TRƯỜNG ===');
  console.log('Node.js: ' + info.node.version + (info.node.ok ? '  [OK]' : '  [CẦN >= 22.5]'));
  console.log('Wrangler: ' + (info.wrangler.found
    ? ((info.wrangler.version || 'có sẵn') + ' (' + info.wrangler.source + ')  [OK]')
    : 'chưa có bản cài sẵn, sẽ dùng npx khi deploy  [CẢNH BÁO]'));
  console.log('Cloudflare: ' + info.cloudflare.message + (info.cloudflare.ok ? '  [OK]' : '  [CẢNH BÁO]'));
  console.log('Project: ' + (info.project.name || '(chưa đọc được)') +
    (info.project.d1 ? ' · D1 OK' : ' · thiếu cấu hình D1'));
  console.log('Thư viện: ' + info.library.exams + ' đề / ' + info.library.subjects + ' môn' +
    (info.library.ok ? '  [OK]' : '  [LỖI]'));
  if (info.missingFiles.length) {
    console.log('Thiếu file: ' + info.missingFiles.join(', '));
  }
  info.errors.forEach((message) => console.log('LỖI: ' + message));
  info.warnings.forEach((message) => console.log('CẢNH BÁO: ' + message));
  console.log('Kết quả: ' + (info.errors.length ? 'CHƯA SẴN SÀNG' :
    (info.warnings.length ? 'CHẠY ĐƯỢC, CÒN CẢNH BÁO' : 'SẴN SÀNG')));
  console.log('');
}

if (info.errors.length) process.exitCode = 1;
else if (info.warnings.length || !info.cloudflare.ok) process.exitCode = 2;
else process.exitCode = 0;
