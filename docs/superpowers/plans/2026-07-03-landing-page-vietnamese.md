# Landing Page Vietnamese Option Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an EN | VI language toggle to the GitHub Pages landing page (`docs/index.html`) so Vietnamese visitors can read the entire page in natural Vietnamese.

**Architecture:** Single-file, no-build i18n: English stays in the markup as the source of truth; a `data-i18n` key on each translatable element maps into an inline `vi` dictionary; `setLanguage()` snapshots the English originals on first use and swaps `textContent`/attributes both ways. Resolution: `?lang=` param → `localStorage('ad_lang')` → `'en'`.

**Tech Stack:** Plain HTML/CSS/JS inside `docs/index.html` (~1543 lines; sections: `#top` hero, `#why`, `#compare`, `#guide`, `#start`, `#faq`, header `nav.site`, footer nav). No frameworks, no external requests.

## Global Constraints

- Worktree: `/Users/home/repos/ai-dict/.claude/worktrees/landing-vi` (branch `feat/landing-vi`). Run `bun install` (repo tooling for lint/format).
- This page is NOT the extension UI → browser verification uses the **agent-browser skill** (invoke the `Skill` tool with `agent-browser`), not the Playwright extension harness.
- `.c3/`: CLI-only. Run once: `c3() { C3X_MODE=agent bash /Users/home/.claude/skills/c3/bin/c3x.sh "$@"; }; c3 lookup docs/index.html` — expected UNCHARTED → no ADR needed; note "uncharted per c3 lookup" in the PR. If it IS charted, stop and follow the returned component's constraints.
- Vietnamese quality bar: natural, professional standard Vietnamese (polished SaaS landing tone) — translate meaning, not word-for-word. Keep untranslated: product name "AI Dictionary", brand/browser names (Chrome, Safari, Gemini, ChatGPT), keyboard keys, code, API-key strings.
- Reuse the page's existing CSS custom properties/classes for the toggle — no clashing new palette.
- Commits: conventional, NO Co-Authored-By. Never `--no-verify`. Let prettier format the file (`bun run format`).
- Gates before PR: `bun run lint && bun run format:check`.

---

### Task 0: Recon + BEFORE evidence

- [ ] **Step 1:** `c3 lookup docs/index.html` (see constraint above).
- [ ] **Step 2:** Read `docs/index.html` fully. Inventory every user-visible string: `<title>`, meta description, header nav labels, hero (h1, lede, CTAs), the demo card copy ("A Day by the Water" etc. — the demo card imitates a lookup card whose CONTENT is product output; translate surrounding labels but keep the sample lookup text English, since the product answers about English words), `#why`, `#compare` (table headings/cells), `#guide` (all h3 blocks + paragraphs), `#start` (3 steps), `#faq` (questions + answers), footer nav + small print, image `alt`s, `aria-label`s.
- [ ] **Step 3: BEFORE evidence:** `python3 -m http.server 8377 -d docs` (background), then via agent-browser capture `/tmp/evidence-c/before-desktop.png` (1280px) of `http://localhost:8377/`.
- [ ] **Step 4: Commit** the plan file if not yet committed: `git add docs/superpowers && git commit -m "docs(plan): landing page vietnamese option"`

### Task 1: i18n mechanism + toggle UI

**Files:** Modify `docs/index.html`

- [ ] **Step 1: Head bootstrap** (no flash of wrong language) — add immediately after `<meta charset…>`:

```html
<script>
  // Resolve language before first paint: ?lang= wins (and is saved), else saved choice, else en.
  (function () {
    var p = new URLSearchParams(location.search).get('lang');
    var l = p === 'vi' || p === 'en' ? p : null;
    try {
      if (l) localStorage.setItem('ad_lang', l);
      else l = localStorage.getItem('ad_lang');
    } catch (e) { /* storage blocked: default en */ }
    document.documentElement.lang = l === 'vi' ? 'vi' : 'en';
  })();
</script>
```

- [ ] **Step 2: Toggle markup** — inside `nav.site` (line ~917), append as the last item:

```html
<div class="lang-switch" role="group" aria-label="Language / Ngôn ngữ">
  <button type="button" data-lang="en" aria-pressed="true">EN</button>
  <button type="button" data-lang="vi" aria-pressed="false">VI</button>
</div>
```

  Style it with the page's existing variables (inspect the nav's current link styling and reuse its colors/radii; active state = filled with the page's accent variable, inactive = quiet). Must remain visible and tappable at 390px width (if the nav collapses on mobile, place the switch so it stays reachable — verify in Task 3).
- [ ] **Step 3: Engine** — add at the END of `<body>` (synchronous, before the closing tag; AFTER the dictionary of Task 2, which lives in the same script block):

