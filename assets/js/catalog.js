/*
 * DANH MỤC ĐỀ THI CỦA THƯ VIỆN
 * ------------------------------------------------------------------
 * Đây là nơi DUY NHẤT cần sửa khi thêm / bớt / đổi tên một đề.
 * Trang chủ (index.html) và Service Worker (sw.js) đều đọc file này.
 *
 * Quy tắc thêm đề:
 *   1. Đặt file HTML vào exams/<môn>/<tên file>.html
 *   2. Thêm một mục vào đúng môn trong mảng "exams" bên dưới.
 *   3. "id" phải duy nhất và trùng với "id" trong khối quiz-data của file đề.
 *   4. "file" là đường dẫn tính từ thư mục gốc của repository.
 *
 * File này cố tình viết bằng JavaScript (không phải JSON) để trang chủ
 * vẫn chạy được khi mở trực tiếp bằng file:// và Service Worker có thể
 * nạp bằng importScripts().
 */
(function (root) {
  'use strict';

  root.EXAM_LIBRARY = {
    version: 1,
    title: 'Thư viện đề thi THPT',
    subtitle: 'Ôn tập và kiểm tra trực tuyến, dùng được ngoại tuyến trên điện thoại và máy tính.',
    updatedAt: '2026-10-30',

    subjects: [
      {
        id: 'toan',
        name: 'Toán',
        icon: '∑',
        description: 'Đề trắc nghiệm Toán THPT, có chấm điểm và lưu lịch sử làm bài trên thiết bị.',
        exams: [
          {
            id: 'toan_01',
            title: 'Đề Toán THPT số 1',
            file: 'exams/toan/de_toan_01.html',
            description: 'Đề ôn tập 50 câu: hàm số, mũ – lôgarit, tích phân, hình học không gian, xác suất…',
            questions: 50,
            points: 50,
            minutes: 0,
            mode: 'practice',
            tags: ['Hàm số', 'Mũ – Lôgarit', 'Tích phân', 'Hình học', 'Xác suất'],
            addedAt: '2026-10-30'
          }
        ]
      },
      {
        id: 'van',
        name: 'Ngữ văn',
        icon: '✎',
        description: 'Đề đọc hiểu và nghị luận Ngữ văn THPT.',
        exams: []
      },
      {
        id: 'anh',
        name: 'Tiếng Anh',
        icon: 'A',
        description: 'Đề trắc nghiệm Tiếng Anh THPT.',
        exams: []
      }
    ]
  };
})(typeof self !== 'undefined' ? self : this);
