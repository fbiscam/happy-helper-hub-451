const ENDPOINTS =
  location.protocol === "chrome-extension:"
    ? [
        "https://project--9fc0698e-7373-4bdf-b90d-fe4ff903454b-dev.lovable.app/api/public/gold",
        "https://project--9fc0698e-7373-4bdf-b90d-fe4ff903454b.lovable.app/api/public/gold",
      ]
    : ["/api/public/gold"];
let API = ENDPOINTS[0];


const TIMEFRAMES = ["15m", "1h", "4h", "1d"];
const QUICKS = [
  { label: "Read screen", text: "Read the chart on my screen using ICT/SMC concepts." },
  { label: "Trade plan", text: "Give me a trade plan now: bias, entry (POI), stop, TP1/TP2, RR." },
  { label: "Liquidity", text: "Where is liquidity resting and where should I expect the next sweep?" },
  { label: "Structure", text: "Explain market structure: BOS/CHoCH, premium or discount?" },
];

const $ = (id) => document.getElementById(id);

let timeframe = "15m";
let chartImage = null;
let stream = null;
let watchTimer = null;
let busy = false;
let history = [];

/* ---------- chat threads (new chat + history) ---------- */

const STORE_KEY = "jenvu_threads_v1";
const SNAPSHOT_KEY = "jenvu_market_snapshot_v1";

const store = {
  get() {
    return new Promise((resolve) => {
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          chrome.storage.local.get(STORE_KEY, (r) => resolve(r[STORE_KEY] || { threads: [], activeId: null }));
        } else {
          resolve(JSON.parse(localStorage.getItem(STORE_KEY) || "null") || { threads: [], activeId: null });
        }
      } catch { resolve({ threads: [], activeId: null }); }
    });
  },
  set(data) {
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.set({ [STORE_KEY]: data });
      } else {
        localStorage.setItem(STORE_KEY, JSON.stringify(data));
      }
    } catch { /* quota — ignore */ }
  },
};

let threads = [];       // [{ id, title, updatedAt, messages: [{cls, text}] }]
let activeId = null;

function persist() {
  store.set({ threads, activeId });
}

function activeThread() {
  return threads.find((t) => t.id === activeId) || null;
}

function newChat() {
  activeId = null;
  history = [];
  chartImage = null;
  $("file").value = "";
  $("attached").classList.add("hidden");
  emptyState();
  updateQuickVisibility();
  $("historyPanel").classList.add("hidden");
  box.focus();
}

function loadThread(id) {
  const t = threads.find((x) => x.id === id);
  if (!t) return;
  activeId = id;
  history = t.messages.map((m) => ({ role: m.cls === "user" ? "user" : "assistant", text: m.text }));
  const el = $("thread");
  el.innerHTML = "";
  if (!t.messages.length) emptyState();
  t.messages.forEach((m) => addMsg(m.cls, m.text));
  updateQuickVisibility();
  $("historyPanel").classList.add("hidden");
  persist();
}

function saveMessage(cls, text) {
  if (cls === "err") return;
  let t = activeThread();
  if (!t) {
    t = { id: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title: "", updatedAt: Date.now(), messages: [] };
    threads.unshift(t);
    activeId = t.id;
  }
  t.messages.push({ cls, text });
  t.updatedAt = Date.now();
  if (!t.title && cls === "user") t.title = text.slice(0, 48) || "Chart analysis";
  threads.sort((a, b) => b.updatedAt - a.updatedAt);
  persist();
}

function deleteThread(id) {
  threads = threads.filter((t) => t.id !== id);
  if (activeId === id) { newChat(); }
  persist();
  renderHistoryList();
}

function renderHistoryList() {
  const c = $("historyList");
  c.innerHTML = "";
  if (!threads.length) {
    c.innerHTML = '<div class="history-empty">No past chats yet.<br>Start a new chat — it will be saved here.</div>';
    return;
  }
  threads.forEach((t) => {
    const row = document.createElement("div");
    row.className = "history-item";
    const title = document.createElement("span");
    title.className = "htitle";
    title.textContent = t.title || "Chat";
    const date = document.createElement("span");
    date.className = "hdate";
    date.textContent = new Date(t.updatedAt).toLocaleDateString("en-US", { day: "numeric", month: "short" });
    const del = document.createElement("button");
    del.className = "hdel";
    del.textContent = "✕";
    del.title = "Delete chat";
    del.onclick = (e) => { e.stopPropagation(); deleteThread(t.id); };
    row.append(title, date, del);
    row.onclick = () => loadThread(t.id);
    c.appendChild(row);
  });
}

