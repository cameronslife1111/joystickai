import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type DestinationPosition = "top" | "bottom" | "after_current";

interface Props {
  documents: { id: string; title: string }[];
  targetDocumentId: string;
  onTargetDocumentIdChange: (id: string) => void;
  position: DestinationPosition;
  onPositionChange: (p: DestinationPosition) => void;
}

export function DestinationPicker({
  documents,
  targetDocumentId,
  onTargetDocumentIdChange,
  position,
  onPositionChange,
}: Props) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        Where should this go?
      </p>

      <div className="flex flex-col gap-1.5">
        <Label>Target document</Label>
        <Select value={targetDocumentId} onValueChange={onTargetDocumentIdChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select a document" />
          </SelectTrigger>
          <SelectContent>
            {documents.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.title || "Untitled"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Position</Label>
        <RadioGroup
          value={position}
          onValueChange={(v) => onPositionChange(v as DestinationPosition)}
          className="gap-2"
        >
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="after_current" id="dest-after" />
            <span>After current sentence</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="top" id="dest-top" />
            <span>Top of document</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="bottom" id="dest-bottom" />
            <span>Bottom of document</span>
          </label>
        </RadioGroup>
      </div>
    </div>
  );
}
