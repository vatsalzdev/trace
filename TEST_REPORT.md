# TRACE — QA & Hardening Test Report

- **Generated:** 2026-11-22 14:18 IST
- **Repository:** TRACE (npm workspaces: `/client`, `/server`, `/shared`)
- **Final commit under test:** `4552ba6` (`phase 4: scale console typography and align scanner overlay`)
- **Stack:** React/Vite client, Node API server, deterministic rule engines only (no ML/LLM)

## 1. Executive summary

All five QA phases completed. Every automated check that was run passed. No check was claimed as PASS without captured evidence; checks that could not be run are listed explicitly in §8.

| Suite | Runs | Result |
| --- | --- | --- |
| API (`node:test`) | 1 | **11 / 11 pass** |
| E2E Playwright — DARK (`npm run test:e2e`, default) | 1 | **17 / 17 pass** |
| E2E Playwright — LIGHT (`TRACE_THEME=light`) | 1 | **17 / 17 pass** |
| Light AA contrast audit (`npm run test:contrast`) | 1 | **77 / 77 pairs pass** |
| Production build (`npm run build`, tsc + vite) | 1 | **clean — 0 TypeScript errors** |

Total: **45 automated checks executed, 45 passed, 0 failed.** (11 API + 17 + 17 E2E; contrast and build are aggregate audits.)

## 2. Phase history (one commit per phase)

| Phase | Commit | Outcome |
| --- | --- | --- |
| 0 — Baseline | `27f3786` | `git init`, `.gitignore`, baseline commit; app verified on Vite `5173` + API `5174` |
| 1 — Tests | `ea41ae4` | API suite (`node:test`), Playwright Chromium suite, screenshots + console-error guard |
| 2 — Fixes | `891238c` | Root-cause fixes for all Phase 1 FAILs; build clean |
| 3 — Light theme | `fa42597` | Console-only light theme, toggle in bar + palette, AA contrast, no flash, PDF unchanged |
| 4 — Typography | `4552ba6` | Larger/bolder console-only type tokens, scanner overlay alignment, graph-click flake fixed |
| 5 — Final verification | this report | Full dark + light suites, visual overlay alignment check, report, final build |

## 3. Environment & how to reproduce

```bash
npm install
npx playwright install chromium

# API tests (isolated server + temp DB on port 5190)
npm run test:api

# E2E (Playwright manages API on 5174 and Vite on 5173 via webServer config)
npm run test:e2e                       # dark
$env:TRACE_THEME='light'; npm run test:e2e   # light

npm run test:contrast
npm run build
```

Test hooks: `TRACE_DB_DIR`, `TRACE_FORCE_OFFLINE=1`, `TRACE_LOOKUP_HOST=10.255.255.1`, `TRACE_THEME=dark|light`.
Screenshots: `tests/screenshots/<name>-dark.png` / `<name>-light.png`.
Raw logs: `tests/artifacts/*.txt`.

### App start evidence

- `GET http://localhost:5173/` → `200 text/html`
- `GET http://localhost:5174/api/health` → `200 application/json; charset=utf-8`

