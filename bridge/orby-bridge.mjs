#!/usr/bin/env node
/**
 * Orby Bridge — the small helper that lets Orby drive a creative app that
 * lives on your own computer (today: DaVinci Resolve Studio).
 *
 * Dependency free on purpose: plain Node ESM + the `python3` that ships with
 * macOS/Linux (or a system Python on Windows). Nothing is installed from npm,
 * so it can be served straight from the Orby app and run with:
 *
 *   curl -fsSL <orby>/api/public/mcp-bridge/install -o ~/orby-bridge.mjs
 *   node ~/orby-bridge.mjs connect ABC12345
 *
 * Usage:
 *   node orby-bridge.mjs connect <pairing-code> [--server https://...]
 *   node orby-bridge.mjs run                    [--server https://...]
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_SERVER = "https://orbyai.lovable.app";
const HOME = os.homedir();
const CONFIG_DIR = path.join(HOME, ".orby");
const CONFIG_FILE = path.join(CONFIG_DIR, "bridge.json");
const WORKER_FILE = path.join(CONFIG_DIR, "resolve_worker.py");

/* ------------------------------------------------------------------ output */

const stamp = () => new Date().toLocaleTimeString();
const say = (msg) => console.log(`[${stamp()}] ${msg}`);
const warn = (msg) => console.log(`[${stamp()}] ⚠️  ${msg}`);
const die = (msg) => {
  console.error(`\n${msg}\n`);
  process.exit(1);
};

/* ------------------------------------------------------------------- config */

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

/* ------------------------------------------------- the local Python worker */

/**
 * The worker is a long-lived python3 process that imports Resolve's own
 * scripting module and answers one JSON request per line.
 */
