/* Jenvu — draws AI markings (FVG, OB, BOS/CHoCH, liquidity, sweeps, killzones)
   as an overlay layer on top of the TradingView chart in the page.
   Price → pixel mapping is auto-estimated, so levels are approximate;
   the small toolbar lets the user nudge / stretch the layer to fit. */
(() => {
  if (window.__jenvuOverlay) return;

  const state = { marks: [], lo: 0, hi: 0, bias: null, offsetY: 0, scale: 1, rect: null };

  const host = document.createElement("div");
  host.id = "jenvu-overlay-host";
  host.style.cssText = "position:fixed;inset:0;z-index:2147483600;pointer-events:none;";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
  host.appendChild(canvas);

  const bar = document.createElement("div");
  bar.style.cssText =
    "position:absolute;top:12px;right:14px;pointer-events:auto;display:flex;align-items:center;gap:6px;" +
    "background:rgba(20,22,26,.92);color:#fff;border-radius:10px;padding:6px 8px;font:500 11px/1 system-ui,sans-serif;" +
    "box-shadow:0 4px 14px rgba(0,0,0,.35)";
  bar.innerHTML =
    '<span style="opacity:.75">Jenvu markings · approx</span>' +
    '<button data-a="up">▲</button><button data-a="down">▼</button>' +
    '<button data-a="in">＋</button><button data-a="out">－</button>' +
    '<button data-a="close">✕</button>';
  for (const b of bar.querySelectorAll("button")) {
    b.style.cssText =
      "border:0;background:rgba(255,255,255,.12);color:#fff;border-radius:6px;padding:4px 7px;cursor:pointer;font:inherit";
  }
  bar.addEventListener("click", (e) => {
    const a = e.target instanceof HTMLElement ? e.target.dataset.a : null;
    if (!a) return;
    if (a === "up") state.offsetY -= 8;
    if (a === "down") state.offsetY += 8;
    if (a === "in") state.scale *= 1.06;
    if (a === "out") state.scale /= 1.06;
    if (a === "close") { host.remove(); window.__jenvuOverlay = false; return; }
    draw();
  });
  host.appendChild(bar);
  document.documentElement.appendChild(host);
  window.__jenvuOverlay = true;

  /** Best guess at the chart pane: the biggest canvas in the page. */
  function chartRect() {
    let best = null;
    for (const c of document.querySelectorAll("canvas")) {
      const r = c.getBoundingClientRect();
      if (r.width < 240 || r.height < 160) continue;
      if (!best || r.width * r.height > best.width * best.height) best = r;
    }
    if (best) return { x: best.left, y: best.top, w: best.width, h: best.height };
    return { x: 0, y: 0, w: innerWidth, h: innerHeight };
  }

  const KZ = [
    { name: "Asia KZ", from: 0, to: 3 },
    { name: "London KZ", from: 7, to: 10 },
    { name: "New York KZ", from: 12, to: 15 },
  ];

  function draw() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.floor(innerWidth * dpr);
    canvas.height = Math.floor(innerHeight * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    if (!state.marks.length || !(state.hi > state.lo)) return;

    const r = chartRect();
    state.rect = r;
    const padY = r.h * 0.06;
    const top = r.y + padY;
    const height = (r.h - padY * 2) * state.scale;
    const y = (p) => top + state.offsetY + ((state.hi - p) / (state.hi - state.lo)) * height;
    const left = r.x + 8;
    const right = r.x + r.w - 8;
    const tone = (t) => (t === "buy" ? "#0f9d58" : t === "sell" ? "#d93025" : "#8a8f98");

    ctx.font = "600 10px system-ui, sans-serif";
    ctx.textBaseline = "middle";

    const label = (text, x, yy, color) => {
      const w = ctx.measureText(text).width + 10;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.92;
      ctx.fillRect(x, yy - 8, w, 16);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#fff";
      ctx.fillText(text, x + 5, yy + 1);
    };

    for (const m of state.marks) {
      if (m.kind === "zone") {
        const y1 = y(Math.max(m.from, m.to));
        const y2 = y(Math.min(m.from, m.to));
        if (!isFinite(y1) || !isFinite(y2)) continue;
        ctx.fillStyle = tone(m.tone);
        ctx.globalAlpha = 0.14;
        ctx.fillRect(left, y1, right - left, Math.max(2, y2 - y1));
        ctx.globalAlpha = 1;
        ctx.strokeStyle = tone(m.tone);
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1;
        ctx.strokeRect(left, y1, right - left, Math.max(2, y2 - y1));
        ctx.setLineDash([]);
        label(m.label, left + 4, y1 + 9, tone(m.tone));
      } else {
        const yy = y(m.level);
        if (!isFinite(yy)) continue;
        const color = m.kind === "event" ? (m.dir === "up" ? "#0f9d58" : "#d93025") : tone(m.tone);
        ctx.strokeStyle = color;
        ctx.lineWidth = m.kind === "event" ? 1.6 : 1.2;
        ctx.setLineDash(m.kind === "line" ? [6, 4] : []);
        ctx.beginPath();
        ctx.moveTo(left, yy);
        ctx.lineTo(right, yy);
        ctx.stroke();
        ctx.setLineDash([]);
        const text = m.kind === "sweep" ? `${m.label}` : `${m.label} ${m.level}`;
        label(text, right - ctx.measureText(text).width - 14, yy, color);
      }
    }

    // Killzone status chip (session clock, not drawn on the time axis)
    const h = new Date().getUTCHours();
    const active = KZ.find((k) => h >= k.from && h < k.to);
    const chip = active ? `${active.name} · active` : "No killzone active";
    ctx.font = "600 11px system-ui, sans-serif";
    const w = ctx.measureText(chip).width + 16;
    ctx.fillStyle = active ? "#0f9d58" : "rgba(20,22,26,.85)";
    ctx.fillRect(r.x + 12, r.y + 12, w, 22);
    ctx.fillStyle = "#fff";
    ctx.fillText(chip, r.x + 20, r.y + 24);

    if (state.bias) {
      const b = `AI bias: ${String(state.bias).toUpperCase()}`;
      const bw = ctx.measureText(b).width + 16;
      ctx.fillStyle = /bull/i.test(state.bias) ? "#0f9d58" : /bear/i.test(state.bias) ? "#d93025" : "#5f6368";
      ctx.fillRect(r.x + 12, r.y + 40, bw, 22);
      ctx.fillStyle = "#fff";
      ctx.fillText(b, r.x + 20, r.y + 52);
    }
  }

  addEventListener("resize", draw, { passive: true });
  addEventListener("scroll", draw, { passive: true });
  setInterval(draw, 1200);

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (!msg || msg.type !== "JENVU_MARK") return;
    state.marks = Array.isArray(msg.marks) ? msg.marks : [];
    state.lo = Number(msg.lo);
    state.hi = Number(msg.hi);
    state.bias = msg.bias ?? null;
    state.offsetY = 0;
    state.scale = 1;
    draw();
    reply?.({ ok: true, count: state.marks.length });
    return true;
  });

  draw();
})();
