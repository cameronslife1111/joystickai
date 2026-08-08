import { supabase } from "@/integrations/supabase/client";

const REDO_RE = /\s*redo\s*(\d+)\s*$/i;

/** Strip a trailing " redo <n>" so counters never stack. */
export function baseTitle(title: string | null | undefined): string {
  const t = (title ?? "").trim();
  const stripped = t.replace(REDO_RE, "").trim();
  return stripped || t || "Untitled";
}

/**
 * Next available "<base> redo N" title for the signed-in user's media.
 */
export async function nextRedoTitle(sourceTitle: string | null | undefined): Promise<string> {
  const base = baseTitle(sourceTitle);
  try {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return `${base} redo 1`;

    const like = `${base.replace(/[%_]/g, (m) => `\\${m}`)} redo %`;
    const { data, error } = await supabase
      .from("media_assets")
      .select("title")
      .eq("user_id", u.user.id)
      .ilike("title", like)
      .limit(500);
    if (error || !data) return `${base} redo 1`;

    let max = 0;
    for (const row of data) {
      const m = REDO_RE.exec(String((row as { title: string }).title ?? ""));
      if (m) {
        const n = parseInt(m[1]!, 10);
        if (Number.isFinite(n) && n > max) max = n;
      }
    }
    return `${base} redo ${max + 1}`;
  } catch {
    return `${base} redo 1`;
  }
}
