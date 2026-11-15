import { Router } from "express";

// A stand-in "comment" endpoint so the stress tester has something real to hit
// out of the box. It behaves like a typical comment-form API: validates the
// three fields, simulates network/processing latency, and can be told to fail
// a configurable percentage of requests so the dashboard has something to show.

const MAX_STORED = 500;
const store = [];

function parseIntParam(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseFloatParam(value, fallback) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const mockRouter = Router();

mockRouter.post("/comments", async (req, res) => {
  const minLatency = parseIntParam(req.query.minLatency, 40);
  const maxLatency = Math.max(minLatency, parseIntParam(req.query.maxLatency, 250));
  const failureRate = Math.min(1, Math.max(0, parseFloatParam(req.query.failureRate, 0)));

  const latency = minLatency + Math.random() * (maxLatency - minLatency);
  await wait(latency);

  const { name, website, comment } = req.body ?? {};
  if (!name || !comment) {
    return res.status(400).json({ error: "Missing required field(s): name, comment" });
  }

  if (Math.random() < failureRate) {
    return res.status(500).json({ error: "Simulated server error" });
  }

  const record = {
    id: store.length + 1,
    name,
    website: website ?? null,
    comment,
    receivedAt: new Date().toISOString(),
  };
  store.push(record);
  if (store.length > MAX_STORED) store.shift();

  res.status(201).json({ ok: true, id: record.id });
});

mockRouter.get("/comments", (_req, res) => {
  res.json({ count: store.length, comments: store.slice(-50) });
});

mockRouter.post("/comments/reset", (_req, res) => {
  store.length = 0;
  res.json({ ok: true });
});
