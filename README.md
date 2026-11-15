# Stress Test — Comment Endpoints

Công cụ stress test cho các endpoint dạng form bình luận (comment, name, website), dùng
automation gửi request đồng thời (concurrent) với payload hoàn toàn giả lập (dummy).

## Chạy thử

```bash
npm install
npm start
```

Mở `http://localhost:3000`.

## Thành phần

- **Mock comment endpoint** (`POST /api/mock/comments`) — một endpoint "comment" mẫu có sẵn
  để stress test ngay mà không cần backend thật. Hỗ trợ query params `minLatency`,
  `maxLatency` (ms) và `failureRate` (0–1) để mô phỏng độ trễ/tỉ lệ lỗi.
- **Trình sinh dữ liệu giả lập** (`src/mockData.js`) — sinh `name`, `website`, `comment` hoàn
  toàn là dummy string (không liên quan dữ liệu thật), mỗi request một giá trị khác nhau.
- **Engine chạy đồng thời** (`src/stressTester.js`) — worker pool tự quản lý concurrency,
  gửi N request tới `targetUrl` bất kỳ (mặc định là mock endpoint ở trên), tính độ trễ,
  p50/p95/p99, RPS, phân bố status theo thời gian thực, phát qua Server-Sent Events.
- **Dashboard** (`public/`) — cấu hình (target URL, tổng số request, concurrency, timeout),
  preset nhanh (Light/Medium/Heavy), biểu đồ latency & phân bố status realtime, bảng log
  request gần nhất, export kết quả JSON/CSV.

## Dùng với endpoint thật

Đổi "Target URL" trong UI sang endpoint comment thật cần kiểm thử (phải nhận JSON
`{ name, website, comment }` qua POST). Lưu ý mạng của sandbox này có thể chặn các host
ngoài danh sách cho phép — endpoint cùng container hoặc đã được whitelist mới gọi được.

## Tab "Comment theo danh sách link"

Dành cho việc **QA/kiểm thử form comment trên nhiều site thật** (của mình hoặc của
khách hàng/đối tác đã đồng ý), khác với tab stress-test ở trên vốn chỉ gửi tải giả
lập vào một mock endpoint:

1. Dán danh sách link (mỗi dòng 1 link) — copy tay từ Google Sheet, vì sandbox này
   không gọi trực tiếp `docs.google.com` được.
2. Nhập 1 bộ `name` / `website` / `comment` dùng chung cho cả danh sách.
3. Bấm **Xem trước & Xác nhận** — hệ thống lọc link hợp lệ/trùng, hiện bản xem trước
   đầy đủ (danh sách link + nội dung sẽ gửi).
4. Phải tick xác nhận có quyền đăng thay + gõ đúng cụm xác nhận (`XAC NHAN GUI`) mới
   bấm được **Xác nhận & Gửi**. Không có bước này, campaign chỉ ở trạng thái
   `pending_confirmation` và không gửi bất cứ request nào.
5. Khi đã xác nhận, request được gửi **tuần tự, có độ trễ bắt buộc** giữa mỗi lần gửi
   (mặc định 2500ms, sàn 1500ms) — không bao giờ gửi đồng thời/hàng loạt, để tránh
   hành vi giống autospam.

Giới hạn: tối đa 100 link/lần chạy, link trùng tự động loại bỏ, link không phải
`http(s)` hợp lệ bị bỏ qua và báo rõ trong bản xem trước.

## Demo site tự quản lí + công cụ autofill form (QA/stress-test)

Để kiểm thử **quy trình bình luận thật** (render trang → điền form → submit → trang
re-render với comment mới) thay vì chỉ gọi JSON API, repo có thêm:

- **Trang blog demo** (`src/demoSite.js`) — `GET /demo/bai-viet-mau`: một bài viết mẫu
  có sẵn danh sách bình luận + biểu mẫu `#commentform` (comment/name/email/website +
  checkbox "lưu thông tin"), submit bằng form POST thường như WordPress, dữ liệu lưu
  trong bộ nhớ (reset qua `POST /demo/bai-viet-mau/comments/reset`).
- **Công cụ autofill** (`qa/autofillComment.mjs`, dùng Playwright) — mở trình duyệt
  thật, điền **đúng 3 ô: comment, name, website** (không đụng tới email, không tick ô
  "lưu thông tin"), rồi chỉ bấm gửi sau khi người chạy xác nhận.

```bash
npm start                      # chạy server ở terminal khác (cổng 3000)
npm run qa:autofill -- --count 5 --delay 1200
```

Các tham số chính: `--url` (mặc định trỏ vào trang demo ở trên), `--count`, `--delay`
(ms, tuần tự — không bao giờ gửi đồng thời), `--headed` (mở cửa sổ trình duyệt để xem),
`--name/--website/--comment` (giá trị cố định thay vì sinh ngẫu nhiên), `--yes` (bỏ qua
bước xác nhận — chỉ nên dùng khi tự động hoá script của chính mình).

An toàn có chủ đích:
- Mặc định **luôn dừng lại chờ gõ `y`** trước khi gửi bất kỳ request thật nào.
- Nếu `--url` không phải `localhost`/`127.0.0.1`, công cụ **từ chối chạy** trừ khi thêm
  `--i-own-this-site` để tự xác nhận đó đúng là site do mình quản lí — công cụ này
  không nhằm (và không nên dùng) để điền form trên site của bên thứ ba.
