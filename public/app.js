const el = (id) => document.getElementById(id);

const targetUrlInput = el("targetUrl");
const totalRequestsInput = el("totalRequests");
const concurrencyInput = el("concurrency");
const timeoutMsInput = el("timeoutMs");
const startBtn = el("startBtn");
const cancelBtn = el("cancelBtn");
const resetMockBtn = el("resetMockBtn");
const errorMsg = el("errorMsg");
const samplePayloadEl = el("samplePayload");
const exportJsonBtn = el("exportJsonBtn");
const exportCsvBtn = el("exportCsvBtn");

const progressFill = el("progressFill");
const progressLabel = el("progressLabel");
const statSent = el("statSent");
const statSuccess = el("statSuccess");
const statFailed = el("statFailed");
const statRps = el("statRps");
const statAvg = el("statAvg");
const statP95 = el("statP95");
const logBody = el("logBody");

const latencyCanvas = el("latencyChart");
const statusCanvas = el("statusChart");

let currentEventSource = null;
let latestSnapshot = null;

function showError(message) {
  if (!message) {
    errorMsg.hidden = true;
    errorMsg.textContent = "";
    return;
  }
  errorMsg.hidden = false;
  errorMsg.textContent = message;
}

async function loadSamplePayload() {
  try {
    const res = await fetch("/api/sample-payload");
    const samples = await res.json();
    samplePayloadEl.textContent = JSON.stringify(samples, null, 2);
  } catch {
    samplePayloadEl.textContent = "// không thể tải mẫu payload";
  }
}

document.querySelectorAll(".chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    totalRequestsInput.value = btn.dataset.total;
    concurrencyInput.value = btn.dataset.conc;
  });
});

resetMockBtn.addEventListener("click", async () => {
  await fetch("/api/mock/comments/reset", { method: "POST" });
  resetMockBtn.textContent = "Đã reset ✓";
  setTimeout(() => (resetMockBtn.textContent = "Reset mock store"), 1200);
});

startBtn.addEventListener("click", startTest);
cancelBtn.addEventListener("click", cancelTest);
exportJsonBtn.addEventListener("click", () => exportResults("json"));
exportCsvBtn.addEventListener("click", () => exportResults("csv"));

async function startTest() {
  showError(null);
  const targetUrl = targetUrlInput.value.trim();
  const totalRequests = Number.parseInt(totalRequestsInput.value, 10);
  const concurrency = Number.parseInt(concurrencyInput.value, 10);
  const timeoutMs = Number.parseInt(timeoutMsInput.value, 10);

  const res = await fetch("/api/stress-test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetUrl, totalRequests, concurrency, timeoutMs }),
  });

  const data = await res.json();
  if (!res.ok) {
    showError(data.error || "Không thể khởi tạo stress test");
    return;
  }

  setRunningState(true);
  resetDashboard(totalRequests);
  subscribeToJob(data.id);
}

function cancelTest() {
  if (!latestSnapshot) return;
  fetch(`/api/stress-test/${latestSnapshot.id}/cancel`, { method: "POST" });
}

function setRunningState(isRunning) {
  startBtn.disabled = isRunning;
  cancelBtn.disabled = !isRunning;
  exportJsonBtn.disabled = isRunning;
  exportCsvBtn.disabled = isRunning;
}

function resetDashboard(total) {
  progressFill.style.width = "0%";
  progressLabel.textContent = `0 / ${total}`;
  statSent.textContent = "0";
  statSuccess.textContent = "0";
  statFailed.textContent = "0";
  statRps.textContent = "0";
  statAvg.textContent = "0 ms";
  statP95.textContent = "0 / 0 ms";
  logBody.innerHTML = "";
}

function subscribeToJob(id) {
  if (currentEventSource) currentEventSource.close();
  currentEventSource = new EventSource(`/api/stress-test/${id}/events`);

  currentEventSource.onmessage = (evt) => {
    const snapshot = JSON.parse(evt.data);
    latestSnapshot = snapshot;
    render(snapshot);
  };

  currentEventSource.addEventListener("done", () => {
    currentEventSource.close();
    currentEventSource = null;
    setRunningState(false);
  });

  currentEventSource.onerror = () => {
    currentEventSource?.close();
    currentEventSource = null;
    setRunningState(false);
  };
}

function render(snapshot) {
  const pct = snapshot.total ? Math.min(100, (snapshot.sent / snapshot.total) * 100) : 0;
  progressFill.style.width = `${pct}%`;
  progressLabel.textContent = `${snapshot.sent} / ${snapshot.total}`;

  statSent.textContent = snapshot.sent;
  statSuccess.textContent = snapshot.success;
  statFailed.textContent = snapshot.failed;
  statRps.textContent = snapshot.rps;
  statAvg.textContent = `${snapshot.latency.avg} ms`;
  statP95.textContent = `${snapshot.latency.p95} / ${snapshot.latency.p99} ms`;

  drawLatencyChart(snapshot.timeline);
  drawStatusChart(snapshot.statusCounts);
  renderLog(snapshot.log);
}

