import { Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { TTS_VOICES, type TtsVoice } from "@/lib/tts-voices";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enabled: boolean;
  voice: TtsVoice;
  prefetch: number;
  onEnabledChange: (enabled: boolean) => void;
  onVoiceChange: (voice: TtsVoice) => void;
  onPrefetchChange: (depth: number) => void;
  onPreview: (voice: TtsVoice) => void;
};


export function SoundSettingsDialog({
  open,
  onOpenChange,
  enabled,
  voice,
  onEnabledChange,
  onVoiceChange,
  onPreview,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Sound</DialogTitle>
          <DialogDescription>Choose the Google voice that reads your sentences.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-3">
          <div>
            <div className="font-medium">Read sentences aloud</div>
            <div className="text-xs text-muted-foreground">Use hosted Google speech</div>
          </div>
          <Switch checked={enabled} onCheckedChange={onEnabledChange} aria-label="Read sentences aloud" />
        </div>

        <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          {(["female", "male"] as const).flatMap((group) => [
            <div
              key={`h-${group}`}
              className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {group === "female" ? "US female voices" : "US male voices"}
            </div>,
            ...TTS_VOICES.filter((o) => o.gender === group).map((option) => {
            const selected = option.id === voice;
            return (
              <div
                key={option.id}
                className={cn(
                  "flex items-center gap-2 rounded-md border p-2 transition-colors",
                  selected ? "border-primary bg-primary/10" : "border-border bg-background",
                  !enabled && "opacity-50",
                )}
              >
                <Button
                  type="button"
                  variant={selected ? "default" : "ghost"}
                  className="h-auto min-w-0 flex-1 justify-start px-3 py-2 text-left"
                  disabled={!enabled}
                  onClick={() => onVoiceChange(option.id)}
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{option.label}</span>
                    <span className="block text-xs opacity-70">{option.description}</span>
                  </span>
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  disabled={!enabled}
                  onClick={() => onPreview(option.id)}
                  aria-label={`Preview ${option.label}`}
                  title={`Preview ${option.label}`}
                >
                  <Volume2 />
                </Button>
              </div>
              );
            }),
          ])}
        </div>
      </DialogContent>
    </Dialog>
  );
}