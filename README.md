# TRACE

Cybercrime investigation and threat-intelligence platform. Messages, URLs and Android packages are resolved by deterministic, documented rules into one connected case file. Every score is a sum of published weights, and every flag retains the exact evidence that fired it.

No machine learning, no LLM, no external AI API, no probabilistic inference.

## Quick start

Requirements: Node.js 18+ and npm.

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. The Vite dev server proxies `/api` to the Express API on `http://localhost:5174`. On first API start the SQLite database is created and seeded with 14 India-focused cases and 35 normalised entities.

Other scripts:

```bash
npm run build            # client production build + server typecheck
npm run seed             # reset and reseed server/data/trace.db
npm run sample:apk       # regenerate the deterministic sample APK fixture
npm run test:api         # API + Phase D unit tests
npm run eval             # labelled evaluation sets -> EVAL_REPORT.md
npm run blocklist:import <domains.txt>  # compile a local blocklist into shared/blocklist.ts
npm run preview          # preview the built client
npm run start            # run only the API
```

## Architecture

```
.
├── shared/                 Deterministic engines and types
│   ├── types.ts            Result/entity/rule/report contracts
│   ├── data.ts             Brands, patterns, UPI handles, TLD lists
│   ├── verdict.ts          One verdict config + pure computeVerdict()
│   ├── confusables.ts      Bundled TR39 subset + punycode decoder
│   ├── blocklist.ts        Compiled local blocklist (empty by default)
│   ├── message.ts          Message extraction, rules, scoring, samples
│   └── url.ts              URL parsing, heuristics, scoring, verdict
├── server/
│   ├── src/index.ts        Express API routes
│   ├── src/db.ts           SQLite schema, correlation, graph, reports
│   ├── src/seed.ts         14 seeded investigating cases
│   ├── src/enrich.ts       RDAP/DNS/TLS/redirect lookups + fixtures
│   ├── src/deep-scan.ts    Static HTML analysis of the landing page
│   ├── src/ssrf.ts         SSRF guard (private/loopback/metadata refusal)
│   ├── src/reputation.ts   Optional Safe Browsing / VirusTotal lookups
│   ├── src/apk.ts          APK inspection, behaviour, signing, packing
│   ├── src/dex.ts          Minimal bounds-checked DEX parser
│   └── src/sample-apk.ts   Deterministic sample + eval APK fixtures
├── data/                   brands, official apps, blocklist, bad hashes
├── eval/                   labelled URL/message sets + runner
└── client/
    ├── src/landing/        Cinematic landing page (GSAP + Lenis)
    ├── src/pages/          Console routes
    ├── src/components/     Shell, drawer, chips, UI primitives
    └── src/lib/            API client, PDF renderer, hooks, formatters
```

The shared engines are imported directly by Vite through the `@shared` alias and by the server through relative imports. The same rules therefore run in the browser demo and in saved cases.

### Routes

| Route | Purpose |
| --- | --- |
| `/` | Cinematic landing page with live client-side engine demo |
| `/app` | Command Center |
| `/app/scan` | Message scanner |
| `/app/url` | URL intelligence |
| `/app/apk` | APK inspector |
| `/app/graph` | Relationship graph |
| `/app/cases`, `/app/cases/:id` | Case index and case file |
| `/app/reports` | Generated report register |

Keyboard shortcuts: `G` then `C/S/U/A/G/K/R`, or `Cmd/Ctrl+K` for the command palette.

## Deterministic scoring

All scores are `min(100, Σ triggered weights)`. The legacy risk band (`HIGH ≥ 60`, `MEDIUM ≥ 30`, otherwise `LOW`) is shown only as a score gauge; it is not the verdict.

Every message, URL and APK result carries the same verdict object, produced by the single pure function `shared/verdict.ts`:

| Verdict | Rule |
| --- | --- |
| `MALICIOUS` | score ≥ 70 **and** at least 2 independent finding categories |
| `SUSPICIOUS` | score ≥ 35 |
| `INCONCLUSIVE` | poor coverage (analysis failed, packed/obfuscated APK, or no network data) and score < 35 |
| `NO_INDICATORS` | none of the above |

`NO_INDICATORS` always carries this exact disclaimer: *“No indicators found by TRACE's checks. This is not a guarantee of safety.”* The thresholds live in one object (`VERDICT_CONFIG`) and nowhere else.

Each result also returns `coverage`:

- `checksRun[]` — what actually ran;
- `checksSkipped[{ id, reason }]` — what could not run and why (network offline, deep scan off, packed APK, truncated DEX, no reputation key, and so on).

The UI renders this as a **What we could not check** panel. A negative result is never presented as proof of legitimacy.

### Message rules

