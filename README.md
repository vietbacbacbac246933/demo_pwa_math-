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
├── de_toan_thpt_mau2.html         # Trang chuyển hướng cho link cũ (giữ tương thích)
├── README.md
├── README_VI.txt                  # Ghi chú phiên bản cũ
│
├── exams/
│   └── toan/
│       └── de_toan_01.html        # Đề gốc, giữ nguyên câu hỏi/đáp án/cách chấm
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
│   └── images/                    # Tạo thư mục này khi cần ảnh dùng chung
│
└── tools/
    └── check-library.js           # Kiểm tra danh mục trước khi deploy
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
| `tools/check-library.js` | Kiểm tra file tồn tại, id trùng, số câu/điểm lệch, đường dẫn sai. |

> **Nguyên tắc:** Service Worker nằm ở thư mục gốc nên có scope `/` (hoặc `/<tên-repo>/` trên GitHub Pages), kiểm soát được cả `exams/toan/...`. Không đặt Service Worker trong thư mục con.

---

## 2. Thay đổi so với bản một đề

Bản gốc `de_toan_thpt_mau2.html` đã được chuyển thành `exams/toan/de_toan_01.html`.

**Giữ nguyên 100%:**
- 50 câu hỏi, đáp án, điểm từng câu, cấu hình xáo trộn, chế độ ôn tập.
- Toàn bộ công thức MathML, giao diện làm bài, chấm điểm, xem lại bài, lịch sử.
- CSS và JavaScript làm bài (chỉ thêm nút quay về thư viện).

**Chỉ sửa các cấu hình cần thiết:**
| Nội dung | Trước | Sau |
|---|---|---|
| Manifest | `./manifest.webmanifest` | `../../manifest.webmanifest` |
| Icon | `./icon-192.png` | `../../assets/icons/icon-192.png` |
| Service Worker | `./sw.js` | `../../sw.js`, scope `../../` |
| Mã đề | `86fe1612f631` | `toan_01` (giữ `legacyIds: ["86fe1612f631"]`) |
| Khóa lịch sử | `offlineQuiz:86fe1612f631` | `exam_history_toan_01` |

**Chuyển lịch sử cũ:** khi mở đề lần đầu, nếu chưa có khóa mới, hệ thống tự đọc khóa cũ `offlineQuiz:86fe1612f631`, ghi sang `exam_history_toan_01` và **giữ nguyên khóa cũ** để không mất dữ liệu. Người dùng không phải làm gì.

> Link cũ `.../de_toan_thpt_mau2.html` vẫn hoạt động: file gốc ở thư mục gốc nay là trang chuyển hướng sang đề mới.

---

## 3. Thêm một đề mới

### Bước 1 — Đặt file đúng chỗ

Đặt file vào `exams/<môn>/`, ví dụ:

```text
exams/toan/de_toan_02.html
exams/van/de_van_01.html
exams/anh/de_anh_01.html
```

Quy ước tên: `de_<môn>_<số hai chữ số>.html`. Không dùng dấu cách, dấu tiếng Việt.

### Bước 2 — Đặt mã đề duy nhất trong file HTML

Mở file đề, tìm khối:

```html
<script id="quiz-data" type="application/json">{"v":1,"title":"...","settings":{...},"questions":[...],"id":"toan_01"}</script>
```

Đổi `"id"` thành mã mới, ví dụ `"toan_02"`. Mã này quyết định khóa lịch sử `exam_history_toan_02`, nên **mỗi đề phải có id khác nhau**. Nên đặt `"title"` trùng với tên hiển thị trong danh mục.

Nếu đề mới được tạo bằng cách sao chép một đề cũ, hãy xóa `legacyIds` (trừ khi bạn thực sự muốn chuyển lịch sử từ đề cũ sang).

### Bước 3 — Thêm vào danh mục

Mở `assets/js/catalog.js`, thêm một mục vào đúng môn:

```js
{
  id: 'toan_02',                                  // trùng "id" trong file đề
  title: 'Đề Toán THPT số 2',
  file: 'exams/toan/de_toan_02.html',             // tính từ thư mục gốc
  description: 'Mô tả ngắn hiển thị trên thẻ đề.',
  questions: 40,
  points: 40,
  minutes: 50,                                    // 0 = không giới hạn
  mode: 'exam',                                   // 'practice' hoặc 'exam'
  tags: ['Hàm số', 'Xác suất'],
  addedAt: '2026-11-01'
}
```

`questions`, `points`, `minutes`, `mode` chỉ để hiển thị và kiểm tra; **cách chấm điểm thật vẫn nằm trong file đề**. Nếu không chắc, cứ điền đúng số liệu trong file.

Môn mới: thêm một object vào `subjects`:

```js
{
  id: 'ly',
  name: 'Vật lí',
  icon: '⚛',
  description: 'Đề trắc nghiệm Vật lí THPT.',
  exams: []
}
```

### Bước 4 — Kiểm tra

```bash
node tools/check-library.js
```

