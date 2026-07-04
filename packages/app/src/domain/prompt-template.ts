import { PROMPT_ENVELOPE } from './default-template';
import { redactPII } from './pii';

export interface TemplateVars {
  word: string;
  context: string;
  target_lang: string;
  source_lang?: string;
  url?: string;
  title?: string;
}

const SUPPORTED = ['word', 'context', 'target_lang', 'source_lang', 'url', 'title'] as const;

export function renderTemplate(template: string, vars: TemplateVars): string {
  const resolved: Record<string, string | undefined> = {
    ...vars,
    source_lang: vars.source_lang ?? 'English',
  };
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (!SUPPORTED.includes(name as (typeof SUPPORTED)[number])) return match;
    const value = resolved[name];
    return value ?? match;
  });
}

/**
 * Assemble the final prompt sent to the model.
 *
 * The user-editable `outputFormat` (the card's section layout) is inserted into
 * the code-owned PROMPT_ENVELOPE FIRST, then the combined string is rendered.
 * Insert-before-render matters: a single `renderTemplate` pass cannot recurse
 * into a replacement value, so doing the insert first lets a `{target_lang}`
 * written inside the user's format still resolve. The constraints live in the
 * envelope, so an empty `outputFormat` still ships them.
 *
 * The page title is passed through `redactPII` here so masking is guaranteed for
 * every caller, independent of the lookup client.
 *
 * Advanced override (#62): a non-blank `envelope` replaces the code-owned
 * `PROMPT_ENVELOPE`. If it omits `{output_format}` it becomes the complete prompt
 * (restoring a legacy full-prompt user's exact behavior); the title is still
 * routed through `redactPII` either way. A blank/absent `envelope` means "built-in".
 */
export function buildPrompt(outputFormat: string, vars: TemplateVars, envelope?: string): string {
  const env = envelope !== undefined && envelope.trim() !== '' ? envelope : PROMPT_ENVELOPE;
  const composed = env.includes('{output_format}')
    ? env.replace('{output_format}', outputFormat)
    : env;
  return renderTemplate(composed, { ...vars, title: redactPII(vars.title ?? '') });
}