```html
<script>
  (function () {
    var EN = new Map(); // element -> original English (snapshotted on first swap)
    var ENA = new Map(); // element -> { attr: original } for attribute translations
    function nodes() { return document.querySelectorAll('[data-i18n], [data-i18n-attrs]'); }
    function apply(lang) {
      document.documentElement.lang = lang;
      nodes().forEach(function (el) {
        var key = el.getAttribute('data-i18n');
        if (key) {
          if (!EN.has(el)) EN.set(el, el.textContent);
          var t = lang === 'vi' ? VI[key] : EN.get(el);
          if (t != null) el.textContent = t;
        }
        // data-i18n-attrs="alt:hero-img-alt,aria-label:nav-label"
        var attrs = el.getAttribute('data-i18n-attrs');
        if (attrs) {
          if (!ENA.has(el)) ENA.set(el, {});
          attrs.split(',').forEach(function (pair) {
            var a = pair.split(':')[0], k = pair.split(':')[1];
            var store = ENA.get(el);
            if (!(a in store)) store[a] = el.getAttribute(a);
            var v = lang === 'vi' ? VI[k] : store[a];
            if (v != null) el.setAttribute(a, v);
          });
        }
      });
      document.title = lang === 'vi' && VI['doc-title'] ? VI['doc-title'] : EN_TITLE;
      document.querySelectorAll('.lang-switch [data-lang]').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === lang));
      });
      try { localStorage.setItem('ad_lang', lang); } catch (e) {}
    }
    var EN_TITLE = document.title;
    document.querySelectorAll('.lang-switch [data-lang]').forEach(function (b) {
      b.addEventListener('click', function () { apply(b.getAttribute('data-lang')); });
    });
    if (document.documentElement.lang === 'vi') apply('vi');
  })();
</script>
```

- [ ] **Step 4: Smoke-check** in agent-browser: declare a stub `var VI = { 'hero-title': 'Tra bất kỳ từ nào ngay tại nơi bạn đang đọc.' };` above the engine (Task 2 replaces it with the full dictionary), add `data-i18n="hero-title"` to the h1 as a probe, then verify: clicking VI swaps the h1 and persists across reload; `?lang=en` overrides. **Step 5: Commit** `git commit -am "feat(landing): language toggle + single-file i18n engine"`

### Task 2: Annotate copy + full Vietnamese dictionary

**Files:** Modify `docs/index.html`

- [ ] **Step 1:** Add `data-i18n="<section>-<slug>"` to every translatable element from the Task 0 inventory (key convention: `nav-why`, `hero-title`, `hero-lede`, `guide-define-h`, `faq-q1`, `faq-a1`, `footer-…`; attribute cases via `data-i18n-attrs`). Rule: annotate the SMALLEST element that wraps the whole string (never split a sentence across keys); if a string contains inline markup (links/em), restructure so each text run gets its own key OR give the parent a key and put the full HTML-free sentence in `textContent` only when that doesn't lose links — when a link must survive, key the text nodes around it separately.
- [ ] **Step 2:** Build `var VI = { … }` (same script block, above the engine) with EVERY key. Include `doc-title`. Quality exemplars to match (use these verbatim):

```js
'doc-title': 'AI Dictionary: tra từ ngay tại nơi bạn đang đọc',
'hero-title': 'Tra bất kỳ từ nào ngay tại nơi bạn đang đọc.',
'nav-why': 'Vì sao', 'nav-compare': 'So sánh', 'nav-guide': 'Hướng dẫn',
'nav-start': 'Bắt đầu', 'nav-faq': 'Hỏi đáp',
'start-h2': 'Bắt đầu sử dụng',
'start-step1-h': 'Thêm vào Chrome',
'start-step2-h': 'Lấy khóa Gemini miễn phí',
'start-step3-h': 'Dán khóa, lưu lại, đọc tiếp',
'faq-h2': 'Những câu hỏi thường gặp',
'why-h2-prefix': 'Sinh ra cho người đọc,',
'guide-privacy-h': 'Dữ liệu của bạn nằm ở đâu: ngay trên máy bạn',
```

  Translate the rest to the same standard: idiomatic, warm-professional, second person "bạn"; keep technical nouns (side panel → "bảng bên (side panel)" on first mention, then "bảng bên").
- [ ] **Step 3:** Verify no missed strings: in agent-browser with VI active, scan every section for leftover English (except the deliberate keep-list) — fix until clean.
- [ ] **Step 4: Commit** `git commit -am "feat(landing): full Vietnamese translation dictionary"`

### Task 3: Visual verification + AFTER evidence (agent-browser)

- [ ] **Step 1:** Serve `docs/` (`python3 -m http.server 8377 -d docs`), drive with agent-browser:
  - default EN at 1280px; click VI → all sections flip (spot-check hero, compare table, guide, FAQ, footer, `document.title`);
  - reload → VI persists; `?lang=en` → EN and persists;
  - 390px viewport in BOTH languages: longer VI strings must not overflow/wrap badly (fix CSS if the toggle or headings break; re-verify);
  - the scroll-reveal animations still fire after language swap.
- [ ] **Step 2: AFTER evidence** to `/tmp/evidence-c/`: `after-vi-desktop.png`, `after-vi-mobile.png`, `after-toggle-closeup.png`, `after-en-desktop.png`.
- [ ] **Step 3: Commit** any CSS fixes: `git commit -am "fix(landing): responsive fixes for Vietnamese copy"`

### Task 4: Gates, evidence hosting, PR

- [ ] **Step 1:** `bun run format` (let prettier normalize `docs/index.html`), then `bun run lint && bun run format:check` → green.
- [ ] **Step 2:** Host evidence on orphan branch `pr-assets/landing-vi` (never on the feature branch); embed as `https://github.com/<owner>/<repo>/raw/pr-assets/landing-vi/<file>` (owner/repo via `gh repo view --json nameWithOwner`). NEVER raw.githubusercontent.com (404 on this private repo).
- [ ] **Step 3:** Push branch; `gh pr create` to master: summary (mechanism, resolution order, keep-list), "uncharted per c3 lookup" note, SEO follow-up note (hreflang/static VI page deliberately out of scope), Before/After screenshots. Do NOT merge.
