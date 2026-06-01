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
