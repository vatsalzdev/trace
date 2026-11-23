# TRACE — 3-minute walkthrough

Start the app with `npm install && npm run dev`, then open <http://localhost:5173>.

## 1. Paste a scam SMS (0:00–0:45)

Go to **Message Scanner** (`G` then `S`, or `Cmd/Ctrl+K`). Pick the **Loan app APK** sample chip.

- The left pane shows the raw message with highlighted indicator spans. The right pane updates 150 ms after typing using the same shared engine as the server.
- The verdict is **MALICIOUS**, with a confidence level and a score out of 100. The rule ledger itemises every check with its weight and the exact matched text: urgency, brand impersonation, suspicious domain, HTTP, payment/KYC lure and APK install request.
- The **Scam type** card names the family and shows the matching safety advice. The extracted-indicator chips include `sbi-kyc-verify.in` and `kyc.support@fakebank`.
- Every link is analysed separately by the URL engine and shown with its own verdict.

For the canonical KYC example, use the **SBI KYC suspension** chip: it scores 95 and is **MALICIOUS** with `urgency`, `brand`, `domain`, `http`, `payment`, `kyc`. The **Genuine OTP (control)** chip is **NO_INDICATORS** and shows the exact disclaimer: “No indicators found by TRACE's checks. This is not a guarantee of safety.” A brand name on its own is not evidence.

Try the **Family "new number"**, **Part-time job lure**, **Accidental OTP forward** and **Electricity disconnection** chips. Each shows its scam type, safety advice and verdict. Their benign controls stay **NO_INDICATORS**.

## 2. Pivot through an indicator (0:45–1:20)

Click the `sbi-kyc-verify.in` chip.

The global entity drawer opens with:

- the normalised value, type and first/last seen dates;
- **5+ linked cases**, including the seeded APK case;
- co-occurring indicators such as `kyc.support@fakebank` and the C2 URL.

Click any case in the drawer to open its case file. Repeat with the UPI chip to see the same cluster from the payment side.

## 3. Open the graph and isolate the cluster (1:20–2:00)

Go to **Relationship Graph** (`G` then `G`).

- The left rail filters entity layers with live counts. Search `sbi-kyc-verify` to focus the node.
- Click the domain node. It opens the drawer and selects the node in the graph.
- Click **Isolate**. Unrelated nodes and edges fade to 15%; the selected node's immediate edges light up in accent. This is the reusable-indicator cluster shared by the complaints and the APK.
- **Reset view** restores the full graph.

## 4. Inspect the sample APK (2:00–2:35)

Go to **APK Inspector** (`G` then `A`) and click **Load sample APK**.

- The unpacking progress bar completes and the verdict is **MALICIOUS** for `com.sbi.kycupdate`, decoded from **binary AXML**, with a score of 100.
- The **Capability matrix** shows SMS, overlay, accessibility, network exfiltration and their evidence. **Permissions** shows 14 decoded permissions; dangerous ones are weighted individually.
- The **DEX files and nested payloads** panel shows every `classes*.dex` parsed and any embedded containers. The **certificate card** shows the signing subject, validity and SHA-256 fingerprint, or the parse anomaly when the certificate is fake.
- **Indicators** shows the embedded C2 URL `http://sbi-kyc-verify.in/api/v2/collect`, the same `sbi-kyc-verify.in` domain, `kyc.support@fakebank`, an IP and a Telegram contact.
- **What we could not check** lists native code, dynamic behaviour, DEX truncation and reputation lookups.
- Save it as a case — the shared domain now links even more cases in the drawer and graph.

## 5. URL intelligence and deep scan (2:35–3:00)

Go to **URL Intelligence** (`G` then `U`) and paste `http://sbi-secure-login.xyz/verify?acc=1`.

- The verdict banner reads **MALICIOUS** with category chips (identity, structure, transport). The ledger shows each weight and evidence.
- The **What we could not check** panel explains that registration age, DNS/TLS and reputation are skipped when offline.
- The **data-status badge** reads **live data**, **demo fixture** or **no network data**. For an unknown domain offline it reads **no network data** and the enrichment fields are empty — nothing is invented.
- Toggle **Deep scan: fetch the page** to have the server fetch the final landing page and inspect the HTML statically. The SSRF guard refuses loopback, private, link-local, CGNAT and metadata addresses.

## 6. Generate the PDF (3:00–3:30)

Open any case from the drawer or **Cases**, then click **Generate report PDF** in the case metadata panel.

The PDF contains the verbatim input, the verdict, confidence, coverage (including skipped checks), the disclaimer for `NO_INDICATORS`, the rule ledger with weights and exact evidence, extracted indicators, cross-case correlations, technical analysis, timeline, notes, timestamps and the SHA-256 integrity hash. The download also appears in **Reports** (`G` then `R`).

---

### Offline check

Run `TRACE_FORCE_OFFLINE=1 npm run dev` (PowerShell: `$env:TRACE_FORCE_OFFLINE=1; npm run dev`). Structural scoring still returns the same verdict; the enrichment badge reads **demo fixture** for documented demo domains and **no network data** for everything else.

### Evaluation check

Run `npm run eval`. It prints precision and recall for the URL, message and APK engines and writes `EVAL_REPORT.md` with the real failures. The sets are small and partly synthetic; read the report as a harness result, not a claim about the real world.
