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
    updatedAt: '2026-11-07',

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
          },
          {
            id: 'toan_02',
            title: 'Đề Toán THPT',
            file: 'exams/toan/de_toan_02.html',
            description: 'Đề trắc nghiệm Toán: 22 câu, 10 điểm.',
            questions: 22,
            points: 10,
            minutes: 0,
            mode: 'practice',
            tags: [],
            addedAt: '2026-11-07'
          }
        ]
      },
      {
        id: 'sinh',
        name: 'Sinh học',
        icon: '🧬',
        description: 'Đề trắc nghiệm Sinh học THPT, chấm điểm và lưu lịch sử ngay trên thiết bị.',
        exams: [
          {
            id: '71efc4fda2de',
            title: 'Bài 4',
            file: 'exams/sinh/bai_4.html',
            description: 'Đột biến gene: đột biến điểm, thể đột biến và mức độ gây hại của allele đột biến.',
            questions: 18,
            points: 10,
            minutes: 0,
            mode: 'practice',
            tags: ['Đột biến gene', 'Đột biến điểm', 'Thể đột biến'],
            addedAt: '2026-11-06'
          },
          {
            id: 'sinh_02',
            title: 'Bài 2',
            file: 'exams/sinh/de_sinh_02.html',
            description: 'Đề trắc nghiệm Sinh học: 23 câu, 23 điểm.',
            questions: 23,
            points: 23,
            minutes: 0,
            mode: 'practice',
            tags: [],
            addedAt: '2026-11-06'
          },
          {
            id: 'sinh_01',
            title: 'Bài 1',
            file: 'exams/sinh/de_sinh_01.html',
            description: 'Đề trắc nghiệm Sinh học: 14 câu, 10 điểm.',
            questions: 14,
            points: 10,
            minutes: 0,
            mode: 'practice',
            tags: [],
            addedAt: '2026-11-06'
          },
          {
            id: 'sinh_05',
            title: 'Bài 5',
            file: 'exams/sinh/de_sinh_05.html',
            description: 'Đề trắc nghiệm Sinh học: 16 câu, 16 điểm.',
            questions: 16,
            points: 16,
            minutes: 0,
            mode: 'practice',
            tags: [],
            addedAt: '2026-11-06'
          },
          {
            id: 'sinh_03',
            title: 'Bài 3',
            file: 'exams/sinh/de_sinh_03.html',
            description: 'Đề trắc nghiệm Sinh học: 16 câu, 10 điểm.',
            questions: 16,
            points: 10,
            minutes: 0,
            mode: 'practice',
            tags: [],
            addedAt: '2026-11-06'
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
      },
      {
        id: 'ly',
        name: 'Vật lí',
        icon: '⚛',
        description: 'Đề trắc nghiệm Vật lí THPT, chấm điểm và lưu lịch sử ngay trên thiết bị.',
        exams: [
          {
            id: 'ly_01',
            title: 'Đề Thi THPT Lý 2026',
            file: 'exams/ly/de_ly_01.html',
            description: 'Đề trắc nghiệm Vật lí: 28 câu, 10 điểm.',
            questions: 28,
            points: 10,
            minutes: 0,
            mode: 'practice',
            tags: [],
            addedAt: '2026-11-07'
          }
        ]
      },
      {
        id: 'hoa',
        name: 'Hóa học',
        icon: '⚗',
        description: 'Đề trắc nghiệm Hóa học THPT, chấm điểm và lưu lịch sử ngay trên thiết bị.',
        exams: [
          {
            id: 'hoa_01',
            title: 'Đề Thi THPT Hóa 2026',
            file: 'exams/hoa/de_hoa_01.html',
            description: 'Đề trắc nghiệm Hóa học: 28 câu, 10 điểm.',
            questions: 28,
            points: 10,
            minutes: 0,
            mode: 'practice',
            tags: [],
            addedAt: '2026-11-07'
          }
        ]
      },
      {
        id: 'su',
        name: 'Lịch sử',
        icon: '🏛',
        description: 'Đề trắc nghiệm Lịch sử THPT, chấm điểm và lưu lịch sử ngay trên thiết bị.',
        exams: []
      }
    ]
  };
})(typeof self !== 'undefined' ? self : this);
