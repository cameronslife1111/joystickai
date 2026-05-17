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

export const Route = createFileRoute("/_authenticated/app")({
  head: () => ({ meta: [{ title: "Joystick AI" }] }),
  component: AppPage,
});

type Doc = { id: string; title: string; position: number; current_sentence_index: number };
type Sentence = { id: string; content: string; order_index: number; document_id: string };

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
  const [composing, setComposing] = useState(false);
  const [composeText, setComposeText] = useState("");
  const [sendOpen, setSendOpen] = useState(false);
  const [sendDocId, setSendDocId] = useState<string | null>(null);
  const [orbState, setOrbState] = useState<"idle" | "listening" | "thinking">("idle");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef<string>("");
  const favIdxRef = useRef<number>(-1);
  const speechTokenRef = useRef<number>(0);
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editOriginIdxRef = useRef<number>(0);
  const callAi = useServerFn(aiContinue);

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
        .order("order_index", { ascending: true });
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

  // TTS — token-gated, race-safe against rapid handler chains
  const speak = useCallback((text: string, token?: number) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (!text) return;
    const wasSpeaking = window.speechSynthesis.speaking || window.speechSynthesis.pending;
    window.speechSynthesis.cancel();
    // Give Chrome/Safari time to flush the canceled utterance before queuing
    // the next one; without this delay (especially when an utterance was
    // mid-flight) the new utterance is often swallowed.
    const delay = wasSpeaking ? 60 : 0;
    setTimeout(() => {
      if (token != null && token !== speechTokenRef.current) return;
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1; u.pitch = 1;
        window.speechSynthesis.speak(u);
      } catch {}
    }, delay);
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

    // Re-fetch the target doc's current_sentence_index from DB so the spoken
    // text can NEVER disagree with the displayed sentence. Cache may be stale.
    const { data: freshDoc } = await supabase
      .from("documents")
      .select("current_sentence_index, title")
      .eq("id", targetId)
      .maybeSingle();
    if (token !== speechTokenRef.current) return; // superseded by newer action
    const targetIdx = freshDoc?.current_sentence_index ?? 0;

    const { data: row } = await supabase
      .from("sentences")
      .select("content")
      .eq("document_id", targetId)
      .eq("order_index", targetIdx)
      .maybeSingle();
    if (token !== speechTokenRef.current) return;

    // Keep the docs cache in sync with the value we're about to speak so the
    // header counter and the spoken sentence agree.
    qc.setQueryData<Doc[]>(["documents"], (prev) =>
      prev?.map((d) => d.id === targetId ? { ...d, current_sentence_index: targetIdx } : d) ?? prev,
    );
    setActiveDocId(targetId);

    if (row?.content) speak(row.content, token);
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

      // shift order_index of everything after currentIdx
      const insertAt = currentSentence ? currentIdx + 1 : 0;
      const tail = (sentences ?? []).slice(insertAt);
      for (let i = tail.length - 1; i >= 0; i--) {
        await supabase.from("sentences")
          .update({ order_index: tail[i].order_index + newSentences.length })
          .eq("id", tail[i].id);
      }
      await supabase.from("sentences").insert(
        newSentences.map((content, i) => ({
          user_id: u.user!.id,
          document_id: activeDocId,
          content,
          order_index: insertAt + i,
        })),
      );
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
      if (d === "up") onSwipeUp();
      else if (d === "down") advanceSentence();
      else if (d === "right") onSwipeRight();
      else onSwipeLeft();
    },
  });

  // Parse the full-doc editor text into sentence parts (paragraph-per-sentence).
  const parseEditParts = useCallback((text: string) => {
    return text.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
  }, []);

  // Map a caret position in the editor text to a sentence index (0-based).
  const caretToSentenceIdx = useCallback((text: string, caret: number) => {
    const before = text.slice(0, Math.max(0, Math.min(caret, text.length)));
    // Split before-text the same way we split for saving; the last part is the
    // sentence the caret sits in. Empty trailing => still last index.
    const partsBefore = before.split(/\n\s*\n+/);
    return Math.max(0, partsBefore.length - 1);
  }, []);

  // Bulk save the editor contents, then jump to `targetIdx` (clamped).
  const commitFullEdit = useCallback(async (rawTargetIdx: number | null) => {
    if (!activeDocId) { setEditing(false); return; }
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { setEditing(false); return; }

    const parts = parseEditParts(editText);
    const existing = sentences ?? [];

    // Empty doc: delete everything and bail.
    if (parts.length === 0) {
      if (existing.length > 0) {
        await supabase.from("sentences")
          .delete()
          .in("id", existing.map((s) => s.id));
        qc.invalidateQueries({ queryKey: ["sentences", activeDocId] });
      }
      await setIndex(0);
      setEditing(false);
      setEditText("");
      toast("Saved", { id: "edit-saved" });
      return;
    }

    // 1) Update existing rows in place (only when changed).
    const overlap = Math.min(parts.length, existing.length);
    const updates: Promise<unknown>[] = [];
    for (let i = 0; i < overlap; i++) {
      if (parts[i] !== existing[i].content) {
        updates.push(
          (async () => {
            await supabase.from("sentences")
              .update({ content: parts[i] })
              .eq("id", existing[i].id);
          })(),
        );
      }
    }
    if (updates.length > 0) await Promise.all(updates);

    // 2) Insert any new tail rows.
    if (parts.length > existing.length) {
      const newRows = parts.slice(existing.length).map((content, i) => ({
        user_id: u.user!.id,
        document_id: activeDocId,
        content,
        order_index: existing.length + i,
      }));
      await supabase.from("sentences").insert(newRows);
    }

    // 3) Delete any surplus tail rows.
    if (parts.length < existing.length) {
      const surplus = existing.slice(parts.length).map((s) => s.id);
      await supabase.from("sentences").delete().in("id", surplus);
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
  }, [activeDocId, editText, sentences, parseEditParts, qc, setIndex, speak, claimSpeech]);

  const handleEditDone = useCallback(() => {
    void commitFullEdit(null);
    toast("Saved", { id: "edit-saved" });
  }, [commitFullEdit]);

  const handleEditJump = useCallback(() => {
    const el = editTextareaRef.current;
    const caret = el?.selectionStart ?? 0;
    const idx = caretToSentenceIdx(editText, caret);
    void commitFullEdit(idx);
    toast("Jumped", { id: "edit-jumped" });
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
  }, []);

  const sendIdea = useCallback(async (
    targetDocId: string,
    position: "top" | "bottom" | "current",
  ) => {
    const parts = splitIntoSentences(composeText);
    if (parts.length === 0) { cancelCompose(); return; }
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;

    const targetDoc = docs?.find((d) => d.id === targetDocId);
    const { data: existing } = await supabase
      .from("sentences")
      .select("id, order_index")
      .eq("document_id", targetDocId)
      .order("order_index", { ascending: true });
    const list = existing ?? [];

    let insertAt: number;
    if (position === "top") insertAt = 0;
    else if (position === "bottom") insertAt = list.length;
    else {
      const curIdx = targetDocId === activeDocId
        ? currentIdx
        : (targetDoc?.current_sentence_index ?? 0);
      insertAt = list.length === 0 ? 0 : Math.min(curIdx + 1, list.length);
    }

    const tail = list.slice(insertAt);
    for (let i = tail.length - 1; i >= 0; i--) {
      await supabase.from("sentences")
        .update({ order_index: tail[i].order_index + parts.length })
        .eq("id", tail[i].id);
    }
    await supabase.from("sentences").insert(
      parts.map((content, i) => ({
        user_id: u.user!.id,
        document_id: targetDocId,
        content,
        order_index: insertAt + i,
      })),
    );
    qc.invalidateQueries({ queryKey: ["sentences", targetDocId] });
    toast(`Sent to ${targetDoc?.title ?? "document"}`, { id: "idea-sent" });
    cancelCompose();
  }, [composeText, docs, activeDocId, currentIdx, qc, cancelCompose]);

  // Menu actions
  const grid = useMemo(() => [
    { e: "🌓", t: "Theme", fn: () => setTheme(theme === "dark" ? "light" : "dark") },
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
    { e: "🚪", t: "Sign out", fn: async () => {
      await supabase.auth.signOut();
      navigate({ to: "/" });
    }},
  ], [theme, docs, activeDoc, favorites, saveFavorites, qc, navigate]);

  // Empty slots padding to 15
  const slots = useMemo(() => {
    const filled: Array<{ e: string; t: string; fn: () => void } | null> = [...grid];
    while (filled.length < 15) filled.push(null);
    return filled;
  }, [grid]);

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* Background */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-1/2 h-[60vh] w-[80vw] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-25 blur-3xl"
          style={{ background: "radial-gradient(closest-side, var(--aurora-2), transparent 70%)" }} />
      </div>

      {/* Top: doc title */}
      <header className="px-6 pt-[env(safe-area-inset-top,1rem)] pt-4 text-center">
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
      <section className="flex flex-1 items-center justify-center px-6 pb-8">
        <div className="w-full max-w-2xl text-center">
          {composing ? (
            <textarea
              ref={(el) => { if (el) el.focus(); }}
              value={composeText}
              onChange={(e) => setComposeText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelCompose();
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  if (composeText.trim()) setSendOpen(true);
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
              placeholder="Edit your document. Leave a blank line between sentences."
              inputMode="text"
              className="w-full resize-none overflow-y-auto bg-transparent text-left font-display text-2xl leading-snug outline-none placeholder:text-muted-foreground/40 md:text-3xl"
              style={{ minHeight: "60vh", maxHeight: "70vh" }}
            />
          ) : (
            <p className="font-display text-3xl leading-tight md:text-4xl">
              {currentSentence?.content ?? (
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
              onClick={cancelCompose}
              className="rounded-full border border-foreground/15 bg-card/70 px-5 py-2 text-sm backdrop-blur transition active:scale-95 hover:bg-foreground/10"
              style={{ boxShadow: "0 0 24px -8px var(--aurora-2)" }}
            >
              Cancel
            </button>
            <button
              onClick={() => setSendOpen(true)}
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

      {/* Orb */}
      <section className="flex items-center justify-center pb-[max(env(safe-area-inset-bottom,1.5rem),2rem)]">
        <Orb ref={orbRef} state={orbState} size={200} />
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
            <div className="grid grid-cols-3 gap-2">
              {slots.map((slot, i) => (
                <button
                  key={i}
                  onClick={slot ? slot.fn : undefined}
                  disabled={!slot}
                  className="relative aspect-square rounded-2xl border border-foreground/10 bg-foreground/5 p-2 text-center transition active:scale-95 disabled:opacity-30"
                >
                  <span className="absolute left-1.5 top-1 text-[10px] text-muted-foreground">
                    {i + 1}
                  </span>
                  {slot ? (
                    <div className="flex h-full flex-col items-center justify-center gap-1">
                      <div className="text-2xl">{slot.e}</div>
                      <div className="text-[11px] leading-tight">{slot.t}</div>
                    </div>
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
      {/* Send-to overlay */}
      {sendOpen && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-background/85 px-4 backdrop-blur-md"
          onClick={() => { setSendOpen(false); setSendDocId(null); }}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-md flex-col rounded-3xl border border-foreground/10 bg-card/80 p-4 backdrop-blur"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between px-2">
              <div className="font-display text-lg">
                {sendDocId ? "Where in the list?" : "Send to which list?"}
              </div>
              <button
                onClick={() => { setSendOpen(false); setSendDocId(null); }}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>

            {!sendDocId ? (
              <div className="flex flex-col gap-1.5 overflow-y-auto p-1">
                {(docs ?? []).map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setSendDocId(d.id)}
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
            ) : (
              <div className="flex flex-col gap-2 p-1">
                <button
                  onClick={() => sendIdea(sendDocId, "top")}
                  className="w-full rounded-xl border border-foreground/10 bg-foreground/5 px-3 py-3 text-sm transition active:scale-[0.98] hover:bg-foreground/10"
                >
                  ⤒  Top of list
                </button>
                <button
                  onClick={() => sendIdea(sendDocId, "current")}
                  className="w-full rounded-xl border border-primary/30 bg-primary/10 px-3 py-3 text-sm text-primary transition active:scale-[0.98] hover:bg-primary/20"
                >
                  ●  After current sentence
                </button>
                <button
                  onClick={() => sendIdea(sendDocId, "bottom")}
                  className="w-full rounded-xl border border-foreground/10 bg-foreground/5 px-3 py-3 text-sm transition active:scale-[0.98] hover:bg-foreground/10"
                >
                  ⤓  Bottom of list
                </button>
                <button
                  onClick={() => setSendDocId(null)}
                  className="mt-1 w-full rounded-xl px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  ← Pick a different list
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
