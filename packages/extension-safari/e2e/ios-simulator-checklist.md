# iOS Simulator manual checklist (run every release — no automated e2e on Safari)

Prereq: macOS with Xcode; a real Gemini API key.

1. [ ] Build the Xcode project (`pnpm --filter @ai-dict/extension-safari build && pnpm --filter @ai-dict/extension-safari xcode:sync`, then build in Xcode).
2. [ ] Boot iOS Simulator (iPhone 15, iOS 17+).
3. [ ] Install the host app.
4. [ ] Settings → Safari → Extensions → enable "AI Dictionary".
5. [ ] Grant "Always Allow on Every Website".
6. [ ] Open Safari, navigate to a test article.
7. [ ] Open extension Settings → paste a real Gemini key.
8. [ ] Select a word → verify `<lookup-trigger>` appears.
9. [ ] Tap trigger → verify the bottom sheet opens with a loading state, then a result card.
10. [ ] Verify a cache hit on a second identical selection (instant, `fromCache`).
11. [ ] Trigger error states: clear the key, turn the network off → verify error UX matches §7.1.
12. [ ] Tap "Clear all data" → verify `storage.local` is wiped (key gone, history empty).
