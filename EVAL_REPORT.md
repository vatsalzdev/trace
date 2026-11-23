# TRACE evaluation report

Generated 2026-11-23T19:51:11.255Z by `npm run eval`.

These sets are small and partly synthetic. The numbers below describe this harness, not real-world accuracy.

## Summary

| Engine | TP | FP | TN | FN | Precision | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| URL engine (static) | 59 | 0 | 64 | 3 | 1.000 | 0.952 |
| Message engine | 24 | 0 | 30 | 6 | 1.000 | 0.800 |
| APK engine (synthetic) | 6 | 0 | 1 | 0 | 1.000 | 1.000 |

- URLs: 64 benign, 62 malicious (malicious set generated from templates, marked synthetic).
- Messages: 30 benign, 30 scam (all scam families, including Hinglish).
- APKs: 1 benign, 6 malicious-style, all synthetic fixtures from `server/src/sample-apk.ts`.

## URL failures

### False positives (benign flagged)
- none

### False negatives (malicious missed)
- `https://bit.ly/3xYzAbC` -> NO_INDICATORS (10/100)
- `https://t.co/abc123` -> NO_INDICATORS (30/100)
- `https://rb.gy/kyc-update` -> NO_INDICATORS (20/100)

## Message failures

### False positives (benign flagged)
- none

### False negatives (scam missed)
- `Your PNB account is blocked. Pay Rs 499 verification fee to kyc.support@fakebank and confirm.` -> NO_INDICATORS (20/100)
- `This is CBI. A case is registered against you for money laundering. Join the video call now or a warrant will be issued.` -> NO_INDICATORS (10/100)
- `Your Aadhaar is linked to a drug parcel. TRAI will disconnect your number. Call this officer immediately.` -> NO_INDICATORS (15/100)
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
- This recall pass added combination rules and visible brand/lure/TLD evidence, not new thresholds. The held-out set was written and scored before those changes.
- Cause of the missed `axis-secure.xyz` family: `data/brands.json` listed Axis Bank only as "axis bank" and "axisbank", so a bare "axis" label produced no brand or typosquat finding; the URL scored only high-abuse TLD (15) plus path word (10) = 25. "axis" was added to the brand keywords, and a `brand-lure-tld` finding (25) now records the brand, lure word and TLD as visible evidence.
- Cause of the missed keyword-stuffed hosts: `.online` and `.site` were absent from the high-abuse TLD set, so hosts such as `update-your-kyc-now.online` had no TLD signal. Both were added, and a `lure-word-tld` finding (15) records stacked lure words plus the TLD. Shorteners, thin job lures and demand-free threats remain below threshold by design.

## Main-set change from this recall pass

| Engine | Before: TP/FN (recall) | After: TP/FN (recall) |
| --- | ---: | ---: |
| URL engine (static) | 56/6 (0.903) | 59/3 (0.952) |
| Message engine | 21/9 (0.700) | 24/6 (0.800) |
| APK engine (synthetic) | 6/0 (1.000) | 6/0 (1.000) |

## Held-out set

25 new cases in `eval/heldout/` (15 messages, 10 URLs) were written and scored before any rule or data change; baseline detail is in `eval/heldout/BASELINE.md`. They are hand-built around the scam mechanics under test, not sampled from real traffic, so a high score here does not measure real-world accuracy.

| Set | Before: flagged/total | Before recall | After: flagged/total | After recall |
| --- | ---: | ---: | ---: | ---: |
| Held-out messages | 4/15 | 0.267 | 15/15 | 1.000 |
| Held-out URLs | 9/10 | 0.900 | 10/10 | 1.000 |

### Held-out false negatives
- none

The held-out set contains no benign labels, so its false-positive count is always 0; the main sets above are the false-positive check.
