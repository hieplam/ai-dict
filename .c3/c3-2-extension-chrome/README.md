---
id: c3-2
c3-seal: eed0db95e55e8e7a1e3a3e97841a9bf84ed57133de6082963dcba3829079a986
title: extension-chrome
type: container
boundary: service
parent: c3-0
goal: Package the ai-dict core as a Chrome Manifest V3 extension — a service worker, a content script, an options page, and a side panel — plus the Chrome-specific adapters that implement the core's ports.
---

## Goal

Package the ai-dict core as a Chrome Manifest V3 extension — a service worker, a content script, an options page, and a side panel — plus the Chrome-specific adapters that implement the core's ports.

## Components

| ID | Name | Category | Status | Goal Contribution |
| --- | --- | --- | --- | --- |
| c3-201 | chrome-adapters | Foundation | implemented | Chrome implementations of the Storage, SettingsStore, TriggerUI, and side-panel mirror ports. |
| c3-210 | chrome-service-worker | Feature | implemented | SW composition root: wires the Gemini client + router + Chrome storage; gates inbound messages. |
| c3-211 | chrome-content-script | Feature | implemented | Content composition root: wires the workflow + DOM selection + renderers; registers elements in the MAIN world. |
| c3-212 | chrome-ui-pages | Feature | implemented | The options page and the side-panel page (HTML + scripts). |

## Responsibilities

- Own everything Chrome-specific: the MV3 `manifest.json`, the esbuild bundle, and the Playwright e2e suite.
- Implement the core's ports against `chrome.*` APIs (storage, runtime messaging, side panel, floating trigger).
- Act as the two composition roots (`sw.ts`, `content.ts`) that inject concrete adapters into the core's `buildRouter` / `runLookupWorkflow`.
- Host the options page (the only place the API key is written) and the toolbar-opened side panel.
- Inject an optional build-time Gemini key via esbuild `define` for personal builds.

## Complexity Assessment

Low-to-moderate. The shell is thin (~670 LOC) — its job is wiring, not logic. The notable subtleties are the two-world content script (isolated world for `content.ts`, MAIN world for `content-elements.ts` custom-element registration, sharing one DOM registry) and the "side panel opens only via toolbar click" rule (spec §6.5).
