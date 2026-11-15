import { randomUUID } from "node:crypto";

// Semi-automated "comment campaign": sends ONE shared {name, website, comment}
// payload sequentially (never concurrently) to a human-reviewed list of real
// target links, gated behind an explicit confirmation step. This is distinct
// from stressTester.js, which blasts concurrent synthetic load at a single
// mock target — this module is for real, low-volume, authorized sends.

export const CAMPAIGN_LIMITS = {
  maxLinks: 100,
  minDelayMs: 1500,
  maxDelayMs: 60000,
  defaultDelayMs: 2500,
};

// Plain-ASCII on purpose so typing it isn't affected by Vietnamese input
// method / diacritic normalization quirks.
export const CONFIRM_PHRASE = "XAC NHAN GUI";

const EMIT_INTERVAL_MS = 200;

function isValidHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Parses a raw links field (newline-separated string, or an array) into a
 * deduplicated list of valid http(s) URLs plus whatever couldn't be parsed.
 */
export function parseAndValidateLinks(raw) {
  const rawList = Array.isArray(raw) ? raw : String(raw ?? "").split(/\r?\n/);
  const seen = new Set();
  const links = [];
  const invalid = [];

  for (const line of rawList) {
    const trimmed = String(line ?? "").trim();
    if (!trimmed) continue;
    if (!isValidHttpUrl(trimmed)) {
      invalid.push(trimmed);
      continue;
    }
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    links.push(trimmed);
  }

  return { links, invalid };
}

class CommentCampaign {
  constructor({ links, payload, delayMs }) {
    this.id = randomUUID();
    this.links = links;
    this.payload = payload;
    this.delayMs = delayMs;
    // pending_confirmation | running | completed | cancelled | failed
    this.status = "pending_confirmation";
    this.createdAt = Date.now();
    this.confirmedAt = null;
    this.finishedAt = null;

    this.sent = 0;
    this.success = 0;
    this.failed = 0;
    this.log = [];

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
    return {
      id: this.id,
      status: this.status,
      total: this.links.length,
      sent: this.sent,
      success: this.success,
      failed: this.failed,
      delayMs: this.delayMs,
      payload: this.payload,
      log: this.log,
    };
  }

  _broadcast() {
    const data = `data: ${JSON.stringify(this.snapshot())}\n\n`;
    for (const res of this.subscribers) res.write(data);
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
    this.log.push(result);
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

class CommentCampaignManager {
  constructor() {
    this.campaigns = new Map();
  }

  create({ links, payload, delayMs }) {
    const campaign = new CommentCampaign({ links, payload, delayMs });
    this.campaigns.set(campaign.id, campaign);
    return campaign;
  }

  get(id) {
    return this.campaigns.get(id);
  }

  /** Transitions a campaign out of pending_confirmation and starts sending. */
  confirmAndStart(id) {
    const campaign = this.campaigns.get(id);
    if (!campaign || campaign.status !== "pending_confirmation") return null;
    campaign.status = "running";
    campaign.confirmedAt = Date.now();
    this._run(campaign).catch((err) => {
      campaign.error = err.message;
      campaign.finish("failed");
    });
    return campaign;
  }

  cancel(id) {
    const campaign = this.campaigns.get(id);
    if (!campaign || campaign.status !== "running") return false;
    campaign.cancelled = true;
    return true;
  }

  async _run(campaign) {
    for (let i = 0; i < campaign.links.length; i++) {
      if (campaign.cancelled) break;
      const link = campaign.links[i];
      const start = performance.now();

      try {
        const res = await fetch(link, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(campaign.payload),
        });
        const latencyMs = performance.now() - start;
        const success = res.status >= 200 && res.status < 300;
        campaign.recordResult({ index: i, link, success, statusLabel: String(res.status), latencyMs });
      } catch (err) {
        const latencyMs = performance.now() - start;
        campaign.recordResult({ index: i, link, success: false, statusLabel: "ERROR", latencyMs, error: err.message });
      }

      // Mandatory pause between sends — sequential, never concurrent — so this
      // can never behave like a burst/spam tool regardless of client input.
      if (i < campaign.links.length - 1 && !campaign.cancelled) {
        await new Promise((resolve) => setTimeout(resolve, campaign.delayMs));
      }
    }

    campaign.finish(campaign.cancelled ? "cancelled" : "completed");
  }
}

export const commentCampaignManager = new CommentCampaignManager();