function renderLog(log) {
  const rows = log.slice(-50).reverse();
  logBody.innerHTML = rows
    .map((r) => {
      const statusClass = r.success ? "status-ok" : "status-bad";
      const comment = (r.payload?.comment || "").slice(0, 60);
      return `<tr>
        <td>${r.index + 1}</td>
        <td class="${statusClass}">${r.statusLabel}</td>
        <td>${r.latencyMs.toFixed(0)} ms</td>
        <td>${escapeHtml(r.payload?.name || "")}</td>
        <td>${escapeHtml(r.payload?.website || "")}</td>
        <td title="${escapeHtml(r.payload?.comment || "")}">${escapeHtml(comment)}${comment.length === 60 ? "…" : ""}</td>
      </tr>`;
    })
    .join("");
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const CHART_HEIGHT = 180;

function setupCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.parentElement.clientWidth;
  const height = CHART_HEIGHT;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width, height };
}

function drawLatencyChart(timeline) {
  const { ctx, width, height } = setupCanvas(latencyCanvas);
  ctx.clearRect(0, 0, width, height);
  if (!timeline || timeline.length === 0) return;

  const padding = { top: 10, right: 10, bottom: 18, left: 36 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const points = timeline.slice(-300);
  const maxLatency = Math.max(10, ...points.map((p) => p.t));

  // y-axis gridlines
  ctx.strokeStyle = "#222736";
  ctx.fillStyle = "#6d7389";
  ctx.font = "10px sans-serif";
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const y = padding.top + plotH - (plotH * i) / steps;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    const value = Math.round((maxLatency * i) / steps);
    ctx.fillText(`${value}`, 2, y + 3);
  }

  ctx.beginPath();
  ctx.strokeStyle = "#6c8cff";
  ctx.lineWidth = 1.5;
  points.forEach((p, i) => {
    const x = padding.left + (plotW * i) / Math.max(1, points.length - 1);
    const y = padding.top + plotH - (p.t / maxLatency) * plotH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  points.forEach((p, i) => {
    const x = padding.left + (plotW * i) / Math.max(1, points.length - 1);
    const y = padding.top + plotH - (p.t / maxLatency) * plotH;
    ctx.beginPath();
    ctx.fillStyle = p.success ? "#39d98a" : "#ff5d7a";
    ctx.arc(x, y, 1.6, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawStatusChart(statusCounts) {
  const { ctx, width, height } = setupCanvas(statusCanvas);
  ctx.clearRect(0, 0, width, height);

  const entries = Object.entries(statusCounts || {});
  if (entries.length === 0) return;

  const padding = { top: 10, right: 10, bottom: 28, left: 30 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const maxCount = Math.max(1, ...entries.map(([, c]) => c));
  const barWidth = plotW / entries.length;

  ctx.font = "10px sans-serif";
  entries.forEach(([label, count], i) => {
    const barH = (count / maxCount) * plotH;
    const x = padding.left + i * barWidth + barWidth * 0.15;
    const y = padding.top + plotH - barH;
    const w = barWidth * 0.7;
    ctx.fillStyle = label.startsWith("2") ? "#39d98a" : label === "TIMEOUT" ? "#ffb547" : "#ff5d7a";
    ctx.fillRect(x, y, w, barH);
    ctx.fillStyle = "#9aa0b4";
    ctx.textAlign = "center";
    ctx.fillText(label, x + w / 2, height - padding.bottom + 14);
    ctx.fillStyle = "#e6e8ef";
    ctx.fillText(String(count), x + w / 2, y - 4);
  });
  ctx.textAlign = "left";
}

function exportResults(format) {
  if (!latestSnapshot) return;
  const log = latestSnapshot.log;
  let blob, filename;

  if (format === "json") {
    blob = new Blob([JSON.stringify(latestSnapshot, null, 2)], { type: "application/json" });
    filename = `stress-test-${latestSnapshot.id}.json`;
  } else {
    const header = "index,status,success,latencyMs,name,website,comment\n";
    const rows = log
      .map((r) =>
        [
          r.index + 1,
          r.statusLabel,
          r.success,
          r.latencyMs.toFixed(1),
          csvEscape(r.payload?.name),
          csvEscape(r.payload?.website),
          csvEscape(r.payload?.comment),
        ].join(",")
      )
      .join("\n");
    blob = new Blob([header + rows], { type: "text/csv" });
    filename = `stress-test-${latestSnapshot.id}.csv`;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const str = String(value ?? "");
  return `"${str.replace(/"/g, '""')}"`;
}

loadSamplePayload();
window.addEventListener("resize", () => {
  if (latestSnapshot) {
    drawLatencyChart(latestSnapshot.timeline);
    drawStatusChart(latestSnapshot.statusCounts);
  }
});
