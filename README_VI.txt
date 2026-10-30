THƯ VIỆN ĐỀ THI THPT (PWA OFFLINE)

Tài liệu chính đã được chuyển sang README.md trong cùng thư mục.
Hãy đọc README.md để biết cấu trúc thư mục, cách thêm đề mới, cách deploy
lên GitHub Pages hiện tại và cách kiểm tra PWA/ngoại tuyến.

TÓM TẮT NHANH
- Trang chủ: index.html
- Các đề: exams/<môn>/de_<môn>_<số>.html (mỗi đề là một file HTML độc lập)
- Danh mục đề: assets/js/catalog.js (nơi duy nhất cần sửa khi thêm đề)
- Service Worker: sw.js ở thư mục gốc, cache toàn bộ website và các đề trong danh mục
- Kiểm tra trước khi deploy: node tools/check-library.js
- Khi cập nhật nội dung, tăng CACHE_VERSION trong sw.js (v1 -> v2 -> ...)
- Link cũ de_toan_thpt_mau2.html tự chuyển sang exams/toan/de_toan_01.html

LƯU Ý
- Cần mạng ở lần mở đầu tiên để cài Service Worker.
- Không mở bằng file:// nếu muốn thử chế độ ngoại tuyến; dùng GitHub Pages
  hoặc chạy localhost.
- Lịch sử làm bài lưu bằng localStorage trên từng thiết bị/trình duyệt.
  Khóa mới có dạng exam_history_toan_01; dữ liệu cũ từ
  offlineQuiz:86fe1612f631 được tự động chuyển sang và vẫn giữ lại bản cũ.
