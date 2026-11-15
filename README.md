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
