#!/usr/bin/env node
/*
 * Ghi file an toàn trên Windows khi file đang mang thuộc tính Hidden.
 *
 * Lý do: trong thư mục OneDrive, file có thuộc tính Hidden trả EPERM khi mở
 * để ghi (OneDrive chặn ghi vào file ẩn). Các script cần sửa sw.js — file được
 * ẩn cho gọn thư mục — nên phải tạm bỏ Hidden, ghi, rồi đặt lại.
 *
 * Chỉ có tác dụng trên Windows; trên hệ điều hành khác gọi thẳng fs.
 */
'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');

function isHidden(file) {
  if (process.platform !== 'win32') return false;
  try {
    const out = execFileSync('attrib.exe', [file], { encoding: 'utf8' });
    return out.split(/\r?\n/).some((line) => line.trim() !== '' && line.slice(0, 6).indexOf('H') >= 0);
  } catch (error) {
    return false;
  }
}

function setHidden(file, hidden) {
  if (process.platform !== 'win32') return;
  try {
    execFileSync('attrib.exe', [hidden ? '+h' : '-h', file], { stdio: 'ignore' });
  } catch (error) {
    /* bỏ qua: không đặt lại được thuộc tính cũng không sao */
  }
}

function withWritable(file, fn) {
  const hidden = isHidden(file);
  if (hidden) setHidden(file, false);
  try {
    return fn();
  } finally {
    if (hidden) setHidden(file, true);
  }
}

function writeFileSync(file, data, options) {
  return withWritable(file, () => fs.writeFileSync(file, data, options));
}

function copyFileSync(source, target) {
  return withWritable(target, () => fs.copyFileSync(source, target));
}

module.exports = { isHidden, setHidden, writeFileSync, copyFileSync };
