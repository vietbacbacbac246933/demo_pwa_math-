HUONG DAN TRIỂN KHAI FILE DE TOAN THPT (PWA OFFLINE)

Trong thư mục này có:
- de_toan_thpt_mau2.html: file bài thi đã bổ sung hỗ trợ PWA/mobile; giữ nguyên dữ liệu đề và logic chấm điểm.
- sw.js: lưu bản HTML và các tài nguyên cần thiết để mở lại khi ngoại tuyến.
- manifest.webmanifest: thông tin ứng dụng web.
- icon-192.png, icon-512.png: biểu tượng cài vào màn hình chính.

CÁCH ĐƯA LÊN GITHUB PAGES (HTTPS MIỄN PHÍ)
1. Đăng nhập GitHub và tạo một repository mới, ví dụ: de-toan-thpt.
2. Tải LÊN CẢ 5 FILE ở trên vào cùng một thư mục gốc của repository. Không chỉ tải riêng file HTML.
3. Vào Settings > Pages.
4. Ở phần Build and deployment, chọn Deploy from a branch; chọn branch main và folder /(root), sau đó Save.
5. Chờ GitHub Pages xuất bản website. Đường link thường có dạng:
   https://TEN-TAI-KHOAN.github.io/de-toan-thpt/de_toan_thpt_mau2.html
   Thay TEN-TAI-KHOAN bằng tên tài khoản GitHub thực tế.
6. Mở đường link HTTPS trên điện thoại khi đang có mạng. Chờ thông báo “Chế độ ngoại tuyến đã sẵn sàng”. Nếu thông báo đang lưu, đợi vài giây rồi tải lại trang.
7. Thử làm bài, chọn đáp án, nộp bài và mở lại để kiểm tra lịch sử.
8. Thử bật chế độ máy bay và mở lại cùng đường link trong cùng trình duyệt. Nếu hoạt động, bản offline đã được lưu.
9. Gửi đường link HTTPS qua Zalo/Messenger. Nếu trình duyệt tích hợp không lưu được, chọn menu chia sẻ/mở ngoài rồi dùng Safari (iPhone) hoặc Chrome (Android).

CÀI BIỂU TƯỢNG MÀN HÌNH CHÍNH (TÙY CHỌN)
iPhone: mở link bằng Safari > Chia sẻ > Thêm vào Màn hình chính.
Android: mở link bằng Chrome > menu ⋮ > Cài đặt/Thêm vào màn hình chính hoặc Cài đặt ứng dụng.

LƯU Ý QUAN TRỌNG
- Cần có mạng trong lần đầu để tải HTML và kích hoạt Service Worker. Việc chỉ tải file HTML về máy rồi mở bằng ứng dụng Files không bật được cơ chế PWA offline.
- Dữ liệu lịch sử làm bài dùng localStorage, nên nằm trên thiết bị/trình duyệt đó. Nó không tự đồng bộ giữa Zalo WebView, Safari, Chrome hoặc các thiết bị khác.
- Khi cập nhật đề hoặc code, tải lại các file lên hosting và tăng phiên bản CACHE_NAME trong sw.js (ví dụ v1 thành v2). Nếu thiết bị vẫn dùng bản cũ, đóng/mở lại trang hoặc xóa dữ liệu website rồi tải lại.
- Nội dung đề/đáp án nằm trong HTML phía máy khách như bản gốc. Đây không phải hệ thống bảo mật đáp án chống người có kiến thức kỹ thuật.
- Khả năng lưu offline phụ thuộc vào trình duyệt và chính sách lưu trữ của WebView; cần thử trên thiết bị thực tế.
