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
import { GenerateTextDialog } from "@/components/GenerateTextDialog";
import { AnalyzeImageDialog } from "@/components/AnalyzeImageDialog";
import { WebSearchDialog } from "@/components/WebSearchDialog";
import { SentenceText } from "@/components/SentenceText";
import { LinkDocumentDialog } from "@/components/LinkDocumentDialog";
import { Link as LinkIcon } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app")({
  head: () => ({ meta: [{ title: "Joystick AI" }] }),
  component: AppPage,
});

type Doc = { id: string; title: string; position: number; current_sentence_index: number };
type Sentence = { id: string; content: string; order_index: number; document_id: string; linked_document_id: string | null };

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
  const [jumpOpen, setJumpOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const [generateTextOpen, setGenerateTextOpen] = useState(false);
  const [analyzeImageOpen, setAnalyzeImageOpen] = useState(false);
  const [webSearchOpen, setWebSearchOpen] = useState(false);
  const [composeText, setComposeText] = useState("");
  const [sendOpen, setSendOpen] = useState(false);
  const [sendDocId, setSendDocId] = useState<string | null>(null);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [sendStage, setSendStage] = useState<"doc" | "where" | "pickAnchor">("doc");
  const [sendTargetSentences, setSendTargetSentences] = useState<Sentence[]>([]);
  const [sendAnchorIdx, setSendAnchorIdx] = useState<number>(0);
  const [orbState, setOrbState] = useState<"idle" | "listening" | "thinking">("idle");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef<string>("");
  const favIdxRef = useRef<number>(-1);
  const speechTokenRef = useRef<number>(0);
  const mutedRef = useRef<boolean>(false);
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editOriginIdxRef = useRef<number>(0);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const callAi = useServerFn(aiContinue);

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

  // Apply theme
  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // Load docs
  const { data: docs } = useQuery({
    queryKey: ["documents"],
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
          user_id: u.user.id, theme: "dark", grid_layout: [],
        }, { onConflict: "user_id" });
        qc.invalidateQueries({ queryKey: ["documents"] });
      })();
    } else if (!activeDocId) {
      setActiveDocId(docs[0].id);
    }
  }, [docs, activeDocId, qc]);

  const activeDoc = useMemo(
    () => docs?.find((d) => d.id === activeDocId) ?? null,
    [docs, activeDocId],
  );

  // Load sentences for active doc
  const { data: sentences } = useQuery({
    queryKey: ["sentences", activeDocId],
    enabled: !!activeDocId,
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

  // Load user preferences (favorites array + muted flag)
  const { data: prefs } = useQuery({
    queryKey: ["user_preferences"],
    queryFn: async (): Promise<{ favorites: (string | null)[]; muted: boolean }> => {
      const { data } = await supabase
        .from("user_preferences")
        .select("favorites, muted")
        .maybeSingle();
      const raw = (data?.favorites as unknown) ?? [];
      const favorites = Array.isArray(raw) ? (raw as (string | null)[]) : [];
      return { favorites, muted: !!(data as any)?.muted };
    },
  });
  const favorites = prefs?.favorites ?? [];
  const muted = prefs?.muted ?? false;

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

  // Keep favIdxRef pointed at the currently-viewed favorite slot (if any), so
  // the next swipe-right always advances to the NEXT filled slot — never
  // re-selects the slot the user is already on.
  useEffect(() => {
    if (!activeDocId) return;
    const slot = favorites.findIndex((id) => id === activeDocId);
    if (slot >= 0) favIdxRef.current = slot;
  }, [favorites, activeDocId]);

  const currentIdx = activeDoc?.current_sentence_index ?? 0;
  const currentSentence = sentences?.[currentIdx];

  // Keep mutedRef in sync with persisted preference.
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  // Strip emojis, pictographs, symbols, and ZWJ/variation selectors so the
  // synthesizer never tries to read them. Keeps regular punctuation/letters.
  const stripEmoji = (s: string) =>
    s
      .replace(/\p{Extended_Pictographic}/gu, "")
      .replace(/\p{Emoji_Presentation}/gu, "")
      .replace(/\p{Emoji}/gu, "")
      .replace(/\p{Emoji_Component}/gu, "")
      .replace(/\p{So}/gu, "") // other symbols (dingbats, arrows w/ emoji presentation)
      .replace(/\p{Sk}/gu, "") // modifier symbols
      .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "") // regional indicator flags
      .replace(/[\u{1F3FB}-\u{1F3FF}]/gu, "") // skin tone modifiers
      .replace(/[\u200D\uFE0F\uFE0E\u20E3]/gu, "") // ZWJ + variation selectors + keycap
      .replace(/[\u{E0020}-\u{E007F}]/gu, "") // tag characters (flag sequences)
      .replace(/\s{2,}/g, " ")
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

  const advanceSentence = useCallback(async () => {
    if (!activeDoc || !sentences) return;
    const token = claimSpeech();
    const next = currentIdx + 1;
    if (next >= sentences.length) {
      toast("End of document");
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
      toast("Start of document");
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

  const onSwipeRight = useCallback(async () => {
    if (!docs || !activeDoc) return;

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
  }, [docs, activeDoc, favorites, speak, claimSpeech, qc]);

  const onSwipeLeft = useCallback(() => setMenuOpen(true), []);

  const onDoubleTap = useCallback(() => {
    if (editing) return; // already editing — ignore
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

  // Long press = voice mode
  const onLongPressStart = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { toast.error("Voice not supported in this browser"); return; }
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = "en-US";
    transcriptRef.current = "";
    r.onresult = (e: any) => {
      let final = "";
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript + " ";
      }
      if (final) transcriptRef.current = final.trim();
    };
    r.onerror = () => {};
    try { r.start(); } catch {}
    recognitionRef.current = r;
    setOrbState("listening");
  }, []);

  const onLongPressEnd = useCallback(async () => {
    const r = recognitionRef.current;
    if (r) { try { r.stop(); } catch {} recognitionRef.current = null; }
    setOrbState("idle");
    const prompt = transcriptRef.current.trim();
    transcriptRef.current = "";
    if (!prompt || !activeDocId) return;

    setOrbState("thinking");
    try {
      const { text } = await callAi({ data: { documentId: activeDocId, prompt } });
      const newSentences = splitIntoSentences(text);
      if (newSentences.length === 0) return;

      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;

      const insertAt = currentSentence ? currentIdx + 1 : 0;
      const { error: rpcErr } = await supabase.rpc("insert_sentences_at", {
        p_document_id: activeDocId,
        p_contents: newSentences,
        p_insert_at: insertAt,
      });
      if (rpcErr) throw rpcErr;
      await setIndex(insertAt);
      qc.invalidateQueries({ queryKey: ["sentences", activeDocId] });
      const token = claimSpeech();
      speak(newSentences[0], token);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI failed");
    } finally {
      setOrbState("idle");
    }
  }, [activeDocId, callAi, sentences, currentIdx, currentSentence, setIndex, qc, speak, claimSpeech]);

  useOrbGestures(orbRef, {
    onTap: openNewIdea,
    onDoubleTap,
    onTripleTap: deleteCurrent,
    onLongPressStart,
    onLongPressEnd,
    onSwipe: (d) => {
      if (d === "up") advanceSentence();
      else if (d === "down") onSwipeUp();
      else if (d === "right") onSwipeRight();
      else onSwipeLeft();
    },
  });

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

    // Step A: park all existing rows in a high range to free 0..N-1 for clean rewrite.
    // Use negative offsets that mirror original index so we never collide with the
    // unique (document_id, order_index) constraint and so we can recover positions if needed.
    if (existing.length > 0) {
      const PARK_BASE = 1_000_000;
      // Park sequentially in descending original index order to avoid any transient
      // collisions if some rows already sit above PARK_BASE.
      const parkUpdates = await Promise.all(
        existing.map((s, i) =>
          supabase.from("sentences")
            .update({ order_index: PARK_BASE + i })
            .eq("id", s.id)
            .then((res) => res),
        ),
      );
      const parkErr = parkUpdates.find((r) => r.error)?.error;
      if (parkErr) {
        console.error("[edit] park step failed", parkErr);
        toast.error("Couldn't save edits");
        return false;
      }
    }

    // Step B: update overlapping rows (always set order_index = i, plus content if changed).
    const overlap = Math.min(parts.length, existing.length);
    if (overlap > 0) {
      const updateResults = await Promise.all(
        existing.slice(0, overlap).map((s, i) =>
          supabase.from("sentences")
            .update({ content: parts[i], order_index: i })
            .eq("id", s.id)
            .then((res) => res),
        ),
      );
      const updErr = updateResults.find((r) => r.error)?.error;
      if (updErr) {
        console.error("[edit] update step failed", updErr);
        toast.error("Couldn't save edits");
        return false;
      }
    }

    // Step C: insert any new tail rows at clean indexes [existing.length .. parts.length - 1].
    if (parts.length > existing.length) {
      const newRows = parts.slice(existing.length).map((content, i) => ({
        user_id: u.user!.id,
        document_id: activeDocId,
        content,
        order_index: existing.length + i,
      }));
      const { error: insErr } = await supabase.from("sentences").insert(newRows);
      if (insErr) {
        console.error("[edit] insert step failed", insErr);
        toast.error("Couldn't save edits");
        return false;
      }
    }

    // Step D: delete any surplus rows (still parked above PARK_BASE).
    if (parts.length < existing.length) {
      const surplus = existing.slice(parts.length).map((s) => s.id);
      const { error: delErr } = await supabase.from("sentences").delete().in("id", surplus);
      if (delErr) {
        console.error("[edit] delete-surplus step failed", delErr);
        toast.error("Couldn't save edits");
        return false;
      }
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
    qc.invalidateQueries({ queryKey: ["sentences", targetDocId] });
    toast(`Sent to ${targetDoc?.title ?? "document"}`, { id: "idea-sent" });
    cancelCompose();
  }, [composeText, docs, sendTargetSentences, qc, cancelCompose, activeDocId, currentIdx]);


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

  const openLinkedDocument = useCallback(async () => {
    const targetId = currentSentence?.linked_document_id;
    if (!targetId) return;
    const exists = docs?.some((d) => d.id === targetId);
    if (!exists) {
      toast.error("Linked document not found");
      return;
    }
    setActiveDocId(targetId);
    await setIndex(0);
  }, [currentSentence, docs, setIndex]);

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
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const today = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `joystick-export-${today}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Exported ${allDocs.length} document${allDocs.length === 1 ? "" : "s"}`);
    } catch (e: any) {
      toast.error(e?.message || "Export failed");
    }
  }, []);

  // Menu actions
  const grid = useMemo(() => [
    { e: "🌓", t: "Theme", fn: () => setTheme(theme === "dark" ? "light" : "dark") },
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
    { e: "✨", t: "Gen text", fn: () => {
      setMenuOpen(false);
      if (!activeDocId) { toast.error("Open a document first"); return; }
      setGenerateTextOpen(true);
    }},
    { e: "👁️", t: "Analyze img", fn: () => {
      if (!activeDocId) { toast.error("Open a document first"); return; }
      setMenuOpen(false);
      setAnalyzeImageOpen(true);
    }},
    { e: "🌐", t: "Web search", fn: () => {
      if (!activeDocId) { toast.error("Open a document first"); return; }
      setMenuOpen(false);
      setWebSearchOpen(true);
    }},
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
    }},
    { e: "↕️", t: "Move sentence", fn: () => {
      setMenuOpen(false);
      setMoveOpen(true);
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
    { e: "📤", t: "Export text", fn: () => {
      setMenuOpen(false);
      void handleExportAll();
    }},
    { e: "🔗", t: "Link to doc", fn: () => {
      if (!currentSentence) { toast.error("No sentence selected"); return; }
      setMenuOpen(false);
      setLinkPickerOpen(true);
    }},
    { e: "↗️", t: "Open link", fn: () => {
      if (!currentSentence?.linked_document_id) { toast.error("This sentence has no linked document"); return; }
      setMenuOpen(false);
      void openLinkedDocument();
    }},
  ], [theme, muted, saveMuted, currentSentence, docs, activeDoc, activeDocId, favorites, saveFavorites, qc, navigate, unseenCount, handleExportAll, openLinkedDocument]);

  // Arrange menu buttons into the requested 4x6 grid slots
  const slots = useMemo(() => {
    const filled: Array<{ e: string; t: string; fn: () => void; badge?: number } | null> = Array(24).fill(null);
    filled[0] = grid[0];   // 1  Theme
    filled[1] = grid[5];   // 2  Rename
    filled[2] = grid[5];   // 3  New doc
    filled[3] = grid[1];   // 4  Sound on/off
    filled[4] = grid[7];   // 5  Delete doc
    filled[5] = grid[10];  // 6  Move sentence
    filled[6] = grid[12];  // 7  Copy sentence
    filled[7] = grid[13];  // 8  Copy document
    filled[8] = grid[15];  // 9  Import checklists
    filled[9] = grid[16];  // 10 Media Gallery
    filled[10] = grid[11]; // 11 Search docs
    filled[11] = grid[9];  // 12 Jump to
    filled[12] = grid[2];  // 13 Gen text
    filled[13] = grid[3];  // 14 Analyze img
    filled[14] = grid[4];  // 15 Web search
    filled[15] = grid[8];  // 16 Favorites
    filled[16] = grid[17]; // 17 Export text
    filled[17] = grid[18]; // 18 Link to doc
    filled[18] = grid[19]; // 19 Open link
    filled[23] = grid[14]; // 24 Sign out
    return filled;
  }, [grid]);

  return (
    <main
      className="relative flex h-[100svh] max-h-[100svh] flex-col overflow-hidden bg-background text-foreground"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {/* Background */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-1/2 h-[60vh] w-[80vw] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-25 blur-3xl"
          style={{ background: "radial-gradient(closest-side, var(--aurora-2), transparent 70%)" }} />
      </div>

      {/* Top: doc title */}
      <header className="relative px-6 pt-[env(safe-area-inset-top,1rem)] pt-4 text-center">
        {/* Invisible repeat-speech button (top-right corner) */}
        <button
          onClick={() => {
            const text = currentSentence?.content;
            if (text) speak(text, claimSpeech());
          }}
          className="absolute right-0 top-0 h-12 w-12 opacity-0"
          aria-label="Repeat sentence"
        />
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
      </header>

      {/* Sentence */}
      <section className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-6 pb-4">
        <div className="w-full max-w-2xl max-h-full overflow-y-auto text-center">
          {composing ? (
            <textarea
              ref={(el) => { if (el) el.focus(); }}
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
                <SentenceText content={currentSentence.content} />
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
          {currentSentence?.linked_document_id && (() => {
            const linkedDocTitle = docs?.find((d) => d.id === currentSentence.linked_document_id)?.title ?? null;
            return (
              <button
                type="button"
                onClick={() => void openLinkedDocument()}
                className="absolute left-1/2 -top-10 z-10 flex max-w-[80vw] -translate-x-1/2 items-center gap-1.5 rounded-full border border-primary/40 bg-card/80 px-3 py-1.5 text-xs text-primary backdrop-blur transition active:scale-95 hover:bg-primary/15"
                style={{ boxShadow: "0 0 24px -8px var(--aurora-2)" }}
              >
                <LinkIcon className="h-3 w-3 shrink-0" />
                <span className="truncate">{linkedDocTitle ?? "Linked"}</span>
              </button>
            );
          })()}
          <Orb
            ref={orbRef}
            state={orbState}
            size={0}
            className="!w-full !h-full"
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
                <button
                  key={i}
                  onClick={slot ? slot.fn : undefined}
                  disabled={!slot}
                  className="relative h-20 rounded-2xl border border-foreground/10 bg-foreground/5 p-1.5 text-center transition active:scale-95 disabled:opacity-30"
                >
                  <span className="absolute left-1.5 top-0.5 text-[9px] text-muted-foreground">
                    {i + 1}
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
              ))}
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
            <div className="flex flex-col gap-1.5 overflow-y-auto p-1">
              {Array.from({ length: 50 }).map((_, i) => {
                const docId = favorites[i] ?? null;
                const doc = docId ? docs?.find((d) => d.id === docId) : null;
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

          {pickerSlot !== null && (
            <div
              className="absolute inset-0 z-10 flex items-end justify-center bg-background/70 px-4 pb-6 backdrop-blur-sm"
              onClick={() => setPickerSlot(null)}
            >
              <div
                className="w-full max-w-md rounded-3xl border border-foreground/10 bg-card/95 p-4"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-3 flex items-center justify-between px-2">
                  <div className="font-display text-base">Slot {pickerSlot + 1}</div>
                  <button
                    onClick={() => setPickerSlot(null)}
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>
                <div className="max-h-[50vh] space-y-1 overflow-y-auto">
                  {favorites[pickerSlot] && (
                    <button
                      onClick={async () => {
                        const next = [...favorites];
                        while (next.length < 50) next.push(null);
                        next[pickerSlot!] = null;
                        await saveFavorites(next);
                        setPickerSlot(null);
                      }}
                      className="w-full rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-left text-sm text-destructive"
                    >
                      Clear slot
                    </button>
                  )}
                  {(docs ?? []).map((d) => (
                    <button
                      key={d.id}
                      onClick={async () => {
                        const next = [...favorites];
                        while (next.length < 50) next.push(null);
                        next[pickerSlot!] = d.id;
                        await saveFavorites(next);
                        setPickerSlot(null);
                      }}
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
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {/* Search-docs overlay */}
      {searchOpen && (() => {
        const q = searchQuery.trim().toLowerCase();
        const results = (docs ?? []).filter((d) =>
          q === "" ? true : d.title.toLowerCase().includes(q)
        );
        const pickDoc = (doc: Doc) => {
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
                    className="w-full truncate rounded-xl border border-foreground/10 bg-foreground/5 px-4 py-3 text-left text-sm transition active:scale-[0.98] hover:bg-foreground/10"
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
                { label: "⏪  Jump back 10", target: currentIdx - 10 },
                { label: "◀  Jump back 5", target: currentIdx - 5 },
                { label: "▶  Jump ahead 5", target: currentIdx + 5 },
                { label: "⏩  Jump ahead 10", target: currentIdx + 10 },
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
              <div className="flex flex-col gap-1.5 overflow-y-auto p-1">
                {(docs ?? []).map((d) => (
                  <button
                    key={d.id}
                    onClick={() => pickSendDoc(d.id)}
                    className="w-full rounded-xl border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-left text-sm transition active:scale-[0.98] hover:bg-foreground/10"
                  >
                    {d.title}
                  </button>
                ))}
                {(!docs || docs.length === 0) && (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                    No documents yet.
                  </div>
                )}
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
      {activeDocId && (
        <GenerateTextDialog
          open={generateTextOpen}
          onOpenChange={setGenerateTextOpen}
          currentDocumentId={activeDocId}
          documents={(docs ?? []).map((d) => ({ id: d.id, title: d.title }))}
        />
      )}
      {activeDocId && (
        <AnalyzeImageDialog
          open={analyzeImageOpen}
          onOpenChange={setAnalyzeImageOpen}
          currentDocumentId={activeDocId}
          documents={(docs ?? []).map((d) => ({ id: d.id, title: d.title }))}
        />
      )}
      {activeDocId && (
        <WebSearchDialog
          open={webSearchOpen}
          onOpenChange={setWebSearchOpen}
          currentDocumentId={activeDocId}
          documents={(docs ?? []).map((d) => ({ id: d.id, title: d.title }))}
        />
      )}
    </main>
  );
}
