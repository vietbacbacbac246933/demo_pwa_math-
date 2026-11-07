# Thư viện đề thi THPT

Website tĩnh chứa nhiều bài kiểm tra độc lập, phân loại theo môn học, chạy trên **một GitHub Pages duy nhất**. Mỗi đề vẫn là **một file HTML độc lập** như bản gốc; trang chủ chỉ đóng vai trò danh mục.

- Không backend, không database, không đăng nhập.
- Không cần tạo repository mới cho từng đề.
- Lịch sử làm bài lưu bằng `localStorage`, tách riêng theo từng đề.
- Trang chủ và các đề đã tải có thể dùng ngoại tuyến (PWA).

---

## 1. Cấu trúc thư mục

```text
repository/
├── index.html                     # Trang chủ thư viện
├── manifest.webmanifest           # Manifest dùng chung cho cả thư viện
├── sw.js                          # Service Worker đặt ở GỐC (scope toàn site)
├── README.md
│
├── exams/
│   ├── toan/
│   │   └── de_toan_01.html        # Đề gốc, giữ nguyên câu hỏi/đáp án/cách chấm
│   └── sinh/
│       └── bai_4.html             # Bài 4 – Đột biến gene
│   # exams/van/, exams/anh/       # Tạo khi có đề tương ứng
│
├── assets/
│   ├── css/
│   │   └── library.css            # CSS riêng của trang chủ
│   ├── js/
│   │   ├── catalog.js             # DANH MỤC ĐỀ — nơi duy nhất cần sửa khi thêm đề
│   │   └── library.js             # Tìm kiếm, lọc, hiển thị, đăng ký PWA
│   ├── icons/
│   │   ├── icon-192.png
│   │   └── icon-512.png
│
└── tools/
    ├── check-library.js           # Kiểm tra danh mục trước khi deploy
    └── import-exam.js             # Tự động nhập đề mới (START.bat gọi file này)
|
|___START.bat #Chạy tự động: nhập đề, kiểm tra, commit, push 
```

### Vai trò các file

| File | Vai trò |
|---|---|
| `index.html` | Trang chủ: thống kê, tìm kiếm, lọc môn, danh sách đề. Không chứa dữ liệu câu hỏi. |
| `assets/js/catalog.js` | Danh mục môn học + đề thi. Trang chủ và Service Worker cùng đọc file này. |
| `assets/js/library.js` | Hiển thị danh mục, tìm kiếm không dấu, lọc môn, thông báo cập nhật PWA. |
| `assets/css/library.css` | Giao diện trang chủ. Các file đề giữ CSS riêng, không bị ảnh hưởng. |
| `exams/<môn>/<đề>.html` | Một đề hoàn chỉnh, độc lập: giao diện, dữ liệu, chấm điểm, lịch sử. |
| `manifest.webmanifest` | Thông tin cài đặt PWA. `start_url` là trang chủ, `scope` là toàn repository. |
| `sw.js` | Cache trang chủ, tài nguyên và **tất cả file đề trong catalog**; cập nhật theo phiên bản cache. |
| `tools/check-library.js` | Kiểm tra file tồn tại, id trùng, số câu/điểm lệch, đường dẫn sai, và **đề có file nhưng quên khai báo trong catalog**. |
| `tools/import-exam.js` | Chuẩn hóa đề mới, chép vào `exams/`, cập nhật catalog và `sw.js`; tự hoàn tác nếu kiểm tra lỗi. |
| `START.bat` | Chạy importer → kiểm tra → commit → push `main`. |

> **Nguyên tắc:** Service Worker nằm ở thư mục gốc nên có scope `/` (hoặc `/<tên-repo>/` trên GitHub Pages), kiểm soát được cả `exams/toan/...`. Không đặt Service Worker trong thư mục con.
---
## 4. PWA và ngoại tuyến

- `manifest.webmanifest` đặt `start_url: "./index.html"`, `scope: "./"`, icon trong `assets/icons/`.
- `sw.js` nằm ở gốc, đăng ký từ trang chủ và từ đề với `{ scope: '../../' }`.
- Khi cài đặt, Service Worker cache:
  - trang chủ, CSS, JS, manifest, icon;
  - **mọi file đề có trong `catalog.js`** (nhờ `importScripts` đọc catalog);
  - trang chuyển hướng link cũ.
