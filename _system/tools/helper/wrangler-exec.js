#!/usr/bin/env node
/*
 * Chạy Wrangler đã có trên máy, không tự nâng cấp.
 * Dùng cho deploy-pages.ps1 và phần kiểm tra môi trường.
 *
 *   node _system/tools/helper/wrangler-exec.js whoami
 *   node _system/tools/helper/wrangler-exec.js pages deploy <thư-mục> --project-name ...
 */
'use strict';

const { spawnSync } = require('child_process');
const { findWrangler, commandFor } = require('./find-wrangler');

const wrangler = findWrangler();
const args = process.argv.slice(2);

if (!args.length) {
  console.error('Thiếu tham số cho Wrangler.');
  process.exit(2);
}

const command = commandFor(wrangler, args);
const result = spawnSync(command.file, command.args, {
  stdio: 'inherit',
  windowsHide: false,
  env: Object.assign({}, process.env, {
    WRANGLER_SEND_METRICS: 'false',
    NO_COLOR: '1',
    FORCE_COLOR: '0'
  })
});

if (result.error) {
  console.error('Không chạy được Wrangler: ' + result.error.message);
  process.exit(1);
}
process.exit(typeof result.status === 'number' ? result.status : 1);
