import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVoiceDictation } from "@/lib/use-voice-dictation";

interface Props {
  /** Called with the transcribed text (callers append it to their field). */
  onText: (text: string) => void;
  className?: string;
}

/** 🔴 / ⬛️ push-to-dictate button, same behavior as the chat composer mic. */
export function DictateButton({ onText, className }: Props) {
  const dictation = useVoiceDictation(onText);
  return (
    <Button
      size="icon"
      variant="ghost"
      type="button"
      onClick={() => void dictation.toggle()}
      disabled={dictation.transcribing}
      aria-label={dictation.recording ? "Stop recording" : "Start voice input"}
      title={dictation.recording ? "Stop and transcribe" : "Voice input"}
      className={"shrink-0 text-lg " + (className ?? "")}
    >
      {dictation.transcribing ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : dictation.recording ? (
        <span aria-hidden>⬛️</span>
      ) : (
        <span aria-hidden>🔴</span>
      )}
    </Button>
  );
}
