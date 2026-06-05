export function adoptStyles(root: ShadowRoot, css: string): void {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  root.adoptedStyleSheets = [sheet];
}
