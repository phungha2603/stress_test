import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mockRouter } from "./src/mockEndpoint.js";
import { stressTestManager, LIMITS } from "./src/stressTester.js";
import { generateMockPayload } from "./src/mockData.js";
import {
  commentCampaignManager,
  parseAndValidateLinks,
  CAMPAIGN_LIMITS,
  CONFIRM_PHRASE,
} from "./src/commentCampaign.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Demo target endpoint the stress tester hits by default.
app.use("/api/mock", mockRouter);

app.get("/api/limits", (_req, res) => {
  res.json(LIMITS);
});

app.get("/api/sample-payload", (_req, res) => {
  const samples = [0, 1, 2].map((n) => generateMockPayload(Math.floor(Math.random() * 10000) + n));
  res.json(samples);
});

app.post("/api/stress-test", (req, res) => {
  const body = req.body ?? {};
  const totalRequests = Number.parseInt(body.totalRequests, 10);
  const concurrency = Number.parseInt(body.concurrency, 10);
  const timeoutMs = Number.parseInt(body.timeoutMs, 10) || 5000;
  const targetUrl = typeof body.targetUrl === "string" ? body.targetUrl.trim() : "";

  if (!targetUrl) {
    return res.status(400).json({ error: "targetUrl is required" });
  }
  let resolvedTargetUrl;
  try {
    // Allow a relative path (e.g. "/api/mock/comments") by resolving it
    // against this server's own origin, since Node's fetch needs an absolute URL.
    resolvedTargetUrl = new URL(targetUrl, `${req.protocol}://${req.get("host")}`).toString();
  } catch {
    return res.status(400).json({ error: "targetUrl must be a valid URL or path" });
  }
  if (!Number.isInteger(totalRequests) || totalRequests < 1 || totalRequests > LIMITS.maxTotalRequests) {
    return res.status(400).json({ error: `totalRequests must be between 1 and ${LIMITS.maxTotalRequests}` });
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > LIMITS.maxConcurrency) {
    return res.status(400).json({ error: `concurrency must be between 1 and ${LIMITS.maxConcurrency}` });
  }

  const job = stressTestManager.createJob({ targetUrl: resolvedTargetUrl, totalRequests, concurrency, timeoutMs });
  res.status(201).json({ id: job.id });
});

app.get("/api/stress-test/:id", (req, res) => {
  const job = stressTestManager.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  res.json(job.snapshot());
});

app.get("/api/stress-test/:id/events", (req, res) => {
  const job = stressTestManager.getJob(req.params.id);
  if (!job) return res.status(404).end();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  job.addSubscriber(res);
  res.write(`data: ${JSON.stringify(job.snapshot())}\n\n`);

  if (job.status !== "running") {
    res.write("event: done\ndata: {}\n\n");
    res.end();
  }

  req.on("close", () => job.removeSubscriber(res));
});

app.post("/api/stress-test/:id/cancel", (req, res) => {
  const ok = stressTestManager.cancelJob(req.params.id);
  res.json({ ok });
});

app.get("/api/campaign-limits", (_req, res) => {
  res.json({ ...CAMPAIGN_LIMITS, confirmPhrase: CONFIRM_PHRASE });
});

// Step 1: validate links + payload, create a campaign that is NOT sent yet —
// it just sits in "pending_confirmation" until a human reviews and confirms it.
app.post("/api/comment-campaign", (req, res) => {
  const body = req.body ?? {};
  const { links, invalid } = parseAndValidateLinks(body.links);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const website = typeof body.website === "string" ? body.website.trim() : "";
  const comment = typeof body.comment === "string" ? body.comment.trim() : "";

  let delayMs = Number.parseInt(body.delayMs, 10);
  if (!Number.isFinite(delayMs)) delayMs = CAMPAIGN_LIMITS.defaultDelayMs;
  delayMs = Math.min(CAMPAIGN_LIMITS.maxDelayMs, Math.max(CAMPAIGN_LIMITS.minDelayMs, delayMs));

  if (links.length === 0) {
    return res.status(400).json({ error: "Cần ít nhất 1 link hợp lệ (http/https)" });
  }
  if (links.length > CAMPAIGN_LIMITS.maxLinks) {
    return res.status(400).json({ error: `Tối đa ${CAMPAIGN_LIMITS.maxLinks} link mỗi lần chạy` });
  }
  if (!name || !comment) {
    return res.status(400).json({ error: "Thiếu name hoặc comment" });
  }

  const campaign = commentCampaignManager.create({ links, payload: { name, website, comment }, delayMs });
  res.status(201).json({
    id: campaign.id,
    preview: { links, invalid, payload: campaign.payload, delayMs: campaign.delayMs, confirmPhrase: CONFIRM_PHRASE },
  });
});

// Step 2: human must send back the exact confirm phrase before anything is
// actually dispatched. Only a campaign still pending can be confirmed, so a
// double-click (or retry) can never fire the same campaign twice.
app.post("/api/comment-campaign/:id/confirm", (req, res) => {
  const campaign = commentCampaignManager.get(req.params.id);
  if (!campaign) return res.status(404).json({ error: "campaign not found" });
  if (campaign.status !== "pending_confirmation") {
    return res.status(409).json({ error: "campaign không ở trạng thái chờ xác nhận" });
  }

  const typed = String(req.body?.confirmPhrase ?? "").trim().toUpperCase();
  if (typed !== CONFIRM_PHRASE) {
    return res.status(400).json({ error: "Cụm từ xác nhận không đúng" });
  }

  const started = commentCampaignManager.confirmAndStart(campaign.id);
  if (!started) return res.status(409).json({ error: "Không thể bắt đầu campaign" });
  res.json({ ok: true });
});

app.get("/api/comment-campaign/:id", (req, res) => {
  const campaign = commentCampaignManager.get(req.params.id);
  if (!campaign) return res.status(404).json({ error: "campaign not found" });
  res.json(campaign.snapshot());
});

app.get("/api/comment-campaign/:id/events", (req, res) => {
  const campaign = commentCampaignManager.get(req.params.id);
  if (!campaign) return res.status(404).end();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  campaign.addSubscriber(res);
  res.write(`data: ${JSON.stringify(campaign.snapshot())}\n\n`);

  if (campaign.status !== "running" && campaign.status !== "pending_confirmation") {
    res.write("event: done\ndata: {}\n\n");
    res.end();
  }

  req.on("close", () => campaign.removeSubscriber(res));
});

app.post("/api/comment-campaign/:id/cancel", (req, res) => {
  const ok = commentCampaignManager.cancel(req.params.id);
  res.json({ ok });
});

app.listen(PORT, () => {
  console.log(`Stress test dashboard running at http://localhost:${PORT}`);
});
