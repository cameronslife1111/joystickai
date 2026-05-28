## Increase Generate Text prompt limit

The `Generate Text` action hits a Zod validator in `src/lib/ai.functions.ts` that caps `prompt` at 8000 characters. GPT-5.5 accepts far more, so the limit is artificially low.

### Change

In `src/lib/ai.functions.ts`, raise `prompt` max from `8000` → `100000` on:
- `generateTextSchema.prompt`
- `analyzeImageSchema.prompt`
- `webSearchSchema.prompt`

(Keeping all three consistent so the same fix applies to Analyze Image and Web Search dialogs, which share the same composer.)

No client-side changes needed — the `Textarea` in `GenerateTextDialog.tsx` has no maxLength. No model/system-prompt changes.

### Why 100k

Comfortably covers long pasted context and attached-document concatenation, while still bounding payload size to protect the server function from absurd inputs.
