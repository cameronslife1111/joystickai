# Move voice typing onto your own OpenAI key

## What's using Lovable credits today

I checked every AI call in the app. Only two features use Lovable credits:

1. **Voice typing (the 🔴 buttons)** — the transcription runs through Lovable AI.
2. **Sentence reading voices (text-to-speech)** — also Lovable AI.

Everything else already runs on your own keys: all chat, planning, plan steps, delegate, media rewrite and the hands-free calls use your **OpenAI** key; images, video, avatars and upscaling use your **Fal** key. So nothing else is quietly spending credits.

## The best speech-to-text choice

Whisper is now the old one. OpenAI's current transcription model is **gpt-4o-transcribe**, same price as Whisper ($0.006 per minute of audio) with about 22% fewer mistakes and better language handling [3](https://tokenmix.ai/blog/gpt-4o-transcribe-vs-whisper-review-2026), [2](https://developers.openai.com/api/docs/models/gpt-4o-transcribe). That's roughly a third of a cent per minute you speak, billed to your OpenAI account instead of Lovable credits.

So: switch voice typing to **gpt-4o-transcribe on your own OpenAI key**, with `gpt-4o-mini-transcribe` as an automatic cheaper fallback if the main one is ever unavailable.

## Killing the "error, and it heard nothing" problem

Four fixes, all on the sending side (the recording itself stays exactly as it is):

- **Long recordings get split, not rejected.** Anything longer than roughly 8 minutes is cut into overlapping-free chunks at 16 kHz mono, transcribed in order, and stitched back into one block of text — so a long note never fails for being too big.
- **Automatic retries.** A hiccup, rate limit or timeout retries up to 3 times with a short growing wait before it ever shows you an error.
- **Nothing gets thrown away.** If one chunk of a long recording fails after retries, you still get the text from all the other chunks plus a short note that a piece was missed — instead of losing the whole thing.
- **Honest, useful messages.** Out-of-credit / billing problems, key problems, and "you were silent" each say what actually happened, in plain words.

## Technical notes

- `src/lib/whisper.functions.ts`: swap the Lovable gateway call for `https://api.openai.com/v1/audio/transcriptions` using `process.env.OPENAI_API_KEY`, model `gpt-4o-transcribe`, `response_format: "json"`, no `language` field (auto-detect). Add chunking (decode the WAV server-side, re-emit WAV slices), bounded retry with backoff, per-chunk partial-failure tolerance, and mapped error messages for 401 / 402 / 429 / 5xx.
- The client (`use-voice-dictation.ts`, `DictateButton.tsx`, `audio-recorder.ts`) is untouched; the server function keeps the same input/output shape.
- Add `tests/whisper.test.ts` covering: chunking of over-long audio, retry then success, partial-chunk failure still returning text, and error mapping.

## Optional, not included

If you later want to drop the last Lovable-credit use too, the sentence voices could move to OpenAI's own speech voices on your key. Say the word and I'll plan that separately — this plan leaves them exactly as they are.
