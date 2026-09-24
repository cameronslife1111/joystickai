import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { TTS_VOICES, setSpeechVoice, setSpeechHighQuality, speakText } from "@/lib/speech";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  muted: boolean;
  voice: string;
  highQuality: boolean;
  onMutedChange: (muted: boolean) => void;
  onVoiceChange: (voice: string) => void;
  onHighQualityChange: (on: boolean) => void;
}

export function SoundSettingsDialog({ open, onOpenChange, muted, voice, highQuality, onMutedChange, onVoiceChange, onHighQualityChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sound</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
          <span className="text-sm">Read sentences aloud</span>
          <Switch checked={!muted} onCheckedChange={(on) => onMutedChange(!on)} />
        </div>
        <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
          <div>
            <div className="text-sm">High-quality voice</div>
            <div className="text-xs text-muted-foreground">Richer and more expressive, costs a bit more</div>
          </div>
          <Switch
            checked={highQuality}
            onCheckedChange={(on) => { setSpeechHighQuality(on); onHighQualityChange(on); }}
          />
        </div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Voice</div>
        <div className="grid grid-cols-2 gap-2">
          {TTS_VOICES.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => {
                setSpeechVoice(v.id);
                onVoiceChange(v.id);
                if (!muted) speakText(`Hi, I'm ${v.label}.`);
              }}
              className={`rounded-xl border px-3 py-2 text-left transition ${
                voice === v.id ? "border-primary bg-primary/10" : "border-border hover:bg-accent"
              }`}
            >
              <div className="text-sm font-medium">{v.label}</div>
              <div className="text-xs text-muted-foreground">{v.hint}</div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
