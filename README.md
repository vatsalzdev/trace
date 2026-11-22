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
npm run preview          # preview the built client
npm run start            # run only the API
```

## Architecture

```
.
├── shared/                 Deterministic engines and types
│   ├── types.ts            Result/entity/rule/report contracts
│   ├── data.ts             Brands, patterns, UPI handles, TLD lists
│   ├── message.ts          Message extraction, rules, scoring, samples
│   └── url.ts              URL parsing, heuristics, scoring, risk bands
├── server/
│   ├── src/index.ts        Express API routes
│   ├── src/db.ts           SQLite schema, correlation, graph, reports
│   ├── src/seed.ts         14 seeded investigating cases
│   ├── src/enrich.ts       RDAP/DNS/TLS/redirect lookups + fixtures
│   ├── src/apk.ts          Binary AXML manifest decoder + APK inspection
│   └── src/sample-apk.ts   Deterministic sample APK generator
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

All scores are `min(100, Σ triggered weights)`. Risk bands: `HIGH ≥ 60`, `MEDIUM ≥ 30`, otherwise `LOW`. A low score means these rules did not fire; it is never presented as proof of legitimacy.

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

A brand name alone never fires `brand`; the mismatch between the named brand and the domain is the evidence. This is why a genuine HDFC OTP stays LOW.

### URL heuristics

| Weight | Heuristic |
| ---: | --- |
| 30 | Brand used outside its official domain |
| 25 | Punycode/homoglyph host, raw IP host |
| 20 | Userinfo (`@`) obfuscation |
| 15 | High-abuse TLD |
| 10 | Deep subdomains, hyphen stacking, non-standard port, HTTP, suspicious path words, shortener, high-entropy label, typosquat |
| 8 | Numeric padding in the registrable label |
| 5 | Unusually long URL |

Each heuristic carries `id`, `name`, `weight`, `triggered`, `evidence[]` and `explanation`. The UI ledger shows all checks with their exact matches.

### APK inspection

The server decodes binary AXML manifests (plain XML is also accepted), enumerates permissions and components, fingerprints the package with SHA-256/MD5, and extracts embedded URLs, domains, IPs, UPI IDs and wallet addresses. Dangerous permissions and exported components are weighted individually; every rule still records its evidence.

## Evidence and correlation

- Entities are normalised (`www.` stripped, UPI/email lower-cased, phone numbers reduced to 10 digits, URLs canonicalised).
- Every saved case writes its entities into a shared index with counts and first/last-seen timestamps.
- The graph derives nodes from that index and recomputes edges from evidence links and co-occurrence on each query. Isolating a node dims unrelated nodes to 15%.
- The entity drawer shows every case containing an indicator and the indicators it co-occurs with.

Seeded overlap: `kyc.support@fakebank` and `sbi-kyc-verify.in` each appear in five seeded cases, including the sample APK, so correlation is visible immediately.

## Network lookups

RDAP, DNS, TLS and redirect lookups use a four-second budget per source. If a lookup fails or the network is unavailable, the server falls back to a documented local fixture and the UI shows a **`cached`** badge next to the analysis. A successful lookup is labelled **`live`**. Structural URL scoring never depends on the network.

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
