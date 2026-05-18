import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  value: string;
  onChange: (v: string) => void;
  includeAuto?: boolean;
}

export function AspectRatioSelect({ value, onChange, includeAuto = false }: Props) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder="Aspect ratio" />
      </SelectTrigger>
      <SelectContent>
        {includeAuto && <SelectItem value="auto">Match input image</SelectItem>}
        <SelectItem value="portrait_16_9">Portrait 9:16 (vertical)</SelectItem>
        <SelectItem value="portrait_4_3">Portrait 3:4</SelectItem>
        <SelectItem value="square_hd">Square</SelectItem>
        <SelectItem value="landscape_16_9">Landscape 16:9</SelectItem>
        <SelectItem value="landscape_4_3">Landscape 4:3</SelectItem>
      </SelectContent>
    </Select>
  );
}
