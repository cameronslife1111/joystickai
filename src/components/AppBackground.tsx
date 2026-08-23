import { useAppBackground } from "@/lib/use-app-background";
import { proxyMediaUrl } from "@/lib/sb-proxy";

/**
 * Full-screen page background: the theme base color, plus the user's chosen
 * photo when one is set. The photo fades out toward the top (mask) and sits
 * under a theme-colored scrim so text stays readable in both themes.
 *
 * Render inside a `relative` page root; the layer is absolutely positioned
 * behind content and never intercepts touches.
 */
export function AppBackground() {
  const bg = useAppBackground();
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-background" />
      {bg?.url && (
        <>
          <img src={proxyMediaUrl(bg.url)} alt="" className="app-bg-photo" draggable={false} />
          <div className="app-bg-scrim" />
        </>
      )}
    </div>
  );
}
