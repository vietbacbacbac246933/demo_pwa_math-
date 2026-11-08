#!/usr/bin/env node
/*
 * Sinh hash PBKDF2-SHA256 cho mật khẩu giáo viên.
 *
 *   node tools/hash-password.js
 *
 * Không truyền mật khẩu qua tham số dòng lệnh (sẽ lộ trong lịch sử shell).
 * Nhập mật khẩu trực tiếp, không hiển thị trên màn hình.
 * Kết quả dùng cho biến môi trường TEACHER_PASSWORD_HASH.
 *
 * Định dạng: pbkdf2_sha256$<iterations>$<salt_hex>$<hash_hex>
 */
'use strict';

const crypto = require('crypto');
const readline = require('readline');

// 50.000 vòng là mức cân bằng cho Cloudflare Pages Functions gói miễn phí:
// PBKDF2 chạy trong giới hạn CPU ngắn của request. Với 210.000 vòng, Workers
// có thể hủy phép tính và đăng nhập luôn trả 401 dù mật khẩu đúng.
const ITERATIONS = 50000;
const KEY_LENGTH = 32;
const MIN_LENGTH = 8;

function readHidden(prompt) {
  return new Promise(function (resolve, reject) {
    const input = process.stdin;
    const output = process.stdout;
    const rl = readline.createInterface({ input: input, output: output, terminal: true });

    let muted = false;
    const write = rl._writeToOutput.bind(rl);
    rl._writeToOutput = function (text) {
      if (muted) return;
      write(text);
    };

    rl.question(prompt, function (answer) {
      rl.close();
      output.write('\n');
      resolve(answer);
    });

    muted = true;
    rl.on('SIGINT', function () {
      rl.close();
      output.write('\n');
      reject(new Error('Đã hủy.'));
    });
  });
}

function hashPassword(password, salt) {
  const derived = crypto.pbkdf2Sync(
    Buffer.from(password, 'utf8'),
    salt,
    ITERATIONS,
    KEY_LENGTH,
    'sha256'
  );
  return 'pbkdf2_sha256$' + ITERATIONS + '$' + salt.toString('hex') + '$' + derived.toString('hex');
}

async function main() {
  if (!process.stdin.isTTY) {
    console.error('Cần chạy trong terminal tương tác để nhập mật khẩu.');
    process.exitCode = 1;
    return;
  }

  const password = await readHidden('Mật khẩu giáo viên: ');
  if (!password || password.length < MIN_LENGTH) {
    console.error('Mật khẩu phải có ít nhất ' + MIN_LENGTH + ' ký tự.');
    process.exitCode = 1;
    return;
  }

  const confirm = await readHidden('Nhập lại mật khẩu: ');
  if (password !== confirm) {
    console.error('Mật khẩu nhập lại không khớp.');
    process.exitCode = 1;
    return;
  }

  const salt = crypto.randomBytes(16);
  const hash = hashPassword(password, salt);

  console.log('\nTEACHER_PASSWORD_HASH=' + hash);
  console.log('\nDán dòng trên vào .dev.vars (local) và Cloudflare Pages > Settings > Environment variables (production).');
  console.log('Không commit file .dev.vars và không gửi hash/mật khẩu qua chat hay log.');
}

main().catch(function (error) {
  console.error(error && error.message ? error.message : 'Lỗi không xác định.');
  process.exitCode = 1;
});
