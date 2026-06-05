import axe, { type Result } from 'axe-core';

export async function axeViolations(el: Element): Promise<Result[]> {
  const results = await axe.run(el, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  });
  return results.violations;
}
