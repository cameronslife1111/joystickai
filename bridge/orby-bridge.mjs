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
/** Keep in sync with BRIDGE_VERSION in the Python worker and in src/lib/mcp-providers.ts. */
const BRIDGE_VERSION = "2";

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

def log(msg):
    sys.stderr.write("[resolve] %s\n" % msg)
    sys.stderr.flush()


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
BRIDGE_VERSION = "3"


def norm(s):
    return " ".join(str(s or "").split()).lower()

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
    mp = project().GetMediaPool()
    if mp is None:
        raise Exception("Resolve returned no media pool. Make sure a project is open, then try again.")
    return mp

def root_folder():
    f = pool().GetRootFolder()
    if f is None:
        raise Exception("Resolve returned no Master bin. Open the Media page once, then try again.")
    return f

def folder():
    """The selected bin, falling back to Master when Resolve hasn't selected one."""
    f = None
    try:
        f = pool().GetCurrentFolder()
    except Exception:
        f = None
    if f is None:
        log("no current bin selected; falling back to Master")
        f = root_folder()
    return f

def clip_list(f):
    if f is None:
        raise Exception("Resolve returned no bin to read clips from. Open the Media page once, then try again.")
    return f.GetClipList() or []

def walk_folders(f=None, depth=0):
    """Master bin first, then every sub-bin, depth first."""
    f = f if f is not None else root_folder()
    out = [f]
    if depth < 12:
        for s in (f.GetSubFolderList() or []):
            if s is not None:
                out += walk_folders(s, depth + 1)
    return out

def find_clip(name):
    want = norm(name)
    if not want:
        raise Exception("Tell me which clip by name.")
    searched = []
    bins = []
    cur = None
    try:
        cur = pool().GetCurrentFolder()
    except Exception:
        cur = None
    if cur is not None:
        bins.append(cur)
    for f in walk_folders():
        if f not in bins:
            bins.append(f)
    for pass_exact in (True, False):
        for f in bins:
            bin_name = f.GetName() or "?"
            if pass_exact and bin_name not in searched:
                searched.append(bin_name)
            for c in clip_list(f):
                cn = norm(c.GetName())
                if (cn == want) if pass_exact else (want in cn or cn in want):
                    log("found clip '%s' in bin '%s'" % (c.GetName(), bin_name))
                    return c
    raise Exception(
        "No clip named '%s' in the media pool. I looked in: %s." % (name, ", ".join(searched) or "Master")
    )

def find_timeline_items(name, kind="video", track=None):
    """Every clip on the timeline whose name matches, exact first then partial."""
    t = timeline()
    want = norm(name)
    tracks = [int(track)] if track else list(range(1, (t.GetTrackCount(kind) or 0) + 1))
    rows = []
    for i in tracks:
        for item in (t.GetItemListInTrack(kind, i) or []):
            if item is None:
                continue
            rows.append((i, item))
    exact = [r for r in rows if norm(r[1].GetName()) == want]
    hits = exact or [r for r in rows if want and want in norm(r[1].GetName())]
    if not hits:
        raise Exception(
            "No clip named '%s' on the %s tracks of '%s'." % (name, kind, t.GetName())
        )
    log("matched %d timeline clip(s) for '%s'" % (len(hits), name))
    return hits

def ensure_track(t, kind, index):
    have = t.GetTrackCount(kind) or 0
    while have < index:
        if not t.AddTrack(kind):
            raise Exception("Resolve refused to add %s track %d (it has %d)." % (kind, index, have))
        have = t.GetTrackCount(kind) or (have + 1)
    return have

def source_range(item):
    """(startFrame, endFrame) in the source media, with fallbacks."""
    start = None
    end = None
    for getter in ("GetSourceStartFrame", "GetSourceEndFrame"):
        if not hasattr(item, getter):
            start = None
            break
    if hasattr(item, "GetSourceStartFrame") and hasattr(item, "GetSourceEndFrame"):
        try:
            start = int(item.GetSourceStartFrame())
            end = int(item.GetSourceEndFrame())
        except Exception:
            start = None
    if start is None:
        try:
            left = int(item.GetLeftOffset() or 0)
            dur = int(item.GetDuration() or 0)
            start = left
            end = left + max(dur - 1, 0)
        except Exception:
            raise Exception("Resolve wouldn't tell me the source range of '%s'." % item.GetName())
    return start, end


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
        "bridge_version": BRIDGE_VERSION,
    }


ASPECTS = {
    "vertical": (1080, 1920), "9:16": (1080, 1920), "portrait": (1080, 1920),
    "square": (1080, 1080), "1:1": (1080, 1080),
    "widescreen": (1920, 1080), "16:9": (1920, 1080), "hd": (1920, 1080), "horizontal": (1920, 1080),
    "uhd": (3840, 2160), "4k": (3840, 2160),
    "cinema": (2048, 858), "2.39:1": (2048, 858),
    "4:5": (1080, 1350),
}

