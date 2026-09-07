const ENDPOINTS =
  location.protocol === "chrome-extension:"
    ? [
        "https://project--9fc0698e-7373-4bdf-b90d-fe4ff903454b.lovable.app/api/public/gold",
        "https://project--9fc0698e-7373-4bdf-b90d-fe4ff903454b-dev.lovable.app/api/public/gold",
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

let timeframe = "1h";
let chartImage = null;
let stream = null;
let watchTimer = null;
let busy = false;
const history = [];

const $ = (id) => document.getElementById(id);

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
  t.innerHTML =
    '<div class="empty"><strong>Your ICT/SMC gold analyst is ready.</strong><br>' +
    'Share your chart and I’ll read structure, liquidity, order blocks, FVGs, entries and targets in real time.</div>';
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
    text.split("\n").forEach((line) => {
      const l = line.trim();
      if (!l) return;
      if (l.startsWith("#")) {
        const h = document.createElement("h4");
        h.textContent = l.replace(/^#+\s*/, "").replace(/\*\*/g, "");
        body.appendChild(h);
      } else {
        const p = document.createElement("div");
        p.textContent = l.replace(/\*\*/g, "").replace(/^[-*•]\s*/, "— ");
        body.appendChild(p);
      }
    });
  } else {
    body.textContent = text;
  }
  d.appendChild(body);
  if (t.querySelector(".empty")) t.innerHTML = "";
  t.appendChild(d);
  t.scrollTop = t.scrollHeight;
  return d;
}

async function post(body) {
  let lastErr;
  for (const url of [API, ...ENDPOINTS.filter((u) => u !== API)]) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      API = url;
      return json;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Network error");
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
    const t = new Date();
    $("updated").textContent = `Live · updated ${t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
    $("dot").className = "dot live";
  } catch (e) {
    $("updated").textContent = `Reconnecting… (${e.message})`;
    $("dot").className = "dot off";
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

function stopShare() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = null;
  $("watch").checked = false;
  $("watchwrap").classList.add("hidden");
  $("share").textContent = "Share screen";
  $("share").classList.remove("on");
  $("shstate").textContent = "Screen off";
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
    $("shstate").textContent = "Screen live";
    $("watchwrap").classList.remove("hidden");
  } catch (e) {
    $("shstate").textContent = "Screen share cancel ho gaya";
    stream = null;
  }
};

$("watch").onchange = (e) => {
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = null;
  if (e.target.checked && stream) {
    watchTimer = setInterval(() => {
      if (!busy) send("Screen par ab kya change hua? Short update do — structure, level, action.", true);
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
  };
  r.readAsDataURL(f);
};
$("clear").onclick = () => {
  chartImage = null;
  $("file").value = "";
  $("attached").classList.add("hidden");
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

  const shot = grabFrame();
  if (!silentUser) addMsg("user", text, shot || chartImage || undefined);

  const pend = addMsg("ai", "");
  pend.classList.add("typing");
  pend.textContent = "Soch raha hoon…";

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