$("newchat").onclick = () => newChat();
$("historybtn").onclick = () => {
  const p = $("historyPanel");
  if (p.classList.contains("hidden")) { renderHistoryList(); p.classList.remove("hidden"); }
  else p.classList.add("hidden");
};
$("historyClose").onclick = () => $("historyPanel").classList.add("hidden");


function renderTabs() {
  const c = $("tfs");
  c.innerHTML = "";
  TIMEFRAMES.forEach((tf) => {
    const b = document.createElement("button");
    b.className = "tab" + (tf === timeframe ? " active" : "");
    b.textContent = tf;
    b.onclick = () => {
      timeframe = tf;
      renderTabs();
      loadSnapshot();
    };
    c.appendChild(b);
  });
}

function renderQuick() {
  const c = $("quick");
  c.innerHTML = "";
  QUICKS.forEach((q) => {
    const b = document.createElement("button");
    b.textContent = q.label;
    b.onclick = () => send(q.text);
    c.appendChild(b);
  });
}

function emptyState() {
  const t = $("thread");
  t.classList.add("has-empty");
  t.innerHTML =
    '<div class="empty"><strong>Your ICT/SMC gold analyst is ready.</strong><br>' +
    'Share your chart and I’ll read structure, liquidity, order blocks, FVGs and entries in real time.</div>';
  updateQuickVisibility();
}

function updateQuickVisibility() {
  const hasMessages = !!$("thread").querySelector(".msg");
  const hasContext = !!chartImage || !!stream;
  $("quick").classList.toggle("hidden", hasMessages || hasContext);
}

function scrollThread(force = false) {
  // The real scrolling element is the .content wrapper, not #thread.
  const t = document.querySelector(".content") || $("thread");
  if (!t) return;
  // ChatGPT-style: auto-scroll to latest, but don't yank the user down if
  // they scrolled up to read older messages (unless it's their own message).
  const nearBottom = t.scrollHeight - t.scrollTop - t.clientHeight < 160;
  if (!force && !nearBottom) return;
  const go = () => { t.scrollTop = t.scrollHeight; };
  requestAnimationFrame(() => { go(); setTimeout(go, 60); setTimeout(go, 250); });
}

function addMsg(cls, text, shot) {
  const t = $("thread");
  const ownMessage = cls === "user";
  const d = document.createElement("div");
  d.className = "msg " + cls;
  if (shot) {
    const img = document.createElement("img");
    img.src = shot;
    img.className = "shot";
    img.addEventListener("load", () => scrollThread(true));
    d.appendChild(img);
  }
  const body = document.createElement("div");
  if (cls === "ai") {
    const inline = (s) =>
      s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
        .replace(/`(.+?)`/g, "<code>$1</code>");
    let list = null;
    const closeList = () => { list = null; };
    text.split("\n").forEach((line) => {
      const l = line.trim();
      if (!l) { closeList(); return; }
      const heading = l.match(/^#{1,6}\s*(.+)$/) || l.match(/^\*\*(.+?)\*\*:?$/);
      const num = l.match(/^(\d+)[.)]\s+(.+)$/);
      const bullet = l.match(/^[-*•]\s+(.+)$/);
      if (heading) {
        closeList();
        const h = document.createElement("h4");
        h.innerHTML = inline(heading[1].replace(/\*\*/g, "").replace(/:$/, ""));
        body.appendChild(h);
      } else if (num) {
        if (!list || list.tagName !== "OL") {
          list = document.createElement("ol");
          list.className = "md-list";
          body.appendChild(list);
        }
        const li = document.createElement("li");
        li.innerHTML = inline(num[2]);
        list.appendChild(li);
      } else if (bullet) {
        if (!list || list.tagName !== "UL") {
          list = document.createElement("ul");
          list.className = "md-list";
          body.appendChild(list);
        }
        const li = document.createElement("li");
        li.innerHTML = inline(bullet[1]);
        list.appendChild(li);
      } else {
        closeList();
        const p = document.createElement("p");
        p.className = "md-p";
        p.innerHTML = inline(l);
        body.appendChild(p);
      }
    });
  } else {
    body.textContent = text;
  }

  d.appendChild(body);
  if (t.querySelector(".empty")) {
    t.innerHTML = "";
    t.classList.remove("has-empty");
  }
  t.appendChild(d);
  updateQuickVisibility();
  scrollThread(ownMessage);
  return d;
}

