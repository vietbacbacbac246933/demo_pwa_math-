# `_system/` — khu vực hệ thống

Thư mục này gom các **công cụ, tài liệu và migration** của dự án để giáo viên
không sửa nhầm khi thao tác hằng ngày. Bạn **không cần mở** thư mục này để thêm,
đổi tên hay xóa đề — hãy mở `Start\START.bat` ở thư mục gốc.

## Cấu trúc thư mục dự án

```text
de_toan_thpt_pwa_scrollfix/     # khi mở chỉ thấy 2 mục
├── Start/                      # Giáo viên mở thư mục này để chạy
│   ├── START.bat
│   ├── START-CLOUDFLARE.bat
│   └── START-GITHUB.bat
└── _system/                    # Thư mục này
```

Các file web (`index.html`, `teacher.html`, `assets/`, `exams/`, `functions/`,
`sw.js`, `wrangler.jsonc`, ...) **vẫn nằm ở gốc** nhưng được đặt thuộc tính
**Hidden** của Windows để thư mục gọn. Chúng không bị xóa và không thể di chuyển
(xem mục Quy tắc). Muốn xem lại:

```powershell
# Hiện các file web ở gốc
powershell -ExecutionPolicy Bypass -File _system/tools/hide-runtime.ps1 -Show

# Ẩn lại
powershell -ExecutionPolicy Bypass -File _system/tools/hide-runtime.ps1
```

`Start\START.bat` tự gọi script này mỗi lần chạy nên thuộc tính Hidden luôn được
đặt lại (kể cả sau khi copy/sync thư mục).

## Cấu trúc `_system/`

```text
_system/
├── tools/         # Script Node.js / PowerShell của hệ thống
├── ui/            # Giao diện Local Helper (add-exam.html)
├── docs/          # Tài liệu triển khai, sao lưu, hướng dẫn
└── migrations/    # Migration D1 (wrangler.jsonc trỏ tới thư mục này)
```

## Quy tắc

1. **Không sửa tay** file trong `_system/tools/` nếu không hiểu rõ pipeline.
   Mọi thay đổi nên đi qua giao diện Local Helper.
2. Không di chuyển `index.html`, `assets/`, `exams/`, `functions/`, `sw.js`
   hoặc `wrangler.jsonc` ra khỏi thư mục gốc:
   - GitHub Pages phục vụ website từ **gốc repository**.
   - Cloudflare Pages đọc `functions/` và `wrangler.jsonc` tại **gốc project**.
   - Di chuyển các file này sẽ làm hỏng deploy và PWA đã cài trên máy học sinh.
3. `migrations/` đã được khai báo trong `wrangler.jsonc`:

   ```jsonc
   "d1_databases": [
     {
       "binding": "DB",
       "migrations_dir": "_system/migrations"
     }
   ]
   ```

   Vì vậy `wrangler d1 migrations apply ...` vẫn tìm đúng thư mục.

## Lưu ý khi deploy

- **Cloudflare (khuyến nghị):** `_system/tools/deploy-pages.ps1` chỉ copy các
  file công khai (`index.html`, `teacher.html`, `assets/`, `exams/`, `sw.js`,
  `manifest.webmanifest`, `_headers`, `_routes.json`). `_system/` không bao giờ
  được đưa lên web.
- **GitHub Pages:** site phục vụ từ gốc repository và repo có `.nojekyll`, nên
  nếu đẩy cả repo lên GitHub Pages thì `_system/` cũng truy cập được (chỉ là
  script/tài liệu, không chứa mật khẩu — `.dev.vars` đã nằm trong `.gitignore`).
  Muốn che hoàn toàn, hãy deploy bằng Cloudflare hoặc để repo ở chế độ private.

## Lệnh thường dùng

```powershell
# Kiểm tra toàn bộ thư viện và môi trường
node _system/tools/check-environment.js
node _system/tools/check-library.js

# Kiểm tra migration (không cần Cloudflare)
node _system/tools/check-migrations.js

# Cập nhật đề + kiểm tra + deploy (dự phòng khi không dùng giao diện)
powershell -ExecutionPolicy Bypass -File _system/tools/update-and-deploy.ps1
```

## Sao lưu khi xóa đề

Khi xóa một đề từ giao diện, file đề **không bị xóa hẳn** mà được chuyển vào:

```text
backups/exam-deletes/<mốc-thời-gian>/
```

Thư mục `backups/` nằm ngoài `_system/`, không được deploy lên web và đã nằm
trong `.gitignore`.

## Liên quan

- Hướng dẫn giáo viên: [`docs/QUAN-LY-DE.md`](docs/QUAN-LY-DE.md)
- Triển khai Cloudflare: [`docs/DEPLOY.md`](docs/DEPLOY.md)
- Sao lưu / khôi phục: [`docs/BACKUP.md`](docs/BACKUP.md)
