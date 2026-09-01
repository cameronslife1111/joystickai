/**
 * Emoji-chip notifications.
 *
 * Drop-in replacement for sonner's `toast`: every call renders a small
 * rounded chip in the top-right corner with an emoji that represents what
 * happened, optional tiny text, and an optional 👁️ (view) / ↩️ (undo) button.
 *
 * Import `toast` from here instead of "sonner" everywhere in the app.
 */
import { toast as sonner } from "sonner";
import { createElement, type ReactNode } from "react";

type Kind = "default" | "success" | "error" | "info" | "warning" | "loading";

export interface EmojiToastOptions {
  id?: string | number;
  duration?: number;
  description?: ReactNode;
  action?: { label: ReactNode; onClick: () => void };
  cancel?: { label: ReactNode; onClick?: () => void };
  /** Force a specific emoji instead of the keyword-derived one. */
  emoji?: string;
  [key: string]: unknown;
}

const KEYWORDS: Array<[RegExp, string]> = [
  [/\bundo\b|restored?/i, "↩️"],
  [/delet|remov|clear/i, "🗑️"],
  [/copi|copy|clipboard/i, "📋"],
  [/renam/i, "✏️"],
  [/transcrib|listening|recording|microphone|mic\b/i, "🎙️"],
  [/download/i, "⬇️"],
  [/upload/i, "⬆️"],
  [/import/i, "📥"],
  [/export|pdf|saved|save/i, "💾"],
  [/video/i, "🎬"],
  [/image|photo|picture|背景|background/i, "🖼️"],
  [/speech|speak|voice|sound|audio/i, "🔊"],
  [/folder/i, "📁"],
  [/schedul/i, "⏰"],
  [/pin(ned)?\b/i, "📌"],
  [/link/i, "🔗"],
  [/attach/i, "📎"],
  [/sent|send/i, "📤"],
  [/chat|message|reply/i, "💬"],
  [/document|sentence|doc\b/i, "📄"],
  [/sign(ed)? in|sign(ed)? up|account|auth/i, "🔑"],
  [/generating|regenerat|working|processing|creating/i, "⏳"],
  [/approv/i, "✅"],
  [/retry|retrying/i, "🔁"],
  [/plan/i, "🟣"],
  [/moved?\b|swap/i, "↔️"],
  [/created?\b|added?\b/i, "➕"],
];

const KIND_EMOJI: Record<Kind, string> = {
  default: "•",
  success: "✅",
  error: "❌",
  info: "ℹ️",
  warning: "⚠️",
  loading: "⏳",
};

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function pickEmoji(kind: Kind, message: unknown, description?: unknown): string {
  const hay = `${textOf(message)} ${textOf(description)}`.trim();
  if (kind === "loading") return "⏳";
  if (kind === "error") {
    if (/plan/i.test(hay)) return "🔴";
    return "❌";
  }
  if (hay) {
    // Plan-specific wins over the generic plan emoji.
    if (/plan/i.test(hay) && /done|complete|finish/i.test(hay)) return "🟢";
    for (const [re, emoji] of KEYWORDS) if (re.test(hay)) return emoji;
  }
  return KIND_EMOJI[kind];
}

function actionEmoji(label: unknown): string {
  const text = textOf(label);
  if (/undo|restore|revert/i.test(text)) return "↩️";
  return "👁️";
}

function shortLabel(message: unknown, description?: unknown): string {
  const raw = textOf(message) || textOf(description);
  if (!raw) return "";
  const cleaned = raw.replace(/\s+/g, " ").trim();
  // Keep only the leading clause, then hard-truncate.
  const clause = cleaned.split(/ — | - |[:.!?]/)[0].trim() || cleaned;
  return clause.length > 24 ? `${clause.slice(0, 23)}…` : clause;
}

function defaultDuration(kind: Kind): number {
  if (kind === "loading") return Infinity;
  if (kind === "error") return 2000;
  return 1000;
}

function chip(
  kind: Kind,
  message: unknown,
  opts: EmojiToastOptions | undefined,
  toastId: string | number,
) {
  const emoji = opts?.emoji ?? pickEmoji(kind, message, opts?.description);
  const label = shortLabel(message, opts?.description);
  const full = `${textOf(message)}${opts?.description ? ` — ${textOf(opts.description)}` : ""}`.trim();
  const action = opts?.action;

  return createElement(
    "div",
    {
      title: full || undefined,
      className:
        "pointer-events-auto flex items-center gap-1.5 rounded-full border border-border/70 bg-background/90 px-2.5 py-1.5 shadow-lg backdrop-blur-md",
    },
    createElement("span", { className: "text-xl leading-none", "aria-hidden": true }, emoji),
    label
      ? createElement(
          "span",
          { className: "max-w-[9rem] truncate text-[10px] leading-none text-muted-foreground" },
          label,
        )
      : null,
    action
      ? createElement(
          "button",
          {
            type: "button",
            onClick: () => {
              action.onClick();
              sonner.dismiss(toastId);
            },
            className:
              "-mr-0.5 ml-0.5 rounded-full px-1 text-xl leading-none transition-transform active:scale-90",
            "aria-label": textOf(action.label) || "Action",
          },
          actionEmoji(action.label),
        )
      : null,
  );
}

function show(kind: Kind, message: unknown, opts?: EmojiToastOptions) {
  const id = opts?.id ?? `emoji-${Math.random().toString(36).slice(2)}`;
  return sonner.custom(() => chip(kind, message, opts, id), {
    id,
    duration: opts?.duration ?? defaultDuration(kind),
    position: "top-right",
    unstyled: true,
    className: "!bg-transparent !border-0 !shadow-none !p-0 !w-auto",
  });
}

type ToastFn = (message: unknown, opts?: EmojiToastOptions) => string | number;

export const toast: ToastFn & {
  success: ToastFn;
  error: ToastFn;
  info: ToastFn;
  warning: ToastFn;
  message: ToastFn;
  loading: ToastFn;
  custom: typeof sonner.custom;
  dismiss: typeof sonner.dismiss;
} = Object.assign(
  ((message: unknown, opts?: EmojiToastOptions) => show("default", message, opts)) as ToastFn,
  {
    success: (m: unknown, o?: EmojiToastOptions) => show("success", m, o),
    error: (m: unknown, o?: EmojiToastOptions) => show("error", m, o),
    info: (m: unknown, o?: EmojiToastOptions) => show("info", m, o),
    warning: (m: unknown, o?: EmojiToastOptions) => show("warning", m, o),
    message: (m: unknown, o?: EmojiToastOptions) => show("default", m, o),
    loading: (m: unknown, o?: EmojiToastOptions) => show("loading", m, o),
    custom: sonner.custom,
    dismiss: sonner.dismiss,
  },
);

export default toast;
