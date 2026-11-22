# TRACE — 3-minute walkthrough

Start the app with `npm install && npm run dev`, then open <http://localhost:5173>.

## 1. Paste a scam SMS (0:00–0:45)

Go to **Message Scanner** (`G` then `S`, or `Cmd/Ctrl+K`). Pick the **Loan app APK** sample chip.

- The left pane shows the raw message with highlighted indicator spans. The right pane updates 150 ms after typing using the same shared engine as the server.
- The composite score is **HIGH**. The rule ledger itemises every check with its weight and the exact matched text: urgency, brand impersonation, suspicious domain, HTTP, payment/KYC lure and APK install request.
- The extracted-indicator chips include `sbi-kyc-verify.in` and `kyc.support@fakebank`.

For the canonical KYC example, use the **SBI KYC suspension** chip: it scores **95 HIGH** with `urgency`, `brand`, `domain`, `http`, `payment`, `kyc`. The **Genuine OTP (control)** chip stays **LOW** because a brand name on its own is not evidence.

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

- The unpacking progress bar completes and the verdict shows `com.sbi.kycupdate`, decoded from **binary AXML**, scoring **100 HIGH**.
- **Permissions** shows 14 decoded permissions; dangerous ones are weighted individually.
- **Indicators** shows the embedded C2 URL `http://sbi-kyc-verify.in/api/v2/collect`, the same `sbi-kyc-verify.in` domain, `kyc.support@fakebank`, an IP and a Telegram contact.
- **Hashes** shows the SHA-256 fingerprint. Save it as a case — the shared domain now links even more cases in the drawer and graph.

## 5. Generate the PDF (2:35–3:00)

Open any case from the drawer or **Cases**, then click **Generate report PDF** in the case metadata panel.

The PDF contains the verbatim input, the rule ledger with weights and exact evidence, extracted indicators, cross-case correlations, technical analysis, timeline, notes, timestamps and the SHA-256 integrity hash. The download also appears in **Reports** (`G` then `R`).

---

### Offline check

Disable the network and run the URL example `http://sbi-secure-login.xyz/verify?acc=1`. Structural scoring still returns **100 HIGH**; the enrichment badge reads **cached** because the local RDAP/DNS/TLS fixtures were used.
