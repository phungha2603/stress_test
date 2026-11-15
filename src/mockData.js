// Generates fully synthetic (dummy) comment-form payloads: { name, website, comment }.
// Nothing here is derived from real users — every value is a template filled with a
// request counter so payloads stay unique across a run without touching real data.

const NAME_POOL = [
  "Nguyen Van Test",
  "Tran Thi Demo",
  "Le Van Mock",
  "Pham Thi Dummy",
  "Hoang Van QA",
  "Vu Thi Stress",
  "Dang Van Load",
  "Bui Thi Fake",
  "Do Van Sample",
  "Ngo Thi Sandbox",
];

const DOMAIN_POOL = [
  "example.com",
  "test.local",
  "dummy.dev",
  "mock-site.io",
  "stress-test.net",
  "sample.invalid",
];

const COMMENT_TEMPLATES = [
  "[DUMMY #{n}] Day la binh luan kiem thu duoc tao tu dong de stress test endpoint.",
  "[MOCK #{n}] Noi dung gia lap, khong mang y nghia thuc te, chi dung cho load test.",
  "[TEST #{n}] Comment thu nghiem: Lorem ipsum dolor sit amet, du lieu nay hoan toan la gia lap.",
  "[FAKE #{n}] Day la request so {n} trong kich ban concurrent stress test tu dong.",
  "[SAMPLE #{n}] Noi dung placeholder cho muc dich kiem tra hieu nang API comment.",
  "[DUMMY #{n}] Request tu dong #{n} - vui long bo qua, khong phai du lieu thuc.",
];

function pick(pool) {
  return pool[Math.floor(Math.random() * pool.length)];
}

function fill(template, n) {
  return template.replaceAll("{n}", String(n));
}

/**
 * Builds one synthetic comment payload for request index `n`.
 * @param {number} n - 0-based request index, used only to keep values unique.
 */
export function generateMockPayload(n) {
  const suffix = n + 1;
  return {
    name: `${pick(NAME_POOL)} #${suffix}`,
    website: `https://user${suffix}.${pick(DOMAIN_POOL)}`,
    comment: fill(pick(COMMENT_TEMPLATES), suffix),
  };
}
