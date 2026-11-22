/* API Buttons — session variables, CRUD, run, brokers CSV, history CSV */
const API_VAR_KEY = "golddesk_api_vars";

function loadSessionVars() {
  try { return JSON.parse(sessionStorage.getItem(API_VAR_KEY) || "{}"); }
  catch { return {}; }
}
function saveSessionVars(obj) {
  sessionStorage.setItem(API_VAR_KEY, JSON.stringify(obj || {}));
}

function resolveText(text, vars) {
  return String(text || "").replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, k) =>
    vars[k] != null ? String(vars[k]) : `{{${k}}}`
  );
}

let apiSelectedId = null;
let apiButtonsCache = [];

function renderVarEditor() {
  const el = $("apiVars");
  if (!el) return;
  const vars = loadSessionVars();
  const keys = Object.keys(vars);
  el.innerHTML = keys.length
    ? keys.map(k => `<div class="api-var-row"><code>{{${k}}}</code> = <input data-k="${k}" value="${esc(vars[k])}" /><button type="button" data-del="${k}">x</button></div>`).join("")
    : '<div class="empty">No session variables yet.</div>';
  el.querySelectorAll("input[data-k]").forEach(inp => {
    inp.onchange = () => {
      const v = loadSessionVars();
      v[inp.dataset.k] = inp.value;
      saveSessionVars(v);
      updateResolvedPreview();
    };
  });
  el.querySelectorAll("button[data-del]").forEach(b => {
    b.onclick = () => {
      const v = loadSessionVars();
      delete v[b.dataset.del];
      saveSessionVars(v);
      renderVarEditor();
      updateResolvedPreview();
    };
  });
}

function updateResolvedPreview() {
  const vars = loadSessionVars();
  const method = ($("apiMethod") || {}).value || "GET";
  const url = resolveText(($("apiUrl") || {}).value || "", vars);
  const headers = resolveText(($("apiHeaders") || {}).value || "{}", vars);
  const payload = resolveText(($("apiPayload") || {}).value || "", vars);
  const pre = $("apiResolved");
  if (pre) {
    pre.textContent = `${method} ${url}\n\nHeaders:\n${headers}\n\nBody:\n${payload}`;
  }
}

function fillForm(btn) {
  apiSelectedId = btn ? btn.id : null;
  if ($("apiLabel")) $("apiLabel").value = btn ? btn.label : "";
  if ($("apiMethod")) $("apiMethod").value = btn ? (btn.method || "GET") : "GET";
  if ($("apiUrl")) $("apiUrl").value = btn ? btn.url : "";
  if ($("apiHeaders")) $("apiHeaders").value = btn ? (btn.headers || "{}") : "{}";
  if ($("apiPayload")) $("apiPayload").value = btn ? (btn.payload || "") : "";
  if ($("apiBroker")) $("apiBroker").value = btn ? (btn.broker_id || "") : "";
  document.querySelectorAll(".api-btn-item").forEach(x => {
    x.classList.toggle("active", btn && x.dataset.id === btn.id);
  });
  updateResolvedPreview();
}

async function loadApiButtons() {
  const list = $("apiBtnList");
  try {
    const r = await fetch("/api/buttons");
    apiButtonsCache = await r.json();
    if (!list) return;
    if (!apiButtonsCache.length) {
      list.innerHTML = '<div class="empty">No buttons yet. Create one below.</div>';
      return;
    }
    list.innerHTML = apiButtonsCache.map(b =>
      `<button type="button" class="api-btn-item" data-id="${b.id}"><b>${esc(b.label)}</b> <span>${esc(b.method)}</span></button>`
    ).join("");
    list.querySelectorAll(".api-btn-item").forEach(el => {
      el.onclick = () => {
        const b = apiButtonsCache.find(x => x.id === el.dataset.id);
        fillForm(b);
      };
    });
  } catch (e) {
    if (list) list.innerHTML = '<div class="empty">Could not load buttons.</div>';
  }
}

async function loadBrokers() {
  const sel = $("apiBroker");
  const box = $("apiBrokerList");
  try {
    const r = await fetch("/api/brokers");
    const d = await r.json();
    const brokers = d.brokers || [];
    if (sel) {
      sel.innerHTML = '<option value="">— broker template —</option>' +
        brokers.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("");
    }
    if (box) {
      box.innerHTML = brokers.map(b =>
        `<div class="api-broker-row"><b>${esc(b.name)}</b> <code>${esc(b.base_url)}</code><br><span class="meta">${esc(b.notes || "")} · model ${esc((b.payload_model || "").slice(0, 80))}</span></div>`
      ).join("") || '<div class="empty">No brokers in CSV.</div>';
    }
  } catch (e) {
    if (box) box.innerHTML = '<div class="empty">Brokers CSV unavailable.</div>';
  }
}