- Trang đã mở được cache thêm khi điều hướng; tài nguyên mới được cache khi dùng lần đầu.
- Điều hướng dùng *network-first*: có mạng lấy bản mới, mất mạng hoặc lỗi 5xx dùng cache.
- `catalog.js` dùng *network-first* để đề mới xuất hiện ngay khi online.
- Khi tăng `CACHE_VERSION`, Service Worker mới xóa cache phiên bản cũ và cả cache cũ `de-toan-thpt-pwa-*`.

**Giới hạn thực tế:**
- Cần mạng ở lần mở đầu tiên để cài Service Worker.
- Mở trực tiếp bằng `file://` không bật được chế độ ngoại tuyến; phải dùng HTTPS/GitHub Pages hoặc localhost.
- Lịch sử nằm trên từng trình duyệt/thiết bị, không đồng bộ.
- Đáp án nằm trong HTML phía máy khách, không phải cơ chế bảo mật chống người rành kỹ thuật.

---

### An toàn dữ liệu

- Nếu `check-library.js` báo lỗi, importer khôi phục `catalog.js`, `sw.js`, `library.js`, xóa file đề vừa tạo và trả nguồn về chỗ cũ.
- Nếu đang có thay đổi chưa commit của **file đã theo dõi**, `START.bat` cảnh báo và hỏi trước khi `git add -A`.
- Nếu đang ở nhánh khác `main`, script dừng, không commit.
- Push thất bại (ví dụ máy đang lùi so với GitHub), commit vẫn còn trên máy; chạy `git pull --rebase origin main` rồi `git push origin main`.

### Quy ước dữ liệu (giữ nguyên)

1. **Đầu ra HTML** phải giữ khối `<script id="quiz-data" type="application/json">`.
2. **Mã đề** lấy từ tên file: `de_toan_02.html` → `toan_02`; ghi vào `"id"` trong quiz-data.
3. **Vị trí file**: `exams/<môn>/de_<môn>_<số>.html`.
4. **Danh mục**: thêm object vào `assets/js/catalog.js`.
5. **Kiểm tra**: gọi `node tools/check-library.js`; dừng nếu exit code khác 0.
6. **Cache**: tăng `CACHE_VERSION` trong `sw.js`.
7. **Deploy**: commit + push nhánh `main`; GitHub Pages tự xuất bản.

---

## 8. Câu hỏi thường gặp

**Thêm đề mà trang chủ không đổi?**
Kiểm tra `assets/js/catalog.js` đã lưu đúng chưa, đúng môn chưa, và đã tải lại trang chưa. Chạy `node tools/check-library.js`: nếu báo *“Đề có file nhưng chưa có trong catalog”* thì file đề đã có trên đĩa nhưng chưa được khai báo nên trang chủ không hiển thị. Thêm mục vào `catalog.js` rồi chạy lại. Nếu đang offline, cần tăng `CACHE_VERSION` rồi mở online một lần.

**Đề mới mở được nhưng không dùng offline?**
Tăng `CACHE_VERSION` trong `sw.js` để Service Worker cài lại và cache đề. Sau đó mở trang chủ online một lần.

**Lịch sử của đề cũ biến mất?**
Kiểm tra Console và `localStorage`:
- Khóa cũ: `offlineQuiz:86fe1612f631` (vẫn được giữ).
- Khóa mới: `exam_history_toan_01`.

Nếu đã xóa dữ liệu trình duyệt hoặc đổi thiết bị thì không khôi phục được (không có đồng bộ đám mây).

**Có cần sửa các đề cũ khi thêm đề mới?**
Không. Chỉ sửa `catalog.js` và tăng `CACHE_VERSION`.

**Có thể dùng ảnh trong đề không?**
Có. Đặt ảnh trong `assets/images/` và tham chiếu từ đề bằng đường dẫn tương đối `../../assets/images/ten-anh.png`. Ảnh sẽ được cache khi mở đề lần đầu; nếu muốn cache sẵn, thêm đường dẫn vào `CORE_PATHS` trong `sw.js`.
