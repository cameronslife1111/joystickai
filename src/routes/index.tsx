import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { LandingOrb, ORB_HEX, type OrbColor } from "@/components/LandingOrb";
import { useReveal } from "@/hooks/use-reveal";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Orby — Focus more in a busy world, one sentence at a time" },
      {
        name: "description",
        content:
          "Orby is a focus instrument: it shows you one sentence at a time, listens when you speak, and runs multi-step AI plans — all from eight little glowing orbs.",
      },
      { property: "og:title", content: "Orby — Focus more in a busy world, one sentence at a time" },
      {
        property: "og:description",
        content:
          "Orby is a focus instrument: it shows you one sentence at a time, listens when you speak, and runs multi-step AI plans — all from eight little glowing orbs.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const HEADING = { fontFamily: "'Syne', ui-sans-serif, system-ui, sans-serif" };
const BODY = { fontFamily: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif" };

function Reveal({
  children,
  className,
  delay,
}: {
  children: ReactNode;
  className?: string;
  delay?: string;
}) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={cn("reveal", className)} style={delay ? { transitionDelay: delay } : undefined}>
      {children}
    </div>
  );
}

/* ---------------------------------- Hero ---------------------------------- */

const HERO_ORBS: Array<{
  color: OrbColor;
  size: number;
  className: string;
  drift: number;
  floatDelay: string;
}> = [
  { color: "blue", size: 64, className: "left-[7%] top-[14%]", drift: 0.06, floatDelay: "0s" },
  { color: "red", size: 48, className: "left-[14%] bottom-[16%]", drift: -0.05, floatDelay: "0.9s" },
  { color: "yellow", size: 52, className: "right-[13%] top-[22%]", drift: 0.09, floatDelay: "1.5s" },
  { color: "green", size: 72, className: "right-[7%] bottom-[22%]", drift: -0.07, floatDelay: "0.4s" },
  { color: "purple", size: 44, className: "left-[36%] top-[8%] hidden md:block", drift: 0.04, floatDelay: "2.1s" },
  { color: "orange", size: 56, className: "right-[30%] bottom-[8%] hidden md:block", drift: -0.03, floatDelay: "1.1s" },
];

function Hero() {
  return (
    <section className="relative flex min-h-[92svh] flex-col items-center justify-center overflow-hidden px-6 text-center">
      {HERO_ORBS.map((o, i) => (
        <LandingOrb
          key={i}
          color={o.color}
          size={o.size}
          drift={o.drift}
          floatDelay={o.floatDelay}
          className={cn("absolute", o.className)}
        />
      ))}

      <Reveal>
        <span className="rounded-full border border-[#818cf8]/30 bg-[#818cf8]/10 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.25em] text-[#a5f3fc]">
          One sentence. Total focus.
        </span>
      </Reveal>
      <Reveal delay="120ms">
        <h1
          className="mt-7 max-w-4xl text-5xl leading-[1.05] tracking-tight md:text-7xl"
          style={HEADING}
        >
          Focus more in a busy world,{" "}
          <span className="bg-gradient-to-r from-[#67e8f9] via-[#818cf8] to-[#c4b5fd] bg-clip-text text-transparent">
            one sentence at a time.
          </span>
        </h1>
      </Reveal>
      <Reveal delay="240ms">
        <p className="mx-auto mt-6 max-w-xl text-base text-slate-400 md:text-lg">
          Orby reads your documents to you one sentence at a time, listens when you speak, and runs
          multi-step plans — all through eight little glowing orbs.
        </p>
      </Reveal>
      <Reveal delay="360ms">
        <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
          <Link
            to="/auth"
            className="inline-flex items-center justify-center rounded-full px-8 py-3.5 text-sm font-semibold text-[#020617] transition active:scale-95"
            style={{
              background: "linear-gradient(135deg, #a5f3fc, #67e8f9, #818cf8)",
              boxShadow: "0 10px 40px rgba(129,140,248,0.45)",
            }}
          >
            Start free
          </Link>
          <span className="text-xs text-slate-500">Free to start · Built for mobile</span>
        </div>
      </Reveal>

      <div className="absolute bottom-8 flex flex-col items-center gap-2 text-slate-500">
        <span className="text-[10px] uppercase tracking-[0.3em]">Scroll</span>
        <span className="block h-8 w-px bg-gradient-to-b from-slate-500 to-transparent" />
      </div>
    </section>
  );
}

