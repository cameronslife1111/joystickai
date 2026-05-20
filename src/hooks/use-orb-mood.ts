import { useEffect, useRef, useState, useCallback } from "react";

const DECAY_MS = 5 * 60 * 1000; // 5 minutes to fully asleep
const BOOST_AMOUNT = 0.18;
const STORAGE_KEY = "orby_mood_state_v1";

type Persisted = { mood: number; lastInteractionAt: number };

function readPersisted(): Persisted {
  if (typeof window === "undefined") return { mood: 1, lastInteractionAt: Date.now() };
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { mood: 1, lastInteractionAt: Date.now() };
    const p = JSON.parse(raw) as Persisted;
    if (typeof p.mood !== "number" || typeof p.lastInteractionAt !== "number") {
      return { mood: 1, lastInteractionAt: Date.now() };
    }
    // Apply decay since last visit
    const elapsed = Date.now() - p.lastInteractionAt;
    const decayed = Math.max(0, p.mood - elapsed / DECAY_MS);
    return { mood: decayed, lastInteractionAt: p.lastInteractionAt };
  } catch {
    return { mood: 1, lastInteractionAt: Date.now() };
  }
}

function writePersisted(p: Persisted) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* noop */
  }
}

export function useOrbMood(options?: { interactive?: boolean }) {
  const interactive = options?.interactive ?? true;
  const initial = interactive ? readPersisted() : { mood: 1, lastInteractionAt: Date.now() };
  const [mood, setMood] = useState<number>(initial.mood);
  const moodRef = useRef<number>(initial.mood);
  const lastInteractionRef = useRef<number>(initial.lastInteractionAt);

  // Blink
  const [blinking, setBlinking] = useState(false);
  // Eye drift (look around): values in [-1, 1]
  const [gaze, setGaze] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const setMoodSafe = useCallback((m: number) => {
    const clamped = Math.max(0, Math.min(1, m));
    moodRef.current = clamped;
    setMood(clamped);
  }, []);

  const boost = useCallback(
    (amount = BOOST_AMOUNT) => {
      if (!interactive) return;
      lastInteractionRef.current = Date.now();
      setMoodSafe(moodRef.current + amount);
      writePersisted({ mood: moodRef.current, lastInteractionAt: lastInteractionRef.current });
    },
    [interactive, setMoodSafe],
  );

  // Decay loop — throttled to ~4fps
  useEffect(() => {
    if (!interactive) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const elapsed = Date.now() - lastInteractionRef.current;
      const next = Math.max(0, 1 - elapsed / DECAY_MS);
      // Only update if meaningfully different
      if (Math.abs(next - moodRef.current) > 0.005 || (next === 0 && moodRef.current !== 0)) {
        // Cap by current mood baseline: mood naturally drifts toward decayed value but
        // never above the boost-set value. Use min of current and decayed.
        const target = Math.min(moodRef.current, next);
        moodRef.current = target;
        setMood(target);
      }
    };
    const id = window.setInterval(tick, 250);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [interactive]);

  // Persist on unmount/visibility change
  useEffect(() => {
    if (!interactive) return;
    const save = () =>
      writePersisted({ mood: moodRef.current, lastInteractionAt: lastInteractionRef.current });
    window.addEventListener("visibilitychange", save);
    window.addEventListener("pagehide", save);
    return () => {
      save();
      window.removeEventListener("visibilitychange", save);
      window.removeEventListener("pagehide", save);
    };
  }, [interactive]);

  // Blink loop
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    let timeout: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const delay = 3500 + Math.random() * 3500;
      timeout = setTimeout(() => {
        setBlinking(true);
        setTimeout(() => setBlinking(false), 140);
        schedule();
      }, delay);
    };
    schedule();
    return () => clearTimeout(timeout);
  }, []);

  // Gaze drift
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    let timeout: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const delay = 1800 + Math.random() * 2600;
      timeout = setTimeout(() => {
        // If asleep, look straight (closed eyes anyway)
        if (moodRef.current <= 0.02) {
          setGaze({ x: 0, y: 0 });
        } else {
          setGaze({ x: (Math.random() - 0.5) * 1.6, y: (Math.random() - 0.5) * 1.2 });
        }
        schedule();
      }, delay);
    };
    schedule();
    return () => clearTimeout(timeout);
  }, []);

  // Talking / lip-sync — polls window.speechSynthesis.speaking
  const [talking, setTalking] = useState(false);
  const [mouthOpen, setMouthOpen] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let lastOpen = 0;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      const isSpeaking = !!window.speechSynthesis.speaking && moodRef.current > 0.02;
      setTalking((prev) => (prev !== isSpeaking ? isSpeaking : prev));
      if (isSpeaking) {
        let next: number;
        if (reduce) {
          next = 0.6;
        } else {
          const t = (performance.now() - start) / 1000;
          const base = 0.5 + 0.5 * Math.sin(t * 18);
          next = Math.max(0, Math.min(1, base * 0.85 + Math.random() * 0.15));
        }
        lastOpen = next;
        setMouthOpen(next);
      } else if (lastOpen > 0) {
        lastOpen = 0;
        setMouthOpen(0);
      }
    }, 80);
    return () => window.clearInterval(id);
  }, []);

  return { mood, boost, blinking, gaze, talking, mouthOpen };
}
