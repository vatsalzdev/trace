# Held-out baseline (before recall fixes)

Recorded from `npm run eval:heldout` on the unmodified engines. All 25 held-out cases were written before any rule or data change.

| Set | Cases | Flagged | Missed | Recall |
| --- | ---: | ---: | ---: | ---: |
| Held-out messages | 15 | 4 | 11 | 0.267 |
| Held-out URLs | 10 | 9 | 1 | 0.900 |

## Message misses

- Cyber Cell / Aadhaar-parcel / video call / transfer: NO_INDICATORS (20) — payment, kyc only.
- CBI FIR / money laundering / do not tell family / pay: NO_INDICATORS (20) — payment, authority only.
- ED drug case / video conference / move funds: NO_INDICATORS (25) — urgency, kyc only.
- Customs courier / digital arrest order / stay on call / UPI: NO_INDICATORS (20) — payment, authority only.
- KBC lucky draw / pay tax / share bank details: NO_INDICATORS (20) — payment, prize only.
- Hinglish lucky-draw winner / pay tax: NO_INDICATORS (10) — prize only.
- Reward points cash prize / handling fee / card details: NO_INDICATORS (20) — payment, prize only.
- Loan offer / install APK / 30-minute deadline / PAN+Aadhaar: NO_INDICATORS (0) — no findings.
- Hinglish loan approved / install APK / Aadhaar photo: NO_INDICATORS (10) — payment only.
- Courier address incomplete / Rs 29 fee / link: NO_INDICATORS (20) — http, payment only.
- Hinglish parcel held / address update / Rs 20 fee / link: NO_INDICATORS (20) — http, payment only.

## URL miss

- `https://update-kyc-verify-secure.online/` -> NO_INDICATORS (25) — keyword-stuffing, hyphens. `.online` is not on the high-abuse TLD list.

No benign held-out cases; false positives are tracked by the main `npm run eval` set.