/* -------------------- One sentence at a time (cycler) --------------------- */

const SENTENCES = [
  "Your document, one sentence at a time.",
  "Press an orb. Hear the next one.",
  "Speak an idea — Orby writes it down.",
  "Plans run themselves, step by step.",
  "Focus more in a busy world.",
];

function SentenceCycler() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => setIdx((i) => (i + 1) % SENTENCES.length), 2600);
    return () => window.clearInterval(t);
  }, []);

  return (
    <section className="relative flex min-h-[80svh] flex-col items-center justify-center overflow-hidden px-6 text-center">
      <LandingOrb color="purple" size={40} drift={-0.12} floatDelay="0.6s" className="absolute left-[10%] top-[22%]" />
      <LandingOrb color="green" size={52} drift={0.14} floatDelay="1.8s" className="absolute right-[9%] top-[30%]" />
      <LandingOrb color="orange" size={36} drift={-0.09} floatDelay="0.2s" className="absolute bottom-[20%] left-[20%] hidden md:block" />
      <LandingOrb color="blue" size={44} drift={0.1} floatDelay="1.2s" className="absolute bottom-[26%] right-[18%] hidden md:block" />

      <Reveal>
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-500">
          How it reads
        </p>
      </Reveal>
      <div className="mt-8 flex min-h-[7rem] items-center justify-center md:min-h-[9rem]">
        <p
          key={idx}
          className="sentence-swap max-w-3xl text-3xl leading-snug tracking-tight text-white md:text-5xl"
          style={HEADING}
        >
          {SENTENCES[idx]}
        </p>
      </div>
      <Reveal delay="150ms">
        <div className="mt-8 flex items-center gap-2">
          {SENTENCES.map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all duration-500",
                i === idx ? "w-6 bg-[#67e8f9]" : "w-1.5 bg-slate-700",
              )}
            />
          ))}
        </div>
      </Reveal>
    </section>
  );
}

/* ----------------------------- Meet the orbs ------------------------------ */

const CLUSTER: Array<{ color: OrbColor; label: string; col: number; row: number }> = [
  { color: "blue", label: "Previous sentence", col: 3, row: 1 },
  { color: "red", label: "Delete sentence", col: 1, row: 1 },
  { color: "yellow", label: "Open the menu", col: 2, row: 2 },
  { color: "green", label: "Next document", col: 4, row: 2 },
  { color: "orange", label: "Pinned document / Search", col: 5, row: 1 },
  { color: "purple", label: "Next sentence", col: 3, row: 3 },
  { color: "pink", label: "Move sentence / Jump to", col: 1, row: 3 },
  { color: "gray", label: "Media gallery / Chat", col: 5, row: 3 },
];

function MeetTheOrbs() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => setActive((i) => (i + 1) % CLUSTER.length), 1600);
    return () => window.clearInterval(t);
  }, []);

  return (
    <section className="relative mx-auto flex min-h-[90svh] w-full max-w-5xl flex-col items-center justify-center px-6 py-24 text-center">
      <Reveal>
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-500">
          The controls
        </p>
        <h2 className="mt-4 text-4xl leading-tight tracking-tight md:text-6xl" style={HEADING}>
          Meet the orbs.
        </h2>
        <p className="mx-auto mt-4 max-w-md text-base text-slate-400">
          Everything Orby does is one press away. No menus to dig through, no gestures to memorize.
        </p>
      </Reveal>

      <Reveal delay="150ms" className="mt-14">
        <div
          className="landing-cluster grid"
          style={{
            alignItems: "stretch",
            justifyItems: "stretch",
            gridTemplateColumns:
              "repeat(2, clamp(44px, 13vw, 64px)) clamp(60px, 18vw, 88px) repeat(2, clamp(44px, 13vw, 64px))",
            gridTemplateRows:
              "clamp(44px, 13vw, 64px) clamp(60px, 18vw, 88px) clamp(44px, 13vw, 64px)",
            gap: "clamp(8px, 2.5vw, 14px)",
          }}
        >
          {CLUSTER.map((orb, i) => (
            <LandingOrb
              key={orb.color}
              color={orb.color}
              size="fill"
              active={i === active}
              floatDelay={`${i * 0.35}s`}
              style={{ gridColumn: orb.col, gridRow: orb.row }}
              className="h-full w-full"
            />
          ))}
          <div
            className="flex h-full w-full items-center justify-center rounded-full border border-dashed border-white/20"
            style={{ gridColumn: 3, gridRow: 2 }}
          >
            <span className="px-1 text-[8px] uppercase leading-relaxed tracking-[0.18em] text-slate-500 md:text-[9px]">
              tap to edit
              <br />
              hold to speak
            </span>
          </div>
        </div>
        <div className="mt-8 flex h-6 items-center justify-center">
          <p key={active} className="sentence-swap text-sm font-semibold" style={{ color: ORB_HEX[CLUSTER[active].color] }}>
            {CLUSTER[active].label}
          </p>
        </div>
      </Reveal>

      <Reveal delay="250ms" className="mt-12 w-full max-w-md">
        <ul className="grid grid-cols-2 gap-x-8 gap-y-4 text-left sm:grid-cols-3">
          {CLUSTER.map((orb) => (
            <li key={orb.color} className="flex items-center gap-2.5">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: ORB_HEX[orb.color], boxShadow: `0 0 10px ${ORB_HEX[orb.color]}` }}
              />
              <span className="text-xs text-slate-400">{orb.label}</span>
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  );
}

