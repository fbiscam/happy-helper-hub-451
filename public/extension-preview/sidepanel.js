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

function addMsg(cls, text, shot) {
  const t = $("thread");
  const d = document.createElement("div");
  d.className = "msg " + cls;
  if (shot) {
    const img = document.createElement("img");
    img.src = shot;
    img.className = "shot";
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
  t.scrollTop = t.scrollHeight;
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

function drawChart(points) {
  const svg = $("chart");
  if (!svg) return;
  if (!points || points.length < 2) {
    svg.innerHTML = "";
    return;
  }
  const W = 300;
  const H = 96;
  const pad = 6;
  const vals = points.map((p) => p.c);
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (max === min) {
    max += 1;
    min -= 1;
  }
  const span = max - min;
  const x = (i) => (i / (points.length - 1)) * W;
  const y = (v) => pad + (1 - (v - min) / span) * (H - pad * 2);

  let line = "";
  points.forEach((p, i) => {
    line += `${i ? "L" : "M"}${x(i).toFixed(2)} ${y(p.c).toFixed(2)} `;
  });
  const area = `${line}L${W} ${H} L0 ${H} Z`;
  const up = vals[vals.length - 1] >= vals[0];
  const stroke = up ? "#c9a227" : "#c0553f";
  const lastX = W;
  const lastY = y(vals[vals.length - 1]);

  svg.innerHTML = `
    <defs>
      <linearGradient id="chfill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${stroke}" stop-opacity="0.28" />
        <stop offset="100%" stop-color="${stroke}" stop-opacity="0" />
      </linearGradient>
    </defs>
    <line class="chart-grid" x1="0" y1="${(H / 2).toFixed(1)}" x2="${W}" y2="${(H / 2).toFixed(1)}" />
    <path d="${area}" fill="url(#chfill)" />
    <path d="${line.trim()}" fill="none" stroke="${stroke}" stroke-width="1.6"
      stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
    <circle cx="${(lastX - 1.5).toFixed(2)}" cy="${lastY.toFixed(2)}" r="2.6" fill="${stroke}" />
  `;
}

let lastPrice = null;

async function loadSnapshot() {
  try {
    const d = await post({ action: "snapshot", timeframe });
    const p = d.ticker.price;
    const el = $("price");
    el.textContent = p.toFixed(2);
    if (lastPrice !== null && p !== lastPrice) {
      el.classList.remove("tick-up", "tick-down");
      void el.offsetWidth;
      el.classList.add(p > lastPrice ? "tick-up" : "tick-down");
    }
    lastPrice = p;
    const up = d.ticker.changePercent >= 0;
    const ch = $("change");
    ch.textContent = `${up ? "▲" : "▼"} ${d.ticker.changePercent.toFixed(2)}%`;
    ch.className = "hchange " + (up ? "bull" : "bear");
    const trend = $("trend");
    const bias = String(d.technicals?.trend || d.indicators?.trend || (up ? "Bullish" : "Bearish"));
    trend.textContent = bias.toUpperCase();
    trend.className = "trend " + (/bull|up/i.test(bias) ? "bull" : /bear|down/i.test(bias) ? "bear" : "");
    drawChart(d.chart);
  } catch (e) {
    console.warn("market pulse failed", e);
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
