import { Router } from "express";

// A small self-hosted "blog post" page you actually own, structured like a
// classic WordPress single-post + comment section (title, comment list,
// comment form with comment/name/email/website fields, honeypot-free plain
// form POST). It exists so the QA autofill tool (qa/autofillComment.mjs) has
// a real rendered form to drive end-to-end — not just a JSON API — letting
// you stress-test your *own* comment pipeline (render → submit → re-render).

const MAX_STORED = 300;
const store = [];
let nextId = 1;

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function renderComment(c) {
  const siteLink = c.website ? `<a href="${esc(c.website)}" rel="nofollow ugc">${esc(c.author)}</a>` : esc(c.author);
  return `
    <li id="comment-${c.id}" class="comment">
      <article class="comment-body">
        <footer class="comment-meta">
          <cite class="fn">${siteLink}</cite>
          <time datetime="${esc(c.createdAt)}">${esc(new Date(c.createdAt).toLocaleString("vi-VN"))}</time>
        </footer>
        <p>${esc(c.comment)}</p>
      </article>
    </li>`;
}

function renderPage({ notice } = {}) {
  const comments = store.slice(-100);
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Bài viết mẫu — Demo site tự quản lí</title>
<style>
  body { font-family: -apple-system, Arial, sans-serif; max-width: 760px; margin: 40px auto; padding: 0 16px; color: #333; }
  h1 { font-size: 1.8em; }
  article.entry { border-bottom: 1px solid #eee; padding-bottom: 24px; margin-bottom: 24px; }
  #comments-title { font-size: 1.3em; }
  ol.comment-list { list-style: none; padding: 0; }
  li.comment { border-top: 1px solid #eee; padding: 12px 0; }
  .comment-meta { color: #777; font-size: 0.85em; margin-bottom: 4px; }
  .comment-meta cite { font-style: normal; font-weight: 600; margin-right: 8px; }
  #respond { background: #f7f7f7; padding: 20px; border-radius: 6px; margin-top: 24px; }
  #respond p { margin: 0 0 12px; }
  #respond label { display: block; margin-bottom: 4px; font-size: 0.9em; }
  #respond input[type=text], #respond input[type=email], #respond input[type=url], #respond textarea {
    width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font: inherit;
  }
  #respond textarea { min-height: 100px; }
  .consent { display: flex; align-items: center; gap: 8px; font-size: 0.85em; }
  .notice { background: #eaf7ea; border: 1px solid #b7e0b7; padding: 10px 14px; border-radius: 4px; margin-bottom: 16px; }
  input[type=submit] { background: #1693a5; color: #fff; border: 0; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-size: 1em; }
</style>
</head>
<body>
  ${notice ? `<p class="notice">${esc(notice)}</p>` : ""}

  <article class="entry">
    <h1>Bài viết mẫu dùng để kiểm thử quy trình bình luận</h1>
    <p>Đây là nội dung demo trên trang tự quản lí, dùng làm mục tiêu cho công cụ QA/stress-test điền &amp; gửi
    biểu mẫu bình luận tự động (trong môi trường của mình, không phải site của bên thứ ba).</p>
  </article>

  <section id="comments">
    <h3 id="comments-title">${store.length} bình luận</h3>
    <ol class="comment-list">
      ${comments.map(renderComment).join("\n") || "<li>Chưa có bình luận nào.</li>"}
    </ol>

    <div id="respond" class="comment-respond">
      <h3 id="reply-title">Gửi bình luận</h3>
      <p class="comment-notes">Email sẽ không được công khai. Trường bắt buộc đánh dấu *</p>
      <form action="/demo/bai-viet-mau/comments" method="post" id="commentform">
        <p class="comment-form-comment">
          <label for="comment">Comment *</label>
          <textarea id="comment" name="comment" required></textarea>
        </p>
        <p class="comment-form-author">
          <label for="author">Name *</label>
          <input id="author" name="author" type="text" required>
        </p>
        <p class="comment-form-email">
          <label for="email">Email</label>
          <input id="email" name="email" type="email">
        </p>
        <p class="comment-form-url">
          <label for="url">Website</label>
          <input id="url" name="url" type="url">
        </p>
        <p class="comment-form-cookies-consent">
          <label class="consent">
            <input id="wp-comment-cookies-consent" name="wp-comment-cookies-consent" type="checkbox" value="yes">
            <span>Lưu tên, email và website của tôi trên trình duyệt cho lần bình luận kế tiếp.</span>
          </label>
        </p>
        <p class="form-submit">
          <input id="submit" name="submit" type="submit" value="Gửi bình luận">
        </p>
      </form>
    </div>
  </section>
</body>
</html>`;
}

export const demoSiteRouter = Router();

demoSiteRouter.get("/bai-viet-mau", (_req, res) => {
  res.type("html").send(renderPage());
});

demoSiteRouter.post("/bai-viet-mau/comments", (req, res) => {
  const author = String(req.body?.author ?? "").trim();
  const email = String(req.body?.email ?? "").trim();
  const website = String(req.body?.url ?? "").trim();
  const comment = String(req.body?.comment ?? "").trim();

  if (!author || !comment) {
    return res.status(400).type("html").send(renderPage({ notice: "Thiếu Name hoặc Comment (bắt buộc)." }));
  }

  const record = { id: nextId++, author, email: email || null, website: website || null, comment, createdAt: new Date().toISOString() };
  store.push(record);
  if (store.length > MAX_STORED) store.shift();

  res.redirect(303, `/demo/bai-viet-mau#comment-${record.id}`);
});

demoSiteRouter.get("/bai-viet-mau/comments.json", (_req, res) => {
  res.json({ count: store.length, comments: store.slice(-50) });
});

demoSiteRouter.post("/bai-viet-mau/comments/reset", (_req, res) => {
  store.length = 0;
  res.json({ ok: true });
});
