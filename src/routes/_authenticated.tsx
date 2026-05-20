import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { CallModeProvider } from "@/contexts/CallModeContext";
import { CallOverlay } from "@/components/CallOverlay";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/auth" });
  },
  component: () => (
    <CallModeProvider>
      <Outlet />
      <CallOverlay />
    </CallModeProvider>
  ),
});
