import { createFileRoute, Link } from "@tanstack/react-router";
import { Orb } from "@/components/Orb";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Joystick AI — Focus on one sentence at a time" },
      { name: "description", content: "A playful focus tool. One sentence. One orb. Tap, swipe, speak — and let AI carry you forward." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <main className="relative h-[100svh] overflow-hidden bg-background text-foreground">
      {/* Background aurora */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 left-1/2 h-[60vh] w-[80vw] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
          style={{ background: "radial-gradient(closest-side, var(--aurora-2), transparent 70%)" }} />
        <div className="absolute bottom-0 right-0 h-[40vh] w-[50vw] rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(closest-side, var(--aurora-3), transparent 70%)" }} />
        <div className="absolute bottom-10 -left-20 h-[40vh] w-[50vw] rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(closest-side, var(--aurora-1), transparent 70%)" }} />
      </div>

      <nav className="flex items-center justify-between px-6 py-5 md:px-10">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-full" style={{
            background: "linear-gradient(135deg, var(--aurora-1), var(--aurora-2), var(--aurora-3))",
            boxShadow: "0 0 20px color-mix(in oklab, var(--aurora-2) 60%, transparent)",
          }} />
          <span className="font-display text-xl">Joystick AI</span>
        </div>
        <Link
          to="/auth"
          className="rounded-full bg-foreground/10 px-4 py-2 text-sm backdrop-blur transition hover:bg-foreground/20"
        >
          Sign in
        </Link>
      </nav>

      <section className="relative mx-auto flex max-w-3xl flex-col items-center px-6 pt-8 pb-24 text-center md:pt-16">
        <span className="mb-6 rounded-full border border-foreground/15 bg-foreground/5 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
          One orb. One sentence. Total focus.
        </span>
        <h1 className="font-display text-5xl leading-[1.05] tracking-tight md:text-7xl">
          Focus more <br /> in a busy world.
        </h1>
        <p className="mt-6 max-w-xl text-balance text-base text-muted-foreground md:text-lg">
          Joystick AI shows you exactly one sentence at a time. Tap the orb to advance,
          swipe to navigate, hold to speak — and let AI continue your thought.
        </p>

        <div className="relative mt-12 flex h-[300px] w-full items-center justify-center md:h-[380px]">
          <Orb size={260} />
        </div>

        <div className="mt-12 flex flex-col items-center gap-3">
          <Link
            to="/auth"
            className="group relative inline-flex items-center justify-center overflow-hidden rounded-full px-8 py-4 text-base font-semibold text-primary-foreground transition active:scale-95"
            style={{
              background: "linear-gradient(135deg, var(--aurora-1), var(--aurora-2), var(--aurora-3))",
              boxShadow: "0 10px 40px color-mix(in oklab, var(--aurora-2) 50%, transparent)",
            }}
          >
            Get the orb
          </Link>
          <p className="text-xs text-muted-foreground">Free to start. Built for mobile.</p>
        </div>

        <div className="mt-20 grid w-full grid-cols-1 gap-4 text-left md:grid-cols-3">
          {[
            { e: "👆", t: "Tap", d: "Advance to the next sentence. It reads aloud." },
            { e: "🎙️", t: "Hold", d: "Speak. AI continues your document." },
            { e: "↕️↔️", t: "Swipe", d: "Up: back. Down: delete. Left: menu. Right: next doc." },
          ].map((x) => (
            <div key={x.t} className="rounded-2xl border border-foreground/10 bg-foreground/5 p-5 backdrop-blur">
              <div className="text-2xl">{x.e}</div>
              <div className="mt-2 font-display text-xl">{x.t}</div>
              <div className="mt-1 text-sm text-muted-foreground">{x.d}</div>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-foreground/10 px-6 py-6 text-center text-xs text-muted-foreground">
        Joystick AI · A focus instrument
      </footer>
    </main>
  );
}
