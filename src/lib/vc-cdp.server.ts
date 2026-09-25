// Server-only: a tiny Chrome DevTools Protocol client.
//
// Remote uses this to drive the throwaway cloud browser with her own hands —
// one short burst of commands per invocation, then the socket closes. There
// is no long-lived connection anywhere.
type Pending = (msg: any) => void;

export type Cdp = {
  send: (method: string, params?: Record<string, unknown>) => Promise<any>;
  close: () => void;
};

/** Open a socket to one page. Works on the Worker runtime and in dev. */
export async function openCdp(pageWsUrl: string): Promise<Cdp> {
  const socket = await connect(pageWsUrl);
  let nextId = 0;
  const pending = new Map<number, Pending>();

  socket.addEventListener("message", (event: any) => {
    try {
      const msg = JSON.parse(typeof event.data === "string" ? event.data : "");
      if (msg?.id && pending.has(msg.id)) {
        pending.get(msg.id)!(msg);
        pending.delete(msg.id);
      }
    } catch {
      /* protocol noise */
    }
  });

  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<any>((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
      }, 20_000);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(`CDP ${method}: ${msg.error.message ?? "failed"}`));
        else resolve(msg.result ?? {});
      });
      try {
        socket.send(JSON.stringify({ id, method, params }));
      } catch (e) {
        clearTimeout(timer);
        pending.delete(id);
        reject(e as Error);
      }
    });

  return {
    send,
    close: () => {
      try {
        socket.close();
      } catch {
        /* already gone */
      }
    },
  };
}

async function connect(url: string): Promise<any> {
  // Cloudflare Workers: outbound sockets come from a fetch upgrade.
  try {
    const res = await fetch(url.replace(/^ws/, "http"), { headers: { Upgrade: "websocket" } });
    const ws = (res as any).webSocket;
    if (ws) {
      ws.accept();
      return ws;
    }
  } catch {
    /* fall through to the standard constructor */
  }
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("browser socket timed out")), 15_000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("couldn't open the browser socket"));
    });
  });
  return ws;
}

/** Find (or open) a page in the browser and return its socket address. */
export async function findPageSocket(cdpUrl: string): Promise<string | null> {
  const base = cdpUrl.replace(/\/$/, "");
  const read = async (): Promise<any[]> => {
    const res = await fetch(`${base}/json/list`);
    if (!res.ok) return [];
    const list = await res.json().catch(() => []);
    return Array.isArray(list) ? list : [];
  };
  let pages = (await read()).filter((t) => t?.type === "page" && t?.webSocketDebuggerUrl);
  if (!pages.length) {
    await fetch(`${base}/json/new?about:blank`, { method: "PUT" }).catch(() => null);
    pages = (await read()).filter((t) => t?.type === "page" && t?.webSocketDebuggerUrl);
  }
  // Prefer a page that already has a real url loaded.
  const best = pages.find((p) => p.url && p.url !== "about:blank") ?? pages[0];
  return best?.webSocketDebuggerUrl ? String(best.webSocketDebuggerUrl) : null;
}

/**
 * What the page looks like, as plain text: the interactive parts with their
 * positions, plus a short digest of what it says. No screenshots, so no
 * vision-model cost and nothing slow.
 */
export const HARVEST_JS = `(() => {
  const out = [];
  const sel = 'a,button,input,textarea,select,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=option],[onclick],[contenteditable=true]';
  let i = 0;
  for (const el of document.querySelectorAll(sel)) {
    if (i >= 90) break;
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) continue;
    if (r.bottom < -80 || r.top > innerHeight + 900) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
    if (el.disabled) continue;
    const type = (el.type || '').toLowerCase();
    const isSecret = type === 'password';
    const tick = type === 'radio' || type === 'checkbox';
    const own = el.labels && el.labels[0] ? (el.labels[0].innerText || '').trim() : '';
    const valAttr = (tick || type === 'submit' || type === 'button') ? (el.value || '') : '';
    const group = el.getAttribute ? (el.getAttribute('name') || '') : '';
    const raw = own || el.getAttribute('aria-label') || el.placeholder || valAttr || group || (el.innerText || '').trim() || el.title || el.alt || '';
    let label = String(raw).replace(/\\s+/g, ' ').trim().slice(0, 70);
    if (tick && group && label.toLowerCase() !== group.toLowerCase()) label = label + ' [' + group + ']';
    const checked = tick ? Boolean(el.checked) : false;
    const filled = tick
      ? checked
      : el.tagName === 'SELECT'
        ? Boolean(el.value)
        : (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? Boolean(el.value) : false;
    out.push({
      i: i++,
      tag: el.tagName.toLowerCase(),
      type: type || null,
      secret: isSecret,
      label,
      href: el.getAttribute && el.getAttribute('href') ? String(el.getAttribute('href')).slice(0, 100) : null,
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
      onScreen: r.top >= 0 && r.top < innerHeight,
      filled,
      checked
    });
  }
  return JSON.stringify({
    url: location.href,
    title: document.title,
    scrollY: Math.round(scrollY),
    scrollRoom: Math.max(0, Math.round(document.documentElement.scrollHeight - innerHeight - scrollY)),
    text: (document.body ? document.body.innerText || '' : '').replace(/\\s+/g, ' ').slice(0, 2600),
    els: out
  });
})()`;

export type PageEl = {
  i: number;
  tag: string;
  type: string | null;
  secret: boolean;
  label: string;
  href: string | null;
  x: number;
  y: number;
  onScreen: boolean;
  filled: boolean;
  checked: boolean;
};

export type PageView = {
  url: string;
  title: string;
  scrollY: number;
  scrollRoom: number;
  text: string;
  els: PageEl[];
};

export async function harvest(cdp: Cdp): Promise<PageView> {
  const res = await cdp.send("Runtime.evaluate", { expression: HARVEST_JS, returnByValue: true });
  const value = res?.result?.value;
  if (typeof value !== "string") throw new Error("couldn't read the page");
  return JSON.parse(value) as PageView;
}

export async function clickAt(cdp: Cdp, x: number, y: number) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

/** Focus a field, clear it, and type. Values are never echoed anywhere. */
export async function typeInto(cdp: Cdp, el: PageEl, value: string) {
  await clickAt(cdp, el.x, el.y);
  await cdp.send("Runtime.evaluate", {
    expression:
      "(() => { const a = document.activeElement; if (a && ('value' in a)) { a.value = ''; a.dispatchEvent(new Event('input', {bubbles:true})); } })()",
  });
  await cdp.send("Input.insertText", { text: value });
  await cdp.send("Runtime.evaluate", {
    expression:
      "(() => { const a = document.activeElement; if (a) { a.dispatchEvent(new Event('input', {bubbles:true})); a.dispatchEvent(new Event('change', {bubbles:true})); } })()",
  });
}

export async function pressEnter(cdp: Cdp) {
  for (const type of ["keyDown", "keyUp"] as const) {
    await cdp.send("Input.dispatchKeyEvent", {
      type,
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      ...(type === "keyDown" ? { text: "\r" } : {}),
    });
  }
}

export async function scrollBy(cdp: Cdp, dy: number) {
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: 400,
    y: 400,
    deltaX: 0,
    deltaY: dy,
  });
}

export async function navigate(cdp: Cdp, url: string) {
  await cdp.send("Page.navigate", { url });
}

export async function goBack(cdp: Cdp) {
  await cdp.send("Runtime.evaluate", { expression: "history.back()" });
}

export const settle = (ms = 1100) => new Promise<void>((r) => setTimeout(r, ms));
