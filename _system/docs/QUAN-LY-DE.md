# Quản lý đề bằng Local Helper

Tài liệu dành cho giáo viên: mở giao diện, thêm đề, cập nhật, đổi tên hoặc xóa đề cũ và xử lý sự cố.

## 1. Mở giao diện

1. Nhấp đúp `START.bat` trong thư mục dự án.
2. Cửa sổ kiểm tra môi trường chạy vài giây, sau đó trình duyệt tự mở
   `http://127.0.0.1:47821/add-exam.html`.
3. Nếu trình duyệt không tự mở, nhấp đúp `START.bat` lần nữa. Trợ lý đã chạy
   sẵn sẽ được mở lại, không tạo thêm tiến trình.

Trợ lý chỉ lắng nghe trên `127.0.0.1` (máy của bạn). Không có đề nào được gửi
lên Internet cho đến khi bạn bấm **Đăng lên thư viện**.

## 2. Thêm đề

1. Kéo thả file `.html`, cả thư mục export hoặc file `.zip` vào khung **Chọn đề**.
2. Kiểm tra danh sách:
   - **Thêm mới**: đề sẽ nhận mã mới dạng `<môn>_<số>`.
   - **Cập nhật**: chỉ xuất hiện khi bạn chủ động chọn cho đề trùng mã.
   - **Bỏ qua**: nội dung giống hệt bản đang có.
   - **Cần sửa**: file thiếu `quiz-data`, JSON lỗi, sai môn… Hãy xóa file đỏ.
3. Nếu chưa nhận ra môn, chọn môn trong ô thả xuống của từng đề.
4. Bấm **Đăng lên thư viện**, kiểm tra hộp xác nhận rồi chờ đến khi báo hoàn tất.

Giới hạn mỗi lần: 20 file, mỗi file tối đa 12 MB; ZIP được giải nén an toàn và
chỉ nhận file `.html`/`.htm`.

## 3. Đề trùng mã

Mặc định hệ thống **không ghi đè** đề cũ. Đề trùng mã được thêm thành đề mới
với mã riêng.

Muốn thay nội dung bản cũ:

1. Bấm **Cập nhật** trên dòng đề trùng.
2. Đọc cảnh báo và xác nhận.
3. Bản cũ được sao lưu vào `backups/exam-updates/<thời gian>/` trước khi ghi.

Nếu nội dung không đổi, hệ thống tự chuyển thành **Bỏ qua** và không cho deploy.

## 3.1. Đổi tên hoặc xóa đề đã có

Áp dụng cho **mọi đề đang có trong thư viện**, kể cả đề đã đăng lên Cloudflare
từ trước — vì nguồn duy nhất của thư viện là `assets/js/catalog.js` và thư mục
`exams/` trên máy bạn.

1. Ở thẻ **Thư viện hiện tại**, bấm vào **chip môn** (ví dụ `🏛 Lịch sử 2`).
   Danh sách đề của môn đó hiện ra trong thẻ **Quản lý đề đã có**.
2. Bấm **✏️** để đổi tên hoặc **🗑** để xóa:
   - **Đổi tên**: nhập tiêu đề mới → xác nhận. Tiêu đề trong file đề và
     `catalog.js` được cập nhật; mã đề và file giữ nguyên để không làm mất lịch
     sử làm bài của học sinh.
   - **Xóa**: xác nhận. File đề được chuyển vào
     `backups/exam-deletes/<thời-gian>/` trước khi gỡ khỏi catalog.
3. Chờ tiến trình chạy xong. Trợ lý tự kiểm tra toàn thư viện, cập nhật đáp án
   phía server, tăng `CACHE_VERSION` và **deploy lên Cloudflare**.
4. Bảng kết quả báo **“Đã đổi tên đề thành công”** hoặc **“Đã xóa đề thành
   công”** là thay đổi đã lên web.

Nếu deploy lỗi, dữ liệu trên máy được khôi phục tự động; bấm **Thử lại** sau khi
xử lý nguyên nhân (mạng, đăng nhập Cloudflare...). Các nút ✏️/🗑 tự khóa khi
đang có tiến trình chạy.

## 4. An toàn dữ liệu

Trước mỗi lần đăng, trợ lý sao lưu:

- `assets/js/catalog.js`
- `assets/js/library.js`
- `assets/js/exam-revs.js`
- `sw.js`
- `functions/_lib/exam-data.js`
- toàn bộ thư mục `exams/` (kể cả đề chưa khai báo trong catalog)

