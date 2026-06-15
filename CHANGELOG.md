# Changelog

## [1.5.0](https://github.com/hieplam/ai-dict/compare/v1.4.0...v1.5.0) (2026-06-15)


### Features

* Chrome Web Store publishing — brand icon + automated release pipeline ([f53de20](https://github.com/hieplam/ai-dict/commit/f53de209d6302307b5439aa968019b00cc3bb010))
* **prompt:** default template injects {word}+{context}; add English target language ([#56](https://github.com/hieplam/ai-dict/issues/56)) ([4ebaaf3](https://github.com/hieplam/ai-dict/commit/4ebaaf3ebdc75b6a42c2c9a78894e48d850c13f4))
* **prompt:** split Card format from system envelope; wire {title} with PII redaction ([#63](https://github.com/hieplam/ai-dict/issues/63)) ([5680203](https://github.com/hieplam/ai-dict/commit/568020332bafe9ce7c3cebf79686758a72a3c650))

## [1.4.0](https://github.com/hieplam/ai-dict/compare/v1.3.0...v1.4.0) (2026-06-11)


### Features

* choose your AI provider — Gemini (default) or ChatGPT (OpenAI) ([#44](https://github.com/hieplam/ai-dict/issues/44)) ([f1233cc](https://github.com/hieplam/ai-dict/commit/f1233cc3eab60a340dbf41f9facbf997100d3e72))
* **prompt:** switch default template to a sense-aware structured format ([#53](https://github.com/hieplam/ai-dict/issues/53)) ([940ad9b](https://github.com/hieplam/ai-dict/commit/940ad9bb31604ecb834bb0070b996753813bd53e)), closes [#50](https://github.com/hieplam/ai-dict/issues/50)
* **side-panel:** per-entry delete in Recent removes the word from history and cache ([#46](https://github.com/hieplam/ai-dict/issues/46)) ([a64d9c0](https://github.com/hieplam/ai-dict/commit/a64d9c08fa41cb9b69f9969ec4aafb7515e44c05))
* **tooling:** hard dependency-direction gate before every build and lint ([#49](https://github.com/hieplam/ai-dict/issues/49)) ([83464f4](https://github.com/hieplam/ai-dict/commit/83464f453fc15e6272eade345042805112bd5e05))
* **ui:** always-available Settings action; harden setup card against host-page CSS resets ([#39](https://github.com/hieplam/ai-dict/issues/39)) ([a69d97f](https://github.com/hieplam/ai-dict/commit/a69d97f52fec5c4da409d9f62909e585843da3a0))
* **ui:** make the result card's Settings action discoverable ([#43](https://github.com/hieplam/ai-dict/issues/43)) ([ebfc730](https://github.com/hieplam/ai-dict/commit/ebfc7303506510b807de27d1dff9d750f2906f22))


### Bug Fixes

* **bottom-sheet:** cap panel at 88dvh so long content stays on-screen on mobile ([#55](https://github.com/hieplam/ai-dict/issues/55)) ([87ff590](https://github.com/hieplam/ai-dict/commit/87ff590866680f8bbc754387b31b95614dcc932e)), closes [#52](https://github.com/hieplam/ai-dict/issues/52)
* **ci:** push trigger targeted 'main' but the default branch is 'master' ([#36](https://github.com/hieplam/ai-dict/issues/36)) ([75587e0](https://github.com/hieplam/ai-dict/commit/75587e08a63be2fe7329e9cdafc100121164089f))
* **settings:** apply theme on select change for live preview ([#54](https://github.com/hieplam/ai-dict/issues/54)) ([0b42574](https://github.com/hieplam/ai-dict/commit/0b4257479a2854825205da15db9d1d0a0f9dbdbf)), closes [#51](https://github.com/hieplam/ai-dict/issues/51)

## [1.3.0](https://github.com/hieplam/ai-dict/compare/v1.2.0...v1.3.0) (2026-06-10)


### Features

* **ci:** SonarQube Cloud scan + coverage + one-time issue backlog importer ([#34](https://github.com/hieplam/ai-dict/issues/34)) ([408f5b1](https://github.com/hieplam/ai-dict/commit/408f5b13b36e7e2a8ee61ca034e23ebee6032cd0))
* **onboarding:** guide keyless first-run users from Define to setup ([#31](https://github.com/hieplam/ai-dict/issues/31)) ([6601a77](https://github.com/hieplam/ai-dict/commit/6601a7790db3f258aeb4cb84899130b664dcef77))
* **settings:** user-selectable light/dark/system theme, light by default ([#35](https://github.com/hieplam/ai-dict/issues/35)) ([a361430](https://github.com/hieplam/ai-dict/commit/a36143035c13a5fc241cd0cd3bb67379f48fd06a))

## [1.2.0](https://github.com/hieplam/ai-dict/compare/v1.1.0...v1.2.0) (2026-06-09)


### Features

* **app:** add restore-default button for the prompt template ([#26](https://github.com/hieplam/ai-dict/issues/26)) ([c9b5e36](https://github.com/hieplam/ai-dict/commit/c9b5e36f4ce86b0e80dde15a371bb0dc12c2c70d))
* **app:** brighten the theme to winter-morning light ([#21](https://github.com/hieplam/ai-dict/issues/21)) ([1791963](https://github.com/hieplam/ai-dict/commit/179196366362629757e4f142ea8eaa67faac7ac1))
* **app:** redesign the options page onto the winter-morning theme ([#25](https://github.com/hieplam/ai-dict/issues/25)) ([452803f](https://github.com/hieplam/ai-dict/commit/452803f2d742fa679d7e2655519d0312d6d2e93a))
* **install:** publish dist-chrome.zip on release + one-line Chrome installer ([#27](https://github.com/hieplam/ai-dict/issues/27)) ([e8d0449](https://github.com/hieplam/ai-dict/commit/e8d0449bd8dd6b613ab9e46392285ed9f9baba5b))


### Bug Fixes

* **app:** scroll long lookups instead of clipping the sheet / growing the panel ([#23](https://github.com/hieplam/ai-dict/issues/23)) ([1531a6b](https://github.com/hieplam/ai-dict/commit/1531a6b781c5fc96d7ffc7ef4437c41934bb0cc0))
* **app:** surface a status line for every options action and wire export-history ([#24](https://github.com/hieplam/ai-dict/issues/24)) ([609d791](https://github.com/hieplam/ai-dict/commit/609d79115632239e4916bdcaf39b05ac88d52ee0))

## [1.1.0](https://github.com/hieplam/ai-dict/compare/v1.0.0...v1.1.0) (2026-06-07)


### Features

* **app:** redesign the side panel as a persistent reading surface ([#18](https://github.com/hieplam/ai-dict/issues/18)) ([60493a0](https://github.com/hieplam/ai-dict/commit/60493a0937245d69ba2c429b4f95e2f841b9e000))

## 1.0.0 (2026-06-06)


### Features

* **adapters-shared:** GeminiLookupClient (fetch, timeout, error map) ([c12c4b1](https://github.com/hieplam/ai-dict/commit/c12c4b1697464123e7e36cc66bdb4638bc37996f))
* **adapters-shared:** InlineBottomSheetRenderer (compose shared-ui + sanitize) ([e5fdc16](https://github.com/hieplam/ai-dict/commit/e5fdc1630314dd8066c9c02b5ffcada0c5e4d85e))
* **adapters-shared:** package setup + markdown sanitize (marked + DOMPurify allowlist) ([8928228](https://github.com/hieplam/ai-dict/commit/89282286ac82c90add032825122c91732afdfe92))
* **app:** cozy-Christmas visual identity for the in-page lookup UI ([9aa3430](https://github.com/hieplam/ai-dict/commit/9aa343006c99c1ee919c3e40ceb9cc59fc41705f))
* **app:** loading spinner after clicking the Define bubble ([#8](https://github.com/hieplam/ai-dict/issues/8)) ([0066098](https://github.com/hieplam/ai-dict/commit/00660985a64d5950fbdd8c8771d944e6d7ddf949))
* **app:** lock API-key field when GEMINI_API_KEY is baked into the build ([#7](https://github.com/hieplam/ai-dict/issues/7)) ([5002593](https://github.com/hieplam/ai-dict/commit/50025932055c0c39d3f92727b2fcc649ebd783b7))
* **ci-release:** add CI/release workflows, renovate config, and release checklist ([6be583d](https://github.com/hieplam/ai-dict/commit/6be583def42de295c81ec2baf25d8f9d7b635018))
* **ci-release:** add wire:check and release:bump scripts ([8f94319](https://github.com/hieplam/ai-dict/commit/8f94319ebfeb114d348293436c9744d47c63936f))
* **core:** cache policy (FNV-1a + LRU) ([8696492](https://github.com/hieplam/ai-dict/commit/8696492689c8e9921dd26713ac6ac33898351a82))
* **core:** default prompt template ([72fdc1b](https://github.com/hieplam/ai-dict/commit/72fdc1bccc8b77c340529fd30472196fd15c2905))
* **core:** Gemini-&gt;LookupError mapper + response fixtures ([0b06d32](https://github.com/hieplam/ai-dict/commit/0b06d322e552e850ac86c948825220967ed65f8b))
* **core:** history policy (FIFO + paging) ([167adc5](https://github.com/hieplam/ai-dict/commit/167adc56da45d2f1f65f157c40bd33678792e2f6))
* **core:** lookup workflow orchestrator + coverage gate ([a611fcb](https://github.com/hieplam/ai-dict/commit/a611fcb7408bde3478dd6fff7cbb762f0b6b5d0f))
* **core:** package setup, domain types, port interfaces ([2fa0714](https://github.com/hieplam/ai-dict/commit/2fa0714de6e3ea4c1eadbcdb9e812003d817ae9d))
* **core:** prompt template substitution ([20d41be](https://github.com/hieplam/ai-dict/commit/20d41be4f404203e58b0d069104df907adb56060))
* **core:** zod wire schemas + JSON-schema snapshot ([65d42e9](https://github.com/hieplam/ai-dict/commit/65d42e9d7e3809e9e6e242ec896f902348977ace))
* **extension-chrome:** allow GEMINI_API_KEY from build env ([#5](https://github.com/hieplam/ai-dict/issues/5)) ([c83e92c](https://github.com/hieplam/ai-dict/commit/c83e92c2047e8aed3a5ed091248742b9b7194c8a))
* **extension-chrome:** composition roots (content, options, side-panel) + typecheck fixes ([020edbf](https://github.com/hieplam/ai-dict/commit/020edbf8d7b149510537e751d86ffb80f2c9519d))
* **extension-chrome:** content relay adapters (lookup + settings) ([00c4e57](https://github.com/hieplam/ai-dict/commit/00c4e5703180012fade933db715b961e2e4423a4))
* **extension-chrome:** DOM adapters (selection, trigger, side-panel mirror) ([ccce07e](https://github.com/hieplam/ai-dict/commit/ccce07e87b7ce30f0abc0a2ea8730504fd461ce3))
* **extension-chrome:** inbound classifier (S3 guard) + SW listener wiring ([d4e8e2d](https://github.com/hieplam/ai-dict/commit/d4e8e2dd9da5fef59e4fedade752b42f7c3b8be1))
* **extension-chrome:** package setup + MV3 manifest (strict CSP, minimal perms) ([6d3b6bf](https://github.com/hieplam/ai-dict/commit/6d3b6bfdca5810bd9507483c846b770834d96c4c))
* **extension-chrome:** storage adapters (kv + settings, S1 strip) ([af5538c](https://github.com/hieplam/ai-dict/commit/af5538cf42c36f0afcf7b5629e21148eff01a482))
* **extension-chrome:** SW router + write queue (cancellation suppression, toggles) ([307349a](https://github.com/hieplam/ai-dict/commit/307349a541fe8fdc773f70d2e0eaf27543c7c476))
* **extension-safari:** composition roots (content, options) + typecheck fixes ([0d600f3](https://github.com/hieplam/ai-dict/commit/0d600f3b6c897e09fd30beda28b9a7291f6c4261))
* **extension-safari:** content relay adapters (lookup + settings) ([d223984](https://github.com/hieplam/ai-dict/commit/d22398479708d8765cf77a3efde51b965c6e2b39))
* **extension-safari:** DOM adapters (selection, trigger) ([5307632](https://github.com/hieplam/ai-dict/commit/53076325aed57db2a947f5fedc1a2d95e4f00e4d))
* **extension-safari:** inbound classifier (S3 guard) + SW listener wiring ([e2a3db1](https://github.com/hieplam/ai-dict/commit/e2a3db1523665b13e150e3b37e0a08b6395ddc28))
* **extension-safari:** package setup + MV3 manifest (browser_specific_settings, no sidePanel) ([0f492f1](https://github.com/hieplam/ai-dict/commit/0f492f1472246eb597d7e02989de87a5780e554b))
* **extension-safari:** storage adapters (kv + settings, S1 strip) ([721d95a](https://github.com/hieplam/ai-dict/commit/721d95a06c0f3f316f328a84d9a17e01644384e3))
* **extension-safari:** SW router + write queue (cancellation suppression, toggles) ([f6c896d](https://github.com/hieplam/ai-dict/commit/f6c896d535476f3b334cbfe75fe85416f603514a))
* **extension-safari:** Xcode iOS wrapper + sync script + manual iOS checklist ([b8160ac](https://github.com/hieplam/ai-dict/commit/b8160acb10a0dac79a680149bdc8b766692b9439))
* **scaffold:** pnpm workspace, strict tsconfig, hex eslint zones, vitest projects ([3351bc4](https://github.com/hieplam/ai-dict/commit/3351bc440fead23fccdd4a8695e85a177a86f150))
* **shared-ui:** &lt;bottom-sheet&gt; (dialog + focus trap + ESC + reduced-motion) ([7674432](https://github.com/hieplam/ai-dict/commit/7674432d4db624b63aac13fe3c162480d4e80878))
* **shared-ui:** &lt;lookup-card&gt; (loading/result/error states + close/expand events) ([d100d57](https://github.com/hieplam/ai-dict/commit/d100d5742f3b6fa2d6bec66fd7e509bbf8900aff))
* **shared-ui:** &lt;lookup-trigger&gt; (button + lookup-click event + a11y) ([32d3acb](https://github.com/hieplam/ai-dict/commit/32d3acb45ed06cbac3f5e6e427564f82a1e073d8))
* **shared-ui:** &lt;settings-form&gt; (save/clear-cache/clear-history/test-connection/export-history) ([6d65072](https://github.com/hieplam/ai-dict/commit/6d650724b46a9b3e7f67a5ddc5ca7d56ef6acc5c))
* **shared-ui:** package setup + adoptedStyleSheets + axe helper ([37b7e05](https://github.com/hieplam/ai-dict/commit/37b7e0510a8caa5a43f4d0c18d15f6b0eddc106b))


### Bug Fixes

* **adapters-shared:** disable raw HTML in marked (preprocess hook strips HTML before lexing) ([2e47034](https://github.com/hieplam/ai-dict/commit/2e470341370918ea3e7bb727804544b5f14b9a9d))
* **adapters-shared:** harden in-flight abort test with latch + guard global stub cleanup ([bc6d28e](https://github.com/hieplam/ai-dict/commit/bc6d28e482baa0f91bf34911709f8e0f0ff57b67))
* **adapters-shared:** resolve ESLint errors in test file ([4760046](https://github.com/hieplam/ai-dict/commit/476004664a124ed0d7326d3b0400131f289d2c1a))
* **adapters-shared:** strengthen timeout test, reorder catch guards, SafeHtml trust boundary, security tests, DOM cleanup ([d08a432](https://github.com/hieplam/ai-dict/commit/d08a4321c7ce849f79381bba3b9fb4987d973e6d))
* **app:** keep loading-spinner label hidden under strict CSP (side panel + bottom sheet) ([#12](https://github.com/hieplam/ai-dict/issues/12)) ([d229cbf](https://github.com/hieplam/ai-dict/commit/d229cbf0764d47a9131655ecd77172e1831dabe6))
* **app:** pin lookup-trigger :host z-index so click works inside positive-z stacking contexts ([#6](https://github.com/hieplam/ai-dict/issues/6)) ([260816e](https://github.com/hieplam/ai-dict/commit/260816ee41cf6b76e0881d0f766b4165648e478f))
* **app:** remove dead Expand button from lookup-card ([#11](https://github.com/hieplam/ai-dict/issues/11)) ([313cf9d](https://github.com/hieplam/ai-dict/commit/313cf9db87b34aab6a30d3b8a9e89ef554273cc9))
* **app:** show selected word + visible loading caption so the lookup card never appears empty ([#15](https://github.com/hieplam/ai-dict/issues/15)) ([d1e0572](https://github.com/hieplam/ai-dict/commit/d1e05729af94304c4775a3e5f959b2ce1783de09))
* bubble not close ([73090b2](https://github.com/hieplam/ai-dict/commit/73090b22a58fb6c083bdf9c332ff92b5157e908e))
* **ci-release:** address bundle-07 code-quality findings ([854193a](https://github.com/hieplam/ai-dict/commit/854193aeac475d2d89226aebf1f6764c9670d2e7))
* **ci-release:** align size-limit entries and playwright exec commands with spec §8.7 / plan ([6e3d15c](https://github.com/hieplam/ai-dict/commit/6e3d15c00da7a6293848dc54fe83331ea5006bdb))
* **ci-release:** remediate bundle-07 review findings ([b55468b](https://github.com/hieplam/ai-dict/commit/b55468b3a91afdc30509c7e9d366f0d9fb6985ef))
* **ci-release:** restore test-contract job, add actions:read, guard missing ExportOptions.plist, document e2e-chrome gate ([0d13608](https://github.com/hieplam/ai-dict/commit/0d136083c46225981264ff4f29220adf4f3b556f))
* **ci:** unblock secret-scan permissions + secure-context-safe request id ([46972dd](https://github.com/hieplam/ai-dict/commit/46972ddead2c0ab1e063877d6a2bff1a212cad7d))
* **core:** address all 7 confirmed code-quality findings in Bundle 02 ([02c0d59](https://github.com/hieplam/ai-dict/commit/02c0d596925f6612a6a89066e838ca9107e42552))
* **core:** export Settings publicly, close test gaps, enforce strictObject on LookupError ([674ae87](https://github.com/hieplam/ai-dict/commit/674ae87cf18c6776f102f8f5f7807c096c426f19))
* **extension-chrome:** address confirmed security and correctness findings (bundle-05 review) ([cd980a7](https://github.com/hieplam/ai-dict/commit/cd980a7763a04c43b27742b2b350d75587f13c0d))
* **extension-chrome:** fix SW startup crash + customElements in isolated world ([929f9cb](https://github.com/hieplam/ai-dict/commit/929f9cb9ad39477f2625aed8adeba0da84182c2c))
* **extension-chrome:** fix two lint errors in router.test.ts blocking CI gate ([b36c0b3](https://github.com/hieplam/ai-dict/commit/b36c0b3c7cfe791ee71292a67fa1ec166e556f74))
* **extension-chrome:** harden wire-schema shim with field-stripping + pin undefined-sender test ([c58339b](https://github.com/hieplam/ai-dict/commit/c58339bc621f3cb8e65d21ce04387420c7b6a8b3))
* **extension-chrome:** preserve lookup error message across the SW→content wire boundary ([dc8edb6](https://github.com/hieplam/ai-dict/commit/dc8edb6e6cd5b830ff0d099c588d40428b27b735))
* **extension-chrome:** resolve all SPEC-COMPLIANCE issues (D9 size gate, tsconfig, owns_files) ([c814f92](https://github.com/hieplam/ai-dict/commit/c814f92b7b4cd5e3167047edcefb4d558b84497a))
* **extension-chrome:** resolve spec-compliance issues from independent review ([509f55e](https://github.com/hieplam/ai-dict/commit/509f55e00e04f6075e3ff2d1fa52fea07a607dfe))
* **extension-chrome:** spec-compliance fixes (headless config, test.fixme, plan bookkeeping) ([f70fa88](https://github.com/hieplam/ai-dict/commit/f70fa88614bc5c938414e76284f45b1628f2d17d))
* **extension-chrome:** typecheck + lint cleanups (B, C, D) ([e3e4ccd](https://github.com/hieplam/ai-dict/commit/e3e4ccddfa5dfedd58ea1e4c0648c96ef5e7a6d1))
* **extension-safari:** bundle size, Xcode project structure, and test layout corrections ([d45fb39](https://github.com/hieplam/ai-dict/commit/d45fb3927b40d001b660052a3475cec1d87761e9))
* **extension-safari:** fix 3 code-quality findings in bundle-06 ([8fbc58b](https://github.com/hieplam/ai-dict/commit/8fbc58be5af6245712fc3e06840c2fdf9a0bca13))
* **extension-safari:** preserve lookup req fields in lite-wire-schema shim and tighten coverage gate ([6950c5a](https://github.com/hieplam/ai-dict/commit/6950c5a0eb29e0b917e4f3b1b3ee9b27d5321bd9))
* **extension-safari:** remove speculative extras, rewrite onMessage to sendResponse+return true ([019359f](https://github.com/hieplam/ai-dict/commit/019359f9f49a9a77dc694dc6f6bd631b83ab07e0))
* **extension-safari:** strip known PublicSettings fields only when caching SW settings reply (FIX 3 / S1 defense-in-depth) ([50b0d8e](https://github.com/hieplam/ai-dict/commit/50b0d8e11cb5f1a71a331ee9c0081aee648c0496))
* **extension-safari:** sync router error-message fix (keep shared file byte-identical) ([761ea40](https://github.com/hieplam/ai-dict/commit/761ea403dd63b2b36b1f8f2a773c8ec5c1114fe5))
* **lint:** declare Node globals for scripts/ and fix sparse-array in release-bump ([31812c4](https://github.com/hieplam/ai-dict/commit/31812c4f5dcf484dacbff614c5ef618004678a11))
* **manifests:** remove redundant host_permissions Gemini entry from safari and chrome manifests (FIX 6 / S5) ([cf07ace](https://github.com/hieplam/ai-dict/commit/cf07ace806428de72e6a3b02e80d33caa43f428e))
* result not populate ([fbdbbe3](https://github.com/hieplam/ai-dict/commit/fbdbbe3de39581b55ef7eb6fe714c6c7cd729ba9))
* **scaffold:** align @types/node to Node 20 engine constraint ([c2264b1](https://github.com/hieplam/ai-dict/commit/c2264b1ff44f87cce42280e5c9b86f400218df8d))
* **shared-ui:** address bundle-03 code-quality findings (composed tests, SafeHtml brand, payload→state) ([e8237da](https://github.com/hieplam/ai-dict/commit/e8237da05dc258bd918643174fc38cdcdb5fa28e))
* **shared-ui:** address five confirmed code-quality findings in Bundle 03 ([10a5809](https://github.com/hieplam/ai-dict/commit/10a5809b574e42af003413918c0d4501b7b34796))
* **shared-ui:** strengthen tests and fix a11y for lookup-trigger ([27b1c4f](https://github.com/hieplam/ai-dict/commit/27b1c4ff39096543091d171979fd093bcfa3e640))
