export * from './domain/types';
export * from './ports';
export * from './domain/default-template';
export * from './domain/prompt-template';
export * from './domain/legacy-templates';
export * from './domain/pii';
export * from './domain/key-hygiene';
export * from './domain/cache-policy';
export * from './domain/history-policy';
export * from './domain/saved-words-policy';
export * from './domain/words-page-policy';
export * from './domain/badge-policy';
export * from './domain/nudge-policy';
export * from './domain/card-placement';
export * from './domain/onboarding-policy'; // C1
export * from './domain/setup-health-policy';
export * from './domain/ui-flags';
export * from './domain/error-mapper';
export * from './domain/highlight-policy'; // B3
export * from './domain/backup-policy';
export {
  toErrorRecord,
  appendCapped,
  fibThreshold,
  decide,
  ERROR_BUFFER_CAP,
  type ErrorRecord,
  type Consent,
  type CaptureInput,
  type CaptureMeta,
  type ReportDecision,
} from './domain/error-report';
export * from './wire';
export * from './domain/workflow';
export * from './ui/index';
export * from './app/markdown-sanitize';
export * from './app/gemini-lookup-client';
export * from './app/openai-lookup-client';
export * from './app/anthropic-lookup-client';
export * from './app/lookup-client-selector';
export * from './app/inline-bottom-sheet-renderer';
export * from './app/save-reply-guard';
export * from './app/router';
export * from './app/history-export';
export * from './app/backup';
export * from './app/anki-export';
export * from './app/inbound';
export * from './app/dom-selection-source';
export * from './app/message-relay-lookup-client';
export * from './app/lookup-chunk-message';
export * from './app/page-highlighter'; // B3
export * from './app/hover-recall-controller';
export { buildGa4Request, GA4_ENDPOINT, type Ga4Config, type Ga4Request } from './app/ga4-payload';
export { ErrorReporter, type ErrorReporterDeps, type ErrorLogStatus } from './app/error-reporter';
export { buildConsentFooter } from './ui/error-consent';
