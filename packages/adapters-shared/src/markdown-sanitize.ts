import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import type { SafeHtml } from '@ai-dict/shared-ui/lookup-card';

// Spec S4: "markdown renderer with raw HTML DISABLED".
// Strip any literal HTML from the markdown source before lexing — this is the
// equivalent of marked's old `html: false` flag. The preprocess hook runs before
// the lexer, so the HTML is gone before tokenisation; no raw-HTML tokens reach
// the renderer or DOMPurify. Markdown-generated HTML (bold, headings, links, etc.)
// is produced by marked itself and is safe to pass to DOMPurify's allowlist below.
//
// Regex matches:
//   - paired tags (including content): <script>…</script>
//   - self-closing / void tags:        <img src=x onerror=…>
//   - closing-only tags:               </div>
//
// Note: this is a best-effort strip on the *source markdown*; DOMPurify is the
// authoritative sanitizer for the *rendered HTML* and provides defence-in-depth.
const STRIP_HTML_REGEX = /<[a-zA-Z][^>]*>[\s\S]*?<\/[a-zA-Z]+>|<[a-zA-Z][^>]*\/?>|<\/[a-zA-Z]+>/gm;

// Local Marked instance so the preprocess hook is scoped here, not global.
const markedNoHtml = new Marked({
  hooks: {
    preprocess(md: string): string {
      return md.replace(STRIP_HTML_REGEX, '');
    },
  },
});

// Force every surviving anchor to open safely (S4). Registered once at module load;
// DOMPurify hooks are global to the singleton instance, so we add it a single time.
let hooked = false;
function ensureHook(): void {
  if (hooked) return;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if ('target' in node) {
      (node as Element).setAttribute('target', '_blank');
      (node as Element).setAttribute('rel', 'noopener noreferrer');
    }
  });
  hooked = true;
}

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'b', 'i', 'code', 'pre',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'a', 'span',
];
const ALLOWED_ATTR = ['href', 'target', 'rel'];
const HTTPS_ONLY = /^https:\/\//i; // anchors: https only (no javascript:, data:, mailto:, relative)

export function sanitizeMarkdown(md: string): SafeHtml {
  ensureHook();
  // markedNoHtml converts markdown → HTML with raw HTML stripped from the source.
  // DOMPurify then enforces the allowlist (strips javascript: links, event attrs, etc.).
  // `async: false` guarantees a synchronous string.
  const rawHtml = markedNoHtml.parse(md, { async: false });
  // This `as SafeHtml` cast is the ONE authorised SafeHtml trust boundary (S4).
  // DOMPurify output is, by definition, safe HTML — the ALLOWED_TAGS/ALLOWED_ATTR/
  // ALLOWED_URI_REGEXP config above enforces the allowlist. No other file may cast
  // a plain string to SafeHtml; produce it only through this function.
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: HTTPS_ONLY,
  }) as SafeHtml;
}
