# TRACE evaluation report

Generated 2026-11-23T17:41:54.454Z by `npm run eval`.

These sets are small and partly synthetic. The numbers below describe this harness, not real-world accuracy.

## Summary

| Engine | TP | FP | TN | FN | Precision | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| URL engine (static) | 56 | 0 | 64 | 6 | 1.000 | 0.903 |
| Message engine | 21 | 0 | 30 | 9 | 1.000 | 0.700 |
| APK engine (synthetic) | 6 | 0 | 1 | 0 | 1.000 | 1.000 |

- URLs: 64 benign, 62 malicious (malicious set generated from templates, marked synthetic).
- Messages: 30 benign, 30 scam (all scam families, including Hinglish).
- APKs: 1 benign, 6 malicious-style, all synthetic fixtures from `server/src/sample-apk.ts`.

## URL failures

### False positives (benign flagged)
- none

### False negatives (malicious missed)
- `https://axis-secure.xyz/login` -> NO_INDICATORS (25/100)
- `https://bit.ly/3xYzAbC` -> NO_INDICATORS (10/100)
- `https://t.co/abc123` -> NO_INDICATORS (30/100)
- `https://rb.gy/kyc-update` -> NO_INDICATORS (20/100)
- `https://update-your-kyc-now.online` -> NO_INDICATORS (10/100)
- `https://secure-login.top/path%2f..%2fverify` -> NO_INDICATORS (25/100)

## Message failures

### False positives (benign flagged)
- none

### False negatives (scam missed)
- `Your PNB account is blocked. Pay Rs 499 verification fee to kyc.support@fakebank and confirm.` -> NO_INDICATORS (20/100)
- `Congratulations! You won Rs 25,00,000 in the KBC lottery. Send your bank details to claim.` -> NO_INDICATORS (10/100)
- `Your delivery failed. Reschedule and pay Rs 15 here http://delhivery-reschedule.xyz` -> NO_INDICATORS (20/100)
- `This is CBI. A case is registered against you for money laundering. Join the video call now or a warrant will be issued.` -> NO_INDICATORS (10/100)
- `Your Aadhaar is linked to a drug parcel. TRAI will disconnect your number. Call this officer immediately.` -> NO_INDICATORS (15/100)
- `You are under digital arrest. Stay on the call and transfer funds to the government verification account.` -> NO_INDICATORS (30/100)
- `Your loan of Rs 50,000 is approved. Install this APK to receive the amount: http://loan-fast.top/app.apk` -> NO_INDICATORS (25/100)
- `Instant loan without documents. Install our app http://rupee-instant.xyz/loan.apk and grant SMS permission.` -> NO_INDICATORS (25/100)
- `Part time job, ghar baithe paise kamao. Daily payout Rs 2000. Join Telegram group to start.` -> NO_INDICATORS (25/100)

## APK results

| Fixture | Expected | Verdict | Score |
| --- | --- | --- | ---: |
| benign | benign | NO_INDICATORS | 0 |
| sms-reader | malicious | SUSPICIOUS | 55 |
| overlay-only | malicious | SUSPICIOUS | 40 |
| banker-triad | malicious | MALICIOUS | 100 |
| dropper | malicious | MALICIOUS | 80 |
| packed-like | malicious | INCONCLUSIVE | 20 |
| impersonator | malicious | SUSPICIOUS | 45 |
| debug-signed | weak signal | NO_INDICATORS | 12 |

`debug-signed` is reported separately. A debug signature is a provenance weakness, not enough on its own to cross the SUSPICIOUS threshold; treating it as benign would hide a real risk, and treating it as malicious would overstate the evidence.

## Interpretation

- A benign case is a false positive only when the verdict is MALICIOUS or SUSPICIOUS. INCONCLUSIVE is counted as not flagged, because it says the checks could not see enough, not that the target is hostile.
- The malicious URL set is template-generated from typosquats, homoglyphs, IP hosts, embedded-domain tricks, shorteners and keyword-stuffed hosts. It is not a sample of live phishing.
- The message set is hand-written from known Indian scam scripts, including Hinglish. It is not a random sample of real traffic.
- APK fixtures are synthetic ZIPs built by the generator. No real malware was downloaded or executed.
- Verdict thresholds were not changed. Two input-pattern gaps found by the first run were fixed before this report: comma-grouped amounts (`Rs 8,000`) in the family-money rule, and code-forward requests (`forward the code`) in the credential rule. Remaining failures are left in the lists above.
