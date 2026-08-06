// A15: split into its own zero-dependency module so e2e specs (which run in Node, not a browser)
// can import the mark name without pulling in chrome-floating-trigger.ts's top-level
// registerContentElements() call (browser-only — defines custom elements via `customElements`).
export const TRIGGER_SHOWN_MARK = 'ai-dict:trigger-shown';
