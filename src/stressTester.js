import { randomUUID } from "node:crypto";
import { generateMockPayload } from "./mockData.js";

export const LIMITS = {
  maxTotalRequests: 20000,
  maxConcurrency: 200,
};

const EMIT_INTERVAL_MS = 200;
const LOG_TAIL_SIZE = 200;

function percentile(sortedLatencies, p) {
  if (sortedLatencies.length === 0) return 0;
  const idx = Math.min(
    sortedLatencies.length - 1,
    Math.ceil((p / 100) * sortedLatencies.length) - 1
  );
  return sortedLatencies[Math.max(0, idx)];
}

class StressTestJob {
  constructor(config) {
    this.id = randomUUID();
    this.config = config;
    this.status = "running"; // running | completed | cancelled | failed
    this.createdAt = Date.now();
    this.finishedAt = null;

    this.sent = 0;
    this.success = 0;
    this.failed = 0;
    this.statusCounts = new Map(); // "200" -> n, "ERR" -> n
    this.latencies = [];
    this.timeline = []; // { t, latencyMs, success, statusLabel }
    this.log = []; // last N request results with payload preview

    this.cancelled = false;
    this.subscribers = new Set();
    this._emitTimer = null;
  }

  addSubscriber(res) {
    this.subscribers.add(res);
  }

  removeSubscriber(res) {
    this.subscribers.delete(res);
  }

  snapshot() {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const elapsedSec = Math.max(0.001, ((this.finishedAt ?? Date.now()) - this.createdAt) / 1000);
    return {
      id: this.id,
      status: this.status,
      config: this.config,
      sent: this.sent,
      total: this.config.totalRequests,
      success: this.success,
      failed: this.failed,
      elapsedSec: Number(elapsedSec.toFixed(2)),
      rps: Number((this.sent / elapsedSec).toFixed(2)),
      latency: {
        min: sorted[0] ?? 0,
        max: sorted[sorted.length - 1] ?? 0,
        avg: sorted.length ? Number((sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(1)) : 0,
        p50: Number(percentile(sorted, 50).toFixed(1)),
        p95: Number(percentile(sorted, 95).toFixed(1)),
        p99: Number(percentile(sorted, 99).toFixed(1)),
      },
      statusCounts: Object.fromEntries(this.statusCounts),
      timeline: this.timeline,
      log: this.log,
    };
  }

  _broadcast() {
    const payload = `data: ${JSON.stringify(this.snapshot())}\n\n`;
    for (const res of this.subscribers) {
      res.write(payload);
    }
  }

  _scheduleEmit() {
    if (this._emitTimer) return;
    this._emitTimer = setTimeout(() => {
      this._emitTimer = null;
      this._broadcast();
    }, EMIT_INTERVAL_MS);
  }

  recordResult(result) {
    this.sent += 1;
    if (result.success) this.success += 1;
    else this.failed += 1;

    const label = result.statusLabel;
    this.statusCounts.set(label, (this.statusCounts.get(label) ?? 0) + 1);
    this.latencies.push(result.latencyMs);
    this.timeline.push({
      t: Number((result.latencyMs).toFixed(1)),
      elapsedMs: Date.now() - this.createdAt,
      success: result.success,
      statusLabel: label,
    });

    this.log.push(result);
    if (this.log.length > LOG_TAIL_SIZE) this.log.shift();

    this._scheduleEmit();
  }

  finish(status) {
    this.status = status;
    this.finishedAt = Date.now();
    if (this._emitTimer) {
      clearTimeout(this._emitTimer);
      this._emitTimer = null;
    }
    this._broadcast();
    for (const res of this.subscribers) {
      res.write("event: done\ndata: {}\n\n");
      res.end();
    }
    this.subscribers.clear();
  }
}

class StressTestManager {
  constructor() {
    this.jobs = new Map();
  }

  createJob(config) {
    const job = new StressTestJob(config);
    this.jobs.set(job.id, job);
    this._run(job).catch((err) => {
      job.status = "failed";
      job.error = err.message;
      job.finish("failed");
    });
    return job;
  }

  getJob(id) {
    return this.jobs.get(id);
  }

  cancelJob(id) {
    const job = this.jobs.get(id);
    if (!job || job.status !== "running") return false;
    job.cancelled = true;
    return true;
  }

  async _run(job) {
    const { targetUrl, totalRequests, concurrency, timeoutMs } = job.config;
    let nextIndex = 0;

    const worker = async () => {
      while (true) {
        if (job.cancelled) return;
        const index = nextIndex++;
        if (index >= totalRequests) return;

        const payload = generateMockPayload(index);
        const start = performance.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const res = await fetch(targetUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
          const latencyMs = performance.now() - start;
          const success = res.status >= 200 && res.status < 300;
          job.recordResult({
            index,
            success,
            statusLabel: String(res.status),
            latencyMs,
            payload,
          });
        } catch (err) {
          const latencyMs = performance.now() - start;
          job.recordResult({
            index,
            success: false,
            statusLabel: err.name === "AbortError" ? "TIMEOUT" : "ERROR",
            latencyMs,
            payload,
            error: err.message,
          });
        } finally {
          clearTimeout(timeout);
        }
      }
    };

    const workerCount = Math.min(concurrency, totalRequests);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    job.finish(job.cancelled ? "cancelled" : "completed");
  }
}

export const stressTestManager = new StressTestManager();
