import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
};

export function SoundSettingsDialog({ open, onOpenChange, enabled, onEnabledChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Sound</DialogTitle>
          <DialogDescription>
            Sentences are read with your device&apos;s own voice — instant and free.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-3">
          <div>
            <div className="font-medium">Read sentences aloud</div>
            <div className="text-xs text-muted-foreground">Uses your device voice</div>
          </div>
          <Switch checked={enabled} onCheckedChange={onEnabledChange} aria-label="Read sentences aloud" />
        </div>

        <p className="text-xs text-muted-foreground">
          To change the voice, use your device settings (on iPhone: Settings › Accessibility › Spoken
          Content › Voices).
        </p>
      </DialogContent>
    </Dialog>
  );
}
