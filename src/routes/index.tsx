import { createFileRoute, Link } from "@tanstack/react-router";
import { Orb } from "@/components/Orb";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Orby — One sentence. Total focus. Built for the way you think." },
      {
        name: "description",
        content:
          "Orby is a focus instrument: read one sentence at a time, talk to AI hands-free, run multi-step plans, generate images and video, and move thoughts between documents — all from a single glowing orb.",
      },
    ],
  }),
  component: Landing,
});

const HEADING = { fontFamily: "'Syne', ui-sans-serif, system-ui, sans-serif" };
const BODY = { fontFamily: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif" };

function Landing() {
  return (
    <main
      className="relative min-h-[100svh] w-full overflow-x-hidden bg-[#020617] text-white selection:bg-[#67e8f9] selection:text-[#020617]"
      style={BODY}
    >
      {/* Background aurora */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
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

      {/* Bento grid */}
      <section className="mx-auto w-full max-w-7xl px-4 pb-12 pt-4 md:px-8">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-12 md:auto-rows-[180px]">
          {/* HERO */}
          <div className="relative overflow-hidden rounded-[2.5rem] border border-white/10 bg-gradient-to-br from-[#1e293b] to-[#0f172a] p-8 md:col-span-8 md:row-span-3">
            <div className="absolute -top-24 -right-24 h-96 w-96 rounded-full bg-[#c4b5fd]/20 blur-[120px]" />
            <div className="relative z-10 flex h-full flex-col justify-between gap-8">
              <div>
                <span className="rounded-full border border-[#818cf8]/30 bg-[#818cf8]/10 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-[#a5f3fc]">
                  One sentence. Total focus.
                </span>
                <h1
                  className="mt-6 max-w-2xl text-5xl leading-[1.05] tracking-tight md:text-7xl"
                  style={HEADING}
                >
                  Focus more in a{" "}
                  <span className="bg-gradient-to-r from-[#67e8f9] to-[#c4b5fd] bg-clip-text text-transparent">
                    busy world.
                  </span>
                </h1>
                <p className="mt-5 max-w-xl text-base text-slate-400 md:text-lg">
                  Orby is a focus instrument. One sentence at a time. Voice-first. With AI that
                  plans, writes, and creates alongside you.
                </p>
                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <Link
                    to="/auth"
                    className="group relative inline-flex items-center justify-center overflow-hidden rounded-full px-7 py-3.5 text-sm font-semibold text-[#020617] transition active:scale-95"
                    style={{
                      background: "linear-gradient(135deg, #a5f3fc, #67e8f9, #818cf8)",
                      boxShadow: "0 10px 40px rgba(129,140,248,0.45)",
                    }}
                  >
                    Get the orb
                  </Link>
                  <span className="text-xs text-slate-500">Free to start · Built for mobile</span>
                </div>
              </div>

              <div className="flex items-end gap-6">
                <div className="relative h-28 w-28 shrink-0 md:h-36 md:w-36">
                  <Orb size={144} interactive={false} />
                </div>
                <p className="max-w-xs text-base italic leading-relaxed text-slate-400 md:text-lg">
                  “Orby shows you exactly one sentence at a time.”
                </p>
              </div>
            </div>
          </div>

          {/* AI PLANS */}
          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 transition-colors hover:bg-white/[0.08] md:col-span-4 md:row-span-2">
            <div className="flex gap-2">
              <div className="h-1 w-full rounded-full bg-[#67e8f9]" />
              <div className="h-1 w-full rounded-full bg-[#818cf8]" />
              <div className="h-1 w-2/3 rounded-full bg-slate-700" />
            </div>
            <h3 className="mt-5 text-2xl" style={HEADING}>
              Multi-step AI plans
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              Tell Orby a goal. It breaks it into steps and runs them.
            </p>
            <div className="mt-4 space-y-2">
              <PlanStep n={1} tint="#c4b5fd" label="Research the topic" />
              <PlanStep n={2} tint="#818cf8" label="Draft & synthesize" />
              <PlanStep n={3} tint="#67e8f9" label="Generate visuals" muted />
            </div>
          </div>

          {/* VOICE CALL */}
          <div className="relative overflow-hidden rounded-[2rem] border border-[#818cf8]/20 bg-[#818cf8]/10 p-6 md:col-span-4 md:row-span-2">
            <div
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(circle at center, rgba(129,140,248,0.18), transparent 65%)",
              }}
            />
            <div className="relative flex h-full flex-col items-center justify-center gap-4">
              <div className="flex h-12 items-end gap-1.5">
                <span className="block w-1.5 animate-bounce rounded-full bg-[#67e8f9]" style={{ height: 24 }} />
                <span
                  className="block w-1.5 animate-bounce rounded-full bg-[#818cf8]"
                  style={{ height: 40, animationDelay: "0.1s" }}
                />
                <span
                  className="block w-1.5 animate-bounce rounded-full bg-[#c4b5fd]"
                  style={{ height: 18, animationDelay: "0.2s" }}
                />
                <span
                  className="block w-1.5 animate-bounce rounded-full bg-[#a5f3fc]"
                  style={{ height: 32, animationDelay: "0.15s" }}
                />
                <span
                  className="block w-1.5 animate-bounce rounded-full bg-[#67e8f9]"
                  style={{ height: 26, animationDelay: "0.05s" }}
                />
              </div>
              <h3 className="text-2xl" style={HEADING}>
                Call with Orby
              </h3>
              <p className="text-center text-[10px] uppercase tracking-[0.25em] text-slate-400">
                Hold to speak · talk hands-free
              </p>
            </div>
          </div>

          {/* GESTURES */}
          <div className="rounded-[2rem] border border-white/5 bg-gradient-to-b from-[#0f172a] to-black p-6 md:col-span-3 md:row-span-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">
              Gesture first
            </p>
            <h3 className="mt-2 text-3xl leading-tight" style={HEADING}>
              Move with your thumb.
            </h3>

            <div className="mt-6 space-y-5">
              <GestureRow label="Tap" desc="Next sentence" active>
                <span className="block h-3 w-3 rounded-full bg-[#67e8f9]" />
              </GestureRow>
              <GestureRow label="Hold" desc="Speak to Orby">
                <span className="block h-2.5 w-10 rounded-full bg-white/40" />
              </GestureRow>
              <GestureRow label="Swipe ←" desc="Open menu">
                <span className="block h-0.5 w-10 rounded-full bg-white/30" />
              </GestureRow>
              <GestureRow label="Swipe →" desc="Next document">
                <span className="block h-0.5 w-10 rounded-full bg-white/30" />
              </GestureRow>
              <GestureRow label="Swipe ↑" desc="Previous sentence">
                <span className="block h-3 w-0.5 rounded-full bg-white/30" />
              </GestureRow>
              <GestureRow label="Swipe ↓" desc="Delete sentence">
                <span className="block h-3 w-0.5 rounded-full bg-white/30" />
              </GestureRow>
            </div>
          </div>

          {/* MEDIA GENERATION */}
          <div className="group relative overflow-hidden rounded-[2.5rem] border border-[#c4b5fd]/20 bg-[#c4b5fd]/5 p-8 md:col-span-5 md:row-span-3">
            <div className="absolute inset-0 opacity-50 transition-all duration-700 group-hover:opacity-80">
              <div className="absolute inset-0 z-10 bg-gradient-to-t from-[#020617] via-[#020617]/60 to-transparent" />
              <div className="grid grid-cols-2 gap-3 p-6">
                <div className="aspect-square overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#818cf8] to-[#67e8f9]" />
                <div className="aspect-square overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-tr from-[#c4b5fd] to-[#a5f3fc]" />
                <div className="aspect-square overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#a5f3fc] to-[#818cf8]" />
                <div className="aspect-square overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-tr from-[#67e8f9] to-[#c4b5fd]" />
              </div>
            </div>
            <div className="relative z-20 flex h-full flex-col justify-end">
              <div className="mb-3 inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1 backdrop-blur">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#67e8f9]" />
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-300">
                  Image · Video · Audio
                </span>
              </div>
              <h3 className="text-4xl leading-tight" style={HEADING}>
                Generate images and video mid-thought.
              </h3>
              <p className="mt-3 max-w-md text-sm text-slate-300">
                Describe what you see. Orby creates it — stills, video, even audio — then drops it
                back into your document.
              </p>
            </div>
          </div>

          {/* DOCUMENT SLOTS (pill) */}
          <div className="flex items-center justify-between rounded-full border border-white/10 bg-white/5 px-6 py-4 transition-all hover:border-[#67e8f9]/50 md:col-span-4 md:row-span-1">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#67e8f9]/40 bg-[#67e8f9]/20">
                <div className="h-4 w-3 rounded-sm border-2 border-[#67e8f9]" />
              </div>
              <div className="leading-tight">
                <p className="text-sm font-semibold">23 document slots</p>
                <p className="text-[11px] text-slate-400">Swap thoughts between docs instantly</p>
              </div>
            </div>
            <div className="flex -space-x-2">
              <span className="h-7 w-7 rounded-full border-2 border-[#020617] bg-[#818cf8]" />
              <span className="h-7 w-7 rounded-full border-2 border-[#020617] bg-[#c4b5fd]" />
              <span className="h-7 w-7 rounded-full border-2 border-[#020617] bg-[#67e8f9]" />
              <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#020617] bg-slate-700 text-[10px] font-bold">
                +20
              </span>
            </div>
          </div>

          {/* MEDIA GALLERY (full-width strip) */}
          <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 md:col-span-12 md:row-span-2">
            <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
              <div className="max-w-md">
                <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">
                  Media library
                </p>
                <h3 className="mt-2 text-3xl leading-tight" style={HEADING}>
                  Every image, video, and clip — in one place.
                </h3>
                <p className="mt-2 text-sm text-slate-400">
                  Batch-select, organize, and reuse everything Orby creates with you.
                </p>
              </div>
              <div className="flex w-full gap-3 overflow-hidden md:w-auto">
                {[
                  "from-[#818cf8] to-[#67e8f9]",
                  "from-[#c4b5fd] to-[#a5f3fc]",
                  "from-[#a5f3fc] to-[#818cf8]",
                  "from-[#67e8f9] to-[#c4b5fd]",
                  "from-[#818cf8] to-[#c4b5fd]",
                ].map((g, i) => (
                  <div
                    key={i}
                    className={`h-24 w-24 shrink-0 rounded-2xl border border-white/10 bg-gradient-to-br ${g} shadow-lg`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative mx-auto w-full max-w-4xl px-6 pb-24 pt-8 text-center">
        <h2 className="text-4xl leading-tight md:text-6xl" style={HEADING}>
          One orb. Endless focus.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base text-slate-400">
          Join writers, builders, and thinkers who use Orby to move through their day one clear
          thought at a time.
        </p>
        <Link
          to="/auth"
          className="mt-8 inline-flex items-center justify-center rounded-full px-8 py-4 text-base font-semibold text-[#020617] transition active:scale-95"
          style={{
            background: "linear-gradient(135deg, #a5f3fc, #67e8f9, #818cf8)",
            boxShadow: "0 10px 40px rgba(129,140,248,0.5)",
          }}
        >
          Start with Orby — free
        </Link>
      </section>

      <footer className="border-t border-white/10 px-6 py-6 text-center text-xs text-slate-500">
        Orby · A focus instrument
      </footer>
    </main>
  );
}

function PlanStep({
  n,
  tint,
  label,
  muted,
}: {
  n: number;
  tint: string;
  label: string;
  muted?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 text-sm ${muted ? "text-slate-500" : "text-slate-300"}`}>
      <div
        className="flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold"
        style={{ backgroundColor: `${tint}33`, color: tint }}
      >
        {n}
      </div>
      {label}
    </div>
  );
}

function GestureRow({
  label,
  desc,
  active,
  children,
}: {
  label: string;
  desc: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 ${active ? "" : "opacity-60"}`}>
      <div>
        <div className={`text-xs font-semibold ${active ? "text-[#67e8f9]" : "text-white"}`}>
          {label}
        </div>
        <div className="text-[10px] text-slate-500">{desc}</div>
      </div>
      <div className="flex items-center">{children}</div>
    </div>
  );
}
