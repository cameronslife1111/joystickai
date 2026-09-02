import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Renders chat text and turns [[doc:<uuid>|Title]] tokens into tappable pills
 * that open that document in the app (closing the chat first).
 */
const DOC_TOKEN =
  /\[\[doc:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:\|([^\]]*))?\]\]/g;

export function hasDocLink(text: string): boolean {
  DOC_TOKEN.lastIndex = 0;
  return DOC_TOKEN.test(text ?? "");
}

/** Strip link tokens so speech / copy stay clean. */
export function stripDocLinks(text: string): string {
  return (text ?? "").replace(DOC_TOKEN, (_m, _id, title) => (title ? String(title).trim() : "")).trim();
}

type Props = {
  text: string;
  className?: string;
  onOpenDocument?: (documentId: string) => void;
};

export function DocLinkText({ text, className, onOpenDocument }: Props) {
  const src = text ?? "";
  const nodes: React.ReactNode[] = [];
  let last = 0;
  DOC_TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DOC_TOKEN.exec(src))) {
    if (m.index > last) nodes.push(<span key={`t${last}`}>{src.slice(last, m.index)}</span>);
    const id = m[1];
    const title = (m[2] ?? "").trim() || "Open document";
    nodes.push(
      <button
        key={`d${m.index}`}
        type="button"
        onClick={() => onOpenDocument?.(id)}
        className="mx-0.5 inline-flex max-w-full items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 align-middle text-sm text-primary transition hover:bg-primary/20 active:scale-[0.97]"
      >
        <FileText className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{title}</span>
      </button>,
    );
    last = m.index + m[0].length;
  }
  if (last < src.length) nodes.push(<span key={`t${last}`}>{src.slice(last)}</span>);

  return <span className={cn("whitespace-pre-wrap", className)}>{nodes}</span>;
}

/** A standalone row of document pills (used by plan cards). */
export function DocLinkRow({
  docs,
  className,
  onOpenDocument,
}: {
  docs: { id: string; title: string }[];
  className?: string;
  onOpenDocument?: (documentId: string) => void;
}) {
  if (docs.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {docs.map((d) => (
        <button
          key={d.id}
          type="button"
          onClick={() => onOpenDocument?.(d.id)}
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary transition hover:bg-primary/20 active:scale-[0.97]"
        >
          <FileText className="h-3 w-3 shrink-0" />
          <span className="truncate">{d.title || "Untitled"}</span>
        </button>
      ))}
    </div>
  );
}