Nếu pipeline kiểm tra/deploy lỗi hoặc bạn dừng trước khi tải lên, các file trên
được khôi phục về trạng thái trước khi đăng. Snapshot và log nằm trong
`%LOCALAPPDATA%\ExamLibraryHelper\`, không nằm trong repo.

## 5. Theo dõi và thử lại

- Thanh tiến trình hiển thị từng bước: nhập đề, patch, đáp án, cache, kiểm tra,
  deploy.
- Nhật ký chi tiết có nút **Sao chép log** để gửi khi cần hỗ trợ.
- Nếu lỗi, bấm **Thử lại**; danh sách đề vẫn được giữ và dữ liệu cũ đã được
  khôi phục.
- Không thể chạy hai lần đăng cùng lúc. Nút deploy bị khóa khi đang chạy.
- Nút **Dừng tiến trình** chỉ hoạt động trước khi bắt đầu tải lên Cloudflare.

Đóng trình duyệt không dừng tiến trình. Mở lại giao diện để xem tiếp; nếu trợ
lý đã tắt, chạy lại `START.bat`.

## 6. Xử lý sự cố

| Hiện tượng | Cách xử lý |
| --- | --- |
| “Không kết nối được Local Helper” | Chạy `START.bat`. Kiểm tra cổng `47821` có bị ứng dụng khác dùng. |
| “Phiên đã hết hạn” | Đóng tab, chạy lại `START.bat` để nhận token mới. |
| “Chưa đăng nhập Cloudflare” | Chạy `npx wrangler login` một lần, rồi bấm **Kiểm tra lại**. |
| Deploy lỗi ở bước kiểm tra | Đọc log, sửa đề lỗi, bấm **Thử lại**. Dữ liệu cũ đã được khôi phục. |
| Trợ lý tự tắt | Trợ lý tắt sau 60 phút không hoạt động. Chạy lại `START.bat`. |
| Cần deploy bằng terminal | Dùng `START-CLOUDFLARE.bat` (dự phòng, giữ nguyên quy trình cũ). |
| Cần quy trình GitHub Pages cũ | Dùng `START-GITHUB.bat` hoặc `START.bat --github`. |

## 7. Kiểm thử

Kiểm thử tích hợp chạy trên **bản sao dự án**, không deploy thật:

```powershell
# 1. Tạo bản sao và khởi chạy helper ở chế độ thử
$env:EXAM_HELPER_ROOT = "$env:TEMP\opencode\exam-helper-test"
$env:EXAM_HELPER_SESSION_DIR = "$env:TEMP\opencode\exam-helper-session"
$env:EXAM_HELPER_PORT = "47831"
$env:EXAM_HELPER_NO_OPEN = "1"
$env:EXAM_HELPER_NO_DEPLOY = "1"
node _system/tools/local-helper.js --no-open

# 2. Cửa sổ khác
$env:EXAM_HELPER_SESSION_DIR = "$env:TEMP\opencode\exam-helper-session"
node _system/tools/test-helper.js
```

`_system/tools/test-helper.js` kiểm tra: khởi động, token/Host/Origin, path traversal,
giới hạn body, thêm đề, trùng mã, cập nhật có sao lưu, bỏ qua nội dung không đổi,
rollback khi pipeline lỗi, chặn deploy song song, log không lộ token và khởi
động trùng.

## 8. Kiến trúc ngắn gọn

```text
START.bat
  └─ node _system/tools/local-helper.js        (HTTP 127.0.0.1, token mỗi phiên)
       ├─ _system/ui/add-exam.html     (giao diện tự chứa)
       ├─ POST /api/files              (đọc HTML/ZIP vào thư mục tạm)
       ├─ POST /api/plan               (kiểm tra + mã đề + trùng lặp)
       ├─ POST /api/deploy             (tạo job, không chạy song song)
       └─ _system/tools/helper/runner.js
            ├─ snapshot catalog/exams
            ├─ _system/tools/import-exam.js    (--update-existing khi cần)
            ├─ _system/tools/update-and-deploy.ps1 -SkipImport -Yes
            └─ _system/tools/deploy-pages.ps1  (Wrangler có sẵn, không npx tải mới)
```

Không thay đổi schema D1, API nộp bài, chấm điểm hay cấu hình Cloudflare Pages.
