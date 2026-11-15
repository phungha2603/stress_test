// Wrapped in an IIFE so this file's top-level declarations (starting with
// `el`) never collide with app.js's identically-named ones — both are
// loaded as classic scripts sharing one global scope, and a duplicate
// top-level `const`/`let` across them throws a SyntaxError that silently
// kills this entire file.
(function () {
const el = (id) => document.getElementById(id);

const campaignLinks = el("campaignLinks");
const campaignName = el("campaignName");
const campaignWebsite = el("campaignWebsite");
const campaignComment = el("campaignComment");
const campaignDelay = el("campaignDelay");
const previewCampaignBtn = el("previewCampaignBtn");
const cancelCampaignBtn = el("cancelCampaignBtn");
const campaignErrorMsg = el("campaignErrorMsg");
const campaignExportJsonBtn = el("campaignExportJsonBtn");
const campaignExportCsvBtn = el("campaignExportCsvBtn");

const campaignProgressFill = el("campaignProgressFill");
const campaignProgressLabel = el("campaignProgressLabel");
const campaignStatSent = el("campaignStatSent");
const campaignStatSuccess = el("campaignStatSuccess");
const campaignStatFailed = el("campaignStatFailed");
const campaignLogBody = el("campaignLogBody");

const confirmModal = el("confirmModal");
const modalLinkCount = el("modalLinkCount");
const modalLinkList = el("modalLinkList");
const modalInvalidNote = el("modalInvalidNote");
const modalPayloadPreview = el("modalPayloadPreview");
const confirmAuthCheckbox = el("confirmAuthCheckbox");
const confirmPhraseInput = el("confirmPhraseInput");
const confirmPhraseLabel = el("confirmPhraseLabel");
const modalCancelBtn = el("modalCancelBtn");
const modalConfirmBtn = el("modalConfirmBtn");

let pendingCampaignId = null;
let requiredConfirmPhrase = "XAC NHAN GUI";
let campaignEventSource = null;
let latestCampaignSnapshot = null;

function showCampaignError(message) {
  if (!message) {
    campaignErrorMsg.hidden = true;
    campaignErrorMsg.textContent = "";
    return;
  }
  campaignErrorMsg.hidden = false;
  campaignErrorMsg.textContent = message;
}

async function loadCampaignLimits() {
  try {
    const res = await fetch("/api/campaign-limits");
    const data = await res.json();
    if (data.confirmPhrase) {
      requiredConfirmPhrase = data.confirmPhrase;
      confirmPhraseLabel.textContent = data.confirmPhrase;
    }
    if (data.minDelayMs) campaignDelay.min = String(data.minDelayMs);
    if (data.maxDelayMs) campaignDelay.max = String(data.maxDelayMs);
    if (data.defaultDelayMs) campaignDelay.value = String(data.defaultDelayMs);
  } catch {
    // Keep the hardcoded defaults if the limits endpoint can't be reached.
  }
}

previewCampaignBtn.addEventListener("click", previewCampaign);
modalCancelBtn.addEventListener("click", closeModal);
modalConfirmBtn.addEventListener("click", confirmAndSend);
cancelCampaignBtn.addEventListener("click", cancelCampaign);
campaignExportJsonBtn.addEventListener("click", () => exportCampaignResults("json"));
campaignExportCsvBtn.addEventListener("click", () => exportCampaignResults("csv"));
confirmAuthCheckbox.addEventListener("change", updateConfirmButtonState);
confirmPhraseInput.addEventListener("input", updateConfirmButtonState);

function updateConfirmButtonState() {
  const typed = confirmPhraseInput.value.trim().toUpperCase();
  modalConfirmBtn.disabled = !(confirmAuthCheckbox.checked && typed === requiredConfirmPhrase.toUpperCase());
}

async function previewCampaign() {
  showCampaignError(null);

  const body = {
    links: campaignLinks.value,
    name: campaignName.value.trim(),
    website: campaignWebsite.value.trim(),
    comment: campaignComment.value.trim(),
    delayMs: Number.parseInt(campaignDelay.value, 10),
  };

  const res = await fetch("/api/comment-campaign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    showCampaignError(data.error || "Không thể tạo campaign");
    return;
  }

  pendingCampaignId = data.id;
  openModal(data.preview);
}

function openModal(preview) {
  modalLinkCount.textContent = String(preview.links.length);
  modalLinkList.innerHTML = preview.links.map((l) => `<li>${escapeHtml(l)}</li>`).join("");

  if (preview.invalid && preview.invalid.length) {
    modalInvalidNote.hidden = false;
    modalInvalidNote.textContent = `Bỏ qua ${preview.invalid.length} dòng không phải link http(s) hợp lệ.`;
  } else {
    modalInvalidNote.hidden = true;
  }

  modalPayloadPreview.textContent =
    JSON.stringify(preview.payload, null, 2) + `\n\nĐộ trễ giữa mỗi lần gửi: ${preview.delayMs} ms`;

  if (preview.confirmPhrase) {
    requiredConfirmPhrase = preview.confirmPhrase;
    confirmPhraseLabel.textContent = preview.confirmPhrase;
  }

  confirmAuthCheckbox.checked = false;
  confirmPhraseInput.value = "";
  updateConfirmButtonState();
  confirmModal.hidden = false;
}

function closeModal() {
  confirmModal.hidden = true;
  pendingCampaignId = null;
}

async function confirmAndSend() {
  if (!pendingCampaignId) return;

  const res = await fetch(`/api/comment-campaign/${pendingCampaignId}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmPhrase: confirmPhraseInput.value }),
  });
  const data = await res.json();
  if (!res.ok) {
    showCampaignError(data.error || "Không thể xác nhận gửi");
    return;
  }

  confirmModal.hidden = true;
  setCampaignRunningState(true);
  resetCampaignDashboard();
  subscribeToCampaign(pendingCampaignId);
  pendingCampaignId = null;
}

function cancelCampaign() {
  if (!latestCampaignSnapshot) return;
  fetch(`/api/comment-campaign/${latestCampaignSnapshot.id}/cancel`, { method: "POST" });
}

function setCampaignRunningState(isRunning) {
  previewCampaignBtn.disabled = isRunning;
  cancelCampaignBtn.disabled = !isRunning;
  campaignExportJsonBtn.disabled = isRunning;
  campaignExportCsvBtn.disabled = isRunning;
}

function resetCampaignDashboard() {
  campaignProgressFill.style.width = "0%";
  campaignProgressLabel.textContent = "0 / 0";
  campaignStatSent.textContent = "0";
  campaignStatSuccess.textContent = "0";
  campaignStatFailed.textContent = "0";
  campaignLogBody.innerHTML = "";
}

function subscribeToCampaign(id) {
  if (campaignEventSource) campaignEventSource.close();
  campaignEventSource = new EventSource(`/api/comment-campaign/${id}/events`);

  campaignEventSource.onmessage = (evt) => {
    const snapshot = JSON.parse(evt.data);
    snapshot.id = id;
    latestCampaignSnapshot = snapshot;
    renderCampaign(snapshot);
  };

  campaignEventSource.addEventListener("done", () => {
    campaignEventSource.close();
    campaignEventSource = null;
    setCampaignRunningState(false);
  });

  campaignEventSource.onerror = () => {
    campaignEventSource?.close();
    campaignEventSource = null;
    setCampaignRunningState(false);
  };
}

function renderCampaign(snapshot) {
  const pct = snapshot.total ? Math.min(100, (snapshot.sent / snapshot.total) * 100) : 0;
  campaignProgressFill.style.width = `${pct}%`;
  campaignProgressLabel.textContent = `${snapshot.sent} / ${snapshot.total}`;
  campaignStatSent.textContent = snapshot.sent;
  campaignStatSuccess.textContent = snapshot.success;
  campaignStatFailed.textContent = snapshot.failed;

  const rows = snapshot.log.slice().reverse();
  campaignLogBody.innerHTML = rows
    .map((r) => {
      const statusClass = r.success ? "status-ok" : "status-bad";
      return `<tr>
        <td>${r.index + 1}</td>
        <td class="${statusClass}">${r.statusLabel}</td>
        <td>${r.latencyMs.toFixed(0)} ms</td>
        <td title="${escapeHtml(r.link)}">${escapeHtml(truncate(r.link, 50))}</td>
        <td>${escapeHtml(r.error || "")}</td>
      </tr>`;
    })
    .join("");
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n) + "…" : str;
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function exportCampaignResults(format) {
  if (!latestCampaignSnapshot) return;
  const log = latestCampaignSnapshot.log;
  let blob, filename;

  if (format === "json") {
    blob = new Blob([JSON.stringify(latestCampaignSnapshot, null, 2)], { type: "application/json" });
    filename = `comment-campaign-${latestCampaignSnapshot.id}.json`;
  } else {
    const header = "index,status,success,latencyMs,link,error\n";
    const rows = log
      .map((r) => [r.index + 1, r.statusLabel, r.success, r.latencyMs.toFixed(1), csvEscape(r.link), csvEscape(r.error)].join(","))
      .join("\n");
    blob = new Blob([header + rows], { type: "text/csv" });
    filename = `comment-campaign-${latestCampaignSnapshot.id}.csv`;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

loadCampaignLimits();
})();
