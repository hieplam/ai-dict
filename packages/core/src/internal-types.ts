/**
 * Internal-only types not exported from the public @ai-dict/core barrel.
 * Adapters that need Settings (e.g. a SettingsStore implementation) must import
 * from this path directly: `import type { Settings } from '@ai-dict/core/src/internal-types'`.
 * This keeps `apiKey` off the public API surface and unrepresentable as a wire type.
 */
import type { PublicSettings } from './types';

export interface Settings extends PublicSettings {
  apiKey: string;
  cacheEnabled: boolean;
  saveHistory: boolean;
}