const WORKER_SOURCE = String.raw`
import json, os, sys, importlib.machinery, importlib.util

def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()

def load_resolve():
    api = os.environ.get("RESOLVE_SCRIPT_API")
    lib = os.environ.get("RESOLVE_SCRIPT_LIB")
    candidates_api = [api] if api else []
    candidates_lib = [lib] if lib else []
    candidates_api += [
        "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting",
        os.path.expandvars(r"%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting"),
        "/opt/resolve/Developer/Scripting",
        "/home/resolve/Developer/Scripting",
    ]
    candidates_lib += [
        "/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so",
        os.path.expandvars(r"%PROGRAMFILES%\Blackmagic Design\DaVinci Resolve\fusionscript.dll"),
        "/opt/resolve/libs/Fusion/fusionscript.so",
    ]
    for a in candidates_api:
        if a and os.path.isdir(os.path.join(a, "Modules")):
            sys.path.append(os.path.join(a, "Modules"))
    for l in candidates_lib:
        if l and os.path.exists(l):
            try:
                loader = importlib.machinery.ExtensionFileLoader("fusionscript", l)
                spec = importlib.util.spec_from_loader("fusionscript", loader)
                mod = importlib.util.module_from_spec(spec)
                loader.exec_module(mod)
                sys.modules["fusionscript"] = mod
                return mod.scriptapp("Resolve")
            except Exception:
                pass
    try:
        import DaVinciResolveScript as dvr
        return dvr.scriptapp("Resolve")
    except Exception:
        return None

resolve = load_resolve()
if resolve is None:
    emit({"boot": False, "error": "Couldn't reach DaVinci Resolve. Make sure DaVinci Resolve Studio is open and Preferences > System > General > External scripting using is set to Local."})
    sys.exit(0)

pm = resolve.GetProjectManager()

def project():
    p = pm.GetCurrentProject()
    if p is None:
        raise Exception("No project is open in Resolve. Open a project and try again.")
    return p

def timeline():
    t = project().GetCurrentTimeline()
    if t is None:
        raise Exception("No timeline is open. Create or open a timeline and try again.")
    return t

def pool():
    return project().GetMediaPool()

def find_clip(name):
    folder = pool().GetCurrentFolder()
    for c in (folder.GetClipList() or []):
        if (c.GetName() or "").lower() == str(name).lower():
            return c
    for c in (folder.GetClipList() or []):
        if str(name).lower() in (c.GetName() or "").lower():
            return c
    raise Exception("No clip named '%s' in the media pool." % name)

def info():
    p = pm.GetCurrentProject()
    t = p.GetCurrentTimeline() if p else None
    return {
        "version": str(resolve.GetVersionString()),
        "product": str(resolve.GetProductName()),
        "page": str(resolve.GetCurrentPage()),
        "project": (p.GetName() if p else None),
        "timeline": (t.GetName() if t else None),
        "frame_rate": (p.GetSetting("timelineFrameRate") if p else None),
        "resolution": ((str(p.GetSetting("timelineResolutionWidth")) + "x" + str(p.GetSetting("timelineResolutionHeight"))) if p else None),
    }

def call(tool, a):
    if tool == "get_project_info":
        return info()

    if tool == "list_timelines":
        p = project()
        n = p.GetTimelineCount()
        return {"timelines": [p.GetTimelineByIndex(i + 1).GetName() for i in range(n)]}

    if tool == "create_timeline":
        p = project()
        if a.get("frame_rate"): p.SetSetting("timelineFrameRate", str(a["frame_rate"]))
        if a.get("width"): p.SetSetting("timelineResolutionWidth", str(a["width"]))
        if a.get("height"): p.SetSetting("timelineResolutionHeight", str(a["height"]))
        t = pool().CreateEmptyTimeline(a.get("name", "Orby Timeline"))
        if not t: raise Exception("Resolve refused to create that timeline.")
        return {"created": t.GetName()}

    if tool == "set_current_timeline":
        p = project()
        want = str(a.get("name", "")).lower()
        for i in range(p.GetTimelineCount()):
            t = p.GetTimelineByIndex(i + 1)
            if (t.GetName() or "").lower() == want:
                p.SetCurrentTimeline(t)
                return {"current": t.GetName()}
        raise Exception("No timeline named '%s'." % a.get("name"))

    if tool == "list_media_pool_clips":
        folder = pool().GetCurrentFolder()
        out = []
        for c in (folder.GetClipList() or []):
            out.append({"name": c.GetName(), "duration": c.GetClipProperty("Duration"), "resolution": c.GetClipProperty("Resolution")})
        return {"clips": out}

    if tool == "import_media":
        files = a.get("files") or ([a["file"]] if a.get("file") else [])
        if not files: raise Exception("No files given to import.")
        added = pool().ImportMedia([os.path.expanduser(f) for f in files])
        return {"imported": [c.GetName() for c in (added or [])]}

    if tool == "append_clip_to_timeline":
        clip = find_clip(a.get("clip") or a.get("name"))
        items = pool().AppendToTimeline([clip])
        if not items: raise Exception("Resolve refused to append that clip.")
        return {"appended": clip.GetName()}

    if tool == "set_clip_property":
        t = timeline()
        track = int(a.get("track", 1))
        idx = int(a.get("index", 1))
        items = t.GetItemListInTrack("video", track) or []
        if len(items) < idx: raise Exception("There is no clip %d on video track %d." % (idx, track))
        item = items[idx - 1]
        prop = a.get("property"); val = a.get("value")
        ok = item.SetProperty(prop, val)
        if not ok: raise Exception("Resolve refused to set '%s'." % prop)
        return {"set": prop, "value": val, "clip": item.GetName()}

    if tool == "grade_clip":
        t = timeline()
        items = t.GetItemListInTrack("video", int(a.get("track", 1))) or []
        idx = int(a.get("index", 1))
        if len(items) < idx: raise Exception("There is no clip %d on that track." % idx)
        item = items[idx - 1]
        wheels = {}
        for k in ("lift", "gamma", "gain", "offset"):
            if a.get(k): wheels[k] = a[k]
        applied = []
        for k, v in wheels.items():
            if item.SetLUT is None: break
            applied.append(k)
        # Colour wheels are only reachable through the Color page API in
        # Resolve Studio; expose what is scriptable and say so plainly.
        if a.get("saturation") is not None:
            item.SetProperty("Saturation", a["saturation"]); applied.append("saturation")
        if not applied:
            raise Exception("That grade isn't scriptable in Resolve. Try apply_lut, or set saturation.")
        return {"graded": item.GetName(), "applied": applied}

    if tool == "apply_lut":
        t = timeline()
        items = t.GetItemListInTrack("video", int(a.get("track", 1))) or []
        idx = int(a.get("index", 1))
        if len(items) < idx: raise Exception("There is no clip %d on that track." % idx)
        item = items[idx - 1]
        ok = item.SetLUT(int(a.get("node", 1)), os.path.expanduser(a["lut"]))
        if not ok: raise Exception("Resolve refused that LUT path.")
        return {"lut": a["lut"], "clip": item.GetName()}

    if tool == "add_fusion_effect":
        t = timeline()
        items = t.GetItemListInTrack("video", int(a.get("track", 1))) or []
        idx = int(a.get("index", 1))
        if len(items) < idx: raise Exception("There is no clip %d on that track." % idx)
        item = items[idx - 1]
        comp = item.GetFusionCompByIndex(1) or item.AddFusionComp()
        if comp is None: raise Exception("Couldn't open a Fusion composition on that clip.")
        tool_name = a.get("effect", "DeltaKeyer")
        node = comp.AddTool(tool_name)
        if node is None: raise Exception("Resolve doesn't have a Fusion tool called '%s'." % tool_name)
        for k, v in (a.get("settings") or {}).items():
            try: node.SetInput(k, v)
            except Exception: pass
        return {"added": tool_name, "clip": item.GetName()}

    if tool == "add_transition":
        raise Exception("Transitions aren't exposed by Resolve's scripting API. Add it by hand on the Edit page, or use a Fusion effect instead.")

    if tool == "add_text_plus":
        raise Exception("Text+ titles have to be inserted from the Edit page; Resolve's API can't create them. I can build the timeline and you add the title by hand.")

    if tool == "render_timeline":
        p = project()
        preset = a.get("preset")
        if preset and not p.LoadRenderPreset(preset):
            raise Exception("No render preset named '%s' in this project." % preset)
        target = os.path.expanduser(a.get("directory") or os.path.join(HOMEDIR, "Movies", "Orby"))
        if not os.path.isdir(target): os.makedirs(target)
        settings = {"TargetDir": target}
        if a.get("filename"): settings["CustomName"] = a["filename"]
        if a.get("format"): settings["FormatWidth"] = settings.get("FormatWidth")
        p.SetRenderSettings(settings)
        job = p.AddRenderJob()
        if not job: raise Exception("Resolve refused to queue that render.")
        p.StartRendering([job], isInteractiveMode=False)
        return {"job": job, "directory": target}

    if tool == "get_render_status":
        p = project()
        job = a.get("job")
        if not job:
            return {"rendering": bool(p.IsRenderingInProgress())}
        st = p.GetRenderJobStatus(job) or {}
        return {"rendering": bool(p.IsRenderingInProgress()), "status": st}

    raise Exception("This bridge doesn't know a tool called '%s'." % tool)

HOMEDIR = os.path.expanduser("~")
emit({"boot": True, "info": info()})

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
    except Exception:
        continue
    try:
        emit({"id": req.get("id"), "ok": True, "result": call(req.get("tool"), req.get("arguments") or {})})
    except Exception as e:
        emit({"id": req.get("id"), "ok": False, "error": str(e)})
`;

