# Move sentence reading to OpenAI

## Goal
Replace the Lovable-credit text-to-speech path with OpenAI using the existing OpenAI API key, while keeping sentence reading fast, reliable, and familiar.

## What will change
- Send sentence-reading requests directly to OpenAI’s `gpt-4o-mini-tts` model from the secure server side.
- Stream raw audio as it is generated so uncached sentences begin playing before the full recording finishes.
- Replace the Google voice list with OpenAI’s currently supported voices, keeping female/male organization where the official voice descriptions support it.
- Change the Sound window wording from Google speech to OpenAI speech.
- Safely map an existing Google voice preference to a new default OpenAI voice so no saved setting can break reading.
- Version the saved-audio keys so previously generated Google clips are not mistaken for OpenAI clips.

## Preserve the fast experience
- Keep instant playback for saved sentences in memory and on the device.
- Keep the current interruption, rapid-navigation, iPhone audio recovery, mute, preview, and 1.15× playback behavior.
- Keep preparing the next likely sentence, but stop preparing less-likely cross-document sentences by default to reduce paid generation that may never be heard.
- A real button press will always cancel background preparation and take priority.

## Reliability and billing safeguards
- Never expose the OpenAI key to the browser.
- Make no request while Sound is off or during hands-free calls.
- Preserve bounded retries only for rate limits and temporary OpenAI failures; show OpenAI’s useful error message for permanent failures.
- Honor cancellation when the user moves to another sentence.
- Store every successfully generated sentence locally so repeats do not incur another charge.

## Technical details
- Replace the Lovable AI proxy helper with a direct OpenAI speech helper using `OPENAI_API_KEY` inside the request handler.
- Normalize OpenAI’s streamed PCM audio into the existing 24 kHz playback and storage pipeline.
- Update request validation, voice types, saved preference constraints, defaults, and tests together.
- Add regression coverage for streaming chunks, cancellation, voice fallback, cache versioning, mute behavior, retry rules, and prefetch priority.
- Make one short real OpenAI speech request to confirm the configured key, model, voice, audio format, and streaming path work before completion.
- Verify the app checks cleanly and test sentence playback in the preview where authentication permits.

## Not changing
- Voice typing, hands-free calls, chat, planning, and other OpenAI features remain unchanged.
- Existing Google clips may remain stored on a device until normal cache cleanup, but they will never be played as an OpenAI voice.
