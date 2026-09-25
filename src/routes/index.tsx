import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { LandingOrb, ORB_HEX, type OrbColor } from "@/components/LandingOrb";
import { useReveal } from "@/hooks/use-reveal";
import { cn } from "@/lib/utils";

const DESC =
  "Focus Remote is a simple remote control for reading, thinking, learning routines, navigating documents and directing AI-assisted work — one step at a time.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Focus Remote — Control the flow of your focus" },
      { name: "description", content: DESC },
      { property: "og:title", content: "Focus Remote — Control the flow of your focus" },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const HEADING = { fontFamily: "'Syne', ui-sans-serif, system-ui, sans-serif" };
const BODY = { fontFamily: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif" };

function Reveal({ children, className, delay }: { children: ReactNode; className?: string; delay?: string }) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={cn("reveal", className)} style={delay ? { transitionDelay: delay } : undefined}>
      {children}
    </div>
  );
}

/* ----------------------------- The remote itself ---------------------------- */

const CLUSTER: Array<{ color: OrbColor; label: string; col: number; row: number; rowSpan: number }> = [
  { color: "red", label: "Search docs / mute speech", col: 1, row: 1, rowSpan: 2 },
  { color: "yellow", label: "New idea (hold for menu)", col: 1, row: 3, rowSpan: 2 },
  { color: "pink", label: "Jump to / move sentence", col: 1, row: 5, rowSpan: 2 },
  { color: "blue", label: "Previous sentence", col: 2, row: 1, rowSpan: 3 },
  { color: "purple", label: "Next sentence (hold to hand it to Remote)", col: 2, row: 4, rowSpan: 3 },
  { color: "orange", label: "Pinned document / pin a doc", col: 3, row: 1, rowSpan: 2 },
  { color: "green", label: "Next document (hold to link this sentence)", col: 3, row: 3, rowSpan: 2 },
  { color: "gray", label: "Chat (hold for media gallery)", col: 3, row: 5, rowSpan: 2 },
];

const SENTENCES = [
  "Your document, one sentence at a time.",
  "Press down. Hear the next step.",
  "Capture an idea before it slips away.",
  "Hand a sentence to Remote and let it work.",
  "Move through ideas one step at a time.",
];

function useCycle(length: number, ms: number) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => setI((n) => (n + 1) % length), ms);
    return () => window.clearInterval(t);
  }, [length, ms]);
  return i;
}

