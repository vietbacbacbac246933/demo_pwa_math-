#!/usr/bin/env node
/*
 * Tìm Wrangler đã có trên máy mà KHÔNG tự cài/nâng cấp.
 *
 * Thứ tự ưu tiên:
 *   1. node_modules/wrangler của chính project
 *   2. lệnh "wrangler" có sẵn trong PATH
 *   3. bản Wrangler đã được npx tải trước đó (npm cache _npx)
 *   4. npx (chỉ dùng khi không tìm thấy bản nào; có thể tải lần đầu)
 *
 *   node _system/tools/helper/find-wrangler.js --json
 *   node _system/tools/helper/find-wrangler.js --version
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return null;
  }
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch (error) {
    return false;
  }
}

function versionOf(entry) {
  const pkg = readJson(path.join(entry, '..', 'package.json')) ||
    readJson(path.join(entry, '..', '..', 'package.json'));
  return pkg && pkg.version ? String(pkg.version) : '';
}

function candidateFromNodeModule(dir, source) {
  const entry = path.join(dir, 'bin', 'wrangler.js');
  if (!isFile(entry)) return null;
  return {
    kind: 'node',
    entry,
    version: versionOf(entry),
    source
  };
}

function findInPath() {
  const result = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['wrangler'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 8000
  });
  if (result.status !== 0 || !result.stdout) return null;
  const first = result.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
  if (!first || !isFile(first)) return null;
  const ext = path.extname(first).toLowerCase();
  if (ext === '.js') {
    return { kind: 'node', entry: first, version: '', source: 'PATH' };
  }
  return {
    kind: ext === '.exe' ? 'exe' : 'cmd',
    entry: first,
    version: '',
    source: 'PATH'
  };
}

function findInNpxCache() {
  const bases = [];
  if (process.env.LOCALAPPDATA) {
    bases.push(path.join(process.env.LOCALAPPDATA, 'npm-cache', '_npx'));
  }
  if (process.env.APPDATA) {
    bases.push(path.join(process.env.APPDATA, 'npm-cache', '_npx'));
  }
  bases.push(path.join(os.homedir(), '.npm', '_npx'));

  const found = [];
  bases.forEach((base) => {
    let dirs = [];
    try {
      dirs = fs.readdirSync(base, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(base, entry.name));
    } catch (error) {
      return;
    }
    dirs.forEach((dir) => {
      const candidate = candidateFromNodeModule(
        path.join(dir, 'node_modules', 'wrangler'),
        'npx cache'
      );
      if (candidate) found.push(candidate);
    });
  });

  found.sort((a, b) => {
    const av = a.version.split('.').map(Number);
    const bv = b.version.split('.').map(Number);
    for (let i = 0; i < 3; i += 1) {
      const diff = (bv[i] || 0) - (av[i] || 0);
      if (diff) return diff;
    }
    return a.entry.localeCompare(b.entry);
  });
  return found[0] || null;
}

function findWrangler() {
  const local = candidateFromNodeModule(
    path.join(ROOT, 'node_modules', 'wrangler'),
    'project'
  );
  if (local) return local;

  const global = findInPath();
  if (global) return global;

  const cached = findInNpxCache();
  if (cached) return cached;

  return {
    kind: 'npx',
    entry: '',
    version: '',
    source: 'npx (chưa có bản cài sẵn)'
  };
}

function quoteCmdArg(value) {
  const text = String(value);
  if (!/[\s"&|<>^]/.test(text)) return text;
  return '"' + text.replace(/"/g, '""') + '"';
}

// Trả về lệnh có thể truyền thẳng cho spawnSync.
function commandFor(wrangler, args) {
  if (wrangler.kind === 'node') {
    return {
      file: process.execPath,
      args: [wrangler.entry].concat(args)
    };
  }
  if (wrangler.kind === 'exe') {
    return { file: wrangler.entry, args: args.slice() };
  }
  if (wrangler.kind === 'cmd') {
    return {
      file: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', [quoteCmdArg(wrangler.entry)].concat(args.map(quoteCmdArg)).join(' ')]
    };
  }
  return {
    file: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', ['npx', '--yes', 'wrangler'].concat(args.map(quoteCmdArg)).join(' ')]
  };
}

function printHelp() {
  console.log('Cách dùng: node _system/tools/helper/find-wrangler.js [--json|--version]');
}

if (require.main === module) {
  const arg = process.argv[2] || '';
  const wrangler = findWrangler();
  if (arg === '--json') {
    process.stdout.write(JSON.stringify(wrangler) + '\n');
  } else if (arg === '--version') {
    if (wrangler.version) console.log(wrangler.version);
    else console.log(wrangler.kind + ':' + (wrangler.entry || 'npx'));
  } else if (arg === '--help' || arg === '-h') {
    printHelp();
  } else {
    console.log('Wrangler: ' + (wrangler.version || '(chưa rõ phiên bản)'));
    console.log('Nguồn: ' + wrangler.source);
    console.log('Loại: ' + wrangler.kind);
    if (wrangler.entry) console.log('Đường dẫn: ' + wrangler.entry);
  }
}

module.exports = {
  findWrangler,
  commandFor,
  quoteCmdArg,
  ROOT
};
