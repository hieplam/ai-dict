# Google Drive `appDataFolder` for Rules sync

The Rules file (user-authored prompt customisation, analogous to `CLAUDE.md`) must be identical on every device the user reads from. Safari iPhone Operating System (iOS) extension storage and Chrome desktop extension storage are isolated by browser vendor — no native cross-platform sync exists.

**Decision:** Store the Rules file in the user's own **Google Drive `appDataFolder`** (an app-scoped, hidden Drive folder that does not appear in the user's normal Drive User Interface (UI)). Both extensions read and write the same file via the Google Drive REpresentational State Transfer (REST) Application Programming Interface (API) using Open Authorization 2.0 (OAuth 2.0).

**Why:**
1. The user is already authenticated with Google to obtain a Gemini key (ADR 0002) — one identity covers both scopes; one auth dance instead of two.
2. Google Drive works equally on Safari iOS and Chrome desktop, unlike Apple iCloud (Apple-only) or Chrome Sync (Chrome-only).
3. Data living in the user's own cloud is consistent with the no-backend principle of ADR 0002 — we never store user content.

**Alternatives considered:**
- **Own sync backend** — rejected; violates ADR 0002.
- **GitHub Gist** — rejected; extra account, narrower audience overlap with English as a Second Language (ESL) learners.
- **Per-device manual copy-paste** — rejected; too painful for normal Rules editing.