TRACK_KINDS = ("video", "audio", "subtitle")

def kind_of(a, default="video"):
    k = str(a.get("track_type") or a.get("kind") or default).lower()
    if k in ("v", "vid"): k = "video"
    if k in ("a", "aud"): k = "audio"
    if k in ("sub", "subs", "subtitles"): k = "subtitle"
    if k not in TRACK_KINDS:
        raise Exception("Track type must be video, audio or subtitle.")
    return k

def item_at(a, kind=None):
    t = timeline()
    k = kind or kind_of(a)
    track = int(a.get("track", 1))
    idx = int(a.get("index", 1))
    items = t.GetItemListInTrack(k, track) or []
    if not items:
        raise Exception("There are no clips on %s track %d." % (k, track))
    if len(items) < idx:
        raise Exception("There is no clip %d on %s track %d (it has %d)." % (idx, k, track, len(items)))
    return items[idx - 1]

def set_prop(item, prop, value):
    ok = item.SetProperty(prop, value)
    if not ok:
        raise Exception("Resolve refused to set '%s' on '%s'." % (prop, item.GetName()))
    return {"clip": item.GetName(), "set": prop, "value": value}

def set_resolution(w, h):
    p = project()
    t = p.GetCurrentTimeline()
    done = []
    if t is not None:
        t.SetSetting("useCustomSettings", "1")
        if t.SetSetting("timelineResolutionWidth", str(w)) and t.SetSetting("timelineResolutionHeight", str(h)):
            done.append("timeline")
    if not done:
        if not (p.SetSetting("timelineResolutionWidth", str(w)) and p.SetSetting("timelineResolutionHeight", str(h))):
            raise Exception("Resolve refused that resolution.")
        done.append("project")
    return {"resolution": "%dx%d" % (w, h), "applied_to": done[0]}

def all_tracks(fn, a):
    t = timeline()
    kinds = [kind_of(a)] if (a.get("track_type") or a.get("kind")) else list(TRACK_KINDS)
    touched = []
    for k in kinds:
        for i in range(1, (t.GetTrackCount(k) or 0) + 1):
            if fn(t, k, i):
                touched.append("%s%d" % (k[0].upper(), i))
    return {"tracks": touched}

def find_timeline(name):
    p = project()
    want = str(name or "").lower()
    for i in range(p.GetTimelineCount()):
        t = p.GetTimelineByIndex(i + 1)
        if (t.GetName() or "").lower() == want:
            return t
    raise Exception("No timeline named '%s'." % name)

def clip_summary(item):
    return {
        "name": item.GetName(),
        "start": item.GetStart(),
        "end": item.GetEnd(),
        "duration": item.GetDuration(),
    }