Lệnh này báo lỗi nếu thiếu file, trùng id, sai số câu/điểm hoặc sai đường dẫn tương đối.

### Bước 5 — Tăng phiên bản cache và deploy

Mở `sw.js`, tăng:

```js
var CACHE_VERSION = 'v1';   // đổi thành 'v2', 'v3'...
```

Sau đó commit/push lên GitHub. Người dùng đang mở trang sẽ thấy nút **Cập nhật**; bấm vào để nhận bản mới. Nếu không tăng `CACHE_VERSION`, đề mới vẫn mở được khi online nhưng có thể chưa được tải sẵn để dùng ngoại tuyến.

> Chỉ cần sửa `catalog.js` — **không phải sửa trang chủ hay các đề cũ**.

---

## 4. Deploy lên GitHub Pages hiện tại

Repository hiện tại: `https://github.com/vietbacbacbac246933/demo_pwa_math-`

1. Sao lưu repository (hoặc tạo nhánh `backup`) trước khi thay thế.
2. Tải **toàn bộ** nội dung thư mục này lên repository, giữ nguyên cấu trúc thư mục:
   - `index.html`, `sw.js`, `manifest.webmanifest`, `README.md`
   - thư mục `exams/`, `assets/`, `tools/`
   - file `de_toan_thpt_mau2.html` (trang chuyển hướng)
3. Ghi đè các file cùng tên. File đề cũ ở thư mục gốc sẽ được thay bằng trang chuyển hướng; nội dung đề thật nằm trong `exams/toan/de_toan_01.html`.
4. Vào **Settings → Pages**, giữ nguyên cấu hình cũ: *Deploy from a branch* → nhánh `main` → thư mục `/(root)`.
5. Chờ GitHub Pages deploy xong, mở:
   `https://vietbacbacbac246933.github.io/demo_pwa_math-/`
6. Mở trang chủ một lần khi còn mạng, chờ dòng “Chế độ ngoại tuyến đã sẵn sàng”, sau đó thử tắt mạng và mở lại.
7. Trên điện thoại đã cài PWA cũ: đóng app, mở lại bằng trình duyệt khi có mạng để nhận Service Worker mới; nếu vẫn thấy bản cũ, xóa dữ liệu website rồi tải lại.

**Lưu ý:** không cần bật Jekyll hay workflow riêng. Website là HTML/CSS/JS thuần.

---

## 5. PWA và ngoại tuyến

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

## 6. Kiểm thử cục bộ

Service Worker chỉ chạy trên `https://` hoặc `localhost`. Chạy một web server tĩnh tại thư mục gốc:

```bash
# Python
python -m http.server 8000

# hoặc Node
npx serve .
```

Mở `http://localhost:8000/`. Không mở bằng cách nháy đúp file `index.html` nếu muốn thử offline.

Kiểm tra tự động danh mục:

```bash
node tools/check-library.js
```

Checklist trước khi deploy:
- [ ] Trang chủ hiển thị đúng môn và số đề.
- [ ] Tìm kiếm không dấu hoạt động (`toan` tìm được “Đề Toán”).
- [ ] Bấm thẻ đề mở đúng file trong `exams/`.
- [ ] Làm bài, nộp bài, xem lại đáp án và lịch sử.
- [ ] `localStorage` có khóa `exam_history_<mã đề>` riêng cho từng đề.
- [ ] Không có lỗi đỏ trong Console.
- [ ] Tắt mạng, mở lại trang chủ và đề đã tải.
- [ ] Đã tăng `CACHE_VERSION` nếu thay đổi nội dung.

---

## 7. Quy ước dữ liệu để tích hợp `START.bat` sau này

Quy trình Word → HTML → deploy có thể tự động hóa theo các điểm sau:

1. **Đầu ra HTML** phải giữ khối `<script id="quiz-data" type="application/json">`.
2. **Mã đề** lấy từ tên file: `de_toan_02.html` → `toan_02`; ghi vào `"id"` trong quiz-data.
3. **Vị trí file**: `exams/<môn>/de_<môn>_<số>.html`.
4. **Danh mục**: thêm object vào `assets/js/catalog.js` (đúng schema ở mục 3).
5. **Kiểm tra**: gọi `node tools/check-library.js`; dừng nếu exit code khác 0.
6. **Cache**: tăng `CACHE_VERSION` trong `sw.js` bằng tìm–thay hoặc script.
7. **Deploy**: commit + push nhánh `main`; GitHub Pages tự xuất bản.

Nên đặt `tools/check-library.js` vào `START.bat` ở bước cuối trước khi push để tránh deploy đề thiếu file hoặc trùng id.

---

## 8. Câu hỏi thường gặp

**Thêm đề mà trang chủ không đổi?**
Kiểm tra `assets/js/catalog.js` đã lưu đúng chưa, đúng môn chưa, và đã tải lại trang chưa. Nếu đang offline, cần tăng `CACHE_VERSION` rồi mở online một lần.

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
