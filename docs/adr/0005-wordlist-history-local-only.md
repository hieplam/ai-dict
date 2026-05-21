# Word List and History stay local-only

The Rules file syncs across devices via Google Drive (ADR 0003), so the natural next assumption is that user-saved Words sync the same way. We deliberately chose otherwise.

**Decision:** **History** (every Lookup, auto) and **Word List** (Words the user has explicitly saved) are stored in the **extension's local storage on each device** and are **never** synced to any cloud. The only path off-device is **explicit Markdown file export** initiated by the user.

**Why:**
1. **Privacy.** Reading history never leaves the device. Even if the user's Google Drive is compromised, their reading habits are not on it. The App Store privacy declaration stays empty.
2. **Simplicity.** Real-time sync of an append-mostly list would require conflict resolution, Drive Application Programming Interface (API) quota planning, and per-Word URL/title metadata travelling to the cloud — all out of scope for v1.
3. **Workflow alignment.** English as a Second Language (ESL) learners who want cross-device study already use Anki, Obsidian, or Notion. Markdown export feeds those tools directly; those tools own the sync problem.

**Consequence:** Looking up the same Word on Personal Computer (PC) and iPhone Operating System (iOS) produces two separate History entries. This is acceptable for v1 and consistent with the framing that **Rules describe the user's intent, while History/Word List describe device-specific activity**.