async function loadHistory() {
  const box = $("apiHistory");
  if (!box) return;
  try {
    const r = await fetch("/api/history?limit=40");
    const d = await r.json();
    const rows = d.history || [];
    if (!rows.length) {
      box.innerHTML = '<div class="empty">No API call history yet.</div>';
      return;
    }
    box.innerHTML = rows.map(h => {
      const t = new Date((+h.ts || 0) * 1000).toLocaleString();
      const ok = +h.status >= 200 && +h.status < 300;
      return `<div class="api-hist-row ${ok ? "ok" : "bad"}">
        <span class="tag">${esc(h.method)}</span>
        <span><b>${esc(h.label)}</b> · ${esc(h.status)} · ${esc(h.duration_ms)}ms · ${t}<br>
        <span class="meta">${esc(h.url)}</span><br>
        <span class="meta">${esc((h.response_preview || "").slice(0, 160))}</span></span>
      </div>`;
    }).join("");
  } catch (e) {
    box.innerHTML = '<div class="empty">History unavailable.</div>';
  }
}

async function saveButton() {
  const body = {
    label: ($("apiLabel") || {}).value || "",
    method: ($("apiMethod") || {}).value || "GET",
    url: ($("apiUrl") || {}).value || "",
    headers: ($("apiHeaders") || {}).value || "{}",
    payload: ($("apiPayload") || {}).value || "",
    broker_id: ($("apiBroker") || {}).value || "",
  };
  if (!body.label.trim() || !body.url.trim()) {
    alert("Label and URL required");
    return;
  }
  try {
    JSON.parse(body.headers || "{}");
  } catch {
    alert("Headers must be valid JSON");
    return;
  }
  const url = apiSelectedId ? `/api/buttons/${apiSelectedId}` : "/api/buttons";
  const method = apiSelectedId ? "PUT" : "POST";
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) {
    alert("Save failed: " + (await r.text()));
    return;
  }
  const d = await r.json();
  if (!apiSelectedId && d.id) apiSelectedId = d.id;
  await loadApiButtons();
  updateResolvedPreview();
}

async function deleteButton() {
  if (!apiSelectedId) return;
  if (!confirm("Delete this button?")) return;
  await fetch(`/api/buttons/${apiSelectedId}`, { method: "DELETE" });
  apiSelectedId = null;
  fillForm(null);
  await loadApiButtons();
}

async function runSelected() {
  if (!apiSelectedId) {
    alert("Select or save a button first");
    return;
  }
  const out = $("apiRunResult");
  if (out) out.textContent = "Running…";
  const r = await fetch(`/api/buttons/${apiSelectedId}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ variables: loadSessionVars() }),
  });
  const d = await r.json();
  if (out) {
    out.textContent = `HTTP ${d.status} · ${d.duration_ms}ms\n${d.method} ${d.url}\n\n${d.response || ""}`;
  }
  await loadHistory();
}

function initApiButtonsPanel() {
  if (!$("apiBtnList")) return;
  renderVarEditor();
  loadApiButtons();
  loadBrokers();
  loadHistory();
  ["apiLabel", "apiMethod", "apiUrl", "apiHeaders", "apiPayload"].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener("input", updateResolvedPreview);
  });
  if ($("apiAddVar")) {
    $("apiAddVar").onclick = () => {
      const k = ($("apiNewVarKey") || {}).value || "";
      const v = ($("apiNewVarVal") || {}).value || "";
      if (!k.trim()) return;
      const vars = loadSessionVars();
      vars[k.trim()] = v;
      saveSessionVars(vars);
      if ($("apiNewVarKey")) $("apiNewVarKey").value = "";
      if ($("apiNewVarVal")) $("apiNewVarVal").value = "";
      renderVarEditor();
      updateResolvedPreview();
    };
  }
  if ($("apiSaveBtn")) $("apiSaveBtn").onclick = saveButton;
  if ($("apiNewBtn")) $("apiNewBtn").onclick = () => { apiSelectedId = null; fillForm(null); };
  if ($("apiDelBtn")) $("apiDelBtn").onclick = deleteButton;
  if ($("apiRunBtn")) $("apiRunBtn").onclick = runSelected;
  if ($("apiClearHist")) {
    $("apiClearHist").onclick = async () => {
      if (!confirm("Clear history CSV?")) return;
      await fetch("/api/history", { method: "DELETE" });
      loadHistory();
    };
  }
  if ($("apiBroker")) {
    $("apiBroker").onchange = () => {
      const id = $("apiBroker").value;
      fetch("/api/brokers").then(r => r.json()).then(d => {
        const b = (d.brokers || []).find(x => x.id === id);
        if (!b) return;
        if (b.base_url && $("apiUrl") && !$("apiUrl").value) $("apiUrl").value = b.base_url;
        if (b.payload_model && $("apiHeaders")) {
          try {
            const m = typeof b.payload_model === "string" ? b.payload_model : JSON.stringify(b.payload_model);
            $("apiHeaders").value = m;
          } catch {}
        }
        updateResolvedPreview();
      });
    };
  }
}

document.addEventListener("DOMContentLoaded", initApiButtonsPanel);
if (document.readyState !== "loading") setTimeout(initApiButtonsPanel, 0);
