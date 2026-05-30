import { describe, it, expect } from 'vitest';
import { sanitizeMarkdown } from '../src/markdown-sanitize';

describe('sanitizeMarkdown (S4)', () => {
  it('renders benign markdown to safe HTML', () => {
    const html = sanitizeMarkdown('**bold** and `code`');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
  });

  it('strips <script> tags and their payload', () => {
    const html = sanitizeMarkdown('hi <script>alert(1)</script> there');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
  });

  it('strips inline event handlers and raw <img onerror>', () => {
    const html = sanitizeMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<img');
  });

  it('drops javascript: URLs on links', () => {
    const html = sanitizeMarkdown('[click](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('alert(1)');
  });

  it('drops data: URIs (no img allowed → no data: needed)', () => {
    const html = sanitizeMarkdown('[x](data:text/html,<b>hi</b>)');
    expect(html).not.toContain('data:');
  });

  it('keeps https links and forces target/rel hardening', () => {
    const html = sanitizeMarkdown('[ok](https://example.com)');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