def call(tool, a):
    # ---------------------------------------------------- project & session
    if tool == "get_project_info":
        return info()

    if tool == "get_resolve_version":
        return {"version": str(resolve.GetVersionString()), "product": str(resolve.GetProductName()), "bridge": BRIDGE_VERSION}

    if tool == "list_projects":
        return {"projects": pm.GetProjectListInCurrentFolder() or []}

    if tool == "open_project":
        p = pm.LoadProject(str(a["name"]))
        if not p: raise Exception("Couldn't open a project called '%s'." % a.get("name"))
        return {"opened": p.GetName()}

    if tool == "create_project":
        p = pm.CreateProject(str(a.get("name", "Orby Project")))
        if not p: raise Exception("Resolve refused to create that project (the name may already exist).")
        return {"created": p.GetName()}

    if tool == "save_project":
        if not pm.SaveProject(): raise Exception("Resolve couldn't save the project.")
        return {"saved": project().GetName()}

    if tool == "close_project":
        name = project().GetName()
        pm.CloseProject(project())
        return {"closed": name}

    if tool == "open_page":
        page = str(a.get("page", "edit")).lower()
        if page not in ("media", "cut", "edit", "fusion", "color", "fairlight", "deliver"):
            raise Exception("Page must be media, cut, edit, fusion, color, fairlight or deliver.")
        if not resolve.OpenPage(page): raise Exception("Resolve refused to switch to the %s page." % page)
        return {"page": page}

    if tool == "get_current_page":
        return {"page": str(resolve.GetCurrentPage())}

    if tool == "get_project_setting":
        key = a.get("key")
        if not key: return {"settings": project().GetSetting()}
        return {"key": key, "value": project().GetSetting(str(key))}

    if tool == "set_project_setting":
        if not project().SetSetting(str(a["key"]), str(a["value"])):
            raise Exception("Resolve refused to set '%s'." % a.get("key"))
        return {"key": a["key"], "value": a["value"]}

    if tool == "list_project_settings":
        s = project().GetSetting() or {}
        return {"keys": sorted(list(s.keys()))}

    # -------------------------------------------------------------- timelines
    if tool == "list_timelines":
        p = project()
        return {"timelines": [p.GetTimelineByIndex(i + 1).GetName() for i in range(p.GetTimelineCount())]}

    if tool == "get_timeline_info":
        t = timeline()
        return {
            "name": t.GetName(),
            "start_timecode": t.GetStartTimecode(),
            "video_tracks": t.GetTrackCount("video"),
            "audio_tracks": t.GetTrackCount("audio"),
            "subtitle_tracks": t.GetTrackCount("subtitle"),
            "resolution": info().get("resolution"),
            "frame_rate": info().get("frame_rate"),
        }

    if tool == "create_timeline":
        p = project()
        if a.get("frame_rate"): p.SetSetting("timelineFrameRate", str(a["frame_rate"]))
        if a.get("aspect"):
            w, h = ASPECTS.get(str(a["aspect"]).lower(), (None, None))
            if w: p.SetSetting("timelineResolutionWidth", str(w)); p.SetSetting("timelineResolutionHeight", str(h))
        if a.get("width"): p.SetSetting("timelineResolutionWidth", str(a["width"]))
        if a.get("height"): p.SetSetting("timelineResolutionHeight", str(a["height"]))
        t = pool().CreateEmptyTimeline(a.get("name", "Orby Timeline"))
        if not t: raise Exception("Resolve refused to create that timeline.")
        return {"created": t.GetName()}

    if tool == "set_current_timeline":
        t = find_timeline(a.get("name"))
        project().SetCurrentTimeline(t)
        return {"current": t.GetName()}

    if tool == "rename_timeline":
        t = find_timeline(a.get("name")) if a.get("name") else timeline()
        if not t.SetName(str(a["new_name"])): raise Exception("Resolve refused that timeline name.")
        return {"renamed": a["new_name"]}

    if tool == "duplicate_timeline":
        t = find_timeline(a.get("name")) if a.get("name") else timeline()
        dup = pool().DuplicateTimeline(t, a.get("new_name")) if a.get("new_name") else pool().DuplicateTimeline(t)
        if not dup: raise Exception("Resolve refused to duplicate that timeline.")
        return {"duplicated": dup.GetName()}

    if tool == "delete_timeline":
        t = find_timeline(a.get("name"))
        if not pool().DeleteTimelines([t]): raise Exception("Resolve refused to delete that timeline.")
        return {"deleted": a.get("name")}

    if tool == "set_timeline_resolution":
        if a.get("aspect"):
            key = str(a["aspect"]).lower()
            if key not in ASPECTS: raise Exception("I know these shapes: %s." % ", ".join(sorted(ASPECTS.keys())))
            w, h = ASPECTS[key]
        else:
            w, h = int(a["width"]), int(a["height"])
        return set_resolution(w, h)

    if tool == "set_timeline_aspect":
        key = str(a.get("aspect", "vertical")).lower()
        if key not in ASPECTS: raise Exception("I know these shapes: %s." % ", ".join(sorted(ASPECTS.keys())))
        w, h = ASPECTS[key]
        out = set_resolution(w, h)
        out["aspect"] = key
        return out

    if tool == "set_timeline_frame_rate":
        if not project().SetSetting("timelineFrameRate", str(a["frame_rate"])):
            raise Exception("Resolve refused that frame rate. It can only change while the timeline is empty.")
        return {"frame_rate": a["frame_rate"]}

    if tool == "get_timeline_start_timecode":
        return {"start_timecode": timeline().GetStartTimecode()}

    if tool == "set_timeline_start_timecode":
        if not timeline().SetStartTimecode(str(a["timecode"])): raise Exception("Resolve refused that start timecode.")
        return {"start_timecode": a["timecode"]}

    if tool == "get_timeline_item_count":
        t = timeline()
        out = {}
        for k in TRACK_KINDS:
            total = 0
            for i in range(1, (t.GetTrackCount(k) or 0) + 1):
                total += len(t.GetItemListInTrack(k, i) or [])
            out[k] = total
        return out

    if tool == "set_timeline_setting":
        if not timeline().SetSetting(str(a["key"]), str(a["value"])):
            raise Exception("Resolve refused to set '%s' on this timeline." % a.get("key"))
        return {"key": a["key"], "value": a["value"]}

    if tool == "import_timeline_file":
        t = pool().ImportTimelineFromFile(os.path.expanduser(str(a["file"])))
        if not t: raise Exception("Resolve couldn't import that timeline file.")
        return {"imported": t.GetName()}

    if tool == "export_timeline":
        t = timeline()
        fmt = str(a.get("format", "xml")).lower()
        kinds = {
            "aaf": resolve.EXPORT_AAF, "edl": resolve.EXPORT_EDL, "xml": resolve.EXPORT_FCP_7_XML,
            "fcpxml": resolve.EXPORT_FCPXML_1_8, "otio": resolve.EXPORT_OTIO, "drt": resolve.EXPORT_DRT,
        }
        if fmt not in kinds: raise Exception("Export format must be aaf, edl, xml, fcpxml, otio or drt.")
        target = os.path.expanduser(a.get("file") or os.path.join(HOMEDIR, "Movies", "Orby", "%s.%s" % (t.GetName(), fmt)))
        d = os.path.dirname(target)
        if d and not os.path.isdir(d): os.makedirs(d)
        if not t.Export(target, kinds[fmt]): raise Exception("Resolve refused that export.")
        return {"exported": target}

    # ----------------------------------------------------------------- tracks
    if tool == "get_track_count":
        t = timeline()
        return {k: t.GetTrackCount(k) for k in TRACK_KINDS}

    if tool == "list_tracks":
        t = timeline()
        out = []
        for k in TRACK_KINDS:
            for i in range(1, (t.GetTrackCount(k) or 0) + 1):
                out.append({
                    "type": k, "index": i, "name": t.GetTrackName(k, i),
                    "enabled": bool(t.GetIsTrackEnabled(k, i)),
                    "locked": bool(t.GetIsTrackLocked(k, i)),
                    "clips": len(t.GetItemListInTrack(k, i) or []),
                })
        return {"tracks": out}

    if tool == "rename_track":
        t = timeline()
        if not t.SetTrackName(kind_of(a), int(a.get("track", 1)), str(a["name"])):
            raise Exception("Resolve refused that track name.")
        return {"renamed": a["name"]}

    if tool == "add_track":
        t = timeline()
        k = kind_of(a)
        if not t.AddTrack(k): raise Exception("Resolve refused to add a %s track." % k)
        return {"added": k, "count": t.GetTrackCount(k)}

    if tool == "delete_track":
        t = timeline()
        k = kind_of(a)
        if not t.DeleteTrack(k, int(a.get("track", t.GetTrackCount(k)))):
            raise Exception("Resolve refused to delete that track.")
        return {"deleted": k, "count": t.GetTrackCount(k)}

    if tool == "enable_track":
        t = timeline()
        k = kind_of(a)
        if not t.SetTrackEnable(k, int(a.get("track", 1)), True): raise Exception("Resolve refused to enable that track.")
        return {"enabled": "%s %s" % (k, a.get("track", 1))}

    if tool == "disable_track":
        t = timeline()
        k = kind_of(a)
        if not t.SetTrackEnable(k, int(a.get("track", 1)), False): raise Exception("Resolve refused to disable that track.")
        return {"disabled": "%s %s" % (k, a.get("track", 1))}

    if tool == "enable_all_tracks":
        return all_tracks(lambda t, k, i: t.SetTrackEnable(k, i, True), a)

    if tool == "disable_all_tracks":
        return all_tracks(lambda t, k, i: t.SetTrackEnable(k, i, False), a)

    if tool == "lock_track":
        t = timeline()
        if not t.SetTrackLock(kind_of(a), int(a.get("track", 1)), True): raise Exception("Resolve refused to lock that track.")
        return {"locked": a.get("track", 1)}

    if tool == "unlock_track":
        t = timeline()
        if not t.SetTrackLock(kind_of(a), int(a.get("track", 1)), False): raise Exception("Resolve refused to unlock that track.")
        return {"unlocked": a.get("track", 1)}

    if tool == "lock_all_tracks":
        return all_tracks(lambda t, k, i: t.SetTrackLock(k, i, True), a)

    if tool == "unlock_all_tracks":
        return all_tracks(lambda t, k, i: t.SetTrackLock(k, i, False), a)

    if tool == "mute_audio_track":
        t = timeline()
        if not t.SetTrackEnable("audio", int(a.get("track", 1)), False): raise Exception("Resolve refused to mute that track.")
        return {"muted": a.get("track", 1)}

    if tool == "unmute_audio_track":
        t = timeline()
        if not t.SetTrackEnable("audio", int(a.get("track", 1)), True): raise Exception("Resolve refused to unmute that track.")
        return {"unmuted": a.get("track", 1)}

    if tool == "solo_audio_track":
        raise Exception("Solo isn't in Resolve's scripting API. I can mute the other audio tracks instead, which sounds the same.")

    # -------------------------------------------------- clips on the timeline
    if tool == "list_timeline_clips":
        t = timeline()
        k = kind_of(a)
        if a.get("track"):
            items = t.GetItemListInTrack(k, int(a["track"])) or []
            return {"track": int(a["track"]), "clips": [clip_summary(i) for i in items]}
        out = []
        for i in range(1, (t.GetTrackCount(k) or 0) + 1):
            out.append({"track": i, "clips": [clip_summary(x) for x in (t.GetItemListInTrack(k, i) or [])]})
        return {"tracks": out}

    if tool == "get_clip_info":
        item = item_at(a)
        d = clip_summary(item)
        d["properties"] = item.GetProperty()
        return d

    if tool == "set_clip_property":
        return set_prop(item_at(a), a.get("property"), a.get("value"))

    if tool == "set_clip_color":
        item = item_at(a)
        if not item.SetClipColor(str(a["color"])):
            raise Exception("Resolve refused that clip colour. Try Orange, Apricot, Yellow, Lime, Olive, Green, Teal, Navy, Blue, Purple, Violet, Pink, Tan, Beige, Brown or Chocolate.")
        return {"clip": item.GetName(), "color": a["color"]}

    if tool == "set_clip_flag":
        item = item_at(a)
        if not item.AddFlag(str(a.get("color", "Blue"))): raise Exception("Resolve refused that flag colour.")
        return {"clip": item.GetName(), "flag": a.get("color", "Blue")}

    if tool == "clear_clip_flags":
        item = item_at(a)
        item.ClearFlags("All")
        return {"clip": item.GetName(), "flags": "cleared"}

    if tool == "set_clip_speed":
        item = item_at(a)
        pct = float(a.get("speed_percent", 100))
        if not item.SetProperty("Speed", pct / 100.0):
            raise Exception("Resolve refused that speed. Retiming through the API only works on plain video clips.")
        return {"clip": item.GetName(), "speed_percent": pct}

    if tool == "set_clip_zoom":
        item = item_at(a)
        z = float(a.get("zoom", 1))
        item.SetProperty("ZoomX", z); item.SetProperty("ZoomY", float(a.get("zoom_y", z)))
        return {"clip": item.GetName(), "zoom": z}

    if tool == "set_clip_position":
        item = item_at(a)
        item.SetProperty("Pan", float(a.get("x", 0))); item.SetProperty("Tilt", float(a.get("y", 0)))
        return {"clip": item.GetName(), "x": a.get("x", 0), "y": a.get("y", 0)}

    if tool == "set_clip_crop":
        item = item_at(a)
        for k, prop in (("left", "CropLeft"), ("right", "CropRight"), ("top", "CropTop"), ("bottom", "CropBottom")):
            if a.get(k) is not None: item.SetProperty(prop, float(a[k]))
        return {"clip": item.GetName(), "cropped": True}

    if tool == "set_clip_opacity":
        item = item_at(a)
        return set_prop(item, "Opacity", float(a.get("opacity", 100)))

    if tool == "set_clip_rotation":
        item = item_at(a)
        return set_prop(item, "RotationAngle", float(a.get("degrees", 0)))

    if tool == "set_clip_volume":
        item = item_at(a, "audio")
        return set_prop(item, "Volume", float(a.get("db", 0)))

    if tool == "set_clip_pan":
        item = item_at(a, "audio")
        return set_prop(item, "Pan", float(a.get("pan", 0)))

    if tool == "delete_clip":
        t = timeline()
        item = item_at(a)
        name = item.GetName()
        if not t.DeleteClips([item]): raise Exception("Resolve refused to delete that clip.")
        return {"deleted": name}

    if tool == "set_playhead_timecode":
        if not timeline().SetCurrentTimecode(str(a["timecode"])): raise Exception("Resolve refused that timecode.")
        return {"timecode": a["timecode"]}

    if tool == "get_playhead_timecode":
        return {"timecode": timeline().GetCurrentTimecode()}

    if tool == "append_clip_to_timeline":
        clip = find_clip(a.get("clip") or a.get("name"))
        items = pool().AppendToTimeline([clip])
        if not items: raise Exception("Resolve refused to append that clip.")
        return {"appended": clip.GetName()}

    # ------------------------------------------------------------ media pool
    if tool == "list_media_pool_clips":
        folder = pool().GetCurrentFolder()
        out = []
        for c in (folder.GetClipList() or []):
            out.append({"name": c.GetName(), "duration": c.GetClipProperty("Duration"), "resolution": c.GetClipProperty("Resolution")})
        return {"folder": folder.GetName(), "clips": out}

    if tool == "list_media_pool_folders":
        root = pool().GetRootFolder()
        def walk(f, depth=0):
            rows = [{"name": f.GetName(), "depth": depth, "clips": len(f.GetClipList() or [])}]
            for s in (f.GetSubFolderList() or []):
                rows += walk(s, depth + 1)
            return rows
        return {"folders": walk(root)}

    if tool == "create_media_pool_folder":
        parent = pool().GetCurrentFolder()
        f = pool().AddSubFolder(parent, str(a.get("name", "Orby")))
        if not f: raise Exception("Resolve refused to create that bin.")
        return {"created": f.GetName()}

    if tool == "set_current_folder":
        want = str(a.get("name", "")).lower()
        root = pool().GetRootFolder()
        def find(f):
            if (f.GetName() or "").lower() == want: return f
            for s in (f.GetSubFolderList() or []):
                hit = find(s)
                if hit: return hit
            return None
        f = find(root)
        if not f: raise Exception("No bin called '%s'." % a.get("name"))
        pool().SetCurrentFolder(f)
        return {"current_folder": f.GetName()}

    if tool == "move_clips_to_folder":
        names = a.get("clips") or ([a["clip"]] if a.get("clip") else [])
        clips = [find_clip(n) for n in names]
        want = str(a.get("folder", "")).lower()
        target = None
        for s in (pool().GetRootFolder().GetSubFolderList() or []):
            if (s.GetName() or "").lower() == want: target = s
        if target is None: raise Exception("No bin called '%s'." % a.get("folder"))
        if not pool().MoveClips(clips, target): raise Exception("Resolve refused to move those clips.")
        return {"moved": [c.GetName() for c in clips], "folder": target.GetName()}

    if tool == "delete_media_pool_clips":
        names = a.get("clips") or ([a["clip"]] if a.get("clip") else [])
        clips = [find_clip(n) for n in names]
        if not pool().DeleteClips(clips): raise Exception("Resolve refused to delete those clips.")
        return {"deleted": [c.GetName() for c in clips]}

    if tool == "import_media":
        files = a.get("files") or ([a["file"]] if a.get("file") else [])
        if not files: raise Exception("No files given to import.")
        added = pool().ImportMedia([os.path.expanduser(f) for f in files])
        return {"imported": [c.GetName() for c in (added or [])]}

    if tool == "import_media_folder":
        d = os.path.expanduser(str(a["folder"]))
        if not os.path.isdir(d): raise Exception("There's no folder at %s." % d)
        files = [os.path.join(d, f) for f in sorted(os.listdir(d)) if not f.startswith(".")]
        added = pool().ImportMedia(files)
        return {"imported": [c.GetName() for c in (added or [])]}

    if tool == "get_clip_property":
        c = find_clip(a.get("clip") or a.get("name"))
        if a.get("property"): return {"clip": c.GetName(), "property": a["property"], "value": c.GetClipProperty(str(a["property"]))}
        return {"clip": c.GetName(), "properties": c.GetClipProperty()}

    if tool == "set_media_clip_property":
        c = find_clip(a.get("clip") or a.get("name"))
        if not c.SetClipProperty(str(a["property"]), str(a["value"])):
            raise Exception("Resolve refused to set '%s' on that clip." % a.get("property"))
        return {"clip": c.GetName(), "set": a["property"]}

    if tool == "find_clip":
        c = find_clip(a.get("clip") or a.get("name"))
        return {"clip": c.GetName(), "duration": c.GetClipProperty("Duration"), "resolution": c.GetClipProperty("Resolution")}

    if tool == "create_timeline_from_clips":
        names = a.get("clips") or []
        clips = [find_clip(n) for n in names]
        if not clips: raise Exception("Name at least one clip to build a timeline from.")
        t = pool().CreateTimelineFromClips(str(a.get("name", "Orby Timeline")), clips)
        if not t: raise Exception("Resolve refused to build that timeline.")
        return {"created": t.GetName(), "clips": [c.GetName() for c in clips]}

    if tool == "relink_clips":
        names = a.get("clips") or ([a["clip"]] if a.get("clip") else [])
        clips = [find_clip(n) for n in names]
        folder = os.path.expanduser(str(a.get("folder", "")))
        if not pool().RelinkClips(clips, folder): raise Exception("Resolve couldn't relink those clips from %s." % folder)
        return {"relinked": [c.GetName() for c in clips]}

    if tool == "unlink_clips":
        names = a.get("clips") or ([a["clip"]] if a.get("clip") else [])
        clips = [find_clip(n) for n in names]
        if not pool().UnlinkClips(clips): raise Exception("Resolve refused to unlink those clips.")
        return {"unlinked": [c.GetName() for c in clips]}

    # ---------------------------------------------------------------- colour
    if tool == "apply_lut":
        item = item_at(a)
        if not item.SetLUT(int(a.get("node", 1)), os.path.expanduser(str(a["lut"]))):
            raise Exception("Resolve refused that LUT path.")
        return {"lut": a["lut"], "clip": item.GetName()}

    if tool == "set_cdl":
        item = item_at(a)
        cdl = {}
        for k, key in (("slope", "Slope"), ("offset", "Offset"), ("power", "Power"), ("saturation", "Saturation")):
            if a.get(k) is not None: cdl[key] = str(a[k])
        if not cdl: raise Exception("Give at least one of slope, offset, power or saturation.")
        if not item.SetCDL(cdl): raise Exception("Resolve refused those CDL values.")
        return {"clip": item.GetName(), "cdl": cdl}

    if tool == "grade_clip":
        item = item_at(a)
        applied = []
        if a.get("saturation") is not None:
            item.SetCDL({"Saturation": str(a["saturation"])}); applied.append("saturation")
        cdl = {}
        for k, key in (("slope", "Slope"), ("offset", "Offset"), ("power", "Power")):
            if a.get(k) is not None: cdl[key] = str(a[k])
        if cdl:
            item.SetCDL(cdl); applied.append("cdl")
        if a.get("lut"):
            item.SetLUT(int(a.get("node", 1)), os.path.expanduser(str(a["lut"]))); applied.append("lut")
        if not applied:
            raise Exception("Colour wheels beyond CDL aren't scriptable. Try saturation, slope/offset/power, or a LUT.")
        return {"graded": item.GetName(), "applied": applied}

    if tool == "list_color_versions":
        item = item_at(a)
        return {"clip": item.GetName(), "versions": item.GetVersionNameList(int(a.get("version_type", 0)))}

    if tool == "add_color_version":
        item = item_at(a)
        if not item.AddVersion(str(a.get("name", "Orby")), int(a.get("version_type", 0))):
            raise Exception("Resolve refused to add that colour version.")
        return {"clip": item.GetName(), "version": a.get("name", "Orby")}

    if tool == "load_color_version":
        item = item_at(a)
        if not item.LoadVersionByName(str(a["name"]), int(a.get("version_type", 0))):
            raise Exception("No colour version called '%s' on that clip." % a.get("name"))
        return {"clip": item.GetName(), "loaded": a["name"]}

    if tool == "delete_color_version":
        item = item_at(a)
        if not item.DeleteVersionByName(str(a["name"]), int(a.get("version_type", 0))):
            raise Exception("Resolve refused to delete that colour version.")
        return {"clip": item.GetName(), "deleted": a["name"]}

    if tool == "copy_grade":
        raise Exception("Copying a whole grade needs the Color page gallery. Grab a still from the source clip (grab_still) and apply it with apply_drx_grade, or copy the CDL values with set_cdl.")


    if tool == "grab_still":
        resolve.OpenPage("color")
        still = timeline().GrabStill()
        if not still: raise Exception("Resolve couldn't grab a still. Make sure the playhead is over a clip on the Color page.")
        return {"grabbed": True}

    if tool == "apply_drx_grade":
        item = item_at(a)
        if not item.ApplyDrxGrade(os.path.expanduser(str(a["drx"])), str(a.get("grade_mode", "0"))):
            raise Exception("Resolve refused that .drx grade file.")
        return {"clip": item.GetName(), "drx": a["drx"]}

    # ------------------------------------------------------ fusion & effects
    if tool == "add_fusion_effect":
        item = item_at(a)
        comp = item.GetFusionCompByIndex(1) or item.AddFusionComp()
        if comp is None: raise Exception("Couldn't open a Fusion composition on that clip.")
        tool_name = a.get("effect", "DeltaKeyer")
        node = comp.AddTool(tool_name)
        if node is None: raise Exception("Resolve doesn't have a Fusion tool called '%s'." % tool_name)
        for k, v in (a.get("settings") or {}).items():
            try: node.SetInput(k, v)
            except Exception: pass
        return {"added": tool_name, "clip": item.GetName()}

    if tool == "set_fusion_input":
        item = item_at(a)
        comp = item.GetFusionCompByIndex(1)
        if comp is None: raise Exception("That clip has no Fusion composition yet. Add an effect first.")
        node = comp.FindTool(str(a["node"]))
        if node is None: raise Exception("No Fusion node called '%s' on that clip." % a.get("node"))
        node.SetInput(str(a["input"]), a["value"])
        return {"clip": item.GetName(), "node": a["node"], "input": a["input"]}

    if tool == "list_fusion_nodes":
        item = item_at(a)
        comp = item.GetFusionCompByIndex(1)
        if comp is None: return {"clip": item.GetName(), "nodes": []}
        names = []
        for n in (comp.GetToolList() or {}).values():
            try: names.append(n.GetAttrs()["TOOLS_Name"])
            except Exception: pass
        return {"clip": item.GetName(), "nodes": names}

    if tool == "delete_fusion_node":
        item = item_at(a)
        comp = item.GetFusionCompByIndex(1)
        if comp is None: raise Exception("That clip has no Fusion composition.")
        node = comp.FindTool(str(a["node"]))
        if node is None: raise Exception("No Fusion node called '%s'." % a.get("node"))
        node.Delete()
        return {"clip": item.GetName(), "deleted": a["node"]}

    if tool == "add_fusion_comp":
        item = item_at(a)
        comp = item.AddFusionComp()
        if comp is None: raise Exception("Resolve refused to add a Fusion composition.")
        return {"clip": item.GetName(), "comps": item.GetFusionCompCount()}

    if tool == "delete_fusion_comp":
        item = item_at(a)
        if not item.DeleteFusionCompByName(str(a.get("name", "Composition 1"))):
            raise Exception("Resolve refused to delete that Fusion composition.")
        return {"clip": item.GetName(), "deleted": a.get("name", "Composition 1")}

    # -------------------------------------------------- markers & metadata
    if tool == "add_marker":
        t = timeline()
        frame = int(a.get("frame", 0))
        ok = t.AddMarker(frame, str(a.get("color", "Blue")), str(a.get("name", "Orby")), str(a.get("note", "")), 1)
        if not ok: raise Exception("Resolve refused that marker (a marker may already be on that frame).")
        return {"marker": a.get("name", "Orby"), "frame": frame}

    if tool == "list_markers":
        return {"markers": timeline().GetMarkers() or {}}

    if tool == "delete_marker":
        t = timeline()
        if a.get("frame") is not None:
            if not t.DeleteMarkerAtFrame(int(a["frame"])): raise Exception("No marker on frame %s." % a["frame"])
            return {"deleted_frame": a["frame"]}
        if a.get("color"):
            if not t.DeleteMarkersByColor(str(a["color"])): raise Exception("No %s markers to delete." % a["color"])
            return {"deleted_color": a["color"]}
        if not t.DeleteMarkersByColor("All"): raise Exception("There are no markers to delete.")
        return {"deleted": "all"}

    if tool == "set_clip_metadata":
        c = find_clip(a.get("clip") or a.get("name"))
        if not c.SetMetadata(str(a["key"]), str(a["value"])):
            raise Exception("Resolve refused that metadata field.")
        return {"clip": c.GetName(), "set": a["key"]}

    # ------------------------------------------------------ export & render
    if tool == "list_render_options":
        p = project()
        return {
            "presets": p.GetRenderPresetList() or [],
            "formats": p.GetRenderFormats() or {},
            "codecs": p.GetRenderCodecs(str(a.get("format", "mp4"))) or {},
        }

    if tool == "render_timeline":
        p = project()
        preset = a.get("preset")
        if preset and not p.LoadRenderPreset(str(preset)):
            raise Exception("No render preset named '%s' in this project." % preset)
        target = os.path.expanduser(a.get("directory") or os.path.join(HOMEDIR, "Movies", "Orby"))
        if not os.path.isdir(target): os.makedirs(target)
        if a.get("format"):
            p.SetCurrentRenderFormatAndCodec(str(a["format"]), str(a.get("codec", "H264" if a["format"] in ("mp4", "mov") else "")))
        settings = {"TargetDir": target}
        if a.get("filename"): settings["CustomName"] = str(a["filename"])
        if a.get("aspect"):
            key = str(a["aspect"]).lower()
            if key in ASPECTS:
                settings["FormatWidth"], settings["FormatHeight"] = ASPECTS[key]
        if a.get("width"): settings["FormatWidth"] = int(a["width"])
        if a.get("height"): settings["FormatHeight"] = int(a["height"])
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

    if tool == "stop_render":
        project().StopRendering()
        return {"stopped": True}

    if tool == "add_transition":
        raise Exception("Transitions aren't exposed by Resolve's scripting API. Add it by hand on the Edit page, or use a Fusion effect instead.")

    if tool == "add_text_plus":
        raise Exception("Text+ titles have to be inserted from the Edit page; Resolve's API can't create them. I can build the timeline and you add the title by hand.")

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
  let r = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    r = await post(server, "pair", { code, server_info: flatInfo(worker.info) });
    if (r.ok) break;
    if (r.status !== 404 && r.status !== 410) break;
    if (attempt < 5) {
      say("Waiting for a fresh code…");
      await sleep(10_000);
    }
  }
  if (!r?.ok) {
    const why = r?.json?.error || `Orby answered ${r?.status}.`;
    die(
      `Pairing failed: ${why}\n` +
        'In Orby chat, with DaVinci Resolve Mode on, tap "Get a fresh command" and run the new line.',
    );
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
