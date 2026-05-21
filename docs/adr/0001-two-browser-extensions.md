# Two browser extensions; no native iOS app

The product solves "I lose my reading context when I tab away to a dictionary", and the user's reading happens in browsers (Chrome on Personal Computer (PC), Safari on iPhone Operating System (iOS) after switching from Chrome on iOS).

**Decision:** Ship as **two browser extensions** — a Safari Web Extension on iOS + macOS and a Chrome Manifest V3 (MV3) extension on desktop. Do **not** build a native iOS app, and do **not** target Chrome on iOS.

**Why:**
1. A browser extension can inject the Definition User Interface (UI) directly into the reading page, which is the only way to make Lookups feel truly in-context.
2. Chrome on iOS does **not** support extensions (Apple platform policy); the only way to give iOS users in-page Lookups is to ask them to read in Safari instead, accepting that constraint.
3. A native iOS app would force a Share-Sheet flow (the exact tab-switch pain the product exists to eliminate) or oblige us to ship our own browser — both worse outcomes than an in-page extension.
4. Safari Web Extension and Chrome MV3 share most Application Programming Interface (API) surface; one shared content-script bundle plus thin platform wrappers keeps the second codebase cheap.
