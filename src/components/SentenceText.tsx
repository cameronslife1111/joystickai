import { linkify } from "@/lib/linkify";
import { cn } from "@/lib/utils";

type Props = {
  content: string;
  className?: string;
  pendingDelete?: boolean;
};

export function SentenceText({ content, className, pendingDelete }: Props) {
  const segments = linkify(content);
  return (
    <span
      className={cn(
        className,
        pendingDelete && "line-through decoration-2 text-red-400/70",
      )}
    >
      {segments.map((seg, i) => {
        if (seg.type === "text") {
          return <span key={i}>{seg.value}</span>;
        }
        return (
          <a
            key={i}
            href={seg.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="underline underline-offset-4 decoration-foreground/40 hover:decoration-foreground/80 transition"
          >
            {seg.display}
          </a>
        );
      })}
    </span>
  );
}
