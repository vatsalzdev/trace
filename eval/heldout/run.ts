import { describe, runHeldout } from './metrics';

const heldout = runHeldout();
const messages = describe('Held-out messages', heldout.messages);
const urls = describe('Held-out URLs', heldout.urls);

console.log('| Set | Cases | Flagged | Missed | Recall |');
console.log('| --- | ---: | ---: | ---: | ---: |');
console.log(messages.row);
console.log(urls.row);
console.log('\n## Held-out message misses');
console.log(messages.misses.length ? messages.misses.join('\n') : '- none');
console.log('\n## Held-out URL misses');
console.log(urls.misses.length ? urls.misses.join('\n') : '- none');
console.log('\nAll held-out cases are labelled malicious-style. No benign held-out cases, so FP/TN are always 0 here; check EVAL_REPORT.md for false positives.');