/* ------------------------------ Multi-step plans -------------------------- */

const PLAN_STEPS: Array<{ color: OrbColor; text: string }> = [
  { color: "blue", text: "Tell Orby the goal — out loud or typed." },
  { color: "purple", text: "It breaks the goal into clear steps." },
  { color: "yellow", text: "Each step runs: research, write, create." },
  { color: "green", text: "Results land straight in your document." },
  { color: "orange", text: "You approve, retry, or stop — anytime." },
];

function Plans() {
  return (
    <section className="relative mx-auto flex min-h-[90svh] w-full max-w-3xl flex-col justify-center px-6 py-24">
      <LandingOrb color="red" size={44} drift={0.12} floatDelay="0.7s" className="absolute -right-2 top-[10%] hidden lg:block" />

      <Reveal>
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-500">
          Multi-step plans
        </p>
        <h2 className="mt-4 text-4xl leading-tight tracking-tight md:text-6xl" style={HEADING}>
          Give it a goal.
          <br />
          <span className="bg-gradient-to-r from-[#c4b5fd] to-[#67e8f9] bg-clip-text text-transparent">
            Watch it work.
          </span>
        </h2>
      </Reveal>

      <div className="mt-12 space-y-6">
        {PLAN_STEPS.map((step, i) => (
          <Reveal key={step.text} delay={`${i * 90}ms`}>
            <div className="flex items-center gap-4">
              <span
                className="step-dot h-3.5 w-3.5 shrink-0 rounded-full"
                style={{
                  background: ORB_HEX[step.color],
                  boxShadow: `0 0 14px ${ORB_HEX[step.color]}`,
                }}
              />
              <p className="text-lg text-slate-300 md:text-xl">{step.text}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay="500ms">
        <p className="mt-12 text-sm text-slate-500">
          Plans keep running in the background — even when the app is closed — and check in with you
          when they need a decision.
        </p>
      </Reveal>
    </section>
  );
}

/* ------------------------------- Voice + media ---------------------------- */

function VoiceMedia() {
  return (
    <section className="relative flex min-h-[70svh] flex-col items-center justify-center overflow-hidden px-6 py-24 text-center">
      <LandingOrb color="yellow" size={48} drift={-0.11} floatDelay="0.3s" className="absolute left-[8%] top-[24%]" />
      <LandingOrb color="orange" size={60} drift={0.1} floatDelay="1.3s" className="absolute right-[8%] bottom-[24%]" />
      <LandingOrb color="green" size={36} drift={-0.06} floatDelay="2s" className="absolute right-[20%] top-[16%] hidden md:block" />

      <Reveal>
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-500">
          Voice-first · Media-built-in
        </p>
        <h2 className="mt-4 max-w-3xl text-4xl leading-tight tracking-tight md:text-6xl" style={HEADING}>
          Speak it. See it.
        </h2>
      </Reveal>
      <Reveal delay="150ms">
        <p className="mx-auto mt-6 max-w-xl text-base text-slate-400 md:text-lg">
          Hold the center pad and talk — Orby transcribes, plans, and writes. Describe an image or a
          video and it appears right in your document. No modes. Just momentum.
        </p>
      </Reveal>
    </section>
  );
}

/* -------------------------------- Final CTA ------------------------------- */

const CTA_ORBS: Array<{ color: OrbColor; size: number; className: string; floatDelay: string }> = [
  { color: "blue", size: 44, className: "left-[12%] top-[10%]", floatDelay: "0s" },
  { color: "purple", size: 56, className: "left-[6%] bottom-[16%]", floatDelay: "0.8s" },
  { color: "yellow", size: 40, className: "left-[30%] bottom-[6%]", floatDelay: "1.6s" },
  { color: "green", size: 52, className: "right-[28%] top-[6%]", floatDelay: "0.4s" },
  { color: "red", size: 42, className: "right-[8%] top-[28%]", floatDelay: "1.2s" },
  { color: "orange", size: 60, className: "right-[12%] bottom-[12%]", floatDelay: "2s" },
];

function FinalCta() {
  return (
    <section className="relative mx-auto flex min-h-[70svh] w-full max-w-4xl flex-col items-center justify-center overflow-hidden px-6 py-24 text-center">
      {CTA_ORBS.map((o, i) => (
        <LandingOrb
          key={i}
          color={o.color}
          size={o.size}
          floatDelay={o.floatDelay}
          className={cn("absolute hidden sm:block", o.className)}
        />
      ))}
      <Reveal>
        <h2 className="text-4xl leading-tight tracking-tight md:text-6xl" style={HEADING}>
          One sentence.
          <br />
          Total focus.
        </h2>
      </Reveal>
      <Reveal delay="150ms">
        <p className="mx-auto mt-5 max-w-xl text-base text-slate-400">
          Join writers, builders, and thinkers who move through their day one clear thought at a
          time.
        </p>
      </Reveal>
      <Reveal delay="300ms">
        <Link
          to="/auth"
          className="mt-9 inline-flex items-center justify-center rounded-full px-8 py-4 text-base font-semibold text-[#020617] transition active:scale-95"
          style={{
            background: "linear-gradient(135deg, #a5f3fc, #67e8f9, #818cf8)",
            boxShadow: "0 10px 40px rgba(129,140,248,0.5)",
          }}
        >
          Start with Orby — free
        </Link>
      </Reveal>
    </section>
  );
}

/* --------------------------------- Page ----------------------------------- */

function Landing() {
  return (
    <main
      className="relative min-h-[100svh] w-full overflow-x-hidden bg-[#020617] text-white selection:bg-[#67e8f9] selection:text-[#020617]"
      style={BODY}
    >
      {/* Background aurora */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div
          className="absolute -top-40 left-1/2 h-[60vh] w-[80vw] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
          style={{ background: "radial-gradient(closest-side, #818cf8, transparent 70%)" }}
        />
        <div
          className="absolute bottom-0 right-0 h-[40vh] w-[50vw] rounded-full opacity-25 blur-3xl"
          style={{ background: "radial-gradient(closest-side, #67e8f9, transparent 70%)" }}
        />
        <div
          className="absolute bottom-10 -left-20 h-[40vh] w-[50vw] rounded-full opacity-25 blur-3xl"
          style={{ background: "radial-gradient(closest-side, #c4b5fd, transparent 70%)" }}
        />
      </div>

      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-5 md:px-10">
        <div className="flex items-center gap-2">
          <div
            className="h-7 w-7 rounded-full"
            style={{
              background: "linear-gradient(135deg, #67e8f9, #818cf8, #c4b5fd)",
              boxShadow: "0 0 24px rgba(129,140,248,0.5)",
            }}
          />
          <span className="text-xl tracking-tight" style={HEADING}>
            Orby
          </span>
        </div>
        <Link
          to="/auth"
          className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm backdrop-blur transition hover:bg-white/10"
        >
          Sign in
        </Link>
      </nav>

      <Hero />
      <SentenceCycler />
      <MeetTheOrbs />
      <Plans />
      <VoiceMedia />
      <FinalCta />

      <footer className="border-t border-white/10 px-6 py-6 text-center text-xs text-slate-500">
        Orby · A focus instrument
      </footer>
    </main>
  );
}
