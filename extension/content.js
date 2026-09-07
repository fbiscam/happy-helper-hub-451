/* Jenvu floating panel — draggable + resizable window injected into any page. */
(() => {
  if (window.__jenvuFloatInit) return;
  window.__jenvuFloatInit = true;

  const ID = "jenvu-float-root";
  let root = null;
  let shield = null;

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  function savePos() {
    if (!root) return;
    const r = root.getBoundingClientRect();
    try {
      chrome.storage.local.set({
        jenvuFloat: { left: r.left, top: r.top, width: r.width, height: r.height },
      });
    } catch {}
  }

  function makeShield(on) {
    if (on) {
      if (shield) return;
      shield = document.createElement("div");
      shield.style.cssText =
        "position:fixed;inset:0;z-index:2147483646;cursor:grabbing;background:transparent";
      document.documentElement.appendChild(shield);
    } else if (shield) {
      shield.remove();
      shield = null;
    }
  }

  function build(saved) {
    root = document.createElement("div");
    root.id = ID;
    const w = clamp(saved?.width || 400, 320, window.innerWidth - 20);
    const h = clamp(saved?.height || 620, 320, window.innerHeight - 20);
    const left = clamp(saved?.left ?? window.innerWidth - w - 24, 0, Math.max(0, window.innerWidth - w));
    const top = clamp(saved?.top ?? 24, 0, Math.max(0, window.innerHeight - h));
    root.style.cssText = `position:fixed;left:${left}px;top:${top}px;width:${w}px;height:${h}px;z-index:2147483647;background:#fff;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.28);overflow:hidden;display:flex;flex-direction:column;font-family:"Google Sans",system-ui,sans-serif`;

    const bar = document.createElement("div");
    bar.style.cssText =
      "height:32px;flex:0 0 32px;display:flex;align-items:center;justify-content:space-between;padding:0 8px 0 12px;cursor:grab;background:#fafafa;border-bottom:1px solid rgba(0,0,0,.07);user-select:none";
    const label = document.createElement("span");
    label.textContent = "Jenvu";
    label.style.cssText = "font-size:12px;font-weight:600;color:#2a2a2a;letter-spacing:.02em";
    const close = document.createElement("button");
    close.textContent = "\u2715";
    close.title = "Close";
    close.style.cssText =
      "border:0;background:transparent;font-size:13px;line-height:1;color:#666;cursor:pointer;padding:4px 6px;border-radius:6px";
    close.onclick = () => hide();
    bar.append(label, close);

    const frame = document.createElement("iframe");
    frame.src = chrome.runtime.getURL("sidepanel.html");
    frame.allow = "display-capture; camera; microphone";
    frame.style.cssText = "flex:1;width:100%;border:0;background:#fff";

    const grip = document.createElement("div");
    grip.style.cssText =
      "position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,rgba(0,0,0,.22) 50%)";

    root.append(bar, frame, grip);
    document.documentElement.appendChild(root);

    // drag
    bar.addEventListener("mousedown", (e) => {
      if (e.target === close) return;
      e.preventDefault();
      const sx = e.clientX;
      const sy = e.clientY;
      const r = root.getBoundingClientRect();
      makeShield(true);
      bar.style.cursor = "grabbing";
      const move = (ev) => {
        root.style.left = clamp(r.left + ev.clientX - sx, 0, window.innerWidth - r.width) + "px";
        root.style.top = clamp(r.top + ev.clientY - sy, 0, window.innerHeight - r.height) + "px";
      };
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        makeShield(false);
        bar.style.cursor = "grab";
        savePos();
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });

    // resize
    grip.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const sx = e.clientX;
      const sy = e.clientY;
      const r = root.getBoundingClientRect();
      makeShield(true);
      const move = (ev) => {
        root.style.width = clamp(r.width + ev.clientX - sx, 320, window.innerWidth - r.left) + "px";
        root.style.height = clamp(r.height + ev.clientY - sy, 320, window.innerHeight - r.top) + "px";
      };
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        makeShield(false);
        savePos();
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
  }

  function show() {
    if (root) {
      root.style.display = "flex";
      return;
    }
    try {
      chrome.storage.local.get("jenvuFloat", (res) => build(res?.jenvuFloat));
    } catch {
      build(null);
    }
  }

  function hide() {
    if (root) root.style.display = "none";
  }

  function toggle() {
    if (root && root.style.display !== "none") hide();
    else show();
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "jenvu-toggle-float") toggle();
  });
})();
