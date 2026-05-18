import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Orb } from "@/components/Orb";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — Orby" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/app" });
    });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: window.location.origin + "/app" },
        });
        if (error) throw error;
        toast.success("Account created");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      navigate({ to: "/app" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-1/3 h-[60vh] w-[80vw] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(closest-side, var(--aurora-2), transparent 70%)" }} />
      </div>

      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <span>← Orby</span>
        </Link>

        <div className="mb-8 flex justify-center">
          <Orb size={120} />
        </div>

        <h1 className="text-center font-display text-3xl">
          {mode === "signin" ? "Welcome back" : "Create your orb"}
        </h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          {mode === "signin" ? "Pick up where you left off" : "Start with a single sentence"}
        </p>

        <form onSubmit={submit} className="mt-6 space-y-3">
          <input
            type="email" required autoComplete="email" placeholder="you@example.com"
            value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-2xl border border-foreground/15 bg-foreground/5 px-4 py-3 text-base outline-none placeholder:text-muted-foreground focus:border-foreground/40"
          />
          <input
            type="password" required minLength={6}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            placeholder="Password"
            value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-2xl border border-foreground/15 bg-foreground/5 px-4 py-3 text-base outline-none placeholder:text-muted-foreground focus:border-foreground/40"
          />
          <button
            type="submit" disabled={busy}
            className="w-full rounded-2xl px-4 py-3 text-base font-semibold text-primary-foreground transition active:scale-[0.98] disabled:opacity-60"
            style={{
              background: "linear-gradient(135deg, var(--aurora-1), var(--aurora-2), var(--aurora-3))",
              boxShadow: "0 10px 30px color-mix(in oklab, var(--aurora-2) 40%, transparent)",
            }}
          >
            {busy ? "..." : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <button
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground"
        >
          {mode === "signin" ? "No account? Create one" : "Have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}