| Rule | Weight | Fires when |
| --- | ---: | --- |
| `urgency` | 15 | Time-pressure phrases such as “urgent”, “immediately”, “today only” |
| `brand` | 25 | A protected brand is named **and** the linked domain is not owned by it |
| `domain` | 25 | The linked URL scores 40+ in the URL engine |
| `http` | 10 | A link uses plain `http://` |
| `payment` | 10 | A UPI ID, account number or payment instruction is present |
| `credential` | 15 | OTP, PIN, CVV, password or document harvesting language |
| `shortener` | 10 | A known URL shortener hides the destination |
| `kyc` | 10 | KYC / re-verification pretext |
| `authority` | 10 | Arrest, FIR, legal or police threats |
| `prize` | 10 | Refund, lottery, cashback or reward lure |
| `apk` | 15 | APK link or app-install instruction |
| `family-impersonation` | 30 | A “new number / lost phone” story **and** a money request (English or Hinglish) |
| `job-scam` | 25 | Part-time / work-from-home lure **and** daily-earning claim or Telegram |
| `accidental-code` | 30 | “I sent my code by mistake”, “forward the code”, “send me the 6-digit code” |
| `utility-threat` | 15 | Electricity/gas/water/SIM disconnection threat with a payment link |

A brand name alone never fires `brand`; the mismatch between the named brand and the domain is the evidence. This is why a genuine HDFC OTP stays `NO_INDICATORS`. Each message also gets a deterministic `scamType` (family-impersonation, job-scam, accidental-code, utility-threat, kyc-bank, delivery-prize, digital-arrest, apk-loan, unknown) and a matching `safetyAdvice` string, both shown in the UI and the PDF. Every extracted URL is passed through the URL engine and shown with its own verdict.

### URL heuristics

Registrable-domain extraction uses `tldts` (offline public suffix data), not a hand-written suffix list. Hosts are decoded from punycode and checked for mixed scripts (Latin + Cyrillic/Greek) and confusable skeletons (bundled Unicode TR39 subset) against the brand list and the bundled popular-domain list. Brands are data: `data/brands.json`, plus an organisation-owned `data/watchlist.json`.

| Weight | Heuristic |
| ---: | --- |
| 40 | Local blocklist hit (source named in evidence) |
| 30 | Brand used outside its official domain |
| 25–30 | Homoglyph skeleton matches a trusted name, mixed-script label |
| 25 | Punycode/homoglyph host, raw IP host |
| 20 | Userinfo (`@`) obfuscation, lookalike TLD swap |
| 15 | High-abuse TLD |
| 10 | Deep subdomains, hyphen stacking, non-standard port, HTTP, suspicious path words, shortener, high-entropy label, typosquat |
| 8 | Numeric padding in the registrable label |
| 5 | Unusually long URL |

Brand-independent checks (no brand list required) include random-looking labels, keyword stuffing, embedded full domains (`paypal.com.evil.xyz`), lookalike TLD swaps, userinfo tricks, `data:`/`javascript:` schemes and double-encoded paths. Findings are grouped by category: identity, structure, infrastructure, content and reputation.

**Deep scan** is opt-in (“Deep scan: fetch the page”). The server fetches the final landing page and analyses the HTML statically: password forms, cross-domain form actions, OTP/PIN/CVV/Aadhaar fields, brand mismatch, hidden iframes, meta refresh, obfuscated inline JS and cross-domain favicons. It is protected by an SSRF guard that allows HTTP(S) only, resolves DNS first, rejects loopback/private/link-local/CGNAT/metadata addresses, re-checks every redirect hop, caps redirects at 5 and the body at 2 MB, and never executes JavaScript. Optional reputation lookups (Google Safe Browsing, VirusTotal) run only when their env keys are set; otherwise they are listed as skipped and never affect the verdict.

### APK inspection

The server decodes binary AXML manifests (plain XML is also accepted), enumerates permissions and components, and fingerprints the package with SHA-256/MD5. Every `classes*.dex` is parsed with a bounds-checked minimal DEX reader (header, string/type/method/class tables); truncated or malformed DEX is reported in coverage instead of crashing. Nested `.apk`, `.dex`, `.jar` and `.so` files under `assets/` and `res/raw/` are inventoried with size and SHA-256.

Behaviour findings come from referenced methods and strings: SMS send/read and broadcast abort, dynamic code loading, reflection, device-admin and overlay APIs, notification listeners, accessibility, usage stats, hardcoded IPs, non-standard ports, cleartext endpoints, Telegram bot APIs, Firebase, paste hosts and shorteners. The existing permission weights and combination rules (banker triad, silent exfiltration) remain.

Signing is parsed from `META-INF/*.RSA|DSA|EC` as PKCS#7 via `node-forge`: subject, issuer, validity, self-signed flag and SHA-256 fingerprint. Packing/obfuscation is detected from packer libraries, very short class/method names, tiny DEX plus a large encrypted asset, or a missing application class. A packed APK always gets a `packed` finding, a skipped-check entry and at least `INCONCLUSIVE`; it is never reported as `NO_INDICATORS`. `data/official-apps.json` maps a small set of high-confidence brands to official package names for impersonation checks. Hash reputation uses `data/known-bad-hashes.txt` (empty by default) and an optional VirusTotal hash lookup; only the SHA-256 leaves the machine.

