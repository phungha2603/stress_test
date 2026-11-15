import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mockRouter } from "./src/mockEndpoint.js";
import { stressTestManager, LIMITS } from "./src/stressTester.js";
import { generateMockPayload } from "./src/mockData.js";

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

app.listen(PORT, () => {
  console.log(`Stress test dashboard running at http://localhost:${PORT}`);
});