async function post(body) {
  let lastErr;
  for (const url of [API, ...ENDPOINTS.filter((u) => u !== API)]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          const error = new Error(json.error || `Request failed (${res.status})`);
          error.retryable = res.status === 429 || res.status >= 500;
          throw error;
        }
        API = url;
        return json;
      } catch (e) {
        lastErr = e;
        if (!e.retryable || attempt === 1) break;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
  }
  throw lastErr || new Error("Network error");
}

/* ---------- price chart ---------- */

let lastMarks = [];
let lastBias = null;

function drawChart(points, marks, bias) {
  if (Array.isArray(marks)) lastMarks = marks;
  if (bias !== undefined) lastBias = bias;
  const canvas = $("chart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const cleanPoints = Array.isArray(points)
    ? points.filter((point) => Number.isFinite(Number(point?.c)))
    : [];
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(260, Math.round(rect.width || 300));
  const cssHeight = 132;
  const scale = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const pixelWidth = Math.round(cssWidth * scale);
  const pixelHeight = Math.round(cssHeight * scale);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  if (cleanPoints.length < 2) {
    ctx.fillStyle = "#5f6368";
    ctx.font = '11px "Google Sans", system-ui, sans-serif';
    ctx.textAlign = "center";
    ctx.fillText("Loading chart…", cssWidth / 2, cssHeight / 2);
    return;
  }
  const labelGutter = 52;
  const W = cssWidth;
  const H = cssHeight;
  const plotW = Math.max(120, W - labelGutter);
  const pad = 10;
  const vals = cleanPoints.map((p) => Number(p.c));
  const marksList = Array.isArray(lastMarks) ? lastMarks : [];
  const markLevels = [];
  for (const m of marksList) {
    if (m.kind === "zone") markLevels.push(Number(m.from), Number(m.to));
    else markLevels.push(Number(m.level));
  }
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  const priceSpan = max - min || 1;
  for (const level of markLevels) {
    // only stretch the scale for markings that sit close to the visible range
    if (!Number.isFinite(level)) continue;
    if (level > max && level - max < priceSpan * 0.6) max = level;
    if (level < min && min - level < priceSpan * 0.6) min = level;
  }
  if (max === min) {
    max += 1;
    min -= 1;
  }
  const span = max - min;
  const x = (i) => (i / (cleanPoints.length - 1)) * plotW;
  const y = (v) => pad + (1 - (v - min) / span) * (H - pad * 2);
  const inView = (v) => Number.isFinite(v) && v >= min && v <= max;
  const xForBarsAgo = (barsAgo) => {
    const idx = cleanPoints.length - 1 - Math.max(0, Number(barsAgo) || 0);
    return x(Math.max(0, Math.min(cleanPoints.length - 1, idx)));
  };

  const up = vals[vals.length - 1] >= vals[0];
  const stroke = up ? "#c9a227" : "#c0553f";
  const lastY = y(vals[vals.length - 1]);
  const BUY = "#1a8754";
  const SELL = "#c0553f";
  const NEUTRAL = "#8a8f98";
  const toneColor = (tone) => (tone === "buy" ? BUY : tone === "sell" ? SELL : NEUTRAL);

  ctx.strokeStyle = "rgba(0, 0, 0, 0.07)";
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(0, H / 2);
  ctx.lineTo(plotW, H / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // ---- AI markings: zones behind the price line ----
  ctx.font = '9px "Google Sans", system-ui, sans-serif';
  for (const m of marksList) {
    if (m.kind !== "zone") continue;
    const top = y(Math.max(Number(m.from), Number(m.to)));
    const bottom = y(Math.min(Number(m.from), Number(m.to)));
    if (!Number.isFinite(top) || !Number.isFinite(bottom)) continue;
    const h = Math.max(3, bottom - top);
    ctx.fillStyle = m.tone === "buy" ? "rgba(26, 135, 84, 0.14)" : "rgba(192, 85, 63, 0.14)";
    ctx.fillRect(0, top, plotW, h);
    ctx.fillStyle = toneColor(m.tone);
    ctx.textAlign = "left";
    ctx.fillText(m.label, 3, Math.min(H - 3, top + Math.max(9, h / 2 + 3)));
  }

  const trace = new Path2D();
  cleanPoints.forEach((p, i) => {
    const px = x(i);
    const py = y(Number(p.c));
    if (i === 0) trace.moveTo(px, py);
    else trace.lineTo(px, py);
  });
  const area = new Path2D();
  area.addPath(trace);
  area.lineTo(plotW, H);
  area.lineTo(0, H);
  area.closePath();
  const fill = ctx.createLinearGradient(0, 0, 0, H);
  fill.addColorStop(0, up ? "rgba(201, 162, 39, 0.28)" : "rgba(192, 85, 63, 0.28)");
  fill.addColorStop(1, up ? "rgba(201, 162, 39, 0)" : "rgba(192, 85, 63, 0)");
  ctx.fillStyle = fill;
  ctx.fill(area);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke(trace);
  ctx.fillStyle = stroke;
  ctx.beginPath();
  ctx.arc(plotW - 2.6, lastY, 2.6, 0, Math.PI * 2);
  ctx.fill();

  // ---- AI markings: liquidity lines, BOS / CHoCH, sweeps ----
  const usedRows = [];
  const placeLabel = (py) => {
    let row = py;
    while (usedRows.some((r) => Math.abs(r - row) < 10)) row += 10;
    if (row > H - 3) row = py;
    usedRows.push(row);
    return row;
  };

  for (const m of marksList) {
    if (m.kind === "line") {
      const level = Number(m.level);
      if (!inView(level)) continue;
      const py = y(level);
      ctx.strokeStyle = toneColor(m.tone);
      ctx.globalAlpha = 0.55;
      ctx.setLineDash(m.label === "EQ" ? [2, 4] : [5, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(plotW, py);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.fillStyle = toneColor(m.tone);
      ctx.textAlign = "left";
      ctx.fillText(m.label, plotW + 4, placeLabel(py + 3));
    }
    if (m.kind === "event") {
      const level = Number(m.level);
      if (!inView(level)) continue;
      const py = y(level);
      const px = xForBarsAgo(m.barsAgo);
      const color = m.dir === "up" ? BUY : SELL;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(plotW, py);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = "left";
      ctx.fillText(`${m.label}${m.dir === "up" ? "↑" : "↓"}`, plotW + 4, placeLabel(py + 3));
    }
    if (m.kind === "sweep") {
      const level = Number(m.level);
      if (!inView(level)) continue;
      const py = y(level);
      const px = xForBarsAgo(m.barsAgo);
      ctx.fillStyle = toneColor(m.tone);
      ctx.beginPath();
      ctx.moveTo(px, py - 4);
      ctx.lineTo(px + 3.5, py + 3);
      ctx.lineTo(px - 3.5, py + 3);
      ctx.closePath();
      ctx.fill();
      ctx.textAlign = "left";
      ctx.fillText("SWEEP", plotW + 4, placeLabel(py + 3));
    }
  }

  // ---- direction badge ----
  if (lastBias && /bull|bear/i.test(String(lastBias))) {
    const bull = /bull/i.test(String(lastBias));
    ctx.fillStyle = bull ? BUY : SELL;
    ctx.font = '10px "Google Sans", system-ui, sans-serif';
    ctx.textAlign = "right";
    ctx.fillText(bull ? "AI ▲ BULLISH" : "AI ▼ BEARISH", plotW - 6, 12);
  }
}


let lastPrice = null;

function renderSnapshot(d) {
  const price = Number(d?.ticker?.price);
  const changePercent = Number(d?.ticker?.changePercent);
  if (!Number.isFinite(price) || !Array.isArray(d?.chart) || d.chart.length < 2) {
    throw new Error("Invalid live graph data");
  }
  const el = $("price");
  el.textContent = price.toFixed(2);
  if (lastPrice !== null && price !== lastPrice) {
    el.classList.remove("tick-up", "tick-down");
    void el.offsetWidth;
    el.classList.add(price > lastPrice ? "tick-up" : "tick-down");
  }
  lastPrice = price;
  const safeChange = Number.isFinite(changePercent) ? changePercent : 0;
  const up = safeChange >= 0;
  const ch = $("change");
  ch.textContent = `${up ? "▲" : "▼"} ${safeChange.toFixed(2)}%`;
  ch.className = "hchange " + (up ? "bull" : "bear");
  const trend = $("trend");
  const bias = String(d.technicals?.trend || d.indicators?.trend || (up ? "Bullish" : "Bearish"));
  trend.textContent = bias.toUpperCase();
  trend.className = "trend " + (/bull|up/i.test(bias) ? "bull" : /bear|down/i.test(bias) ? "bear" : "");
  drawChart(d.chart);
  renderPrediction(d.nextCandle);
}

function renderPrediction(p) {
  const card = document.getElementById("predict");
  if (!card) return;
  if (!p || !p.direction) {
    card.classList.add("hidden");
    return;
  }
  card.classList.remove("hidden");
  const green = p.direction === "green";
  card.className = "predict " + (green ? "up" : "down");
  document.getElementById("pdir").textContent = green ? "GREEN" : "RED";
  document.getElementById("pprob").textContent = `${Math.round(p.probability)}%`;
  document.getElementById("pmeta").textContent =
    `${p.confidence} confidence · ${green ? p.bullishFactors : p.bearishFactors}/${p.totalFactors} factors agree · model accuracy ${Math.round(p.hitRate)}%`;
  document.getElementById("pdrivers").textContent = (p.topDrivers || [])
    .slice(0, 3)
    .map((d) => d.name)
    .join(" · ");
  document.getElementById("ptarget").textContent =
    `Projected close ≈ $${p.projectedClose} (±$${p.expectedMove})`;
  const bar = document.getElementById("pbar");
  if (bar) bar.style.width = `${Math.max(0, Math.min(100, p.probability))}%`;
}

async function loadSnapshot() {
  try {
    const d = await post({ action: "snapshot", timeframe });
    renderSnapshot(d);
    try { chrome.storage?.local?.set({ [SNAPSHOT_KEY]: { ...d, timeframe } }); } catch { /* cache is optional */ }
  } catch (e) {
    console.warn("market pulse failed", e);
    const trend = $("trend");
    if (lastPrice === null) {
      drawChart([]);
      trend.textContent = "RECONNECTING";
      trend.className = "trend";
    }
  }
}

/* ---------- screen sharing ---------- */

function grabFrame() {
  if (!stream) return null;
  const v = $("vid");
  if (!v.videoWidth) return null;
  const cv = $("cv");
  const w = Math.min(1280, v.videoWidth);
  cv.width = w;
  cv.height = Math.round((v.videoHeight / v.videoWidth) * w);
  cv.getContext("2d").drawImage(v, 0, 0, cv.width, cv.height);
  return cv.toDataURL("image/jpeg", 0.7);
}

let thumbTimer = null;

function hideShareCard() {
  $("sharecard").classList.add("hidden");
  if (thumbTimer) clearInterval(thumbTimer);
  thumbTimer = null;
}

function refreshThumb() {
  // Thumbnail always shows the shared website's logo (favicon), never the screen frame.
}

function setSiteLogo(tab) {
  const img = $("shthumb");
  let src = tab && tab.favIconUrl ? tab.favIconUrl : "";
  if (!src && tab && tab.url) {
    try {
      src = "https://www.google.com/s2/favicons?sz=64&domain=" + new URL(tab.url).hostname;
    } catch (e) {}
  }
  img.src = src || "jenvu-logo.png";
  img.onerror = () => { img.onerror = null; img.src = "jenvu-logo.png"; };
}

async function showShareCard() {
  $("sharecard").classList.remove("hidden");
  $("shtitle").textContent = "Shared screen";
  $("shurl").textContent = "Live screen share";
  setSiteLogo(null);
  try {
    if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.query) {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const t = tabs && tabs[0];
      if (t) {
        if (t.title) $("shtitle").textContent = t.title;
        if (t.url) {
          try { $("shurl").textContent = new URL(t.url).hostname + new URL(t.url).pathname; }
          catch (e) { $("shurl").textContent = t.url; }
        }
        setSiteLogo(t);
      }
    }
  } catch (e) {}
}

function stopShare() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = null;
  $("watch").checked = false;
  $("watchwrap").classList.add("hidden");
  $("share").textContent = "Share screen";
  $("share").classList.remove("on");
  $("shstate").className = "screen-state off";
  $("shstate").title = "Screen off";
  hideShareCard();
  updateQuickVisibility();
}

$("share").onclick = async () => {
  if (stream) return stopShare();
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 1 },
      audio: false,
    });
    $("vid").srcObject = stream;
    stream.getVideoTracks()[0].addEventListener("ended", stopShare);
    $("share").textContent = "Stop sharing";
    $("share").classList.add("on");
    $("shstate").className = "screen-state live";
    $("shstate").title = "Screen live";
    $("watchwrap").classList.remove("hidden");
    showShareCard();
    updateQuickVisibility();
  } catch (e) {
    $("shstate").className = "screen-state off";
    $("shstate").title = "Screen share cancelled";
    stream = null;
    updateQuickVisibility();
  }
};

