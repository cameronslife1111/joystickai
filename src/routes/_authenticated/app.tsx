import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Orb } from "@/components/Orb";
import { useOrbGestures } from "@/hooks/use-orb-gestures";
import { splitIntoSentences } from "@/lib/sentences";
import { aiContinue } from "@/lib/ai.functions";
import { ChatDialog } from "@/components/ChatDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SentenceText } from "@/components/SentenceText";
import { LinkDocumentDialog } from "@/components/LinkDocumentDialog";
import { sortDocsByTitle } from "@/lib/sortDocs";
import { Input } from "@/components/ui/input";
import { Link as LinkIcon } from "lucide-react";
import { PlanApprovalDialog } from "@/components/PlanApprovalDialog";
import { AIPlansScreen } from "@/components/AIPlansScreen";
import { useRunningPlansAdvancer } from "@/hooks/use-running-plans-advancer";
import { useComposingPlansWatcher } from "@/hooks/use-composing-plans-watcher";

export const Route = createFileRoute("/_authenticated/app")({
  head: () => ({ meta: [{ title: "Orby" }] }),
  component: AppPage,
});

type Doc = { id: string; title: string; position: number; current_sentence_index: number };
type Sentence = { id: string; content: string; order_index: number; document_id: string; linked_document_id: string | null; pending_delete?: boolean };

type MenuSlot = { e: string; t: string; fn: () => void; badge?: number; onLongPress?: () => void } | null;

const EMOJI_FILTERS = ["⚪️", "⚫️", "🟣", "🔵", "🔴", "🟢", "🟡", "🟠", "🟤"] as const;


function MenuGridButton({ index, slot }: { index: number; slot: MenuSlot }) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFiredRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const onPointerDown = () => {
    if (!slot?.onLongPress) return;
    longFiredRef.current = false;
    timerRef.current = setTimeout(() => {
      longFiredRef.current = true;
      slot.onLongPress?.();
    }, 500);
  };

  return (
    <button
      onClick={() => {
        if (longFiredRef.current) {
          longFiredRef.current = false;
          return;
        }
        slot?.fn();
      }}
      onPointerDown={onPointerDown}
      onPointerUp={clearTimer}
      onPointerLeave={clearTimer}
      onPointerCancel={clearTimer}
      onContextMenu={(e) => e.preventDefault()}
      disabled={!slot}
      style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
      className="relative h-20 select-none rounded-2xl border border-foreground/10 bg-foreground/5 p-1.5 text-center transition active:scale-95 disabled:opacity-30"
    >
      <span className="absolute left-1.5 top-0.5 text-[9px] text-muted-foreground">
        {index + 1}
      </span>
      {slot ? (
        <div className="flex h-full flex-col items-center justify-center gap-0.5">
          <div className="text-xl">{slot.e}</div>
          <div className="text-[10px] leading-tight">{slot.t}</div>
        </div>
      ) : null}
      {slot?.badge && slot.badge > 0 ? (
        <span
          className="absolute right-1 top-1 min-w-[18px] rounded-full px-1 text-[9px] font-semibold leading-[16px] text-white"
          style={{ background: "linear-gradient(135deg, var(--aurora-1), var(--aurora-2))" }}
        >
          {slot.badge > 99 ? "99+" : slot.badge}
        </span>
      ) : null}
    </button>
  );
}

function AppPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const orbRef = useRef<HTMLButtonElement>(null);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const [slotFilter, setSlotFilter] = useState<string | null>(null);
  const [pinPickerOpen, setPinPickerOpen] = useState(false);
  const [pinPickerQuery, setPinPickerQuery] = useState("");
  const [pickerQuery, setPickerQuery] = useState("");
  const [replaceMatching, setReplaceMatching] = useState(true);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [recentOpen, setRecentOpen] = useState(false);
  const [recentIds, setRecentIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem("orby-recent-docs");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  });
  const [composing, setComposing] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [composeText, setComposeText] = useState("");
  const [sendOpen, setSendOpen] = useState(false);
  const [sendDocId, setSendDocId] = useState<string | null>(null);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [sendStage, setSendStage] = useState<"doc" | "where" | "pickAnchor">("doc");
  const [sendTargetSentences, setSendTargetSentences] = useState<Sentence[]>([]);
  const [sendAnchorIdx, setSendAnchorIdx] = useState<number>(0);
  const [sendSearchQuery, setSendSearchQuery] = useState("");
  const [planComposerOpen, setPlanComposerOpen] = useState(false);
  const [planApprovalOpen, setPlanApprovalOpen] = useState(false);
  const [planApprovalId, setPlanApprovalId] = useState<string | null>(null);
  const [plansScreenOpen, setPlansScreenOpen] = useState(false);
  const [exportChooserOpen, setExportChooserOpen] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [orbState, setOrbState] = useState<"idle" | "listening" | "thinking">("idle");
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "light";
    const cached = window.localStorage.getItem("orby_theme");
    return cached === "dark" ? "dark" : "light";
  });
  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef<string>("");
  const favIdxRef = useRef<number>(-1);
  const speechTokenRef = useRef<number>(0);
  const mutedRef = useRef<boolean>(false);
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editOriginIdxRef = useRef<number>(0);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const callAi = useServerFn(aiContinue);

  // Call mode (live voice conversation with Orby)
  const { inCall, overlayMinimized, setOverlayMinimized, registerCallController } = useCallMode();
  const inCallRef = useRef(false);
  useEffect(() => { inCallRef.current = inCall; }, [inCall]);
  useEffect(() => {
    // When entering a call, silence any in-flight sentence speech immediately.
    if (inCall && typeof window !== "undefined" && "speechSynthesis" in window) {
      try { window.speechSynthesis.cancel(); } catch {}
    }
  }, [inCall]);

  // Unseen media count (for menu badge). Invalidated whenever this page mounts
  // (i.e. after returning from /media) and whenever media is seen/changed.
  const { data: unseenCount = 0 } = useQuery({
    queryKey: ["media_unseen_count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("media_assets")
        .select("id", { count: "exact", head: true })
        .is("seen_at", null);
      return count ?? 0;
    },
  });
  useEffect(() => {
    qc.invalidateQueries({ queryKey: ["media_unseen_count"] });
  }, [qc]);

  // Load current user id (for the plans advancer)
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
  }, []);

  // Pending plan badge count
  const { data: pendingPlanCount = 0 } = useQuery({
    queryKey: ["plans_pending_count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("plans")
        .select("id", { count: "exact", head: true })
        .eq("acknowledged", false)
        .in("status", ["completed", "failed"]);
      return count ?? 0;
    },
  });

  // Background plan advancer
  useRunningPlansAdvancer(
    currentUserId,
    () => {
      toast.success("Your plan is done — tap to view", {
        action: { label: "View", onClick: () => setPlansScreenOpen(true) },
      });
      qc.invalidateQueries({ queryKey: ["plans_pending_count"] });
    },
    () => {
      toast.error("A plan failed — tap to see what to do", {
        action: { label: "View", onClick: () => setPlansScreenOpen(true) },
      });
      qc.invalidateQueries({ queryKey: ["plans_pending_count"] });
    },
  );

  // Watch composing plans → auto-approve & start; toast confirms
  useComposingPlansWatcher(
    currentUserId,
    // Auto-approved plan started → "View" opens the AI Plans screen
    () => setPlansScreenOpen(true),
    // Refused/failed → open the plan for review
    (planId) => {
      setPlanApprovalId(planId);
      setPlanApprovalOpen(true);
    },
  );


  // Apply theme
  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    document.documentElement.classList.toggle("dark", theme === "dark");
    if (typeof window !== "undefined") window.localStorage.setItem("orby_theme", theme);
  }, [theme]);

  // Load docs
  const { data: docs, error: docsError, isLoading: docsLoading, refetch: refetchDocs } = useQuery({
    queryKey: ["documents"],
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<Doc[]> => {
      const { data, error } = await supabase
        .from("documents").select("*").order("position", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Bootstrap: create first doc if none
  useEffect(() => {
    if (!docs) return;
    if (docs.length === 0) {
      (async () => {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) return;
        await supabase.from("documents").insert({
          user_id: u.user.id, title: "My first list", position: 0,
        });
        await supabase.from("user_preferences").upsert({
          user_id: u.user.id, theme: "light", grid_layout: [],
        }, { onConflict: "user_id" });
        qc.invalidateQueries({ queryKey: ["documents"] });
      })();
    }
  }, [docs, qc]);


  const activeDoc = useMemo(
    () => docs?.find((d) => d.id === activeDocId) ?? null,
    [docs, activeDocId],
  );

  // Load sentences for active doc
  const { data: sentences } = useQuery({
    queryKey: ["sentences", activeDocId],
    enabled: !!activeDocId,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<Sentence[]> => {
      const { data, error } = await supabase
        .from("sentences").select("*")
        .eq("document_id", activeDocId!)
        .order("order_index", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Load user preferences (favorites array + muted flag + theme)
  const { data: prefs } = useQuery({
    queryKey: ["user_preferences"],
    queryFn: async (): Promise<{ favorites: (string | null)[]; muted: boolean; last_favorite_slot: number | null; theme: "dark" | "light" | null; lock_favorites: boolean; pinned_document_id: string | null; locked_document_id: string | null }> => {
      const { data } = await supabase
        .from("user_preferences")
        .select("favorites, muted, last_favorite_slot, theme, lock_favorites, pinned_document_id, locked_document_id")
        .maybeSingle();
      const raw = (data?.favorites as unknown) ?? [];
      const favorites = Array.isArray(raw) ? (raw as (string | null)[]) : [];
      const t = (data as any)?.theme;
      return { favorites, muted: !!(data as any)?.muted, last_favorite_slot: (data as any)?.last_favorite_slot ?? null, theme: t === "dark" || t === "light" ? t : null, lock_favorites: !!(data as any)?.lock_favorites, pinned_document_id: (data as any)?.pinned_document_id ?? null, locked_document_id: (data as any)?.locked_document_id ?? null };
    },
  });
  const favorites = prefs?.favorites ?? [];
  const muted = prefs?.muted ?? false;
  const lockFavorites = prefs?.lock_favorites ?? false;
  const pinnedDocId = prefs?.pinned_document_id ?? null;
  const lockedDocId = prefs?.locked_document_id ?? null;


  // Hydrate theme from saved preference once it loads.
  useEffect(() => {
    if (prefs?.theme && prefs.theme !== theme) setTheme(prefs.theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs?.theme]);

  const saveTheme = useCallback(async (next: "dark" | "light") => {
    setTheme(next);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    qc.setQueryData(["user_preferences"], (prev: any) => ({ ...(prev ?? {}), theme: next }));
    await supabase.from("user_preferences").upsert(
      { user_id: u.user.id, theme: next, favorites: favorites as any },
      { onConflict: "user_id" },
    );
  }, [qc, favorites]);

  const saveFavorites = useCallback(async (next: (string | null)[]) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    qc.setQueryData(["user_preferences"], (prev: any) => ({
      ...(prev ?? {}), favorites: next,
    }));
    await supabase.from("user_preferences").upsert(
      { user_id: u.user.id, favorites: next as any },
      { onConflict: "user_id" },
    );
  }, [qc]);

  const saveMuted = useCallback(async (next: boolean) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    qc.setQueryData(["user_preferences"], (prev: any) => ({
      ...(prev ?? {}), muted: next,
    }));
    if (next && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    await supabase.from("user_preferences").upsert(
      { user_id: u.user.id, muted: next, favorites: favorites as any },
      { onConflict: "user_id" },
    );
  }, [qc, favorites]);

  const saveLastFavoriteSlot = useCallback(async (slot: number) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    qc.setQueryData(["user_preferences"], (prev: any) => ({
      ...(prev ?? {}), last_favorite_slot: slot,
    }));
    await supabase.from("user_preferences").upsert(
      { user_id: u.user.id, last_favorite_slot: slot, favorites: favorites as any, muted: muted as any },
      { onConflict: "user_id" },
    );
  }, [qc, favorites, muted]);

  const saveLockFavorites = useCallback(async (next: boolean) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    qc.setQueryData(["user_preferences"], (prev: any) => ({
      ...(prev ?? {}), lock_favorites: next,
    }));
    await supabase.from("user_preferences").upsert(
      { user_id: u.user.id, lock_favorites: next, favorites: favorites as any, muted: muted as any },
      { onConflict: "user_id" },
    );
  }, [qc, favorites, muted]);

  const savePinnedDoc = useCallback(async (docId: string | null) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    qc.setQueryData(["user_preferences"], (prev: any) => ({
      ...(prev ?? {}), pinned_document_id: docId,
    }));
    await supabase.from("user_preferences").upsert(
      { user_id: u.user.id, pinned_document_id: docId, favorites: favorites as any, muted: muted as any },
      { onConflict: "user_id" },
    );
  }, [qc, favorites, muted]);

  const saveLockedDoc = useCallback(async (docId: string | null) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    qc.setQueryData(["user_preferences"], (prev: any) => ({
      ...(prev ?? {}), locked_document_id: docId,
    }));
    await supabase.from("user_preferences").upsert(
      { user_id: u.user.id, locked_document_id: docId, favorites: favorites as any, muted: muted as any },
      { onConflict: "user_id" },
    );
  }, [qc, favorites, muted]);




  // Restore last favorite slot (or fall back to first doc) once both docs and prefs are loaded.
  useEffect(() => {
    if (!docs || prefs === undefined || activeDocId) return;
    // If the user is locked onto a list, always restore to that exact document.
    if (prefs?.lock_favorites) {
      const lockedId = prefs?.locked_document_id ?? null;
      if (lockedId && docs.some((d) => d.id === lockedId)) {
        setActiveDocId(lockedId);
        return;
      }
    }
    const lastSlot = prefs?.last_favorite_slot ?? null;
    const favs = prefs?.favorites ?? [];
    const lastDocId = typeof lastSlot === "number" && lastSlot >= 0 && lastSlot < favs.length
      ? favs[lastSlot]
      : null;
    const lastDocExists = lastDocId && docs.some((d) => d.id === lastDocId);
    if (lastDocExists) {
      setActiveDocId(lastDocId);
      favIdxRef.current = lastSlot!;
    } else {
      setActiveDocId(docs[0].id);
    }
  }, [docs, prefs, activeDocId]);

  // Initialize favIdxRef ONLY when there isn't already a valid bookmark.
  // The bookmark (the user's place in the favorites sequence) must advance
  // solely via swipe-right — opening a document directly (search, grid, jump)
  // should never move it. So if the current ref already points at a valid,
  // filled slot whose document still exists, leave it untouched.
  useEffect(() => {
    if (!activeDocId) return;
    const cur = favIdxRef.current;
    const curDocId =
      cur >= 0 && cur < favorites.length ? favorites[cur] : null;
    const curValid = !!curDocId && !!docs?.some((d) => d.id === curDocId);
    if (curValid) return;
    // No valid bookmark yet (fresh session, emptied slot, or deleted doc):
    // anchor it to the opened document's slot if it lives in the list.
    const slot = favorites.findIndex((id) => id === activeDocId);
    if (slot >= 0) {
      favIdxRef.current = slot;
      void saveLastFavoriteSlot(slot);
    }
  }, [favorites, activeDocId, docs, saveLastFavoriteSlot]);

  const currentIdx = activeDoc?.current_sentence_index ?? 0;
  const currentSentence = sentences?.[currentIdx];

  // Keep mutedRef in sync with persisted preference.
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  // Strip emoji and pictographic symbols, but preserve digits, letters,
  // punctuation, and whitespace.
  const stripEmoji = (s: string) =>
    s
      .replace(
        /[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu,
        ""
      )
      .replace(/\s+/g, " ")
      .trim();

  // Copy text to the device clipboard. Must be called synchronously from a
  // user gesture on iOS. Falls back to a hidden textarea + execCommand.
  const copyToClipboard = async (text: string): Promise<boolean> => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  };


  // TTS — token-gated, race-safe against rapid handler chains.
  // NOTE: we do NOT wrap speak() in setTimeout — iOS Safari only honors
  // speechSynthesis.speak() when it's called synchronously after a user
  // gesture (or after the one-time unlock in __root.tsx). Any delay or
  // async hop here causes iOS to silently drop the utterance.
  const speak = useCallback((text: string, token?: number) => {
    if (mutedRef.current) return; // sound off — never invoke speechSynthesis
    if (inCallRef.current) return; // on a call — only the conversation is audible
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (!text) return;
    if (token != null && token !== speechTokenRef.current) return;
    const clean = stripEmoji(text);
    if (!clean) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(clean);
      u.rate = 1; u.pitch = 1;
      window.speechSynthesis.speak(u);
    } catch {}
  }, []);

  // Cancel any in-flight speech and claim a fresh speech token. Call at the
  // start of every user-driven action that might end in speak().
  const claimSpeech = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    return ++speechTokenRef.current;
  }, []);

  // Track "busy" UI state via a ref so the auto-repeat timer can check it at
  // fire time without re-subscribing every time a dialog toggles.
  const busyRef = useRef(false);
  busyRef.current =
    editing ||
    menuOpen ||
    favoritesOpen ||
    jumpOpen ||
    moveOpen ||
    searchOpen ||
    recentOpen ||
    composing ||
    sendOpen ||
    linkPickerOpen ||
    chatOpen ||
    planComposerOpen ||
    planApprovalOpen ||
    plansScreenOpen;

  // Track recently-opened documents (most-recent first) in localStorage.
  useEffect(() => {
    if (!activeDocId) return;
    setRecentIds((prev) => {
      const next = [activeDocId, ...prev.filter((id) => id !== activeDocId)].slice(0, 15);
      try {
        window.localStorage.setItem("orby-recent-docs", JSON.stringify(next));
      } catch {}
      return next;
    });
  }, [activeDocId]);

  // Auto-repeat: re-read the current sentence every 2 minutes of inactivity.
  // Any change to activeDocId / currentIdx / sentence text tears this effect
  // down (clearTimeout), guaranteeing a stale sentence can never be spoken.
  // Does NOT touch Orb mood — only the existing speechSynthesis lip-sync
  // poll in useOrbMood will animate the mouth.
  const repeatText = sentences?.[currentIdx]?.content;
  useEffect(() => {
    if (!repeatText) return;
    let id: ReturnType<typeof setTimeout>;
    const schedule = () => {
      id = setTimeout(() => {
        if (
          mutedRef.current ||
          busyRef.current ||
          (typeof document !== "undefined" && document.hidden)
        ) {
          schedule();
          return;
        }
        const token = claimSpeech();
        speak(repeatText, token);
        schedule();
      }, 2 * 60 * 1000);
    };
    schedule();
    return () => clearTimeout(id);
  }, [activeDocId, currentIdx, repeatText, speak, claimSpeech]);

  const setIndex = useCallback(async (newIdx: number) => {
    if (!activeDoc) return;
    const clamped = Math.max(0, newIdx);
    qc.setQueryData<Doc[]>(["documents"], (prev) =>
      prev?.map((d) => d.id === activeDoc.id ? { ...d, current_sentence_index: clamped } : d) ?? prev,
    );
    await supabase.from("documents")
      .update({ current_sentence_index: clamped })
      .eq("id", activeDoc.id);
  }, [activeDoc, qc]);

  const jumpTo = useCallback(async (target: number) => {
    if (!sentences || sentences.length === 0) return;
    const token = claimSpeech();
    const clamped = Math.max(0, Math.min(target, sentences.length - 1));
    await setIndex(clamped);
    speak(sentences[clamped].content, token);
    setJumpOpen(false);
  }, [sentences, setIndex, speak, claimSpeech]);

  // ---- Call mode bridge ----
  // Expose live view state + actions so the voice call can drive the app.
  const callBridgeRef = useRef({ activeDoc, sentences, currentIdx });
  callBridgeRef.current = { activeDoc, sentences, currentIdx };

  useEffect(() => {
    registerCallController({
      getActiveContext: () => {
        const { activeDoc: ad, sentences: ss, currentIdx: ci } = callBridgeRef.current;
        if (!ad) return null;
        return {
          docId: ad.id,
          title: ad.title,
          currentIndex: ci,
          sentences: (ss ?? []).map((s) => ({ id: s.id, content: s.content })),
        };
      },
      openDocumentById: async (id: string) => {
        const token = claimSpeech();
        const [{ data: freshDoc }, { data: rows }] = await Promise.all([
          supabase
            .from("documents")
            .select("current_sentence_index, title")
            .eq("id", id)
            .maybeSingle(),
          supabase
            .from("sentences")
            .select("*")
            .eq("document_id", id)
            .order("order_index", { ascending: true })
            .order("created_at", { ascending: true }),
        ]);
        const list = (rows ?? []) as Sentence[];
        qc.setQueryData<Sentence[]>(["sentences", id], list);
        const savedIdx = freshDoc?.current_sentence_index ?? 0;
        const clamped = list.length === 0 ? 0 : Math.max(0, Math.min(savedIdx, list.length - 1));
        qc.setQueryData<Doc[]>(["documents"], (prev) =>
          prev?.map((d) => (d.id === id ? { ...d, current_sentence_index: clamped } : d)) ?? prev,
        );
        setActiveDocId(id);
        // Suppress the speech token so opening a doc during a call stays silent.
        if (token === speechTokenRef.current) speechTokenRef.current++;
        return freshDoc?.title ? { title: freshDoc.title } : null;
      },
      jumpToIndex: async (index: number) => {
        const { activeDoc: ad, sentences: ss } = callBridgeRef.current;
        if (!ad || !ss || ss.length === 0) return;
        const clamped = Math.max(0, Math.min(index, ss.length - 1));
        qc.setQueryData<Doc[]>(["documents"], (prev) =>
          prev?.map((d) => (d.id === ad.id ? { ...d, current_sentence_index: clamped } : d)) ?? prev,
        );
        await supabase.from("documents")
          .update({ current_sentence_index: clamped })
          .eq("id", ad.id);
      },
    });
    return () => registerCallController(null);
  }, [registerCallController, qc, claimSpeech]);


  const moveSentence = useCallback(async (target: number) => {
    if (!activeDocId || !sentences || sentences.length === 0) return;
    const from = currentIdx;
    const to = Math.max(0, Math.min(target, sentences.length - 1));
    if (from === to) { setMoveOpen(false); return; }
    const token = claimSpeech();
    const { error } = await supabase.rpc("move_sentence", {
      p_document_id: activeDocId,
      p_from_index: from,
      p_to_index: to,
    });
    if (error) { toast.error(error.message || "Failed to move"); return; }
    await setIndex(to);
    await qc.invalidateQueries({ queryKey: ["sentences", activeDocId] });
    const moved = sentences.find((s) => s.order_index === from);
    if (moved) speak(moved.content, token);
    setMoveOpen(false);
  }, [activeDocId, sentences, currentIdx, setIndex, qc, speak, claimSpeech]);

  const moveCurrentToBottom = useCallback(async () => {
    if (!activeDocId || !sentences || sentences.length === 0) return;
    const from = currentIdx;
    const to = sentences.length - 1;
    if (from >= to) { setMoveOpen(false); return; }
    const token = claimSpeech();
    const { error } = await supabase.rpc("move_sentence", {
      p_document_id: activeDocId,
      p_from_index: from,
      p_to_index: to,
    });
    if (error) { toast.error(error.message || "Failed to move"); return; }
    // Stay at the same index: the next sentence shifts into this slot.
    const next = sentences.find((s) => s.order_index === from + 1);
    await qc.invalidateQueries({ queryKey: ["sentences", activeDocId] });
    if (next) speak(next.content, token);
    setMoveOpen(false);
  }, [activeDocId, sentences, currentIdx, qc, speak, claimSpeech]);

  const advanceSentence = useCallback(async () => {
    if (!activeDoc || !sentences) return;
    const token = claimSpeech();
    const next = currentIdx + 1;
    if (next >= sentences.length) {
      if (sentences[currentIdx]) speak(sentences[currentIdx].content, token);
      return;
    }
    await setIndex(next);
    speak(sentences[next].content, token);
  }, [activeDoc, sentences, currentIdx, setIndex, speak, claimSpeech]);

  const openNewIdea = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setComposeText("");
    setComposing(true);
  }, []);

  const onSwipeUp = useCallback(async () => {
    const token = claimSpeech();
    if (currentIdx === 0) {
      if (sentences?.[0]) speak(sentences[0].content, token);
      return;
    }
    const prev = currentIdx - 1;
    await setIndex(prev);
    if (sentences?.[prev]) speak(sentences[prev].content, token);
  }, [currentIdx, setIndex, sentences, speak, claimSpeech]);

  const deleteCurrent = useCallback(async () => {
    if (!currentSentence || !sentences) return;
    const token = claimSpeech();
    const deleted = currentSentence;
    const remaining = sentences.filter((s) => s.id !== deleted.id);
    // optimistic remove + reindex
    qc.setQueryData<Sentence[]>(["sentences", activeDocId], (prev) =>
      prev?.filter((s) => s.id !== deleted.id).map((s, i) => ({ ...s, order_index: i })) ?? prev,
    );
    await supabase.from("sentences").delete().eq("id", deleted.id);
    qc.invalidateQueries({ queryKey: ["sentences", activeDocId] });

    // Move to the sentence that now occupies this slot (or the new last one)
    if (remaining.length > 0) {
      const nextIdx = Math.min(currentIdx, remaining.length - 1);
      if (nextIdx !== currentIdx) await setIndex(nextIdx);
      speak(remaining[nextIdx].content, token);
    }

    toast("Sentence deleted", {
      id: "sentence-deleted",
      duration: 5000,
      action: {
        label: "Undo",
        onClick: async () => {
          const { data: u } = await supabase.auth.getUser();
          if (!u.user || !activeDocId) return;
          await supabase.from("sentences").insert({
            user_id: u.user.id, document_id: activeDocId,
            content: deleted.content, order_index: deleted.order_index,
          });
          qc.invalidateQueries({ queryKey: ["sentences", activeDocId] });
        },
      },
    });
  }, [currentSentence, sentences, currentIdx, setIndex, speak, qc, activeDocId, claimSpeech]);

  // Slot 15: prepend a 🗑️ to the current sentence as a visual delete cue.
  const markCurrentTrash = useCallback(async () => {
    setMenuOpen(false);
    if (!currentSentence) {
      toast("No sentence selected");
      return;
    }
    if (currentSentence.content.startsWith("🗑️")) {
      toast("Already marked");
      return;
    }
    const newContent = `🗑️ ${currentSentence.content}`;
    const id = currentSentence.id;
    qc.setQueryData<Sentence[]>(["sentences", activeDocId], (prev) =>
      prev?.map((s) => (s.id === id ? { ...s, content: newContent } : s)) ?? prev,
    );
    const { error } = await supabase.from("sentences").update({ content: newContent }).eq("id", id);
    if (error) {
      qc.invalidateQueries({ queryKey: ["sentences", activeDocId] });
      toast("Could not mark sentence");
      return;
    }
    qc.invalidateQueries({ queryKey: ["sentences", activeDocId] });
    toast("Marked for deletion");
  }, [currentSentence, qc, activeDocId]);


  const openLinkedDocument = useCallback(async () => {
    const targetId = currentSentence?.linked_document_id;
    if (!targetId) return;
    const exists = docs?.some((d) => d.id === targetId);
    if (!exists) {
      toast.error("Linked document not found");
      return;
    }

    // Mirror onSwipeRight: resume the target doc at its own saved sentence.
    // Do NOT call setIndex here — it would write to the SOURCE doc's row
    // (activeDoc is still stale until setActiveDocId flushes), wiping the
    // user's position on the doc they're coming from.
    const token = claimSpeech();

    const [{ data: freshDoc }, { data: rows }] = await Promise.all([
      supabase
        .from("documents")
        .select("current_sentence_index, title")
        .eq("id", targetId)
        .maybeSingle(),
      supabase
        .from("sentences")
        .select("*")
        .eq("document_id", targetId)
        .order("order_index", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);
    if (token !== speechTokenRef.current) return;

    const list = (rows ?? []) as Sentence[];
    const savedIdx = freshDoc?.current_sentence_index ?? 0;
    const clamped = list.length === 0
      ? 0
      : Math.max(0, Math.min(savedIdx, list.length - 1));
    const resolved = list[clamped];

    qc.setQueryData<Sentence[]>(["sentences", targetId], list);
    qc.setQueryData<Doc[]>(["documents"], (prev) =>
      prev?.map((d) => d.id === targetId ? { ...d, current_sentence_index: clamped } : d) ?? prev,
    );
    if (clamped !== savedIdx) {
      void supabase.from("documents")
        .update({ current_sentence_index: clamped })
        .eq("id", targetId);
    }

    setActiveDocId(targetId);
    if (resolved?.content) speak(resolved.content, token);
  }, [currentSentence, docs, claimSpeech, speak, qc]);

  const openPinnedDocument = useCallback(async (targetId?: string) => {
    const docId = targetId ?? pinnedDocId;
    if (!docId) {
      toast("No document pinned", { description: "Long-press the pin button to choose one." });
      return;
    }
    const exists = docs?.some((d) => d.id === docId);
    if (!exists) {
      toast.error("Pinned document not found");
      void savePinnedDoc(null);
      return;
    }

    const token = claimSpeech();

    const [{ data: freshDoc }, { data: rows }] = await Promise.all([
      supabase
        .from("documents")
        .select("current_sentence_index, title")
        .eq("id", docId)
        .maybeSingle(),
      supabase
        .from("sentences")
        .select("*")
        .eq("document_id", docId)
        .order("order_index", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);
    if (token !== speechTokenRef.current) return;

    const list = (rows ?? []) as Sentence[];
    const savedIdx = freshDoc?.current_sentence_index ?? 0;
    const clamped = list.length === 0
      ? 0
      : Math.max(0, Math.min(savedIdx, list.length - 1));
    const resolved = list[clamped];

    qc.setQueryData<Sentence[]>(["sentences", docId], list);
    qc.setQueryData<Doc[]>(["documents"], (prev) =>
      prev?.map((d) => d.id === docId ? { ...d, current_sentence_index: clamped } : d) ?? prev,
    );
    if (clamped !== savedIdx) {
      void supabase.from("documents")
        .update({ current_sentence_index: clamped })
        .eq("id", docId);
    }

    setActiveDocId(docId);
    if (resolved?.content) speak(resolved.content, token);
  }, [pinnedDocId, docs, claimSpeech, speak, qc, savePinnedDoc]);

  // Load an arbitrary document by id at its saved sentence (same prime pattern
  // used by openLinkedDocument). Used to return to the locked list.
  const goToDocument = useCallback(async (targetId: string) => {
    const exists = docs?.some((d) => d.id === targetId);
    if (!exists) return;
    const token = claimSpeech();
    const [{ data: freshDoc }, { data: rows }] = await Promise.all([
      supabase
        .from("documents")
        .select("current_sentence_index, title")
        .eq("id", targetId)
        .maybeSingle(),
      supabase
        .from("sentences")
        .select("*")
        .eq("document_id", targetId)
        .order("order_index", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);
    if (token !== speechTokenRef.current) return;
    const list = (rows ?? []) as Sentence[];
    const savedIdx = freshDoc?.current_sentence_index ?? 0;
    const clamped = list.length === 0
      ? 0
      : Math.max(0, Math.min(savedIdx, list.length - 1));
    const resolved = list[clamped];
    qc.setQueryData<Sentence[]>(["sentences", targetId], list);
    qc.setQueryData<Doc[]>(["documents"], (prev) =>
      prev?.map((d) => d.id === targetId ? { ...d, current_sentence_index: clamped } : d) ?? prev,
    );
    if (clamped !== savedIdx) {
      void supabase.from("documents")
        .update({ current_sentence_index: clamped })
        .eq("id", targetId);
    }
    setActiveDocId(targetId);
    if (resolved?.content) speak(resolved.content, token);
  }, [docs, claimSpeech, speak, qc]);

  const onSwipeRightRef = useRef<(() => Promise<void>) | null>(null);

  const onSwipeRight = useCallback(async () => {
    if (!docs || !activeDoc) return;

    // If the current sentence links to a document, swipe right opens it.
    const linkedId = currentSentence?.linked_document_id;
    if (linkedId && docs.some((d) => d.id === linkedId)) {
      await openLinkedDocument();
      return;
    }

    if (lockFavorites) {
      // List cycling locked. The only way off the locked list is following a
      // linked step (handled above). If we've followed links onto another doc
      // and this step has no further link, swipe right returns to the locked
      // list. On the locked list itself, repeat the current sentence.
      if (lockedDocId && activeDocId !== lockedDocId && docs.some((d) => d.id === lockedDocId)) {
        await goToDocument(lockedDocId);
        return;
      }
      const token = claimSpeech();
      const text = sentences?.[currentIdx]?.content;
      if (text) speak(text, token);
      return;
    }




    // Claim TTS BEFORE the network round-trip so any in-flight utterance
    // from a previous tap is killed immediately (not 100ms from now).
    const token = claimSpeech();

    // Pick the next target doc — favorites cycle, or fallback to all-docs cycle.
    let targetId: string | null = null;
    const filled = favorites
      .map((id, i) => ({ id, i }))
      .filter((s): s is { id: string; i: number } =>
        !!s.id && docs.some((d) => d.id === s.id),
      );

    if (filled.length > 0) {
      const curIdx = favIdxRef.current;
      const pos = filled.findIndex((s) => s.i > curIdx);
      const nextSlot = pos === -1 ? filled[0] : filled[pos];
      favIdxRef.current = nextSlot.i;
      void saveLastFavoriteSlot(nextSlot.i);
      targetId = nextSlot.id;
    } else {
      if (docs.length < 2) return;
      const idx = docs.findIndex((d) => d.id === activeDoc.id);
      targetId = docs[(idx + 1) % docs.length].id;
    }
    if (!targetId) return;

    // Fetch the target doc's saved index AND its full ordered sentence list
    // in parallel. The spoken text is then resolved from the SAME list the
    // UI will render, by array position — never by order_index lookup. This
    // is the single source of truth that guarantees display === speech.
    const [{ data: freshDoc }, { data: rows }] = await Promise.all([
      supabase
        .from("documents")
        .select("current_sentence_index, title")
        .eq("id", targetId)
        .maybeSingle(),
      supabase
        .from("sentences")
        .select("*")
        .eq("document_id", targetId)
        .order("order_index", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);
    if (token !== speechTokenRef.current) return; // superseded by newer action

    const list = (rows ?? []) as Sentence[];
    const savedIdx = freshDoc?.current_sentence_index ?? 0;
    const clamped = list.length === 0
      ? 0
      : Math.max(0, Math.min(savedIdx, list.length - 1));
    const resolved = list[clamped];

    // Prime the sentences cache for the target doc so when activeDocId
    // flips, the UI renders THIS exact list immediately (no flash of stale
    // data, no race with the sentences query refetching).
    qc.setQueryData<Sentence[]>(["sentences", targetId], list);

    // Sync the docs cache with the clamped index so the header counter and
    // the spoken sentence agree, and persist the correction if savedIdx
    // pointed past the end of the list (e.g. after deletes).
    qc.setQueryData<Doc[]>(["documents"], (prev) =>
      prev?.map((d) => d.id === targetId ? { ...d, current_sentence_index: clamped } : d) ?? prev,
    );
    if (clamped !== savedIdx) {
      void supabase.from("documents")
        .update({ current_sentence_index: clamped })
        .eq("id", targetId);
    }

    setActiveDocId(targetId);

    if (resolved?.content) speak(resolved.content, token);
  }, [docs, activeDoc, activeDocId, favorites, speak, claimSpeech, qc, saveLastFavoriteSlot, lockFavorites, lockedDocId, goToDocument, sentences, currentIdx, currentSentence, openLinkedDocument]);
  onSwipeRightRef.current = onSwipeRight;



  const onSwipeLeft = useCallback(() => setMenuOpen(true), []);

  const onDoubleTap = useCallback(() => {
    if (editing) return; // already editing — ignore
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    editOriginIdxRef.current = currentIdx;
    const list = sentences ?? [];
    if (list.length === 0) {
      setEditText("");
      setEditing(true);
      return;
    }
    const full = list.map((s) => s.content).join("\n\n");
    setEditText(full);
    setEditing(true);
  }, [editing, currentIdx, sentences]);

  // Long press = open Plan Mode composer (voice capture removed)
  const onLongPressStart = useCallback(() => {
    setPlanComposerOpen(true);
  }, []);

  const onLongPressEnd = useCallback(() => {
    // no-op; the composer takes over from here
  }, []);

  useOrbGestures(
    orbRef,
    {
      onTap: openNewIdea,
      onDoubleTap,
      onTripleTap: deleteCurrent,
      onLongPressStart,
      onLongPressEnd,
      onSwipe: (dir) => {
        (orbRef.current as any)?.boostMood?.();
        if (dir === "up") void advanceSentence();
        else if (dir === "down") void onSwipeUp();
        else if (dir === "left") onSwipeLeft();
        else if (dir === "right") void onSwipeRight();
      },
    },
    { swipeThreshold: 38, moveCancelPx: 16 },
  );

  // Spacebar mirrors the center face: single press = new idea, double = edit.
  useEffect(() => {
    let spaceTaps = 0;
    let spaceTimer: ReturnType<typeof setTimeout> | null = null;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return;
      if (busyRef.current) return; // typing in an editor / dialog open
      e.preventDefault();
      spaceTaps += 1;
      if (spaceTimer) clearTimeout(spaceTimer);
      spaceTimer = setTimeout(() => {
        const n = spaceTaps;
        spaceTaps = 0;
        spaceTimer = null;
        if (n >= 2) onDoubleTap();
        else openNewIdea();
      }, 280);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (spaceTimer) clearTimeout(spaceTimer);
    };
  }, [onDoubleTap, openNewIdea]);


  // Parse the full-doc editor text into sentence parts.
  // Supports punctuation-based splitting (. ! ?) while still respecting
  // separate lines / paragraphs as explicit boundaries.
  const parseEditParts = useCallback((text: string) => {
    const blocks = text
      .replace(/\r\n?/g, "\n")
      .split(/\n\s*\n+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const parts = blocks.flatMap((block) => {
      const lineParts = block
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .flatMap((line) => {
          const sentences = splitIntoSentences(line);
          return sentences.length > 0 ? sentences : [line];
        });

      return lineParts.length > 0 ? lineParts : [block];
    });

    return parts.filter(Boolean);
  }, []);

  // Map a caret position in the editor text to a sentence index (0-based).
  const caretToSentenceIdx = useCallback((text: string, caret: number) => {
    const before = text.slice(0, Math.max(0, Math.min(caret, text.length)));
    const partsBefore = parseEditParts(before);
    return Math.max(0, partsBefore.length - 1);
  }, [parseEditParts]);

  // Bulk save the editor contents, then jump to `targetIdx` (clamped).
  // Returns true on success, false on failure (editor stays open on failure).
  const commitFullEdit = useCallback(async (rawTargetIdx: number | null): Promise<boolean> => {
    if (!activeDocId) { setEditing(false); return true; }
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { setEditing(false); return true; }

    const parts = parseEditParts(editText);

    // Re-fetch existing rows directly to avoid stale cache mid-edit.
    const { data: freshExisting, error: fetchErr } = await supabase
      .from("sentences")
      .select("id, content, order_index")
      .eq("document_id", activeDocId)
      .order("order_index", { ascending: true })
      .order("created_at", { ascending: true });

    if (fetchErr) {
      console.error("[edit] fetch existing failed", fetchErr);
      toast.error("Couldn't save edits");
      return false;
    }
    const existing = freshExisting ?? [];

    // Empty doc: delete everything and bail.
    if (parts.length === 0) {
      if (existing.length > 0) {
        const { error: delErr } = await supabase.from("sentences")
          .delete()
          .in("id", existing.map((s) => s.id));
        if (delErr) {
          console.error("[edit] delete-all failed", delErr);
          toast.error("Couldn't save edits");
          return false;
        }
      }
      qc.invalidateQueries({ queryKey: ["sentences", activeDocId] });
      await setIndex(0);
      setEditing(false);
      setEditText("");
      return true;
    }

    // Skip-if-unchanged: if new parts match existing rows' content in order,
    // there is nothing to save. Neutralizes the case where opening + closing
    // the editor on a doc containing sentences with internal '?' / '!' / '.'
    // would otherwise trigger a destructive re-split + reinsert round-trip.
    if (existing.length === parts.length) {
      let same = true;
      for (let i = 0; i < parts.length; i++) {
        if (existing[i].content !== parts[i]) { same = false; break; }
      }
      if (same) {
        const fallback = Math.min(editOriginIdxRef.current, parts.length - 1);
        const targetIdx = rawTargetIdx == null
          ? Math.max(0, fallback)
          : Math.max(0, Math.min(rawTargetIdx, parts.length - 1));
        await setIndex(targetIdx);
        setEditing(false);
        setEditText("");
        const token = claimSpeech();
        speak(parts[targetIdx], token);
        return true;
      }
    }

    // Atomic save: a single transactional RPC replaces the old 4-step
    // park/reuse/insert/delete dance. A mid-save network handoff
    // (Wi-Fi <-> cellular) can now only land in pre-call or post-call state,
    // never a "rows stranded at order_index 1_000_000+" half-applied state.
    // The RPC preserves row identity (and therefore linked_document_id) by
    // matching new parts to existing rows on exact content, closest-by-order.
    const { error: rpcErr } = await supabase.rpc("commit_document_edit", {
      p_document_id: activeDocId,
      p_contents: parts,
    });
    if (rpcErr) {
      console.error("[edit] commit_document_edit failed", rpcErr);
      toast.error("Couldn't save edits");
      return false;
    }

    qc.invalidateQueries({ queryKey: ["sentences", activeDocId] });


    // Resolve the post-save index.
    const fallback = Math.min(editOriginIdxRef.current, parts.length - 1);
    const targetIdx = rawTargetIdx == null
      ? Math.max(0, fallback)
      : Math.max(0, Math.min(rawTargetIdx, parts.length - 1));

    await setIndex(targetIdx);
    setEditing(false);
    setEditText("");

    const token = claimSpeech();
    speak(parts[targetIdx], token);
    return true;
  }, [activeDocId, editText, parseEditParts, qc, setIndex, speak, claimSpeech]);

  const handleEditDone = useCallback(async () => {
    const el = editTextareaRef.current;
    const caret = el?.selectionStart ?? editText.length;
    const idx = caretToSentenceIdx(editText, caret);
    const ok = await commitFullEdit(idx);
    if (ok) toast("Saved", { id: "edit-saved" });
  }, [editText, caretToSentenceIdx, commitFullEdit]);

  const handleEditJump = useCallback(async () => {
    const el = editTextareaRef.current;
    const caret = el?.selectionStart ?? 0;
    const idx = caretToSentenceIdx(editText, caret);
    const ok = await commitFullEdit(idx);
    if (ok) toast("Jumped", { id: "edit-jumped" });
  }, [editText, caretToSentenceIdx, commitFullEdit]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setEditText("");
  }, []);


  const cancelCompose = useCallback(() => {
    setComposing(false);
    setComposeText("");
    setSendOpen(false);
    setSendDocId(null);
    setSendStage("doc");
    setSendTargetSentences([]);
    setSendAnchorIdx(0);
    setSendSearchQuery("");
  }, []);

  // User picked a target document; load its sentences so they can either jump
  // straight to top/bottom or scroll a sentence list and pick the exact anchor.
  const pickSendDoc = useCallback(async (docId: string) => {
    setSendDocId(docId);
    setSendStage("where");
    const { data } = await supabase
      .from("sentences")
      .select("*")
      .eq("document_id", docId)
      .order("order_index", { ascending: true })
      .order("created_at", { ascending: true });
    const list = (data ?? []) as Sentence[];
    setSendTargetSentences(list);
    const targetDoc = docs?.find((d) => d.id === docId);
    const saved = docId === activeDocId
      ? currentIdx
      : (targetDoc?.current_sentence_index ?? 0);
    setSendAnchorIdx(list.length === 0 ? 0 : Math.max(0, Math.min(saved, list.length - 1)));
  }, [docs, activeDocId, currentIdx]);

  // Send-to is a plain paste operation. DO NOT add logic that reorders the
  // existing sentences of the target document. The only thing this function
  // should do is compute an insertion index and call the RPC, which inserts
  // the new block as-is and shifts only the tail. If you find yourself
  // sorting, re-ranking, or rewriting order_index here — stop, the bug
  // you're "fixing" lives somewhere else.
  const sendIdea = useCallback(async (
    targetDocId: string,
    position: "top" | "bottom" | "current" | "afterAnchor",
    anchorIdx?: number,
  ) => {
    const parts = splitIntoSentences(composeText);
    if (parts.length === 0) { cancelCompose(); return; }

    const targetDoc = docs?.find((d) => d.id === targetDocId);

    // Resolve insertion index. For "current", use the live current sentence
    // index of the target doc (which equals currentIdx when sending to the
    // active doc). For "afterAnchor", use the explicit picker selection.
    const targetLen = sendTargetSentences.length;
    const targetCurrentIdx = targetDocId === activeDocId
      ? currentIdx
      : (targetDoc?.current_sentence_index ?? 0);

    let insertAt: number;
    if (position === "top") {
      insertAt = 0;
    } else if (position === "bottom") {
      insertAt = targetLen;
    } else if (position === "current") {
      insertAt = targetLen === 0
        ? 0
        : Math.max(0, Math.min(targetCurrentIdx + 1, targetLen));
    } else {
      insertAt = Math.max(0, Math.min((anchorIdx ?? 0) + 1, targetLen));
    }

    const { error } = await supabase.rpc("insert_sentences_at", {
      p_document_id: targetDocId,
      p_contents: parts,
      p_insert_at: insertAt,
    });
    if (error) {
      toast.error(error.message || "Failed to send");
      return;
    }

    // Point the target document's reading position at the first newly
    // inserted sentence so the idea is immediately reachable — and so it
    // isn't buried off-screen in this one-sentence-at-a-time reader.
    void supabase.from("documents")
      .update({ current_sentence_index: insertAt })
      .eq("id", targetDocId);
    qc.setQueryData<Doc[]>(["documents"], (prev) =>
      prev?.map((d) => d.id === targetDocId ? { ...d, current_sentence_index: insertAt } : d) ?? prev,
    );

    // Read back the true count so the user gets confirmation it landed.
    const { count } = await supabase
      .from("sentences")
      .select("id", { count: "exact", head: true })
      .eq("document_id", targetDocId);

    // Refresh caches/counters live — both the target's sentences and the
    // documents list — so nothing requires navigating away to update.
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["sentences", targetDocId] }),
      qc.invalidateQueries({ queryKey: ["documents"] }),
    ]);

    const title = targetDoc?.title ?? "document";
    const added = parts.length;
    toast(
      typeof count === "number"
        ? `Added ${added} to "${title}" — ${count} total`
        : `Added ${added} to "${title}"`,
      { id: "idea-sent" },
    );
    cancelCompose();

    // If we sent into the document we're currently viewing, jump to and speak
    // the new idea. Otherwise resume the active doc's current sentence.
    // Called synchronously within the user-gesture handler so iOS Safari
    // honors the utterance.
    const spoken = targetDocId === activeDocId
      ? parts[0]
      : sentences?.[currentIdx]?.content;
    if (spoken) {
      const token = claimSpeech();
      speak(spoken, token);
    }
  }, [composeText, docs, sendTargetSentences, qc, cancelCompose, activeDocId, currentIdx, sentences, claimSpeech, speak]);

  // Swap the user's most-recent favorite slot to point at the currently-viewed
  // document. Useful when navigating into a linked doc that isn't favorited.
  const replaceCurrentSlot = useCallback(async () => {
    const slot = favIdxRef.current;
    if (slot < 0 || !activeDocId) return;
    if (favorites[slot] === activeDocId) return;
    const next = [...favorites];
    while (next.length <= slot) next.push(null);
    next[slot] = activeDocId;
    await saveFavorites(next);
    await saveLastFavoriteSlot(slot);
    const docB = docs?.find((d) => d.id === activeDocId);
    toast(`Slot ${slot + 1} now holds "${docB?.title ?? "this document"}"`);
    cancelCompose();
    const resume = sentences?.[currentIdx]?.content;
    if (resume) {
      const token = claimSpeech();
      speak(resume, token);
    }
  }, [favorites, activeDocId, docs, sentences, currentIdx, saveFavorites, saveLastFavoriteSlot, cancelCompose, claimSpeech, speak]);

  // Swap every slot currently holding the active document to the next
  // document in alphabetical order (same sort used everywhere else).
  const swapSlot = useCallback(async () => {
    if (!docs || !activeDocId) return;
    const slotsHolding = favorites
      .map((id, i) => ({ id, i }))
      .filter((s) => s.id === activeDocId)
      .map((s) => s.i);
    if (slotsHolding.length === 0) {
      toast.error("This document isn't in any slot");
      return;
    }
    if (docs.length < 2) {
      toast.error("No other document to swap to");
      return;
    }
    const sorted = sortDocsByTitle(docs);
    const curPos = sorted.findIndex((d) => d.id === activeDocId);
    const nextDoc = sorted[(curPos + 1) % sorted.length];
    if (!nextDoc || nextDoc.id === activeDocId) return;

    const token = claimSpeech();
    const next = [...favorites];
    for (const i of slotsHolding) next[i] = nextDoc.id;
    await saveFavorites(next);
    const stickSlot = slotsHolding.includes(favIdxRef.current)
      ? favIdxRef.current
      : slotsHolding[0];
    favIdxRef.current = stickSlot;
    await saveLastFavoriteSlot(stickSlot);

    // Navigate the view to the new document, mirroring onSwipeRight.
    const [{ data: freshDoc }, { data: rows }] = await Promise.all([
      supabase
        .from("documents")
        .select("current_sentence_index, title")
        .eq("id", nextDoc.id)
        .maybeSingle(),
      supabase
        .from("sentences")
        .select("*")
        .eq("document_id", nextDoc.id)
        .order("order_index", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);
    if (token !== speechTokenRef.current) return;
    const list = (rows ?? []) as Sentence[];
    const savedIdx = freshDoc?.current_sentence_index ?? 0;
    const clamped = list.length === 0 ? 0 : Math.max(0, Math.min(savedIdx, list.length - 1));
    const resolved = list[clamped];
    qc.setQueryData<Sentence[]>(["sentences", nextDoc.id], list);
    qc.setQueryData<Doc[]>(["documents"], (prev) =>
      prev?.map((d) => d.id === nextDoc.id ? { ...d, current_sentence_index: clamped } : d) ?? prev,
    );
    if (clamped !== savedIdx) {
      void supabase.from("documents")
        .update({ current_sentence_index: clamped })
        .eq("id", nextDoc.id);
    }
    setActiveDocId(nextDoc.id);
    toast.success(`Swapped to "${nextDoc.title}" in ${slotsHolding.length} slot${slotsHolding.length === 1 ? "" : "s"}`);
    if (resolved?.content) speak(resolved.content, token);
  }, [docs, activeDocId, favorites, saveFavorites, saveLastFavoriteSlot, qc, claimSpeech, speak]);




  // Parse a .txt file of checklists into [{ title, sentences[] }, ...]
  // Format: titles on their own line wrapped in ===...===, items below as
  // checkbox lines like "[ ] foo", "[x] bar" (optionally prefixed with - or *).
  const parseChecklists = useCallback((text: string) => {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const titleRe = /^\s*===\s*(.+?)\s*===\s*$/;
    const itemRe = /^\s*(?:[-*]\s*)?\[[\sxX]?\]\s*(.+?)\s*$/;
    const out: Array<{ title: string; sentences: string[] }> = [];
    let cur: { title: string; sentences: string[] } | null = null;
    for (const raw of lines) {
      const tm = raw.match(titleRe);
      if (tm) {
        if (cur && cur.sentences.length > 0) out.push(cur);
        cur = { title: tm[1] || "Untitled", sentences: [] };
        continue;
      }
      if (!cur) continue;
      const im = raw.match(itemRe);
      let s: string;
      if (im) {
        s = im[1].trim();
      } else {
        s = raw.trim();
        if (!s) continue;
      }
      if (!s) continue;
      if (!/[.!?]$/.test(s)) s += ".";
      cur.sentences.push(s);
    }
    if (cur && cur.sentences.length > 0) out.push(cur);
    return out;
  }, []);

  const handleImportFile = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const parsed = parseChecklists(text);
      if (parsed.length === 0) { toast.error("No checklists found"); return; }
      const existingByTitle = new Map<string, { id: string }>();
      (docs ?? []).forEach((d: any) => existingByTitle.set(d.title.trim().toLowerCase(), { id: d.id }));
      const updates = parsed.filter(p => existingByTitle.has(p.title.trim().toLowerCase())).length;
      const creates = parsed.length - updates;
      if (!confirm(`Import ${parsed.length} checklist${parsed.length === 1 ? "" : "s"}? (${creates} new, ${updates} will replace existing)`)) return;

      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { toast.error("Not signed in"); return; }
      const basePos = docs?.length ?? 0;
      const tId = toast.loading(`Importing 0 / ${parsed.length}…`);
      let firstId: string | null = null;
      let done = 0;
      let newIdx = 0;
      for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i];
        const existing = existingByTitle.get(item.title.trim().toLowerCase());
        let docId: string;
        if (existing) {
          docId = existing.id;
          const { error: delErr } = await supabase.from("sentences").delete().eq("document_id", docId);
          if (delErr) { toast.error(`Failed to clear "${item.title}"`); continue; }
        } else {
          const { data: doc, error: dErr } = await supabase
            .from("documents")
            .insert({ user_id: u.user.id, title: item.title, position: basePos + newIdx })
            .select().single();
          if (dErr || !doc) { toast.error(`Failed to create "${item.title}"`); continue; }
          docId = doc.id;
          newIdx++;
        }
        if (!firstId) firstId = docId;
        const { error: sErr } = await supabase.rpc("insert_sentences_at", {
          p_document_id: docId,
          p_contents: item.sentences,
          p_insert_at: 0,
        });
        if (sErr) toast.error(`Failed sentences for "${item.title}"`);
        done++;
        toast.loading(`Importing ${done} / ${parsed.length}…`, { id: tId });
      }
      toast.success(`Imported ${done} checklist${done === 1 ? "" : "s"} (${creates} new, ${updates} replaced)`, { id: tId });
      qc.invalidateQueries({ queryKey: ["documents"] });
      if (firstId) setActiveDocId(firstId);
    } catch (e: any) {
      toast.error(e?.message || "Import failed");
    }
  }, [parseChecklists, docs, qc]);

  // openLinkedDocument is defined above (before onSwipeRight) so swipe-right can call it.

  // Build the timestamp string shared by all export filenames.
  const exportStamp = useCallback(() => {
    const now = new Date();
    const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];
    let h = now.getHours();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${months[now.getMonth()]}_${now.getDate()}_${h}${String(now.getMinutes()).padStart(2, "0")}${ampm}`;
  }, []);

  const downloadBlob = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  // Slugify a document title for use in a filename.
  const slugTitle = useCallback((title: string) => {
    const s = (title || "document").trim().replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
    return s || "document";
  }, []);

  // Fetch the active document's sentences (joined into one string).
  const fetchActiveDocText = useCallback(async () => {
    if (!activeDocId) return null;
    let list = qc.getQueryData<Array<{ content: string }>>(["sentences", activeDocId]);
    if (!list) {
      const { data } = await supabase
        .from("sentences")
        .select("content")
        .eq("document_id", activeDocId)
        .order("order_index", { ascending: true });
      list = data ?? [];
    }
    return list.map((s) => s.content);
  }, [activeDocId, qc]);

  const handleExportCurrentTxt = useCallback(async () => {
    if (!activeDocId || !activeDoc) { toast.error("No document open"); return; }
    try {
      const lines = await fetchActiveDocText();
      const text = (lines ?? []).join("\n").trim();
      if (!text) { toast.error("Document is empty"); return; }
      const blob = new Blob([`=== ${activeDoc.title} ===\n${text}\n`], { type: "text/plain;charset=utf-8" });
      downloadBlob(blob, `${slugTitle(activeDoc.title)}_${exportStamp()}.txt`);
      toast.success("Exported document");
    } catch (e: any) {
      toast.error(e?.message || "Export failed");
    }
  }, [activeDocId, activeDoc, fetchActiveDocText, downloadBlob, slugTitle, exportStamp]);

  const handleExportCurrentPdf = useCallback(async () => {
    if (!activeDocId || !activeDoc) { toast.error("No document open"); return; }
    try {
      const lines = await fetchActiveDocText();
      const sentences = (lines ?? []).map((s) => s.trim()).filter(Boolean);
      if (sentences.length === 0) { toast.error("Document is empty"); return; }
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const margin = 48;
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const maxWidth = pageWidth - margin * 2;
      let y = margin;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      const titleLines = doc.splitTextToSize(activeDoc.title, maxWidth);
      for (const tl of titleLines) {
        doc.text(tl, margin, y);
        y += 24;
      }
      y += 8;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(12);
      const lineHeight = 18;
      for (const sentence of sentences) {
        const wrapped = doc.splitTextToSize(sentence, maxWidth);
        for (const wl of wrapped) {
          if (y > pageHeight - margin) {
            doc.addPage();
            y = margin;
          }
          doc.text(wl, margin, y);
          y += lineHeight;
        }
        y += 6;
      }

      doc.save(`${slugTitle(activeDoc.title)}_${exportStamp()}.pdf`);
      toast.success("Exported PDF");
    } catch (e: any) {
      toast.error(e?.message || "Export failed");
    }
  }, [activeDocId, activeDoc, fetchActiveDocText, slugTitle, exportStamp]);

  const handleExportAll = useCallback(async () => {
    try {
      const { data: allDocs, error: dErr } = await supabase
        .from("documents")
        .select("id, title")
        .order("position", { ascending: true });
      if (dErr) throw dErr;
      if (!allDocs || allDocs.length === 0) {
        toast.error("No documents to export");
        return;
      }
      const parts: string[] = [];
      for (const d of allDocs) {
        const { data: rows } = await supabase
          .from("sentences")
          .select("content")
          .eq("document_id", d.id)
          .order("order_index", { ascending: true });
        parts.push(`=== ${d.title} ===`);
        for (const r of rows ?? []) parts.push(r.content);
        parts.push("");
      }
      const text = parts.join("\n");
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      downloadBlob(blob, `orby_export_${exportStamp()}.txt`);
      toast.success(`Exported ${allDocs.length} document${allDocs.length === 1 ? "" : "s"}`);
    } catch (e: any) {
      toast.error(e?.message || "Export failed");
    }
  }, [downloadBlob, exportStamp]);

  // Toggle list-cycling lock on/off (shared by the menu button and the
  // left invisible button flanking the orb).
  const toggleListLock = useCallback((closeMenu: boolean) => {
    const next = !lockFavorites;
    if (closeMenu) setMenuOpen(false);
    void saveLockFavorites(next);
    // Remember which list is being locked so a reload returns to it.
    void saveLockedDoc(next ? activeDocId : null);
    toast.success(next ? "Swipe-right list cycling locked" : "Swipe-right list cycling unlocked");
  }, [lockFavorites, saveLockFavorites, saveLockedDoc, activeDocId]);

  // Menu actions
  const grid = useMemo(() => [
    { e: "🌓", t: "Theme", fn: () => void saveTheme(theme === "dark" ? "light" : "dark") },
    {
      e: muted ? "🔇" : "🔊",
      t: muted ? "Sound off" : "Sound on",
      fn: () => {
        // CRITICAL iOS: close popup + speak synchronously inside this tap
        // gesture. Any async hop here breaks the user-gesture context and
        // iOS Safari silently drops the utterance.
        const next = !muted;
        setMenuOpen(false);
        if (next) {
          // Muting: stop any in-flight speech immediately.
          if (typeof window !== "undefined" && "speechSynthesis" in window) {
            try { window.speechSynthesis.cancel(); } catch {}
          }
        } else {
          // Unmuting: speak the currently displayed sentence right now,
          // synchronously, from this exact tap. This is the iPhone-safe
          // trigger for the Web Speech API.
          const text = currentSentence?.content;
          if (text && typeof window !== "undefined" && "speechSynthesis" in window) {
            try {
              window.speechSynthesis.cancel();
              const clean = stripEmoji(text);
              if (clean) {
                const u = new SpeechSynthesisUtterance(clean);
                u.rate = 1; u.pitch = 1;
                window.speechSynthesis.speak(u);
              }
            } catch {}
          }
        }
        // Persist preference (async, fire-and-forget — happens AFTER speak).
        void saveMuted(next);
      },
    },
    { e: "💬", t: "Chat", fn: () => {
      setMenuOpen(false);
      setChatOpen(true);
    }},
    // Slots 14 & 15 (Analyze img / Web search) folded into Chat — kept inert to preserve grid indices.
    { e: "💬", t: "Chat", fn: () => { setMenuOpen(false); setChatOpen(true); }},
    { e: "💬", t: "Chat", fn: () => { setMenuOpen(false); setChatOpen(true); }},
    { e: "➕", t: "New doc", fn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const title = prompt("Document title?") || "Untitled";
      const pos = (docs?.length ?? 0);
      const { data } = await supabase.from("documents")
        .insert({ user_id: u.user.id, title, position: pos })
        .select().single();
      if (data) setActiveDocId(data.id);
      qc.invalidateQueries({ queryKey: ["documents"] });
      setMenuOpen(false);
    }},
    { e: "✏️", t: "Rename", fn: async () => {
      if (!activeDoc) return;
      const title = prompt("New title?", activeDoc.title);
      if (!title) return;
      await supabase.from("documents").update({ title }).eq("id", activeDoc.id);
      qc.invalidateQueries({ queryKey: ["documents"] });
      setMenuOpen(false);
    }},
    { e: "🗑️", t: "Delete doc", fn: async () => {
      if (!activeDoc) return;
      if (!confirm(`Delete "${activeDoc.title}"? This cannot be undone.`)) return;
      const deletedId = activeDoc.id;
      await supabase.from("documents").delete().eq("id", deletedId);
      // Prune from favorites
      if (favorites.some((id) => id === deletedId)) {
        const pruned = favorites.map((id) => (id === deletedId ? null : id));
        await saveFavorites(pruned);
      }
      setActiveDocId(null);
      favIdxRef.current = -1;
      qc.invalidateQueries({ queryKey: ["documents"] });
      setMenuOpen(false);
    }},
    { e: "⭐", t: "Favorites", fn: () => {
      setMenuOpen(false);
      setFavoritesOpen(true);
    }},
    { e: "🔃", t: "Jump to", fn: () => {
      setMenuOpen(false);
      setJumpOpen(true);
    }, onLongPress: () => {
      setMenuOpen(false);
      void jumpTo(0);
    }},
    { e: "↕️", t: "Move sentence", fn: () => {
      setMenuOpen(false);
      setMoveOpen(true);
    }, onLongPress: () => {
      setMenuOpen(false);
      void moveCurrentToBottom();
    }},
    { e: "🔍", t: "Search docs", fn: () => {
      setMenuOpen(false);
      setSearchQuery("");
      setSearchOpen(true);
    }},
    { e: "📋", t: "Copy sentence", fn: () => {
      setMenuOpen(false);
      const text = currentSentence?.content;
      if (!text) { toast.error("No sentence to copy"); return; }
      copyToClipboard(text).then((ok) => {
        if (ok) toast.success("Copied sentence");
        else toast.error("Failed to copy");
      });
    }},
    { e: "📄", t: "Copy document", fn: async () => {
      setMenuOpen(false);
      if (!activeDocId) { toast.error("No document open"); return; }
      let list = qc.getQueryData<Array<{ content: string }>>(["sentences", activeDocId]);
      if (!list) {
        const { data } = await supabase
          .from("sentences")
          .select("content")
          .eq("document_id", activeDocId)
          .order("order_index", { ascending: true });
        list = data ?? [];
      }
      const full = list.map((s) => s.content).join(" ").trim();
      if (!full) { toast.error("Document is empty"); return; }
      const ok = await copyToClipboard(full);
      if (ok) toast.success("Copied document");
      else toast.error("Failed to copy");
    }},
    { e: "🚪", t: "Sign out", fn: async () => {
      await supabase.auth.signOut();
      navigate({ to: "/" });
    }},
    { e: "📥", t: "Import text", fn: () => {
      setMenuOpen(false);
      // Reset value so picking the same file twice still fires onChange
      if (importInputRef.current) importInputRef.current.value = "";
      importInputRef.current?.click();
    }},
    { e: "🖼️", t: "Media Gallery", fn: () => {
      setMenuOpen(false);
      navigate({ to: "/media" });
    }, badge: unseenCount },
    { e: "💾", t: "Export text", fn: () => {
      setMenuOpen(false);
      setExportChooserOpen(true);
    }},
    { e: "🔗", t: "Link to doc", fn: () => {
      if (!currentSentence) { toast.error("No sentence selected"); return; }
      setMenuOpen(false);
      setLinkPickerOpen(true);
    }},
    { e: "📌", t: "Pinned doc", fn: () => {
      if (lockFavorites) { toast.error("List is locked"); return; }
      setMenuOpen(false);
      void openPinnedDocument();
    }, onLongPress: () => {
      setPinPickerQuery("");
      setPinPickerOpen(true);
    }},
    { e: "🧠", t: "Plan mode", fn: () => {
      setMenuOpen(false);
      setPlanComposerOpen(true);
    }},
    { e: "🤖", t: "AI Plans", fn: () => {
      setMenuOpen(false);
      setPlansScreenOpen(true);
    }, badge: pendingPlanCount },
    {
      e: lockFavorites ? "⛔️" : "🔓",
      t: lockFavorites ? "List locked" : "List unlocked",
      fn: () => toggleListLock(true),
    },
    { e: "⚡️", t: "Swap slot", fn: () => { setMenuOpen(false); setReplaceMatching(true); setPickerQuery("🟢"); setFavoritesOpen(true); setPickerSlot(0); } },
    { e: "🕘", t: "Recent docs", fn: () => { setMenuOpen(false); setRecentOpen(true); } },
    { e: "🗑️", t: "Mark trash", fn: () => void markCurrentTrash() },
  ], [theme, saveTheme, muted, saveMuted, currentSentence, docs, activeDoc, activeDocId, favorites, saveFavorites, qc, navigate, unseenCount, handleExportAll, openLinkedDocument, openPinnedDocument, pendingPlanCount, lockFavorites, saveLockFavorites, saveLockedDoc, swapSlot, markCurrentTrash, moveSentence, moveCurrentToBottom, sentences]);



  // Arrange menu buttons into the requested 4x6 grid slots
  const slots = useMemo(() => {
    const filled: Array<{ e: string; t: string; fn: () => void; badge?: number; onLongPress?: () => void } | null> = Array(24).fill(null);
    filled[0] = grid[0];   // 1  Theme
    filled[1] = grid[6];   // 2  Rename
    filled[2] = grid[5];   // 3  New doc
    filled[3] = grid[1];   // 4  Sound on/off
    filled[4] = grid[7];   // 5  Delete doc
    filled[5] = grid[10];  // 6  Move sentence (long-press preserved)
    filled[6] = grid[12];  // 7  Copy sentence
    filled[7] = grid[13];  // 8  Copy document
    filled[8] = grid[15];  // 9  Import checklists
    filled[9] = grid[14];  // 10 Sign out
    filled[10] = grid[20]; // 11 Plan mode
    filled[11] = grid[9];  // 12 Jump to
    filled[12] = grid[2];  // 13 Chat (combines Gen text / Analyze img / Web search)
    filled[13] = grid[21];  // 14 AI Plans
    filled[14] = grid[25]; // 15 Mark with trash
    filled[15] = grid[8];  // 16 Favorites
    filled[16] = grid[17]; // 17 Export text
    filled[17] = grid[18]; // 18 Link to doc
    filled[18] = grid[19]; // 19 Open link
    filled[19] = grid[11]; // 20 Search docs
    filled[20] = grid[24]; // 21 Recent docs
    filled[21] = grid[22]; // 22 Lock/unlock list cycling
    filled[22] = grid[16]; // 23 Media Gallery
    filled[23] = grid[23]; // 24 Swap slot


    return filled;
  }, [grid]);

  return (
    <main
      className="relative flex h-[100svh] max-h-[100svh] flex-col overflow-hidden text-foreground"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {/* Background */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-background" />
        <div className="app-aurora" />
        <div className="absolute left-1/2 top-1/2 h-[60vh] w-[80vw] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-25 blur-3xl"
          style={{ background: "radial-gradient(closest-side, var(--aurora-2), transparent 70%)" }} />
      </div>

      {/* Connection error fallback — never leave the user stuck on a blank shell */}
      {docsError && !docsLoading && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/95 px-8 text-center backdrop-blur-sm">
          <div className="text-2xl">📡</div>
          <div className="text-base font-medium text-foreground">Couldn't reach the server</div>
          <div className="max-w-xs text-sm text-muted-foreground">
            Check your connection and try again. Your data is safe.
          </div>
          <button
            type="button"
            onClick={() => refetchDocs()}
            className="mt-2 rounded-full px-6 py-2.5 text-sm font-medium text-white transition active:scale-95"
            style={{ background: "linear-gradient(135deg, var(--aurora-1), var(--aurora-2))" }}
          >
            Retry
          </button>
        </div>
      )}


      {/* Top: doc title */}
      <header className="relative px-6 pt-[env(safe-area-inset-top,1rem)] pt-4 text-center">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">
          {composing ? (
            <span className="text-primary">New idea · {activeDoc?.title ?? "—"}</span>
          ) : (
            <>
              {activeDoc?.title ?? "—"}
              {sentences && (
                <span className="ml-2 opacity-60">
                  {Math.min(currentIdx + 1, sentences.length || 1)} / {Math.max(sentences.length, 1)}
                </span>
              )}
            </>
          )}
        </div>
        {!composing && currentSentence?.linked_document_id && (() => {
          const linkedDocTitle = docs?.find((d) => d.id === currentSentence.linked_document_id)?.title ?? null;
          return (
            <div className="mt-2 flex justify-center">
              <button
                type="button"
                onClick={() => void openLinkedDocument()}
                className="flex max-w-[80vw] items-center gap-1.5 rounded-full border border-primary/40 bg-card/80 px-3 py-1.5 text-xs text-primary backdrop-blur transition active:scale-95 hover:bg-primary/15"
                style={{ boxShadow: "0 0 24px -8px var(--aurora-2)" }}
              >
                <LinkIcon className="h-3 w-3 shrink-0" />
                <span className="truncate">{linkedDocTitle ?? "Linked"}</span>
              </button>
            </div>
          );
        })()}
      </header>

      {/* Sentence */}
      <section className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-6 pb-4">
        <div className="w-full max-w-2xl max-h-full overflow-y-auto text-center">
          {composing ? (
            <textarea
              ref={(el) => {
                if (!el) return;
                if ((el as any).__joystickInit) return;
                (el as any).__joystickInit = true;
                el.focus();
              }}
              value={composeText}
              onChange={(e) => setComposeText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelCompose();
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  if (composeText.trim()) {
                    (e.currentTarget as HTMLTextAreaElement).blur();
                    setSendOpen(true);
                  }
                }
              }}
              placeholder="Type your new idea…"
              className="w-full resize-none bg-transparent text-center font-display text-3xl leading-tight outline-none placeholder:text-muted-foreground/40 md:text-4xl"
              rows={4}
            />
          ) : editing ? (
            <textarea
              ref={(el) => {
                editTextareaRef.current = el;
                if (!el) return;
                // Defer focus + caret + scroll into the next frame so layout
                // settles (important on iOS Safari/Chrome where the keyboard
                // pushes the viewport).
                if ((el as any).__joystickInit) return;
                (el as any).__joystickInit = true;
                requestAnimationFrame(() => {
                  el.focus();
                  // Compute caret = end of the originally-current sentence.
                  const list = sentences ?? [];
                  const originIdx = editOriginIdxRef.current;
                  let caret = 0;
                  for (let i = 0; i <= originIdx && i < list.length; i++) {
                    caret += list[i].content.length;
                    if (i < originIdx) caret += 2; // "\n\n" separator
                  }
                  caret = Math.min(caret, el.value.length);
                  try { el.setSelectionRange(caret, caret); } catch {}
                  // Center the caret line using a hidden mirror div.
                  requestAnimationFrame(() => {
                    try {
                      const cs = window.getComputedStyle(el);
                      const mirror = document.createElement("div");
                      const copyProps = [
                        "boxSizing","width","fontFamily","fontSize","fontWeight",
                        "lineHeight","letterSpacing","padding","border",
                        "whiteSpace","wordWrap","wordBreak",
                      ] as const;
                      for (const p of copyProps) (mirror.style as any)[p] = (cs as any)[p];
                      mirror.style.position = "absolute";
                      mirror.style.visibility = "hidden";
                      mirror.style.whiteSpace = "pre-wrap";
                      mirror.style.overflow = "hidden";
                      mirror.style.left = "-9999px";
                      mirror.style.top = "0";
                      mirror.textContent = el.value.slice(0, caret);
                      const marker = document.createElement("span");
                      marker.textContent = "\u200b";
                      mirror.appendChild(marker);
                      document.body.appendChild(mirror);
                      const caretTop = marker.offsetTop;
                      document.body.removeChild(mirror);
                      const target = caretTop - el.clientHeight / 2;
                      el.scrollTop = Math.max(0, target);
                    } catch {}
                  });
                });
              }}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancelEdit();
                }
              }}
              placeholder="Edit your document. Sentences split automatically on periods, question marks, and exclamation marks."
              inputMode="text"
              className="w-full resize-none overflow-y-auto bg-transparent text-left font-display text-2xl leading-snug outline-none placeholder:text-muted-foreground/40 md:text-3xl"
              style={{ minHeight: "60vh", maxHeight: "70vh" }}
            />
          ) : (
            <p className="font-display text-3xl leading-tight md:text-4xl">
              {currentSentence ? (
                <SentenceText content={currentSentence.content} pendingDelete={currentSentence.pending_delete} />
              ) : (
                <span className="text-muted-foreground italic text-2xl">
                  Hold the orb and speak, or double-tap to write.
                </span>
              )}
            </p>
          )}
        </div>
      </section>

      {/* Compose action buttons (above orb) */}
      {composing && (
        <div className="pointer-events-none flex justify-center pb-4">
          <div className="pointer-events-auto flex gap-3">
            <button
              onClick={async () => {
                const text = composeText.trim();
                if (text) {
                  const ok = await copyToClipboard(text);
                  if (ok) toast.success("Copied to clipboard");
                  else toast.error("Failed to copy");
                }
                cancelCompose();
              }}
              className="rounded-full border border-foreground/15 bg-card/70 px-5 py-2 text-sm backdrop-blur transition active:scale-95 hover:bg-foreground/10"
              style={{ boxShadow: "0 0 24px -8px var(--aurora-2)" }}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                // Blur the compose textarea so iOS dismisses the keyboard
                // before the destination picker (button-only UI) opens.
                if (typeof document !== "undefined") {
                  (document.activeElement as HTMLElement | null)?.blur?.();
                }
                setSendOpen(true);
              }}
              disabled={!composeText.trim()}
              className="rounded-full border border-primary/40 bg-primary/15 px-5 py-2 text-sm text-primary backdrop-blur transition active:scale-95 hover:bg-primary/25 disabled:opacity-40"
              style={{ boxShadow: "0 0 28px -6px var(--aurora-2)" }}
            >
              Send to…
            </button>
          </div>
        </div>
      )}

      {/* Edit action buttons (above orb) */}
      {editing && (
        <div className="pointer-events-none flex justify-center pb-4">
          <div className="pointer-events-auto flex gap-3">
            <button
              onClick={handleEditDone}
              className="rounded-full border border-foreground/15 bg-card/70 px-5 py-2 text-sm backdrop-blur transition active:scale-95 hover:bg-foreground/10"
              style={{ boxShadow: "0 0 24px -8px var(--aurora-2)" }}
            >
              Done
            </button>
            <button
              onClick={handleEditJump}
              disabled={!editText.trim()}
              className="rounded-full border border-primary/40 bg-primary/15 px-5 py-2 text-sm text-primary backdrop-blur transition active:scale-95 hover:bg-primary/25 disabled:opacity-40"
              style={{ boxShadow: "0 0 28px -6px var(--aurora-2)" }}
            >
              Jump To
            </button>
          </div>
        </div>
      )}

      {/* Orb — sized to fit any viewport (never causes scroll) */}
      <section className="flex shrink-0 items-center justify-center pb-4">
        <div
          className="relative"
          style={{
            width: "min(55vw, 28svh, 220px)",
            height: "min(55vw, 28svh, 220px)",
          }}
        >
          {/* Linked-document pill moved to the header, under the title. */}
          <Orb
            ref={orbRef}
            state={orbState}
            size={0}
            className={`!w-full !h-full${inCall ? " orb-call" : ""}`}
          />
          {/* Swipe gestures on the orb handle directional navigation. */}
          {/* Invisible repeat-speech buttons flanking the orb */}
          <button
            type="button"
            onClick={() => {
              if (lockFavorites) { toast.error("List is locked"); return; }
              void openPinnedDocument();
            }}
            className="absolute top-1/2 right-full mr-4 h-2/3 w-[22vw] max-w-[120px] -translate-y-1/2 opacity-0"
            aria-label="Open pinned document"
          />
          <button
            type="button"
            onClick={() => {
              const text = currentSentence?.content;
              if (text) speak(text, claimSpeech());
            }}
            className="absolute top-1/2 left-full ml-4 h-2/3 w-[22vw] max-w-[120px] -translate-y-1/2 opacity-0"
            aria-label="Repeat sentence"
          />
        </div>
      </section>

      {/* Grid menu overlay */}
      {menuOpen && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 px-4 backdrop-blur-md"
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl border border-foreground/10 bg-card/70 p-4 backdrop-blur"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between px-2">
              <div className="font-display text-lg">Menu</div>
              <button
                onClick={() => setMenuOpen(false)}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {slots.map((slot, i) => (
                <MenuGridButton key={i} index={i} slot={slot} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Pin document picker overlay */}
      {pinPickerOpen && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-background/85 px-4 backdrop-blur-md"
          onClick={() => setPinPickerOpen(false)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-md flex-col rounded-3xl border border-foreground/10 bg-card/80 p-4 backdrop-blur"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between px-2">
              <div className="font-display text-lg">📌 Pin a document</div>
              <button
                onClick={() => setPinPickerOpen(false)}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>
            <Input
              autoFocus
              value={pinPickerQuery}
              onChange={(e) => setPinPickerQuery(e.target.value)}
              placeholder="Search documents…"
               className="mb-3"
             />
             <div className="mb-3 flex flex-wrap gap-1.5">
               {EMOJI_FILTERS.map((emoji) => (
                 <button
                   key={emoji}
                   type="button"
                   onClick={() => setPinPickerQuery(emoji)}
                   className="flex h-9 w-9 items-center justify-center rounded-xl border border-foreground/10 bg-foreground/5 text-lg transition active:scale-95 hover:bg-foreground/10"
                 >
                   {emoji}
                 </button>
               ))}
             </div>
             {pinnedDocId && (
              <button
                onClick={() => {
                  void savePinnedDoc(null);
                  setPinPickerOpen(false);
                  toast.success("Pin removed");
                }}
                className="mb-2 w-full rounded-xl border border-foreground/10 bg-foreground/5 px-3 py-2 text-left text-sm text-muted-foreground transition hover:bg-foreground/10"
              >
                Remove current pin
              </button>
            )}
            <div className="-mx-1 flex-1 overflow-y-auto px-1">
              {(() => {
                const q = pinPickerQuery.trim().toLowerCase();
                const list = sortDocsByTitle([...(docs ?? [])]).filter(
                  (d) => !q || (d.title ?? "").toLowerCase().includes(q),
                );
                if (list.length === 0) {
                  return <p className="py-8 text-center text-sm text-muted-foreground">No documents.</p>;
                }
                return (
                  <ul className="flex flex-col gap-1">
                    {list.map((d) => (
                      <li key={d.id}>
                        <button
                          onClick={() => {
                            void savePinnedDoc(d.id);
                            setPinPickerOpen(false);
                            toast.success(`Pinned "${d.title || "Untitled"}"`);
                            void openPinnedDocument(d.id);
                          }}
                          className={`flex w-full items-center gap-2 rounded-xl border px-3 py-3 text-left transition ${
                            d.id === pinnedDocId
                              ? "border-primary/50 bg-primary/10"
                              : "border-foreground/10 bg-foreground/5 hover:bg-foreground/10"
                          }`}
                        >
                          <span className="truncate text-sm">{d.title || "Untitled"}</span>
                          {d.id === pinnedDocId && <span className="ml-auto text-xs text-primary">📌</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </div>
          </div>
        </div>
      )}


      {/* Favorites editor overlay */}
      {favoritesOpen && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-background/85 px-4 backdrop-blur-md"
          onClick={() => { setFavoritesOpen(false); setPickerSlot(null); }}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-md flex-col rounded-3xl border border-foreground/10 bg-card/80 p-4 backdrop-blur"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between px-2">
              <div className="font-display text-lg">★ Favorites</div>
              <button
                onClick={() => { setFavoritesOpen(false); setPickerSlot(null); }}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>
            <div className="mb-2 px-2 text-[11px] text-muted-foreground">
              Swipe right on the orb to cycle through these. {favorites.filter(Boolean).length} / 50 filled.
            </div>
            <div className="mb-2 flex flex-wrap gap-1.5 px-1">
              {EMOJI_FILTERS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setSlotFilter((cur) => (cur === emoji ? null : emoji))}
                  className={`flex h-9 w-9 items-center justify-center rounded-xl border text-lg transition active:scale-95 ${
                    slotFilter === emoji
                      ? "border-primary/40 bg-primary/15"
                      : "border-foreground/10 bg-foreground/5 hover:bg-foreground/10"
                  }`}
                >
                  {emoji}
                </button>
              ))}
              {slotFilter && (
                <button
                  type="button"
                  onClick={() => setSlotFilter(null)}
                  className="flex h-9 items-center justify-center rounded-xl border border-foreground/10 bg-foreground/5 px-3 text-xs transition active:scale-95 hover:bg-foreground/10"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex flex-col gap-1.5 overflow-y-auto p-1">
              {Array.from({ length: 50 }).map((_, i) => {
                const docId = favorites[i] ?? null;
                const doc = docId ? docs?.find((d) => d.id === docId) : null;
                if (slotFilter && !(doc && doc.title.includes(slotFilter))) return null;
                return (
                  <button
                    key={i}
                    onClick={() => setPickerSlot(i)}
                    className="flex w-full items-center gap-3 rounded-xl border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-left transition active:scale-[0.98] hover:bg-foreground/10"
                  >
                    <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    {doc ? (
                      <span className="flex-1 truncate text-sm">{doc.title}</span>
                    ) : (
                      <span className="flex-1 text-sm italic text-muted-foreground/60">Empty</span>
                    )}
                    <span className="text-base text-muted-foreground/60">
                      {doc ? "›" : "+"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {pickerSlot !== null && (() => {
            const targetId = favorites[pickerSlot];
            const targetDoc = targetId ? docs?.find((d) => d.id === targetId) : null;
            const matchCount = targetId ? favorites.filter((id) => id === targetId).length : 0;
            const q = pickerQuery.trim().toLowerCase();
            const filtered = sortDocsByTitle(
              (docs ?? []).filter((d) =>
                q === "" ? true : d.title.toLowerCase().includes(q)
              )
            );
            const closePicker = () => {
              setPickerSlot(null);
              setPickerQuery("");
              setReplaceMatching(true);
            };
            const pickDoc = async (docId: string) => {
              // iOS-safe: speak synchronously inside the tap gesture if unmuted.
              if (!muted && typeof window !== "undefined" && "speechSynthesis" in window) {
                try {
                  const picked = docs?.find((d) => d.id === docId);
                  const cached = qc.getQueryData<Sentence[]>(["sentences", docId]);
                  const idx = picked?.current_sentence_index ?? 0;
                  const text = cached?.[Math.max(0, Math.min(idx, (cached?.length ?? 1) - 1))]?.content;
                  if (text) {
                    const clean = stripEmoji(text);
                    if (clean) {
                      window.speechSynthesis.cancel();
                      const u = new SpeechSynthesisUtterance(clean);
                      u.rate = 1; u.pitch = 1;
                      window.speechSynthesis.speak(u);
                    }
                  }
                } catch {}
              }
              const next = [...favorites];
              while (next.length < 50) next.push(null);
              if (replaceMatching && targetId) {
                for (let i = 0; i < next.length; i++) {
                  if (next[i] === targetId) next[i] = docId;
                }
              } else {
                next[pickerSlot!] = docId;
              }
              setActiveDocId(docId);
              closePicker();
              setFavoritesOpen(false);
              await saveFavorites(next);
            };
            return (
            <div
              className="absolute inset-0 z-10 flex items-end justify-center bg-background/70 px-4 pb-6 backdrop-blur-sm"
              onClick={closePicker}
            >
              <div
                className="flex max-h-[80vh] w-full max-w-md flex-col rounded-3xl border border-foreground/10 bg-card/95 p-4"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-3 flex items-center justify-between px-2">
                  <div className="font-display text-base">Slot {pickerSlot + 1}</div>
                  <button
                    onClick={closePicker}
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>
                {targetId && (
                  <div className="mb-2 flex flex-col gap-1.5">
                    <button
                      onClick={async () => {
                        const next = [...favorites];
                        while (next.length < 50) next.push(null);
                        next[pickerSlot!] = null;
                        await saveFavorites(next);
                        closePicker();
                      }}
                      className="w-full rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-left text-sm text-destructive"
                    >
                      Clear slot
                    </button>
                    <button
                      onClick={() => setReplaceMatching((v) => !v)}
                      className={`w-full rounded-xl border px-3 py-2 text-left text-sm transition ${
                        replaceMatching
                          ? "border-primary/40 bg-primary/15 text-foreground"
                          : "border-foreground/20 bg-foreground/5 hover:bg-foreground/10"
                      }`}
                    >
                      {replaceMatching ? "✓ " : ""}Replace all matching slots
                      {matchCount > 1 ? ` (${matchCount})` : ""}
                    </button>
                    {replaceMatching && (
                      <div className="px-1 text-[11px] text-muted-foreground">
                        Picking a doc will replace all {matchCount} slot{matchCount === 1 ? "" : "s"} currently set to "{targetDoc?.title ?? "Unknown"}".
                      </div>
                    )}
                  </div>
                )}
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {EMOJI_FILTERS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setPickerQuery(emoji)}
                      className="flex h-9 w-9 items-center justify-center rounded-xl border border-foreground/10 bg-foreground/5 text-lg transition active:scale-95 hover:bg-foreground/10"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  placeholder="Search documents…"
                  autoFocus
                  className="mb-2 w-full rounded-xl border border-foreground/10 bg-foreground/5 px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-foreground/30"
                />

                <div className="flex-1 space-y-1 overflow-y-auto">
                  {filtered.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => pickDoc(d.id)}
                      className="w-full rounded-xl border border-foreground/10 bg-foreground/5 px-3 py-2 text-left text-sm hover:bg-foreground/10"
                    >
                      {d.title}
                    </button>
                  ))}
                  {(!docs || docs.length === 0) && (
                    <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                      No documents yet.
                    </div>
                  )}
                  {docs && docs.length > 0 && filtered.length === 0 && (
                    <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                      No matches.
                    </div>
                  )}
                </div>
              </div>
            </div>
            );
          })()}
        </div>
      )}
      {/* Search-docs overlay */}
      {searchOpen && (() => {
        const q = searchQuery.trim().toLowerCase();
        const results = sortDocsByTitle(
          (docs ?? []).filter((d) =>
            q === "" ? true : d.title.toLowerCase().includes(q)
          )
        );
        const pickDoc = (doc: Doc) => {
          if (lockFavorites) { toast.error("List is locked"); return; }
          // iOS-safe: speak synchronously inside the tap gesture if unmuted.
          if (!muted && typeof window !== "undefined" && "speechSynthesis" in window) {
            try {
              const cached = qc.getQueryData<Sentence[]>(["sentences", doc.id]);
              const idx = doc.current_sentence_index ?? 0;
              const text = cached?.[Math.max(0, Math.min(idx, (cached?.length ?? 1) - 1))]?.content;
              if (text) {
                const clean = stripEmoji(text);
                if (clean) {
                  window.speechSynthesis.cancel();
                  const u = new SpeechSynthesisUtterance(clean);
                  u.rate = 1; u.pitch = 1;
                  window.speechSynthesis.speak(u);
                }
              }
            } catch {}
          }
          setActiveDocId(doc.id);
          setSearchOpen(false);
          setSearchQuery("");
        };
        return (
          <div
            className="absolute inset-0 z-50 flex items-start justify-center bg-background/85 px-4 pt-20 backdrop-blur-md"
            onClick={() => { setSearchOpen(false); setSearchQuery(""); }}
          >
            <div
              className="w-full max-w-sm rounded-3xl border border-foreground/10 bg-card/80 p-4 backdrop-blur"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between px-2">
                <div className="font-display text-lg">🔍 Search docs</div>
                <button
                  onClick={() => { setSearchOpen(false); setSearchQuery(""); }}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Close
                </button>
              </div>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {EMOJI_FILTERS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => setSearchQuery(emoji)}
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-foreground/10 bg-foreground/5 text-lg transition active:scale-95 hover:bg-foreground/10"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <input

                ref={(el) => { if (el) el.focus(); }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setSearchOpen(false); setSearchQuery(""); }
                  if (e.key === "Enter" && results[0]) { e.preventDefault(); pickDoc(results[0]); }
                }}
                placeholder="Search documents…"
                className="mb-3 w-full rounded-xl border border-foreground/10 bg-foreground/5 px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
              />
              <div className="flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto">
                {results.length === 0 ? (
                  <div className="px-2 py-6 text-center text-sm text-muted-foreground">No matches</div>
                ) : results.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => pickDoc(d)}
                    className="w-full shrink-0 truncate rounded-xl border border-foreground/10 bg-foreground/5 px-4 py-3 text-left text-sm transition active:scale-[0.98] hover:bg-foreground/10"
                  >
                    {d.title}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
      {recentOpen && (() => {
        const results = recentIds
          .map((id) => (docs ?? []).find((d) => d.id === id))
          .filter((d): d is Doc => !!d);
        const pickDoc = (doc: Doc) => {
          if (lockFavorites) { toast.error("List is locked"); return; }
          if (!muted && typeof window !== "undefined" && "speechSynthesis" in window) {
            try {
              const cached = qc.getQueryData<Sentence[]>(["sentences", doc.id]);
              const idx = doc.current_sentence_index ?? 0;
              const text = cached?.[Math.max(0, Math.min(idx, (cached?.length ?? 1) - 1))]?.content;
              if (text) {
                const clean = stripEmoji(text);
                if (clean) {
                  window.speechSynthesis.cancel();
                  const u = new SpeechSynthesisUtterance(clean);
                  u.rate = 1; u.pitch = 1;
                  window.speechSynthesis.speak(u);
                }
              }
            } catch {}
          }
          setActiveDocId(doc.id);
          setRecentOpen(false);
        };
        return (
          <div
            className="absolute inset-0 z-50 flex items-start justify-center bg-background/85 px-4 pt-20 backdrop-blur-md"
            onClick={() => setRecentOpen(false)}
          >
            <div
              className="w-full max-w-sm rounded-3xl border border-foreground/10 bg-card/80 p-4 backdrop-blur"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between px-2">
                <div className="font-display text-lg">🕘 Recent docs</div>
                <button
                  onClick={() => setRecentOpen(false)}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Close
                </button>
              </div>
              <div className="flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto">
                {results.length === 0 ? (
                  <div className="px-2 py-6 text-center text-sm text-muted-foreground">No recent documents yet</div>
                ) : results.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => pickDoc(d)}
                    className="w-full shrink-0 truncate rounded-xl border border-foreground/10 bg-foreground/5 px-4 py-3 text-left text-sm transition active:scale-[0.98] hover:bg-foreground/10"
                  >
                    {d.title}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
      {/* Jump-to overlay */}
      {jumpOpen && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-background/85 px-4 backdrop-blur-md"
          onClick={() => setJumpOpen(false)}
        >
          <div
            className="w-full max-w-xs rounded-3xl border border-foreground/10 bg-card/80 p-4 backdrop-blur"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between px-2">
              <div className="font-display text-lg">🔃 Jump to</div>
              <button
                onClick={() => setJumpOpen(false)}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              {[
                { label: "⤒  Jump to top", target: 0 },
                { label: "⏪  Jump back 25", target: currentIdx - 25 },
                { label: "⏪  Jump back 10", target: currentIdx - 10 },
                { label: "◀  Jump back 5", target: currentIdx - 5 },
                { label: "▶  Jump ahead 5", target: currentIdx + 5 },
                { label: "⏩  Jump ahead 10", target: currentIdx + 10 },
                { label: "⏩  Jump ahead 25", target: currentIdx + 25 },
                { label: "⤓  Jump to end", target: (sentences?.length ?? 1) - 1 },
              ].map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => jumpTo(opt.target)}
                  disabled={!sentences || sentences.length === 0}
                  className="w-full rounded-xl border border-foreground/10 bg-foreground/5 px-4 py-3 text-left text-sm transition active:scale-[0.98] hover:bg-foreground/10 disabled:opacity-40"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {moveOpen && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-background/85 px-4 backdrop-blur-md"
          onClick={() => setMoveOpen(false)}
        >
          <div
            className="w-full max-w-xs rounded-3xl border border-foreground/10 bg-card/80 p-4 backdrop-blur"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between px-2">
              <div className="font-display text-lg">↕️ Move sentence</div>
              <button
                onClick={() => setMoveOpen(false)}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              {[
                { label: "⤒  Move to top", target: 0, disabled: currentIdx === 0 },
                { label: "⏫  Move up 2", target: currentIdx - 2, disabled: currentIdx < 1 },
                { label: "🔼  Move up 1", target: currentIdx - 1, disabled: currentIdx === 0 },
                { label: "🔽  Move down 1", target: currentIdx + 1, disabled: !sentences || currentIdx >= sentences.length - 1 },
                { label: "⏬  Move down 2", target: currentIdx + 2, disabled: !sentences || currentIdx >= sentences.length - 1 },
                { label: "⤓  Move to bottom", target: (sentences?.length ?? 1) - 1, disabled: !sentences || currentIdx >= sentences.length - 1 },
              ].map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => moveSentence(opt.target)}
                  disabled={opt.disabled || !sentences || sentences.length === 0}
                  className="w-full rounded-xl border border-foreground/10 bg-foreground/5 px-4 py-3 text-left text-sm transition active:scale-[0.98] hover:bg-foreground/10 disabled:opacity-40"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {/* Send-to overlay */}
      {sendOpen && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-background/85 px-4 backdrop-blur-md"
          onClick={() => { setSendOpen(false); setSendDocId(null); setSendStage("doc"); setSendTargetSentences([]); }}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-md flex-col rounded-3xl border border-foreground/10 bg-card/80 p-4 backdrop-blur"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between px-2">
              <div className="font-display text-lg">
                {sendStage === "doc" && "Send to which list?"}
                {sendStage === "where" && "Where in the list?"}
                {sendStage === "pickAnchor" && "After which sentence?"}
              </div>
              <button
                onClick={cancelCompose}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>

            {sendStage === "doc" && (
              <div className="flex min-h-0 flex-col gap-2">
                {(() => {
                  const slot = favIdxRef.current;
                  if (slot < 0) return null;
                  const currentSlotDocId = favorites[slot];
                  if (currentSlotDocId === activeDocId) return null;
                  const docA = docs?.find((d) => d.id === currentSlotDocId);
                  const docB = docs?.find((d) => d.id === activeDocId);
                  return (
                    <button
                      onClick={replaceCurrentSlot}
                      className="w-full rounded-xl border border-primary/30 bg-primary/10 px-3 py-2.5 text-left text-sm text-primary transition active:scale-[0.98] hover:bg-primary/20"
                    >
                      <div className="font-medium">↺ Replace current slot</div>
                      <div className="mt-0.5 text-xs opacity-80">
                        Slot {slot + 1}: "{docA?.title ?? "empty"}" → "{docB?.title ?? "this doc"}"
                      </div>
                    </button>
                  );
                })()}
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  {EMOJI_FILTERS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setSendSearchQuery(emoji)}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-foreground/10 bg-foreground/5 text-lg transition hover:bg-foreground/10 active:scale-[0.95]"
                      aria-label={`Filter by ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
                <Input
                  placeholder="Search lists…"
                  value={sendSearchQuery}
                  onChange={(e) => setSendSearchQuery(e.target.value)}
                  className="shrink-0"
                />
                <div className="flex flex-col gap-1.5 overflow-y-auto p-1">
                  {(() => {
                    const q = sendSearchQuery.trim().toLowerCase();
                    const sorted = sortDocsByTitle(docs ?? []);
                    const filtered = q
                      ? sorted.filter((d) =>
                          (d.title || "").toLowerCase().includes(q),
                        )
                      : sorted;
                    return filtered.length > 0 ? (
                      filtered.map((d) => (
                        <button
                          key={d.id}
                          onClick={() => pickSendDoc(d.id)}
                          className="w-full shrink-0 rounded-xl border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-left text-sm transition active:scale-[0.98] hover:bg-foreground/10"
                        >
                          {d.title}
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                        {q ? "No matching lists." : "No documents yet."}
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {sendStage === "where" && sendDocId && (
              <div className="flex flex-col gap-2 p-1">
                <button
                  onClick={() => sendIdea(sendDocId, "top")}
                  className="w-full rounded-xl border border-foreground/10 bg-foreground/5 px-3 py-3 text-sm transition active:scale-[0.98] hover:bg-foreground/10"
                >
                  ⤒  Top of list
                </button>
                <button
                  onClick={() => sendIdea(sendDocId, "current")}
                  disabled={sendTargetSentences.length === 0}
                  className="w-full rounded-xl border border-foreground/10 bg-foreground/5 px-3 py-3 text-sm transition active:scale-[0.98] hover:bg-foreground/10 disabled:opacity-40"
                >
                  ●  After current sentence
                </button>
                <button
                  onClick={() => {
                    if (sendTargetSentences.length === 0) {
                      sendIdea(sendDocId, "top");
                    } else {
                      setSendStage("pickAnchor");
                    }
                  }}
                  className="w-full rounded-xl border border-primary/30 bg-primary/10 px-3 py-3 text-sm text-primary transition active:scale-[0.98] hover:bg-primary/20"
                >
                  ⋯  After a specific sentence…
                </button>
                <button
                  onClick={() => sendIdea(sendDocId, "bottom")}
                  className="w-full rounded-xl border border-foreground/10 bg-foreground/5 px-3 py-3 text-sm transition active:scale-[0.98] hover:bg-foreground/10"
                >
                  ⤓  Bottom of list
                </button>
                <button
                  onClick={() => { setSendDocId(null); setSendStage("doc"); setSendTargetSentences([]); }}
                  className="mt-1 w-full rounded-xl px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  ← Pick a different list
                </button>
              </div>
            )}

            {sendStage === "pickAnchor" && sendDocId && (
              <div className="flex min-h-0 flex-col gap-2 p-1">
                <div className="flex max-h-[55vh] flex-col gap-1 overflow-y-auto rounded-xl border border-foreground/10 bg-foreground/5 p-1">
                  {sendTargetSentences.map((s, i) => (
                    <button
                      key={s.id}
                      onClick={() => setSendAnchorIdx(i)}
                      className={
                        "w-full rounded-lg px-3 py-2 text-left text-sm transition " +
                        (i === sendAnchorIdx
                          ? "bg-primary/20 text-primary ring-1 ring-primary/40"
                          : "hover:bg-foreground/10")
                      }
                    >
                      <span className="mr-2 text-xs opacity-60">{i + 1}.</span>
                      {s.content}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSendStage("where")}
                    className="flex-1 rounded-xl px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    ← Back
                  </button>
                  <button
                    onClick={() => sendIdea(sendDocId, "afterAnchor", sendAnchorIdx)}
                    className="flex-[2] rounded-xl border border-primary/30 bg-primary/10 px-3 py-2.5 text-sm text-primary transition active:scale-[0.98] hover:bg-primary/20"
                  >
                    Insert after sentence {sendAnchorIdx + 1}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <input
        ref={importInputRef}
        type="file"
        accept=".txt,text/plain"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleImportFile(f);
        }}
      />
      <ChatDialog
        open={chatOpen}
        onOpenChange={setChatOpen}
        currentDocumentId={activeDocId}
        documents={(docs ?? []).map((d) => ({ id: d.id, title: d.title }))}
      />
      {currentSentence && (
        <LinkDocumentDialog
          open={linkPickerOpen}
          onOpenChange={setLinkPickerOpen}
          sentenceId={currentSentence.id}
          currentLinkedDocumentId={currentSentence.linked_document_id}
          documents={(docs ?? []).map((d) => ({ id: d.id, title: d.title }))}
          excludeDocumentId={activeDocId ?? undefined}
          onSaved={() => qc.invalidateQueries({ queryKey: ["sentences", activeDocId] })}
        />
      )}
      <PlanComposerDialog
        open={planComposerOpen}
        onOpenChange={setPlanComposerOpen}
        originDocumentId={activeDocId}
        originSentenceIndex={currentIdx}
      />

      <PlanApprovalDialog
        open={planApprovalOpen}
        onOpenChange={(v) => { setPlanApprovalOpen(v); if (!v) setPlanApprovalId(null); }}
        planId={planApprovalId}
        onApproved={() => {
          const text = currentSentence?.content;
          if (text) speak(text, claimSpeech());
        }}
      />
      {plansScreenOpen && (
        <AIPlansScreen onClose={() => setPlansScreenOpen(false)} />
      )}

      {/* Minimized call indicator — small orb pinned top-right; tap to reopen. */}
      {inCall && overlayMinimized && (
        <div
          className="pointer-events-none fixed right-3 z-[55]"
          style={{ top: "max(0.5rem, env(safe-area-inset-top))" }}
        >
          <button
            type="button"
            onClick={() => setOverlayMinimized(false)}
            aria-label="Return to call"
            className="pointer-events-auto relative flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-yellow-300 to-amber-500 text-black shadow-lg transition active:scale-95"
          >
            <span className="absolute inset-0 animate-ping rounded-full bg-yellow-400/60" />
            <Phone className="relative h-4 w-4" />
          </button>
        </div>
      )}

      <Dialog open={exportChooserOpen} onOpenChange={setExportChooserOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Export</DialogTitle>
            <DialogDescription>Choose what you'd like to export.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              className="justify-start"
              onClick={() => { setExportChooserOpen(false); void handleExportAll(); }}
            >
              📚 All documents (.txt)
            </Button>
            <Button
              variant="outline"
              className="justify-start"
              onClick={() => { setExportChooserOpen(false); void handleExportCurrentTxt(); }}
            >
              📄 Current document (.txt)
            </Button>
            <Button
              variant="outline"
              className="justify-start"
              onClick={() => { setExportChooserOpen(false); void handleExportCurrentPdf(); }}
            >
              🗎 Current document (.pdf)
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </main>
  );
}
