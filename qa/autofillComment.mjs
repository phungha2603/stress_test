#!/usr/bin/env node
// Semi-automated form-autofill QA tool for the demo comment page
// (src/demoSite.js). It drives a real browser against the ACTUAL rendered
// <form id="commentform">, filling only comment/name/website — it never
// touches the email field or the "save my info" checkbox, per spec — and
// only ever submits after one explicit, informed go-ahead from whoever runs
// it. Nothing here hits a third-party site: non-loopback targets are refused
// unless the operator explicitly asserts ownership with --i-own-this-site.

import { chromium } from "playwright";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { generateMockPayload } from "../src/mockData.js";

function parseArgs(argv) {
  const args = {
    url: "http://localhost:3000/demo/bai-viet-mau",
    count: 5,
    delayMs: 1200,
    timeoutMs: 15000,
    headed: false,
    yes: false,
    iOwnThisSite: false,
    name: null,
    website: null,
    comment: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--url": args.url = next(); break;
      case "--count": args.count = Number.parseInt(next(), 10); break;
      case "--delay": args.delayMs = Number.parseInt(next(), 10); break;
      case "--timeout": args.timeoutMs = Number.parseInt(next(), 10); break;
      case "--headed": args.headed = true; break;
      case "--yes": args.yes = true; break;
      case "--i-own-this-site": args.iOwnThisSite = true; break;
      case "--name": args.name = next(); break;
      case "--website": args.website = next(); break;
      case "--comment": args.comment = next(); break;
      case "--help":
        printHelp();
        process.exit(0);
      default:
        console.error(`Tham số không hợp lệ: ${a}`);
        printHelp();
        process.exit(1);
    }
  }
  return args;
}

function printHelp() {
  console.log(`
Công cụ autofill biểu mẫu bình luận cho QA/stress-test (chỉ dùng cho trang do bạn tự quản lí).

Usage:
  node qa/autofillComment.mjs [options]

Options:
  --url <url>          Trang bài viết cần test (mặc định: http://localhost:3000/demo/bai-viet-mau)
  --count <n>          Số lượt gửi bình luận (mặc định: 5)
  --delay <ms>         Khoảng nghỉ giữa các lượt gửi, tuần tự (mặc định: 1200)
  --timeout <ms>       Timeout cho mỗi lần mở trang / điền form (mặc định: 15000)
  --headed             Mở cửa sổ trình duyệt để quan sát (mặc định: headless)
  --name <text>        Giá trị cố định cho ô Name (mặc định: sinh ngẫu nhiên mỗi lượt)
  --website <url>      Giá trị cố định cho ô Website
  --comment <text>     Giá trị cố định cho ô Comment
  --yes                Bỏ qua bước xác nhận tương tác (chỉ dùng khi tự chạy script, vd. CI của chính bạn)
  --i-own-this-site    Bắt buộc nếu --url không phải localhost/127.0.0.1 — xác nhận đây là site bạn tự quản lí
  --help               Hiện hướng dẫn này
`);
}

function isLoopback(urlString) {
  try {
    const { hostname } = new URL(urlString);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "0.0.0.0";
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function confirm(message) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(`${message} (gõ "y" để tiếp tục): `);
  rl.close();
  return answer.trim().toLowerCase() === "y";
}

// Quick HTTP check before even opening a browser, so a down/wrong server
// fails fast with a clear message instead of a cryptic Playwright timeout
// after the browser has already launched.
async function preflightCheck(url, timeoutMs) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      console.error(`Cảnh báo: ${url} trả về HTTP ${res.status}. Có thể sai đường dẫn trang bài viết.`);
    }
    return true;
  } catch (err) {
    console.error(`Không kết nối được tới ${url}\n  → ${err.message}`);
    console.error(
      `Kiểm tra: (1) server đã chạy chưa — mở terminal khác, cd vào thư mục project, chạy "npm start"; ` +
      `(2) --url đúng port/path chưa (mặc định server chạy ở cổng 3000, trang demo ở /demo/bai-viet-mau); ` +
      `(3) nếu trỏ sang máy/host khác, host đó có đang lắng nghe và không bị tường lửa chặn không.`
    );
    return false;
  }
}