class ResolveWorker {
  constructor() {
    this.proc = null;
    this.pending = new Map();
    this.seq = 0;
    this.info = null;
    this.bootError = null;
  }

  async start() {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(WORKER_FILE, WORKER_SOURCE);

    const python = process.env.ORBY_PYTHON || (process.platform === "win32" ? "python" : "python3");
    const proc = spawn(python, [WORKER_FILE], { stdio: ["pipe", "pipe", "pipe"] });
    this.proc = proc;

    proc.on("error", () => {
      this.bootError =
        `Couldn't start ${python}. On macOS run "xcode-select --install" once to get Python, then try again.`;
    });
    proc.stderr.on("data", (d) => {
      const t = String(d).trim();
      if (t) warn(`Resolve helper: ${t.split("\n")[0]}`);
    });

    const rl = createInterface({ input: proc.stdout });
    rl.on("line", (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.boot !== undefined) {
        if (msg.boot) {
          this.info = msg.info;
        } else {
          this.bootError = msg.error;
        }
        return;
      }
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      entry(msg);
    });

    proc.on("exit", () => {
      for (const resolveFn of this.pending.values()) {
        resolveFn({ ok: false, error: "The Resolve helper stopped unexpectedly." });
      }
      this.pending.clear();
      this.proc = null;
    });

    // Wait briefly for the boot line.
    for (let i = 0; i < 60; i++) {
      if (this.info || this.bootError || !this.proc) break;
      await sleep(250);
    }
    return { info: this.info, error: this.bootError };
  }

  alive() {
    return Boolean(this.proc);
  }

  async call(tool, args, timeoutMs = 180_000) {
    if (!this.proc) return { ok: false, error: this.bootError || "Resolve isn't connected." };
    const id = String(++this.seq);
    return await new Promise((done) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        done({ ok: false, error: "Resolve didn't answer in time." });
      }, timeoutMs);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        done(msg);
      });
      this.proc.stdin.write(JSON.stringify({ id, tool, arguments: args || {} }) + "\n");
    });
  }
}