(Playwright's `webServer` starts both servers for each run with `reuseExistingServer: true` and stops them when the run ends; the health endpoints were also verified directly.)

## 4. API coverage (11 / 11)

Evidence: `tests/artifacts/api-final.txt`

| # | Check | Evidence |
| --- | --- | --- |
| 1 | Scam SMS scores HIGH with all six rules | `score=95`, rules `urgency, brand, domain, http, payment, kyc` |
| 2 | OTP control stays LOW, no brand rule | `score=0`, rules `[]` |
| 3 | Correlated UPI links multiple cases | `entityId=3`, `cases=6` |
| 4 | URL engine | bad URL `100 HIGH` (7 rules), official SBI `0 LOW` |
| 5 | Edge cases | empty `400`, 10k chars `200 HIGH`, emoji `200 LOW`, entities deduped to `2` |
| 6 | Determinism | `[95, 95, 95]`, identical |
| 7 | Sample APK + malformed APKs | `com.sbi.kycupdate`, `14` permissions, indicators extracted, malformed `[400, 400]` |
| 8 | Case flow graph / status / notes | two linked cases, shared bridge entity, status `investigating` |
| 9 | Report payload + hash | `11` rules, `3` entities, recomputed SHA-256 matches |
| 10a | Offline fallback (`TRACE_FORCE_OFFLINE=1`) | `~33 ms`, mode `cached`, `200` |
| 10b | 4 s timeout via `10.255.255.1` | `~4034 ms`, mode `cached`, `200` |

## 5. E2E coverage (17 / 17 in each theme)

Evidence: `tests/artifacts/e2e-final-dark.txt`, `tests/artifacts/e2e-final-light.txt`

1. Landing preloader, scroll and viewports — 1440/1280/1024/390, `scrollWidth == width`
2. No clipped/overflowing landing text — `clipped=[]` at all four widths (decorative marquee/mock excluded)
3. Scanner analysis ≤ 1 s — scan `~270–290 ms`, 6 rules, highlights + entity chips
4. Save case from real button — toast + `/app/cases` index
5. Sample APK inspection and save — 14 permissions, 11 chips
6. Entity drawer — opens from chip, closes on Escape
7. Graph nodes / isolate / filters / overlap — 108–113 nodes, overlap 2.9–3.7% (budget 20%), isolate dims to `0.15` and restores
8. Case status/notes persistence + PDF extraction — reload persists, PDF markers present
9. URL enrichment offline badge then normal live/cached badge
10. Navigation, shortcuts, palette, back/forward, not-found states
11. Console pages at 1280 and 1024 — 7 routes × 2 widths, `scrollWidth == width`, `clipped=[]`
12. Reduced motion — no curtain/parallax
13. Theme default dark, toggle, persistence, console-only, no-flash bootstrap order
14. First-visit system preference locked; blocked `localStorage` falls back to dark
15. PDF report text unchanged by theme (after volatile-field normalization)
16. Console type tokens + scanner overlay/input rect identity at 1280/1024
17. **Visual overlay alignment** — highlight glyph positions measured against the textarea text

Every E2E test registers `page.on('console')` (error type) and `page.on('pageerror')`, and asserts zero captured errors at the end.

## 6. Theme, typography and overlay — detailed evidence

### Console-only light theme
- Default state: `{"html":"dark","root":"dark","bodyBg":"rgb(5, 5, 6)","stored":"dark"}`
- After toggle: `{"html":"light","root":"light","bodyBg":"rgb(250, 250, 250)","stored":"light"}`
- No-flash bootstrap order: `script=1085 < module=1578`, no blocking stylesheet in dev.
- Landing after console light: `themeAttr=false, bodyBg=rgb(5, 5, 6)`.
- Blocked `localStorage`: console renders dark fallback; first-visit OS preference is locked after change.
- Supplied light tokens that failed AA were darkened: `--text-3 #7a7a85→#686872`, `--accent #5b5bf0→#5252e0`, `--danger #d92d2d→#c82828`, `--warn #b45309→#a34706`, `--ok #15803d→#127235`.

### Typography (console-only)
- `{"rootFontSize":"17px","rootWeight":"500","smallFontSize":"11px","mutedWeight":"600"}`
- Evidence text: `font-size 15px`, `line-height 25.5px`, `padding 12px/16px`.
- Landing unchanged: `{"consoleRoots":0,"bodyFontSize":"15px","sampleFontSize":"12px"}`.

### Scanner overlay alignment
Geometry at **1280** and **1024** (identical in both themes):
- overlay/input rect: `left=261`, `top=270.28`/`350.28`, `width=570`/`314`, `height=248`
- font sizes `["15px","15px"]`, line heights `["25.5px","25.5px"]`, padding `["12px","16px","12px","16px"]`, overlay border `0px`
- overlay `scrollTop` follows textarea (`120px`)

Visual (glyph-level) check from test 17:
- `mark.left = 277`, `glyph.left = 277`; `mark.width = 237.046875`, `glyph.width = 237.046875` at both widths
- The mark sits 1 px above the bare glyph box, which is the intended `padding: 1px 0` on `.mark`.
- Screenshots: `tests/screenshots/visual-overlay-1280-{dark,light}.png`, `visual-overlay-1024-{dark,light}.png`

## 7. PDF parity

`client/src/lib/pdf.ts` was not modified in Phases 3/4/5. The theme toggle changes app CSS only. Test 15 generates a dark and a light PDF and compares extracted text after normalizing only volatile fields: page-count footers (`-- X of N --`), repeated running headers, report IDs, timestamps, generated stamps, SHA-256 hashes, and the report-generated timeline event that the first download appends. All substantive content is compared unchanged. Result: identical text (`~7.9–9.1k chars`) in both theme runs.

## 8. Checks not run / not applicable (with reason)

- **Real external network enrichment** (live WHOIS/DNS/TLS against the public internet) — NOT RUN. The environment uses deterministic local fixtures. Offline fallback and the 4 s timeout are validated with `TRACE_FORCE_OFFLINE=1` and the unroutable host `10.255.255.1` instead.
- **Non-Chromium browsers** (Firefox/WebKit/Safari) — NOT RUN. Playwright is configured for Chromium (`devices['Desktop Chrome']`) only.
- **Real OS-level `prefers-color-scheme` change on first visit** — NOT RUN as a literal OS action. Emulated via Playwright `colorScheme` in test 14, which exercises the same `matchMedia` code path.
- **Byte-for-byte PDF equality** — NOT applicable. Each download inserts a report event into the case timeline, so the two PDFs legitimately differ in volatile metadata/page count. Text parity after metadata normalization is the meaningful invariant.

## 9. Top 5 remaining issues / known limitations

1. **Chromium-only E2E coverage.** Firefox, WebKit and Safari are not exercised; layout/animation differences there are unverified.
2. **Build chunk-size warning.** Vite warns that the `charts` chunk is `544.93 kB` (> 500 kB); non-failing, but no code-splitting/`manualChunks` optimization has been applied.
3. **Graph node overlap at high density.** The force layout shows ~3–4% node-pair overlap with 100+ nodes (within the 20% acceptance budget but not zero); very large cases may need denser collision radius or clustering.
4. **PDF parity normalizes volatile fields** rather than comparing raw bytes, because report generation mutates case state. A byte-level guarantee would require an immutable snapshot payload.
5. **Live enrichment is fixture-driven.** DNS/TLS/WHOIS results come from deterministic local data; behavior against real third-party responses and rate limits is not covered by this suite.

## 10. Evidence index

```
tests/artifacts/api-final.txt
tests/artifacts/e2e-final-dark.txt
tests/artifacts/e2e-final-light.txt
tests/artifacts/contrast-final.txt
tests/artifacts/build-final.txt
tests/artifacts/e2e-phase5-visual-alignment-targeted.txt
tests/artifacts/e2e-phase4-dark-final.txt
tests/artifacts/e2e-phase4-light-final.txt
tests/artifacts/api-phase4.txt
tests/artifacts/contrast-light-phase4.txt
tests/artifacts/build-phase4.txt
```
Screenshots are in `tests/screenshots/` with `-dark.png` / `-light.png` suffixes.
