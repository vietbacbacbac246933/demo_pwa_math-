#!/usr/bin/env node
/*
 * Kiểm tra Service Worker chỉ cache lười:
 *   - Cài đặt chỉ tải phần lõi, KHÔNG tải trước đề nào.
 *   - Mở đề nào thì chỉ tải và lưu đề đó.
 *   - Đề đã mở vẫn mở được khi ngoại tuyến; đề chưa mở hiện trang thông báo.
 *
 *   node tools/test-sw-lazy.js
 *
 * Không cần trình duyệt: mô phỏng Cache Storage + fetch bằng Node.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://example.test';

function main() {
  const listeners = {};
  const cacheStores = new Map();
  const fetched = [];

  function keyOf(value) {
    const url = new URL(typeof value === 'string' ? value : value.url, ORIGIN + '/');
    return url.origin + url.pathname;
  }

  function makeCache(name) {
    if (!cacheStores.has(name)) cacheStores.set(name, new Map());
    const store = cacheStores.get(name);
    return {
      match(value) {
        const hit = store.get(keyOf(value));
        return Promise.resolve(hit ? hit.clone() : undefined);
      },
      put(value, response) {
        store.set(keyOf(value), response.clone());
        return Promise.resolve();
      }
    };
  }

  const caches = {
    open(name) { return Promise.resolve(makeCache(name)); },
    keys() { return Promise.resolve(Array.from(cacheStores.keys())); },
    delete(name) { return Promise.resolve(cacheStores.delete(name)); }
  };

  let offline = false;
  function mockFetch(input) {
    const url = typeof input === 'string' ? input : input.url;
    fetched.push(url);
    if (offline) return Promise.reject(new TypeError('Failed to fetch'));

    const pathname = new URL(url, ORIGIN + '/').pathname;
    if (/\/exams\//.test(pathname)) {
      return Promise.resolve(new Response(
        '<!doctype html><html><script id="quiz-data" type="application/json">{}</script></html>',
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      ));
    }
    if (pathname.endsWith('/') || pathname.endsWith('.html')) {
      return Promise.resolve(new Response('<!doctype html><html>home</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      }));
    }
    return Promise.resolve(new Response('asset', {
      status: 200,
      headers: { 'Content-Type': pathname.endsWith('.css') ? 'text/css' : 'application/javascript' }
    }));
  }

  const sandbox = {
    self: {
      location: { href: ORIGIN + '/', origin: ORIGIN },
      addEventListener(type, fn) { listeners[type] = fn; },
      skipWaiting() { return Promise.resolve(); },
      clients: { claim() { return Promise.resolve(); } },
      EXAM_REVS: {}
    },
    caches,
    fetch: mockFetch,
    Request,
    Response,
    Headers,
    URL,
    URLSearchParams,
    crypto,
    Promise,
    console,
    setTimeout,
    clearTimeout
  };
  sandbox.self.self = sandbox.self;
  sandbox.importScripts = function () {
    Array.prototype.slice.call(arguments).forEach(function (url) {
      const file = path.join(ROOT, new URL(url, ORIGIN + '/').pathname);
      vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    });
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), context, { filename: 'sw.js' });

  let failed = 0;
  function check(name, ok, detail) {
    console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? ' — ' + detail : ''));
    if (!ok) failed += 1;
  }

  async function settleInstall() {
    const waits = [];
    listeners.install({ waitUntil(promise) { waits.push(promise); } });
    await Promise.all(waits);
  }

  async function navigate(pathname) {
    const waits = [];
    let responsePromise = null;
    listeners.fetch({
      request: { url: ORIGIN + pathname, method: 'GET', mode: 'navigate' },
      respondWith(promise) { responsePromise = promise; },
      waitUntil(promise) { waits.push(promise); }
    });
    const response = await responsePromise;
    await Promise.all(waits);
    return { response, text: await response.text() };
  }

  function examFetches() {
    return fetched.filter(function (url) { return /\/exams\//.test(url); });
  }

  return (async function () {
    console.log('Service Worker cache lười: ' + ORIGIN);

    await settleInstall();
    check('cài đặt KHÔNG tải đề nào', examFetches().length === 0,
      'đã tải: ' + examFetches().join(', '));
    check('cài đặt có tải phần lõi (trang chủ)', fetched.some(function (url) {
      return new URL(url, ORIGIN).pathname === '/';
    }));

    const firstExam = await navigate('/exams/toan/de_toan_01');
    check('mở đề lần đầu trả nội dung đề', firstExam.text.includes('quiz-data'));
    check('chỉ tải đúng đề vừa mở', examFetches().length === 1,
      'đã tải: ' + examFetches().map(function (url) {
        return new URL(url).pathname;
      }).join(', '));

    const secondExam = await navigate('/exams/ly/de_ly_01');
    check('mở đề thứ hai trả nội dung đề', secondExam.text.includes('quiz-data'));
    check('không tải các đề còn lại', examFetches().length === 2,
      'tổng đề đã tải: ' + examFetches().length);

    offline = true;
    const cachedExam = await navigate('/exams/toan/de_toan_01');
    check('ngoại tuyến: đề đã mở vẫn mở được từ cache',
      cachedExam.text.includes('quiz-data'));
    const uncachedExam = await navigate('/exams/hoa/de_hoa_01');
    check('ngoại tuyến: đề chưa mở hiện trang thông báo',
      uncachedExam.text.includes('chưa được lưu để dùng ngoại tuyến'));

    if (failed) {
      console.error('\nKẾT QUẢ: LỖI (' + failed + ' kiểm tra thất bại)');
      process.exitCode = 1;
    } else {
      console.log('\nKẾT QUẢ: OK');
    }
  })();
}

main();