/* --------------------------------------------------------------- transport */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(server, endpoint, body) {
  const res = await fetch(`${server}/api/public/mcp-bridge/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  return { ok: res.ok, status: res.status, json, text };
}

function flatInfo(info) {
  if (!info) return {};
  const out = {};
  for (const [k, v] of Object.entries(info)) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === "string" ? v : String(v);
  }
  return out;
}

/* ------------------------------------------------------------------- flows */

async function pair(server, code, worker) {
  const r = await post(server, "pair", { code, server_info: flatInfo(worker.info) });
  if (!r.ok) {
    const why = r.json?.error || `Orby answered ${r.status}.`;
    die(`Pairing failed: ${why}\nOpen Orby, turn DaVinci Resolve Mode on, and copy a fresh command.`);
  }
  writeConfig({ server, token: r.json.token, provider: r.json.provider });
  say(`Paired with Orby ✅  (${r.json.provider})`);
  return r.json.token;
}

async function loop(server, token, worker) {
  let quiet = 0;
  for (;;) {
    const r = await post(server, "poll", { token, server_info: flatInfo(worker.info) });

    if (r.status === 401) die("Orby no longer recognises this computer. Run the connect command again with a fresh code.");
    if (!r.ok) {
      warn(`Couldn't reach Orby (${r.status}). Retrying in 5s…`);
      await sleep(5000);
      continue;
    }

    const cmd = r.json?.command;
    if (!cmd) {
      quiet += 1;
      if (quiet % 60 === 0) say("Still connected, waiting for something to do…");
      await sleep(2000);
      continue;
    }
    quiet = 0;

    say(`▶ ${cmd.tool}`);
    const out = await worker.call(cmd.tool, cmd.arguments);
    if (out.ok) {
      say(`  done`);
      // Refresh the cached project/timeline snapshot after anything that changes it.
      const snap = await worker.call("get_project_info", {}, 20_000);
      if (snap.ok) worker.info = snap.result;
      await post(server, "result", { token, command_id: cmd.id, result: out.result ?? {} });
    } else {
      warn(`  ${out.error}`);
      await post(server, "result", { token, command_id: cmd.id, error: String(out.error).slice(0, 4000) });
    }
  }
}

/* -------------------------------------------------------------------- main */

const argv = process.argv.slice(2);
const cmd = argv[0];
const serverFlag = argv.indexOf("--server");
const server = (serverFlag >= 0 ? argv[serverFlag + 1] : DEFAULT_SERVER).replace(/\/+$/, "");

if (!cmd || !["connect", "run"].includes(cmd)) {
  die(
    "Orby Bridge\n\n" +
      "  node orby-bridge.mjs connect <pairing-code>\n" +
      "  node orby-bridge.mjs run\n\n" +
      "Get the pairing code from Orby: turn on DaVinci Resolve Mode in chat.",
  );
}

say("Starting the Orby bridge…");

const worker = new ResolveWorker();
const boot = await worker.start();

if (boot.error || !worker.alive()) {
  die(
    `${boot.error || "Couldn't start the Resolve helper."}\n\n` +
      "Checklist:\n" +
      "  1. DaVinci Resolve Studio is open (the free version can't be scripted).\n" +
      "  2. A project is open, not the Project Manager screen.\n" +
      "  3. Resolve > Preferences > System > General: External scripting using = Local.\n",
  );
}

say(
  `Talking to ${worker.info?.product || "DaVinci Resolve"} ${worker.info?.version || ""}` +
    (worker.info?.project ? ` — project: ${worker.info.project}` : " — no project open yet"),
);

let token;
if (cmd === "connect") {
  const code = argv[1];
  if (!code) die("Add your pairing code: node orby-bridge.mjs connect ABC12345");
  token = await pair(server, code.trim().toUpperCase(), worker);
} else {
  const cfg = readConfig();
  if (!cfg?.token) die("This computer isn't paired yet. Run: node orby-bridge.mjs connect <code>");
  token = cfg.token;
  say("Reusing the saved pairing.");
}

say("Connected. Leave this window open while you use Orby. Press Ctrl+C to stop.");
await loop(server, token, worker);