// Turns a raw Playwright error into an actionable Vietnamese message instead
// of the default multi-line stack, which buries the actual cause.
function friendlyError(err, url) {
  const msg = err.message || String(err);
  if (/ECONNREFUSED|ERR_CONNECTION_REFUSED/i.test(msg)) {
    return `Kết nối bị từ chối tới ${url} — server chưa chạy hoặc sai port. Chạy "npm start" ở terminal khác rồi thử lại.`;
  }
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND/i.test(msg)) {
    return `Không phân giải được host trong "${url}" — kiểm tra lại chính tả URL.`;
  }
  if (/Timeout .*exceeded/i.test(msg) && /goto/i.test(msg)) {
    return `Mở trang "${url}" quá lâu không phản hồi (vượt --timeout). Server có bị treo không, hoặc thử tăng --timeout.`;
  }
  if (/locator\('#comment'\)/.test(msg) || /locator\('#commentform'\)/.test(msg)) {
    return `Không tìm thấy biểu mẫu bình luận (#commentform/#comment) trên trang "${url}". Trang tải được nhưng không ` +
      `phải trang bài viết có form này — kiểm tra lại --url (ví dụ phải trỏ vào .../demo/bai-viet-mau, không phải trang gốc "/").`;
  }
  return msg;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!Number.isInteger(args.count) || args.count < 1 || args.count > 200) {
    console.error("--count phải là số nguyên từ 1 đến 200.");
    process.exit(1);
  }
  if (!Number.isInteger(args.delayMs) || args.delayMs < 300) {
    console.error("--delay phải >= 300ms (gửi tuần tự, không dồn dập).");
    process.exit(1);
  }

  if (!isLoopback(args.url) && !args.iOwnThisSite) {
    console.error(
      `Target "${args.url}" không phải localhost. Công cụ này chỉ dành cho site bạn tự quản lí — ` +
      `thêm --i-own-this-site nếu bạn xác nhận đây đúng là site của mình.`
    );
    process.exit(1);
  }

  const payloads = Array.from({ length: args.count }, (_, i) => {
    const generated = generateMockPayload(i);
    return {
      author: args.name ?? generated.name,
      website: args.website ?? generated.website,
      comment: args.comment ?? generated.comment,
    };
  });

  console.log(`Target:  ${args.url}`);
  console.log(`Số lượt: ${args.count}  ·  Delay giữa các lượt: ${args.delayMs}ms  ·  Chế độ: ${args.headed ? "headed" : "headless"}`);
  console.log(`Chỉ điền: comment / name / website — KHÔNG điền email, KHÔNG tick ô "lưu thông tin".`);
  console.log(`Ví dụ nội dung lượt #1:`, payloads[0]);

  const reachable = await preflightCheck(args.url, args.timeoutMs);
  if (!reachable) process.exit(1);

  if (!args.yes) {
    const ok = await confirm("\nXác nhận tiến hành điền & gửi các bình luận trên");
    if (!ok) {
      console.log("Đã huỷ — không có gì được gửi.");
      process.exit(0);
    }
  }

  const browser = await chromium.launch({ headless: !args.headed });
  const page = await browser.newPage();
  page.setDefaultTimeout(args.timeoutMs);
  page.setDefaultNavigationTimeout(args.timeoutMs);
  const results = [];

  try {
    for (let i = 0; i < payloads.length; i++) {
      const payload = payloads[i];
      const start = performance.now();
      try {
        await page.goto(args.url, { waitUntil: "domcontentloaded" });

        const formCount = await page.locator("#commentform").count();
        if (formCount === 0) {
          throw new Error(`locator('#commentform') not found on page (title: "${await page.title()}")`);
        }

        await page.fill("#comment", payload.comment);
        await page.fill("#author", payload.author);
        await page.fill("#url", payload.website);
        // Explicitly leave #email untouched and the consent checkbox unchecked.
        await page.click("#submit");
        await page.waitForLoadState("domcontentloaded");
        const latencyMs = performance.now() - start;
        const ok = page.url().includes("#comment-");
        results.push({ index: i, success: ok, latencyMs });
        console.log(`[${i + 1}/${payloads.length}] ${ok ? "OK" : "FAILED"} — ${latencyMs.toFixed(0)}ms — ${page.url()}`);
      } catch (err) {
        const latencyMs = performance.now() - start;
        const friendly = friendlyError(err, args.url);
        results.push({ index: i, success: false, latencyMs, error: friendly });
        console.log(`[${i + 1}/${payloads.length}] ERROR — ${friendly}`);
      }

      if (i < payloads.length - 1) await sleep(args.delayMs);
    }
  } finally {
    await browser.close();
  }

  const success = results.filter((r) => r.success).length;
  const failed = results.length - success;
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const avg = latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1);

  console.log("\n--- Kết quả ---");
  console.log(`Thành công: ${success}  ·  Thất bại: ${failed}  ·  Latency avg: ${avg.toFixed(0)}ms`);

  process.exit(failed > 0 ? 1 : 0);
}

main();