function RemotePreview({ active }: { active?: number }) {
  const idx = useCycle(SENTENCES.length, 2800);
  return (
    <div className="mx-auto w-full max-w-[360px] rounded-[2rem] border border-white/10 bg-white/[0.03] p-5 shadow-2xl backdrop-blur">
      <div className="flex min-h-[7.5rem] items-center justify-center rounded-2xl border border-white/10 bg-[#020617]/70 px-5 text-center">
        <p key={idx} className="sentence-swap text-lg leading-snug text-white" style={HEADING}>
          {SENTENCES[idx]}
        </p>
      </div>
      <div className="mt-2 flex justify-center gap-1.5">
        {SENTENCES.map((_, i) => (
          <span key={i} className={cn("h-1 rounded-full transition-all duration-500", i === idx ? "w-5 bg-[#67e8f9]" : "w-1 bg-slate-700")} />
        ))}
      </div>
      <div
        className="landing-cluster landing-cluster-tiles mx-auto mt-5 grid"
        style={{
          width: "100%",
          height: "clamp(200px, 52vw, 250px)",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.5fr) minmax(0, 1fr)",
          gridTemplateRows: "repeat(6, minmax(0, 1fr))",
          gap: 0,
        }}
      >
        {CLUSTER.map((b, i) => (
          <LandingOrb
            key={b.color}
            color={b.color}
            size="fill"
            active={i === active}
            style={{ gridColumn: b.col, gridRow: `${b.row} / span ${b.rowSpan}` }}
            className="h-full w-full"
          />
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------- Sections -------------------------------- */

function Hero() {
  return (
    <section className="mx-auto grid min-h-[88svh] w-full max-w-6xl items-center gap-14 px-6 py-12 md:grid-cols-2">
      <div className="text-center md:text-left">
        <Reveal>
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-[#67e8f9]">Focus Remote</p>
        </Reveal>
        <Reveal delay="100ms">
          <h1 className="mt-5 text-5xl leading-[1.05] tracking-tight md:text-6xl" style={HEADING}>
            Control the flow of your focus.
          </h1>
        </Reveal>
        <Reveal delay="200ms">
          <p className="mx-auto mt-6 max-w-lg text-base text-slate-400 md:mx-0 md:text-lg">
            Read, think, create, and move through your work one step at a time. Focus Remote gives you a
            simpler way to navigate documents, build ideas, learn routines, and direct AI-assisted work
            without getting lost in clutter.
          </p>
        </Reveal>
        <Reveal delay="300ms">
          <div className="mt-9 flex flex-wrap items-center justify-center gap-4 md:justify-start">
            <Link
              to="/auth"
              className="inline-flex items-center justify-center rounded-full px-7 py-3.5 text-sm font-semibold text-[#020617] transition active:scale-95"
              style={{ background: "linear-gradient(135deg, #a5f3fc, #67e8f9, #818cf8)" }}
            >
              Start using Focus Remote
            </Link>
            <a href="#how" className="rounded-full border border-white/15 px-6 py-3.5 text-sm text-slate-200 transition hover:bg-white/5">
              See how it works
            </a>
          </div>
        </Reveal>
      </div>
      <Reveal delay="200ms">
        <RemotePreview />
      </Reveal>
    </section>
  );
}

function HowItWorks() {
  const active = useCycle(CLUSTER.length, 1700);
  return (
    <section id="how" className="mx-auto w-full max-w-5xl scroll-mt-10 px-6 py-24 text-center">
      <Reveal>
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-500">How it works</p>
        <h2 className="mt-4 text-4xl leading-tight tracking-tight md:text-5xl" style={HEADING}>
          One sentence on screen. A remote underneath.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base text-slate-400">
          Press down to move forward, up to go back. The colored buttons around them search, capture,
          jump, link and chat — every action is one press away, and a long press does the second job.
        </p>
      </Reveal>
      <div className="mt-14 grid items-center gap-12 md:grid-cols-2">
        <Reveal>
          <RemotePreview active={active} />
        </Reveal>
        <Reveal delay="150ms">
          <ul className="space-y-3 text-left">
            {CLUSTER.map((b, i) => (
              <li key={b.color} className={cn("flex items-center gap-3 transition-opacity", i === active ? "opacity-100" : "opacity-50")}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ORB_HEX[b.color] }} />
                <span className="text-sm text-slate-300">{b.label}</span>
              </li>
            ))}
            <li className="pt-3 text-xs text-slate-500">Tap the sentence to edit it. Hold it to delete it.</li>
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

const BENEFITS = [
  { color: "purple" as OrbColor, title: "Read one step at a time.", text: "Move through documents sentence by sentence so your attention stays with the work in front of you." },
  { color: "yellow" as OrbColor, title: "Turn thoughts into something useful.", text: "Capture ideas, edit sentences, create documents, and shape fragmented thoughts into clear work." },
  { color: "gray" as OrbColor, title: "Direct your AI.", text: "Connect conversations to specific parts of your documents and guide multi-step work while keeping yourself in control." },
  { color: "green" as OrbColor, title: "Learn your routines.", text: "Use Focus Remote as a guide while you build a routine. Once it becomes familiar, you can rely on it less." },
];

function Benefits() {
  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-24">
      <Reveal>
        <h2 className="text-center text-4xl leading-tight tracking-tight md:text-5xl" style={HEADING}>
          Built for staying with one thing.
        </h2>
      </Reveal>
      <div className="mt-14 grid gap-x-12 gap-y-10 sm:grid-cols-2">
        {BENEFITS.map((b, i) => (
          <Reveal key={b.title} delay={`${i * 80}ms`}>
            <div className="border-l-2 pl-5" style={{ borderColor: ORB_HEX[b.color] }}>
              <h3 className="text-xl text-white" style={HEADING}>{b.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{b.text}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function WhoFor() {
  const uses = ["Learning routines", "Reviewing documents", "Writing", "Thinking things through", "Staying focused"];
  return (
    <section className="mx-auto w-full max-w-4xl px-6 py-20 text-center">
      <Reveal>
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-500">Made for</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {uses.map((u) => (
            <span key={u} className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300">{u}</span>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col items-center px-6 py-28 text-center">
      <Reveal>
        <h2 className="text-4xl leading-tight tracking-tight md:text-6xl" style={HEADING}>
          Move through ideas one step at a time.
        </h2>
      </Reveal>
      <Reveal delay="150ms">
        <Link
          to="/auth"
          className="mt-10 inline-flex items-center justify-center rounded-full px-8 py-4 text-base font-semibold text-[#020617] transition active:scale-95"
          style={{ background: "linear-gradient(135deg, #a5f3fc, #67e8f9, #818cf8)" }}
        >
          Start using Focus Remote
        </Link>
      </Reveal>
    </section>
  );
}

function Landing() {
  return (
    <main
      className="relative min-h-[100svh] w-full overflow-x-hidden bg-[#020617] text-white selection:bg-[#67e8f9] selection:text-[#020617]"
      style={BODY}
    >
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div
          className="absolute -top-40 left-1/2 h-[50vh] w-[70vw] -translate-x-1/2 rounded-full opacity-25 blur-3xl"
          style={{ background: "radial-gradient(closest-side, #818cf8, transparent 70%)" }}
        />
      </div>

      <nav className="flex items-center justify-between px-6 py-5 md:px-10">
        <span className="text-xl tracking-tight" style={HEADING}>Focus Remote</span>
        <Link
          to="/auth"
          className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm backdrop-blur transition hover:bg-white/10"
        >
          Sign in
        </Link>
      </nav>

      <Hero />
      <HowItWorks />
      <Benefits />
      <WhoFor />
      <FinalCta />

      <footer className="border-t border-white/10 px-6 py-6 text-center text-xs text-slate-500">
        Focus Remote · focusremote.com
      </footer>
    </main>
  );
}