The UI shows a verdict banner, a capability matrix (SMS, overlay, accessibility, dynamic code, network exfiltration, device admin, dropper), certificate card, nested-file list, hashes and the coverage panel.

## Evidence and correlation

- Entities are normalised (`www.` stripped, UPI/email lower-cased, phone numbers reduced to 10 digits, URLs canonicalised).
- Every saved case writes its entities into a shared index with counts and first/last-seen timestamps.
- The graph derives nodes from that index and recomputes edges from evidence links and co-occurrence on each query. Isolating a node dims unrelated nodes to 15%.
- The entity drawer shows every case containing an indicator and the indicators it co-occurs with.

Seeded overlap: `kyc.support@fakebank` and `sbi-kyc-verify.in` each appear in five seeded cases, including the sample APK, so correlation is visible immediately.

## Network lookups

RDAP, DNS, TLS and redirect lookups use a four-second budget per source. Every enrichment result carries `dataStatus`:

- **`live`** — real network data was returned;
- **`fixture`** — a documented demo fixture for a known demo domain, or the deliberate offline mode;
- **`none`** — no data exists for this domain. Registration, DNS, TLS and redirects are returned empty, a skipped-check entry is added, and coverage is marked poor. Nothing is invented.

The UI badge reads **live data**, **demo fixture** or **no network data**. Structural URL scoring never depends on the network. Set `TRACE_FORCE_OFFLINE=1` to skip all outbound lookups.

## Evaluation

`npm run eval` runs labelled sets in `/eval` and writes `EVAL_REPORT.md`:

- 64 benign and 62 malicious-style URLs (the malicious set is template-generated and marked synthetic);
- 30 benign and 30 scam messages, including Hinglish;
- 8 synthetic APK fixtures from the generator (benign, SMS-reader, overlay-only, banker-triad, dropper, packed-like, debug-signed, impersonator).

It prints precision, recall, false positives and false negatives per engine. The sets are small and partly synthetic, so the numbers describe this harness, not real-world accuracy. Thresholds are not tuned to reach 100%; remaining failures stay in the report.

## Limitations

TRACE is a deterministic static analyser, not an oracle. It does not detect:

- **Zero-day campaigns** whose infrastructure and wording match no rule.
- **Heavily packed, encrypted or virtualised malware** — static analysis sees only the loader; the verdict is capped at `INCONCLUSIVE`.
- **Native-code-only payloads** — `.so` files are inventoried but not disassembled.
- **Dynamic behaviour** — no code is executed, so runtime actions, C2 callbacks and time-delayed payloads are invisible.
- **QR-code, image-only, voice and video scams** — there is no OCR or media analysis.
- **Social engineering without keywords** — a patient, well-written scam can score below the threshold.

The brand list is curated, not exhaustive; the bundled popular-domain list is roughly 250 entries, not 1,000. Reputation lookups are optional and may be absent. A `NO_INDICATORS` verdict means these checks found nothing; it is not a guarantee of safety.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Service health |
| `POST` | `/api/analyze/message` | Message analysis (optional `save`) |
| `POST` | `/api/analyze/url` | URL analysis with enrichment |
| `POST` | `/api/analyze/apk` | Multipart `apk` upload or `sample=true` |
| `GET` | `/api/sample-apk` | Download the deterministic sample APK |
| `GET`/`POST` | `/api/cases` | List / open a case |
| `GET`/`PATCH` | `/api/cases/:id` | Read / update a case |
| `GET` | `/api/cases/:id/entities` | Case entities |
| `POST` | `/api/cases/:id/report-data` | Build the report payload |
| `GET`/`GET` | `/api/reports`, `/api/reports/:id` | Report register / stored payload |
| `GET` | `/api/entities`, `/api/entities/:id`, `/api/entities/:id/related` | Entity index and correlation |
| `GET` | `/api/graph`, `/api/stats` | Graph payload and dashboard statistics |

## Reports

`downloadReportPdf(payload)` renders a paginated PDF containing the verbatim submitted input, the rule ledger with weights and exact evidence, extracted indicators, cross-case correlations, technical analysis, the investigation timeline, analyst notes, methodology, both generated timestamps and the SHA-256 integrity hash. Regenerating a report never mutates the case.

## Design notes

Near-black surfaces, hairline borders, Geist + Instrument Serif italic + JetBrains Mono, and a single accent (`#8b8bff`) used sparingly. Glass is limited to the command palette, modal drawer and navigation. Motion uses expo-out easing, transform/opacity only, and is disabled under `prefers-reduced-motion`.

See [DEMO.md](./DEMO.md) for a three-minute guided walkthrough.
