# Gray orb long-press toggle: Media gallery ↔ Chat

## Goal

Give the gray orb the same long-press mode switch as the pink orb. Default mode is Media gallery (`Image` icon). A long press swaps it to Chat mode (`MessageSquare` icon), and a tap then opens the chat dialog exactly like the menu's Chat button. Another long press swaps back.

## Changes

### `src/components/OrbCluster.tsx`

- Replace the gray orb props `onMediaGallery` and `mediaBadge` with:
  - `grayMode: "media" | "chat"`
  - `onGrayTap: () => void`
  - `onGrayLongPress: () => void`
  - `grayBadge?: number`
- Gray orb icon:
  - `media` mode → `Image`
  - `chat` mode → `MessageSquare` (import from `lucide-react`)
- Gray orb label:
  - `"Media gallery (hold for Chat)"`
  - `"Chat (hold for Media gallery)"`
- Keep the badge span; the parent will supply the right count.

### `src/routes/_authenticated/app.tsx`

- Add state: `const [grayMode, setGrayMode] = useState<"media" | "chat">("media");`
- Pass to `OrbCluster`:
  - `grayMode={grayMode}`
  - `onGrayTap={() => {
      if (grayMode === "media") navigate({ to: "/media" });
      else {
        setPendingChatThreadId(null);
        setChatStartInList(true);
        setChatOpen(true);
      }
    }}`
  - `onGrayLongPress={() => {
      setGrayMode((m) => {
        const next = m === "media" ? "chat" : "media";
        toast(next === "media" ? "🖼️ Media gallery" : "💬 Chat", { id: "gray-mode" });
        return next;
      });
    }}`
  - `grayBadge={grayMode === "media" ? unseenCount : chatUnreadCount}`

### `src/components/LandingOrb.tsx`

- Import `MessageSquare` from `lucide-react`.
- The landing orb is decorative and shows the default state, so gray keeps the `Image` icon. No functional change required beyond making the icon import available if future variants need it.

### `src/routes/index.tsx`

- Update the gray entry in `CLUSTER`:
  - `label: "Media gallery / Chat"`

## Verification

- Long-press the gray orb: a toast confirms "💬 Chat" and the icon changes to a chat bubble.
- Tap in chat mode: the chat dialog opens to the thread list.
- Long-press again: toast confirms "🖼️ Media gallery" and the icon returns to the picture icon.
- Tap in media mode: navigates to `/media`.
- Badge switches between unseen media count and unread chat count based on the active mode.
