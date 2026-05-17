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
  const [orbState, setOrbState] = useState<"idle" | "listening" | "thinking">("idle");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef<string>("");
  const favIdxRef = useRef<number>(-1);
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

  // Load user preferences (favorites array)
  const { data: prefs } = useQuery({
    queryKey: ["user_preferences"],
    queryFn: async (): Promise<{ favorites: (string | null)[] }> => {
      const { data } = await supabase
        .from("user_preferences")
        .select("favorites")
        .maybeSingle();
      const raw = (data?.favorites as unknown) ?? [];
      const favorites = Array.isArray(raw) ? (raw as (string | null)[]) : [];
      return { favorites };
    },
  });
  const favorites = prefs?.favorites ?? [];

  const saveFavorites = useCallback(async (next: (string | null)[]) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    qc.setQueryData(["user_preferences"], { favorites: next });
    await supabase.from("user_preferences").upsert(
      { user_id: u.user.id, favorites: next as any },
      { onConflict: "user_id" },
    );
  }, [qc]);

  const currentIdx = activeDoc?.current_sentence_index ?? 0;
  const currentSentence = sentences?.[currentIdx];

  // TTS
  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1; u.pitch = 1;
    window.speechSynthesis.speak(u);
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

  const onTap = useCallback(async () => {
    if (!activeDoc || !sentences) return;
    const next = currentIdx + 1;
    if (next >= sentences.length) {
      toast("End of document");
      return;
    }
    await setIndex(next);
    speak(sentences[next].content);
  }, [activeDoc, sentences, currentIdx, setIndex, speak]);

  const onSwipeUp = useCallback(async () => {
    if (currentIdx === 0) { toast("Start of document"); return; }
    const prev = currentIdx - 1;
    await setIndex(prev);
    if (sentences?.[prev]) speak(sentences[prev].content);
  }, [currentIdx, setIndex, sentences, speak]);

  const onSwipeDown = useCallback(async () => {
    if (!currentSentence) return;
    const deleted = currentSentence;
    // optimistic remove + reindex
    qc.setQueryData<Sentence[]>(["sentences", activeDocId], (prev) =>
      prev?.filter((s) => s.id !== deleted.id).map((s, i) => ({ ...s, order_index: i })) ?? prev,
    );
    await supabase.from("sentences").delete().eq("id", deleted.id);
    qc.invalidateQueries({ queryKey: ["sentences", activeDocId] });

    toast("Sentence deleted", {
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
  }, [currentSentence, qc, activeDocId]);

  const onSwipeRight = useCallback(async () => {
    if (!docs || !activeDoc) return;

    // Filled favorite slots (preserve original slot index for cycling)
    const filled = favorites
      .map((id, i) => ({ id, i }))
      .filter((s): s is { id: string; i: number } =>
        !!s.id && docs.some((d) => d.id === s.id),
      );

    if (filled.length > 0) {
      // Advance through favorites cycle
      const curIdx = favIdxRef.current;
      const pos = filled.findIndex((s) => s.i > curIdx);
      const nextSlot = pos === -1 ? filled[0] : filled[pos];
      favIdxRef.current = nextSlot.i;

      const targetDoc = docs.find((d) => d.id === nextSlot.id);
      if (!targetDoc) return;
      setActiveDocId(targetDoc.id);
      toast(`★ ${nextSlot.i + 1} · ${targetDoc.title}`);

      // Fetch the exact sentence at the doc's saved index and speak it
      const targetIdx = targetDoc.current_sentence_index ?? 0;
      const { data: row } = await supabase
        .from("sentences")
        .select("content")
        .eq("document_id", targetDoc.id)
        .eq("order_index", targetIdx)
        .maybeSingle();
      if (row?.content) speak(row.content);
      return;
    }

    // Fallback: cycle all docs
    if (docs.length < 2) return;
    const idx = docs.findIndex((d) => d.id === activeDoc.id);
    const next = docs[(idx + 1) % docs.length];
    setActiveDocId(next.id);
    toast(next.title);
  }, [docs, activeDoc, favorites, speak]);

  const onSwipeLeft = useCallback(() => setMenuOpen(true), []);

  const onDoubleTap = useCallback(() => {
    if (!currentSentence) {
      // empty doc — start a brand new sentence
      setEditing(true);
      setEditText("");
      return;
    }
    setEditing(true);
    setEditText(currentSentence.content);
  }, [currentSentence]);

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
      speak(newSentences[0]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI failed");
    } finally {
      setOrbState("idle");
    }
  }, [activeDocId, callAi, sentences, currentIdx, currentSentence, setIndex, qc, speak]);

  useOrbGestures(orbRef, {
    onTap, onDoubleTap, onLongPressStart, onLongPressEnd,
    onSwipe: (d) => {
      if (d === "up") onSwipeUp();
      else if (d === "down") onSwipeDown();
      else if (d === "right") onSwipeRight();
      else onSwipeLeft();
    },
  });

  // Save edited sentence — split on enter
  const commitEdit = useCallback(async () => {
    if (!activeDocId) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const parts = splitIntoSentences(editText);
    if (parts.length === 0) { setEditing(false); return; }

    if (currentSentence) {
      // Replace current with first part, insert rest after
      await supabase.from("sentences")
        .update({ content: parts[0] })
        .eq("id", currentSentence.id);
      if (parts.length > 1) {
        const tail = (sentences ?? []).slice(currentIdx + 1);
        for (let i = tail.length - 1; i >= 0; i--) {
          await supabase.from("sentences")
            .update({ order_index: tail[i].order_index + parts.length - 1 })
            .eq("id", tail[i].id);
        }
        await supabase.from("sentences").insert(
          parts.slice(1).map((content, i) => ({
            user_id: u.user!.id,
            document_id: activeDocId,
            content,
            order_index: currentIdx + 1 + i,
          })),
        );
      }
    } else {
      await supabase.from("sentences").insert(
        parts.map((content, i) => ({
          user_id: u.user!.id, document_id: activeDocId, content, order_index: i,
        })),
      );
      await setIndex(0);
    }
    setEditing(false);
    qc.invalidateQueries({ queryKey: ["sentences", activeDocId] });
  }, [activeDocId, currentSentence, currentIdx, sentences, editText, qc, setIndex]);

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
          {activeDoc?.title ?? "—"}
          {sentences && (
            <span className="ml-2 opacity-60">
              {Math.min(currentIdx + 1, sentences.length || 1)} / {Math.max(sentences.length, 1)}
            </span>
          )}
        </div>
      </header>

      {/* Sentence */}
      <section className="flex flex-1 items-center justify-center px-6 pb-8">
        <div className="w-full max-w-2xl text-center">
          {editing ? (
            <textarea
              autoFocus
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  commitEdit();
                }
                if (e.key === "Escape") setEditing(false);
              }}
              onBlur={commitEdit}
              className="w-full resize-none bg-transparent text-center font-display text-3xl leading-tight outline-none md:text-4xl"
              rows={4}
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
    </main>
  );
}