$("shstop").onclick = () => stopShare();

$("watch").onchange = (e) => {
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = null;
  if (e.target.checked && stream) {
    watchTimer = setInterval(() => {
      if (!busy) send("What changed on the screen now? Give a short update — structure, level, action.", true);
    }, 45000);
  }
};

/* ---------- chat ---------- */

$("attach").onclick = () => $("file").click();
$("file").onchange = (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    chartImage = String(r.result);
    $("attached").classList.remove("hidden");
    updateQuickVisibility();
  };
  r.readAsDataURL(f);
};
$("clear").onclick = () => {
  chartImage = null;
  $("file").value = "";
  $("attached").classList.add("hidden");
  updateQuickVisibility();
};

const box = $("q");
box.addEventListener("input", () => {
  box.style.height = "auto";
  box.style.height = Math.min(box.scrollHeight, 110) + "px";
});
box.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
$("send").onclick = () => send();

async function send(preset, silentUser) {
  if (busy) return;
  const text = (preset ?? box.value).trim();
  if (!text && !chartImage && !stream) return;
  busy = true;
  $("send").disabled = true;
  if (!preset) {
    box.value = "";
    box.style.height = "auto";
  }

  let shot = grabFrame();
  if (!shot && stream) {
    for (let i = 0; i < 12 && !shot; i++) {
      await new Promise((r) => setTimeout(r, 250));
      shot = grabFrame();
    }
  }
  if (!shot && stream) {
    busy = false;
    $("send").disabled = false;
    addMsg("ai err", "Screen frame nahi mil paaya. Share dobara start karein (stop ✕ dabayein, phir Share screen).");
    return;
  }
  if (!silentUser) { addMsg("user", text, chartImage || undefined); saveMessage("user", text); }

  const pend = addMsg("ai", "");
  pend.textContent = "Thinking...";

  try {
    const d = await post({
      action: "chat",
      timeframe,
      question: text,
      history: history.slice(-8),
      screenImage: shot || undefined,
      chartImage: chartImage || undefined,
    });
    pend.remove();
    addMsg("ai", d.text);
    saveMessage("ai", d.text);
    history.push({ role: "user", text }, { role: "assistant", text: d.text });
    if (d.ticker) {
      $("price").textContent = d.ticker.price.toFixed(2);
    }
  } catch (e) {
    pend.remove();
    addMsg("ai err", e.message);
  } finally {
    busy = false;
    $("send").disabled = false;
  }
}

renderTabs();
renderQuick();
emptyState();
try {
  chrome.storage?.local?.get(SNAPSHOT_KEY, (saved) => {
    const snapshot = saved?.[SNAPSHOT_KEY];
    if (snapshot?.timeframe === timeframe) {
      try { renderSnapshot(snapshot); } catch { /* wait for live data */ }
    }
  });
} catch { /* extension storage is unavailable in web preview */ }
loadSnapshot();
setInterval(loadSnapshot, 5000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadSnapshot(); });

// Restore last active chat (or start fresh)
store.get().then((data) => {
  threads = data.threads || [];
  activeId = data.activeId || null;
  const t = activeThread();
  if (t && t.messages.length) {
    const el = $("thread");
    el.innerHTML = "";
    t.messages.forEach((m) => addMsg(m.cls, m.text));
    history = t.messages.map((m) => ({ role: m.cls === "user" ? "user" : "assistant", text: m.text }));
  }
  box.focus();
});
