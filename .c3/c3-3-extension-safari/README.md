---
id: c3-3
c3-seal: 570203ade7447c87f4af53f061400672735a0990f2e8a8bee40881720f28a1f0
title: extension-safari
type: container
boundary: service
parent: c3-0
goal: Package the ai-dict core as a Safari/iOS Manifest V3 web extension wrapped in an Xcode project — a service worker, a content script, and an options page — plus the Safari-specific port adapters.
---

## Goal

Package the ai-dict core as a Safari/iOS Manifest V3 web extension wrapped in an Xcode project — a service worker, a content script, and an options page — plus the Safari-specific port adapters.

## Components

| ID | Name | Category | Status | Goal Contribution |
| --- | --- | --- | --- | --- |
| c3-301 | safari-adapters | Foundation | implemented | Safari implementations of the Storage, SettingsStore, and TriggerUI ports. |
| c3-310 | safari-service-worker | Feature | implemented | SW composition root: wires the Gemini client + router + Safari storage; gates inbound messages. |
| c3-311 | safari-content-script | Feature | implemented | Content composition root: wires the workflow + DOM selection + renderer. |
| c3-312 | safari-options-page | Feature | implemented | The options page (HTML + script) where the API key is entered. |

## Responsibilities

- Own everything Safari/iOS-specific: the MV3 `manifest.json`, the esbuild bundle, and the Xcode wrapper + `xcode:sync` step.
- Implement the core's ports against the Safari WebExtension APIs (`browser.*` / `chrome.*` polyfill).
- Act as the composition roots (`sw.ts`, `content.ts`) that inject Safari adapters into the core.
- Host the options page where the user enters the Gemini key.
- Degrade gracefully on sites the user has not granted (no selection events fire).

## Complexity Assessment

Low. The thinnest shell (~580 LOC), structurally mirroring `extension-chrome` minus the side panel. The extra complexity lives outside the TypeScript: the Xcode project generation (`safari-web-extension-converter`) and the manual iOS-simulator release checklist (`packages/extension-safari/e2e/ios-simulator-checklist.md`).
