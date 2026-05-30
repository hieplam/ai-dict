import { marked } from 'marked';
import DOMPurify from 'dompurify';

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

export function sanitizeMarkdown(md: string): string {
  ensureHook();
  // marked emits raw HTML embedded in the markdown verbatim; DOMPurify (not marked)
  // is the HTML allowlist boundary. `async: false` guarantees a synchronous string.
  const rawHtml = marked.parse(md, { async: false });
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: HTTPS_ONLY,
  });
}
