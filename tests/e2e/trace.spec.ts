import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { expect, test, type Page } from '@playwright/test';

const THEME = process.env.TRACE_THEME === 'light' ? 'light' : 'dark';
const ROOT = process.cwd();
const SCREENSHOTS = join(ROOT, 'tests', 'screenshots');
const ARTIFACTS = join(ROOT, 'tests', 'artifacts');
const TSX_CLI = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
mkdirSync(SCREENSHOTS, { recursive: true });
mkdirSync(ARTIFACTS, { recursive: true });

const SCAM_SMS =
  'URGENT! Your SBI account will be blocked today.\nComplete KYC immediately:\nhttp://sbi-kyc-verify.example.com\n\nPay verification fee to:\nsupport@fakebank';

function watchConsole(page: Page, name: string): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`uncaught page error: ${error.message}`));
  (page as Page & { __traceName?: string }).__traceName = name;
  return errors;
}

async function shot(page: Page, name: string): Promise<string> {
  const path = join(SCREENSHOTS, `${name}-${THEME}.png`);
  await page.screenshot({ path, fullPage: true });
  console.log(`[SCREENSHOT] ${name}: ${path}`);
  return path;
}

async function noConsoleErrors(errors: string[]): Promise<void> {
  assert.deepEqual(errors, [], `console/page errors: ${JSON.stringify(errors, null, 2)}`);
}

async function scrollMetrics(page: Page): Promise<{ width: number; scrollWidth: number }> {
  return page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
}

type OfflineServer = { base: string; child: ChildProcess; log: string };

async function startOfflineServer(): Promise<OfflineServer> {
  const port = 5270 + Math.floor(Math.random() * 200);
  const dbDir = join(ARTIFACTS, `offline-db-${port}`);
  mkdirSync(dbDir, { recursive: true });
  const child = spawn(process.execPath, [TSX_CLI, 'src/index.ts'], {
    cwd: join(ROOT, 'server'),
    env: { ...process.env, PORT: String(port), TRACE_DB_DIR: dbDir, TRACE_FORCE_OFFLINE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const server: OfflineServer = { base: `http://127.0.0.1:${port}`, child, log: '' };
  child.stdout.on('data', (chunk) => (server.log += String(chunk)));
  child.stderr.on('data', (chunk) => (server.log += String(chunk)));
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null) throw new Error(`offline API exited: ${server.log}`);
    try {
      const res = await fetch(`${server.base}/api/health`);
      if (res.ok) return server;
    } catch {
      /* not ready */
    }
    await sleep(100);
  }
  throw new Error(`offline API not ready: ${server.log}`);
}

async function stopOfflineServer(server: OfflineServer): Promise<void> {
  writeFileSync(join(ARTIFACTS, 'e2e-offline-api.log'), server.log || '(no output)\n');
  if (server.child.exitCode === null) server.child.kill('SIGTERM');
}

// Phase 5 runs the whole suite once per theme. Theme-specific tests below
// manage their own storage so they can verify first-visit behaviour.
test.beforeEach(async ({ page }, testInfo) => {
  if (/^1[3-5] /.test(testInfo.title)) return;
  await page.addInitScript((value) => {
    try {
      localStorage.setItem('trace:theme', value);
    } catch {
      /* storage-blocked test covers this path */
    }
  }, THEME);
});

test('01 landing preloader, scroll and viewports', async ({ page }) => {
  const errors = watchConsole(page, 'landing');
  for (const width of [1440, 1280, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('preloader')).toBeVisible({ timeout: 2000 });
    await expect(page.getByTestId('preloader')).toHaveCount(0, { timeout: 6000 });
    await expect(page.getByTestId('hero-headline')).toBeVisible({ timeout: 6000 });
    await shot(page, `landing-top-${width}`);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y <= height; y += 700) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(60);
    }
    const mid = Math.round(height / 2);
    await page.evaluate((top) => window.scrollTo(0, top), mid);
    await page.waitForTimeout(250);
    await shot(page, `landing-mid-${width}`);
    await page.evaluate((top) => window.scrollTo(0, top), height);
    await page.waitForTimeout(250);
    await shot(page, `landing-bottom-${width}`);
    const metrics = await scrollMetrics(page);
    assert.ok(metrics.scrollWidth <= metrics.width + 1, `horizontal scroll at ${width}: ${JSON.stringify(metrics)}`);
    console.log(`[EVIDENCE] landing ${width}: ${JSON.stringify(metrics)}`);
  }
  await noConsoleErrors(errors);
});

test('02 no clipped or overflowing text on landing', async ({ page }) => {
  const errors = watchConsole(page, 'landing-bounds');
  for (const width of [1440, 1280, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('preloader')).toHaveCount(0, { timeout: 6000 });
    const offenders = await page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
        const ownText = Array.from(el.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? '')
          .join('')
          .trim();
        if (!ownText) return;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return;
        // The marquee and the tilted console preview are decorative: their
        // text is intentionally clipped by an overflow-hidden ancestor.
        if (el.closest('.marquee-mask, [style*="perspective"]')) return;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const clipped = el.scrollWidth > el.clientWidth + 2 && /(hidden|clip)/.test(style.overflowX);
        if (rect.left < -1 || rect.right > window.innerWidth + 1 || clipped) {
          out.push(
            `${el.tagName.toLowerCase()}.${el.className?.toString().slice(0, 60)} ` +
              `text="${ownText.slice(0, 40)}" left=${rect.left.toFixed(1)} right=${rect.right.toFixed(1)} ` +
              `scroll=${el.scrollWidth}/${el.clientWidth}`,
          );
        }
      });
      return out.slice(0, 25);
    });
    await shot(page, `bounds-${width}`);
    console.log(`[EVIDENCE] bounds ${width}: ${JSON.stringify(offenders)}`);
    assert.deepEqual(offenders, [], `${offenders.length} text elements are clipped or overflow ${width}px viewport`);
  }
  await noConsoleErrors(errors);
});

test('03 scanner analysis renders high risk evidence', async ({ page }) => {
  const errors = watchConsole(page, 'scan');
  await page.goto('/app/scan');
  const started = Date.now();
  await page.getByLabel('Message evidence').fill(SCAM_SMS);
  await expect(page.getByTestId('risk-pill').filter({ hasText: 'HIGH' }).first()).toBeVisible({ timeout: 1000 });
  const elapsed = Date.now() - started;
  assert.ok(elapsed <= 1000, `analysis took ${elapsed}ms`);
  const rules = await page.getByTestId('rule-row').count();
  const highlights = await page.getByTestId('highlight').count();
  const chips = await page.getByTestId('entity-chip').count();
  assert.ok(rules >= 6, `only ${rules} rule rows`);
  assert.ok(highlights >= 1, `only ${highlights} highlights`);
  assert.ok(chips >= 1, `only ${chips} entity chips`);
  console.log(`[EVIDENCE] scan: ${JSON.stringify({ elapsedMs: elapsed, rules, highlights, chips })}`);
  await shot(page, 'scan');
  await noConsoleErrors(errors);
});

test('04 save as case from real button and verify case index', async ({ page }) => {
  const errors = watchConsole(page, 'save-case');
  await page.goto('/app/scan');
  await page.getByLabel('Message evidence').fill(SCAM_SMS);
  await expect(page.getByTestId('risk-pill').filter({ hasText: 'HIGH' }).first()).toBeVisible();
  await page.locator('input[placeholder^="Optional"]').fill('QA E2E Saved Case');
  await page.getByRole('button', { name: 'Save as case' }).click();
  await expect(page.getByTestId('toast').filter({ hasText: /Case TRC-/ })).toBeVisible({ timeout: 10_000 });
  await shot(page, 'save-case-toast');
  await page.goto('/app/cases');
  await page.getByLabel('Search cases').fill('QA E2E Saved Case');
  await expect(page.getByText('QA E2E Saved Case').first()).toBeVisible({ timeout: 10_000 });
  console.log('[EVIDENCE] saved case appears in /app/cases');
  await shot(page, 'save-case-index');
  await noConsoleErrors(errors);
});

test('05 sample APK inspection and save', async ({ page }) => {
  const errors = watchConsole(page, 'apk');
  await page.goto('/app/apk');
  await page.getByRole('button', { name: 'Load sample APK' }).click();
  await expect(page.getByRole('button', { name: 'Permissions' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/com\.sbi\.kycupdate/).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Permissions' }).click();
  const permissions = await page.locator('[data-testid="permission-row"]').count();
  assert.ok(permissions >= 5, `only ${permissions} permission rows`);
  await page.getByRole('button', { name: 'Indicators', exact: true }).click();
  const chips = await page.getByTestId('entity-chip').count();
  assert.ok(chips >= 3, `only ${chips} indicator chips`);
  await page.getByRole('button', { name: 'Save as case' }).click();
  await expect(page.getByTestId('toast').filter({ hasText: /Case TRC-/ })).toBeVisible({ timeout: 10_000 });
  console.log(`[EVIDENCE] APK: permissions=${permissions}, chips=${chips}`);
  await shot(page, 'apk');
  await noConsoleErrors(errors);
});

test('06 entity drawer opens from chip and closes with Escape', async ({ page }) => {
  const errors = watchConsole(page, 'entity-drawer');
  await page.goto('/app/url');
  await page.getByLabel('URL to analyse').fill('http://sbi-kyc-verify.in');
  await page.getByRole('button', { name: 'Analyse URL' }).click();
  await expect(page.getByText('sbi-kyc-verify.in').first()).toBeVisible({ timeout: 15_000 });
  const chip = page.locator('[data-testid="entity-chip"][data-entity-value="kyc.support@fakebank"]').first();
  if ((await chip.count()) === 0) {
    await page.goto('/app/apk');
    await page.getByRole('button', { name: 'Load sample APK' }).click();
    await expect(page.getByRole('button', { name: 'Indicators', exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Indicators', exact: true }).click();
  }
  await page.locator('[data-testid="entity-chip"][data-entity-value="kyc.support@fakebank"]').first().click();
  const dialog = page.getByRole('dialog', { name: 'Entity details' });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  const caseCount = async () => {
    const text = await dialog.locator('div.label').filter({ hasText: /^Cases \(\d+\)$/ }).innerText();
    return Number(text.match(/\((\d+)\)/)?.[1] ?? 0);
  };
  await expect.poll(caseCount, { timeout: 10_000, message: 'drawer correlated case count' }).toBeGreaterThanOrEqual(2);
  const count = await caseCount();
  console.log(`[EVIDENCE] drawer cases=${count}`);
  await shot(page, 'entity-drawer');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0, { timeout: 5000 });
  await noConsoleErrors(errors);
});

test('07 graph nodes, isolate, filters and overlap', async ({ page }) => {
  const errors = watchConsole(page, 'graph');
  await page.goto('/app/graph');
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 15_000 });
  const nodeCount = await page.locator('.react-flow__node').count();
  assert.ok(nodeCount > 10, `only ${nodeCount} graph nodes`);
  const layerButtons = page.locator('button[title^="Toggle "]');
  assert.ok((await layerButtons.count()) > 0, 'filter rail is empty');
  const railText = await layerButtons.allInnerTexts();
  assert.ok(railText.some((t) => /\d/.test(t)), 'filter rail counts are all zero');

  const boxes = await page.locator('.react-flow__node').evaluateAll((nodes) =>
    nodes.map((n) => {
      const r = n.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }),
  );
  let overlapping = 0;
  let pairs = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      pairs++;
      const a = boxes[i];
      const b = boxes[j];
      if (!(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)) overlapping++;
    }
  }
  const overlapPct = (overlapping / Math.max(1, pairs)) * 100;
  console.log(`[EVIDENCE] graph nodes=${nodeCount}, overlap=${overlapPct.toFixed(1)}% (${overlapping}/${pairs})`);
  await shot(page, 'graph-before-isolate');

  // Let the initial fitView settle; with a large graph the node boxes can still
  // be moving when they first appear. Retry a few entity nodes because an
  // overlapping node can intercept a force click at a stale centre point.
  await page.waitForTimeout(700);
  const drawer = page.getByRole('dialog', { name: 'Entity details' });
  const entityNodes = page.locator('.react-flow__node-entity');
  const attempts = Math.min(await entityNodes.count(), 8);
  for (let i = 0; i < attempts; i++) {
    if (await drawer.isVisible().catch(() => false)) break;
    await entityNodes.nth(i).click({ force: true, timeout: 3000 });
  }
  await expect(drawer).toBeVisible({ timeout: 5000 });
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden({ timeout: 3000 });
  await page.getByRole('button', { name: 'Isolate' }).click();
  const dimmed = await page.locator('.react-flow__node').evaluateAll((nodes) =>
    nodes.map((n) => Number(getComputedStyle(n).opacity)),
  );
  assert.ok(dimmed.some((o) => Math.abs(o - 0.15) < 0.02), 'no unrelated nodes dimmed to 0.15');
  assert.ok(dimmed.some((o) => o > 0.9), 'no related nodes stayed fully visible');
  await shot(page, 'graph-isolated');

  await page.getByRole('button', { name: 'Isolate' }).click();
  const restored = await page.locator('.react-flow__node').evaluateAll((nodes) =>
    nodes.map((n) => Number(getComputedStyle(n).opacity)),
  );
  assert.ok(restored.every((o) => o > 0.9), `isolate not cleared: ${JSON.stringify(restored.slice(0, 10))}`);
  await shot(page, 'graph-restored');

  assert.ok(overlapPct <= 20, `graph overlap ${overlapPct.toFixed(1)}% exceeds 20%`);
  await noConsoleErrors(errors);
});

test('08 case status/notes persistence and PDF report extraction', async ({ page }) => {
  const errors = watchConsole(page, 'case-report');
  const raw = `QA E2E PDF ${Date.now()} URGENT SBI KYC http://sbi-kyc-verify.in pay kyc.support@fakebank`;
  const created = await page.request.post('/api/analyze/message', {
    data: { text: raw, save: true, title: 'QA E2E PDF Case' },
  });
  assert.ok(created.ok(), `case create failed: ${created.status()}`);
  const caseId = (await created.json()).caseId as string;
  assert.ok(caseId);

  await page.goto(`/app/cases/${caseId}`);
  await expect(page.getByText('QA E2E PDF Case')).toBeVisible({ timeout: 10_000 });
  await page.getByLabel('Case status').selectOption('investigating');
  await expect(page.getByTestId('toast').filter({ hasText: 'Status moved to investigating' })).toBeVisible();
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  const note = `QA note ${Date.now()} verified`;
  await page.locator('textarea').first().fill(note);
  await page.getByRole('button', { name: 'Save notes' }).first().click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Analyst notes saved' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Case status')).toHaveValue('investigating');
  await expect(page.getByText(note).first()).toBeVisible({ timeout: 10_000 });
  await shot(page, 'case-persisted');

  const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Report PDF', exact: true }).click();
  const download = await downloadPromise;
  const pdfPath = join(ARTIFACTS, 'qa-e2e-report.pdf');
  await download.saveAs(pdfPath);
  const { PDFParse } = await import('pdf-parse');
  const { readFileSync } = await import('node:fs');
  const parser = new PDFParse({ data: new Uint8Array(readFileSync(pdfPath)) });
  const parsed = await parser.getText();
  await parser.destroy();
  const text = parsed.text.replace(/\s+/g, ' ');
  assert.ok(text.includes('QA E2E PDF'), 'PDF missing original input marker');
  assert.ok(text.includes('Detection rules triggered'), 'PDF missing rules table');
  assert.ok(text.includes('Extracted indicators'), 'PDF missing entities section');
  assert.ok(/Generated .*IST/.test(text), 'PDF missing timestamp');
  console.log(`[EVIDENCE] PDF ${pdfPath}: ${text.length} chars; markers present`);
  await shot(page, 'case-report');
  await noConsoleErrors(errors);
});

test('09 URL enrichment with forced offline server, then normal server', async ({ page }) => {
  const errors = watchConsole(page, 'url-offline');
  const offline = await startOfflineServer();
  try {
    const route = async (route: import('@playwright/test').Route) => {
      const request = route.request();
      const parsed = new URL(request.url());
      const target = `${offline.base}${parsed.pathname}${parsed.search}`;
      const headers = { ...request.headers() };
      delete headers.host;
      const response = await fetch(target, {
        method: request.method(),
        headers,
        body: ['GET', 'HEAD'].includes(request.method()) ? undefined : request.postData(),
      });
      await route.fulfill({
        status: response.status,
        headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
        body: Buffer.from(await response.arrayBuffer()),
      });
    };
    await page.route('**/api/**', route);
    await page.goto('/app/url');
    await page.getByLabel('URL to analyse').fill('http://sbi-kyc-verify.in');
    await page.getByRole('button', { name: 'Analyse URL' }).click();
    await expect(page.getByText('cached', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    console.log('[EVIDENCE] offline server returned visible cached badge');
    await shot(page, 'url-offline-cached');
    await page.unroute('**/api/**', route);
  } finally {
    await stopOfflineServer(offline);
  }

  await page.reload();
  await page.getByLabel('URL to analyse').fill('http://sbi-kyc-verify.in');
  await page.getByRole('button', { name: 'Analyse URL' }).click();
  await expect(page.getByText(/^(live|cached)$/).first()).toBeVisible({ timeout: 15_000 });
  console.log('[EVIDENCE] normal server returned live/cached badge');
  await shot(page, 'url-normal-badge');
  await noConsoleErrors(errors);
});

test('10 navigation, shortcuts, palette, back/forward and not-found states', async ({ page }) => {
  const errors = watchConsole(page, 'navigation');
  await page.goto('/app');
  const routes: [string, string][] = [
    ['/app/scan', 'Message scanner'],
    ['/app/url', 'URL intelligence'],
    ['/app/apk', 'APK inspector'],
    ['/app/graph', 'Relationship graph'],
    ['/app/cases', 'Case index'],
    ['/app/reports', 'Reports'],
  ];
  for (const [path, heading] of routes) {
    await page.goto(path);
    await expect(page.getByText(heading, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  }
  console.log('[EVIDENCE] all 7 sidebar destinations rendered');

  const shortcuts: [string, string, string][] = [
    ['c', '/app', 'Command center'],
    ['s', '/app/scan', 'Message scanner'],
    ['u', '/app/url', 'URL intelligence'],
    ['a', '/app/apk', 'APK inspector'],
    ['g', '/app/graph', 'Relationship graph'],
    ['k', '/app/cases', 'Case index'],
    ['r', '/app/reports', 'Reports'],
  ];
  for (const [key, path] of shortcuts) {
    await page.goto('/app');
    await page.keyboard.press('g');
    await page.keyboard.press(key);
    await expect(page).toHaveURL(new RegExp(`${path.replace('/', '\\/')}$`), { timeout: 5000 });
  }
  console.log('[EVIDENCE] G+C/S/U/A/G/K/R shortcuts navigated');

  await page.goto('/app');
  await page.keyboard.press('Control+k');
  await expect(page.getByPlaceholder('Search cases, indicators, pages…')).toBeVisible();
  await page.getByPlaceholder('Search cases, indicators, pages…').fill('APK Inspector');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/app\/apk$/, { timeout: 5000 });
  await page.goBack();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  await page.goForward();
  await expect(page).toHaveURL(/\/app\/apk$/, { timeout: 5000 });
  console.log('[EVIDENCE] palette navigation and browser history worked');

  await page.goto('/does-not-exist');
  await expect(page.getByText('Page not found', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await shot(page, 'unknown-route');
  await page.goto('/app/cases/doesnotexist');
  await expect(page.getByText('Case not found', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await shot(page, 'case-not-found');
  await noConsoleErrors(errors);
});

test('11 console pages at 1280 and 1024', async ({ page }) => {
  const errors = watchConsole(page, 'responsive-console');
  const pages = ['app', 'scan', 'url', 'apk', 'graph', 'cases', 'reports'];
  for (const width of [1280, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of pages) {
      await page.goto(`/app${route === 'app' ? '' : `/${route}`}`);
      await page.waitForTimeout(250);
      const metrics = await scrollMetrics(page);
      assert.ok(metrics.scrollWidth <= metrics.width + 1, `${route} @${width} horizontal scroll: ${JSON.stringify(metrics)}`);
      const clipped = await page.evaluate(() => {
        const out: string[] = [];
        document.querySelectorAll<HTMLElement>('table, [role="table"], td, th, .entity-chip, .btn').forEach((el) => {
          if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
            out.push(`${el.tagName.toLowerCase()} ${el.className?.toString().slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
          }
        });
        return out.slice(0, 15);
      });
      console.log(`[EVIDENCE] ${route} @${width}: ${JSON.stringify(metrics)}, clipped=${JSON.stringify(clipped)}`);
      await shot(page, `console-${route}-${width}`);
    }
  }
  await noConsoleErrors(errors);
});

test('12 reduced motion landing has no curtain or parallax', async ({ page }) => {
  const errors = watchConsole(page, 'reduced-motion');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('hero-headline')).toBeVisible({ timeout: 6000 });
  assert.equal(await page.getByTestId('preloader').count(), 0, 'preloader curtain still rendered');
  const hiddenReveals = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-reveal]')].filter((el) => Number(getComputedStyle(el).opacity) < 0.99).length,
  );
  assert.equal(hiddenReveals, 0, `${hiddenReveals} reveal elements still hidden`);
  const transform = await page.evaluate(() => {
    const hero = document.querySelector<HTMLElement>('[data-testid="hero-headline"]');
    return hero ? getComputedStyle(hero).transform : 'none';
  });
  console.log(`[EVIDENCE] reduced motion: preloader=0, hiddenReveals=0, heroTransform=${transform}`);
  await shot(page, 'reduced-motion');
  await noConsoleErrors(errors);
});

test('13 theme defaults dark, toggles, persists and stays console-only', async ({ page }) => {
  const errors = watchConsole(page, 'theme-toggle');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('console-root')).toBeVisible();

  const state = () =>
    page.evaluate(() => ({
      html: document.documentElement.dataset.theme ?? 'none',
      root: document.querySelector<HTMLElement>('[data-testid="console-root"]')?.dataset.theme ?? 'none',
      bodyBg: getComputedStyle(document.body).backgroundColor,
      stored: (() => {
        try {
          return localStorage.getItem('trace:theme');
        } catch {
          return 'blocked';
        }
      })(),
    }));

  const dark = await state();
  assert.deepEqual(dark, { html: 'dark', root: 'dark', bodyBg: 'rgb(5, 5, 6)', stored: 'dark' });
  console.log(`[EVIDENCE] theme default: ${JSON.stringify(dark)}`);
  await shot(page, 'theme-default-dark');

  const html = await (await page.request.get('/app')).text();
  const bootstrapAt = html.indexOf('document.documentElement.dataset.theme');
  // Vite adds a cache-busting query to the dev module URL, so match the path
  // and ignore build/dev URL differences.
  const moduleAt = html.search(/<script[^>]*src="\/src\/main\.tsx(?:\?[^"]*)?"/);
  const stylesheetAt = html.indexOf('rel="stylesheet"');
  assert.ok(bootstrapAt > -1 && moduleAt > -1 && bootstrapAt < moduleAt, 'theme bootstrap is not before the app module');
  if (stylesheetAt >= 0) assert.ok(bootstrapAt < stylesheetAt, 'theme bootstrap is not before the stylesheet');
  console.log(`[EVIDENCE] no-flash bootstrap order: script=${bootstrapAt}, module=${moduleAt}, stylesheet=${stylesheetAt}`);

  await page.getByTestId('theme-toggle').click();
  await expect.poll(async () => (await state()).html, { timeout: 5000 }).toBe('light');
  const light = await state();
  assert.deepEqual(light, { html: 'light', root: 'light', bodyBg: 'rgb(250, 250, 250)', stored: 'light' });
  console.log(`[EVIDENCE] theme after toggle: ${JSON.stringify(light)}`);
  await shot(page, 'theme-light-console');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('console-root')).toBeVisible();
  assert.equal((await state()).html, 'light', 'light theme did not survive reload');

  await page.keyboard.press('Control+k');
  await expect(page.getByPlaceholder('Search cases, indicators, pages…')).toBeVisible();
  await page.getByPlaceholder('Search cases, indicators, pages…').fill('Switch to dark mode');
  await page.getByText('Switch to dark mode', { exact: true }).click();
  await expect.poll(async () => (await state()).html, { timeout: 5000 }).toBe('dark');
  console.log('[EVIDENCE] palette theme action switched light -> dark');

  await page.getByTestId('theme-toggle').click();
  await expect.poll(async () => (await state()).html, { timeout: 5000 }).toBe('light');
  await page.getByRole('link', { name: /TRACE v1\.0/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute('data-theme')), { timeout: 5000 }).toBe(false);
  const landingBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(landingBg, 'rgb(5, 5, 6)', `landing inherited light theme: ${landingBg}`);
  console.log(`[EVIDENCE] landing after console light: themeAttr=false, bodyBg=${landingBg}`);
  await shot(page, 'theme-landing-stays-dark');
  await noConsoleErrors(errors);
});

test('14 first-visit system preference is locked and blocked storage is safe', async ({ page }) => {
  const errors = watchConsole(page, 'theme-system');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('console-root')).toBeVisible();
  const first = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    stored: localStorage.getItem('trace:theme'),
  }));
  assert.deepEqual(first, { theme: 'light', stored: 'light' });

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('console-root')).toBeVisible();
  const locked = await page.evaluate(() => document.documentElement.dataset.theme);
  assert.equal(locked, 'light', 'system preference changed a stored theme');
  console.log(`[EVIDENCE] first visit=${JSON.stringify(first)}, after OS change=${locked}`);
  await noConsoleErrors(errors);

  const browser = page.context().browser();
  assert.ok(browser, 'Playwright browser is unavailable');
  const blockedContext = await browser.newContext({ colorScheme: 'dark' });
  const blocked = await blockedContext.newPage();
  const blockedErrors = watchConsole(blocked, 'theme-blocked-storage');
  await blocked.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('storage blocked for QA');
      },
    });
  });
  await blocked.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(blocked.getByTestId('console-root')).toBeVisible();
  const blockedTheme = await blocked.evaluate(() => document.documentElement.dataset.theme);
  assert.equal(blockedTheme, 'dark');
  console.log('[EVIDENCE] blocked localStorage rendered console with dark fallback');
  await shot(blocked, 'theme-blocked-storage');
  await noConsoleErrors(blockedErrors);
  await blockedContext.close();
});

test('15 PDF report output is unchanged by console theme', async ({ page }) => {
  const errors = watchConsole(page, 'theme-pdf');
  // This test owns its storage (it toggles themes), so start from a known
  // dark state instead of inheriting the browser's first-visit preference.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('trace:theme', 'dark');
    } catch {
      /* storage-blocked path is covered in test 14 */
    }
  });
  const raw = `QA THEME PDF ${Date.now()} URGENT SBI KYC http://sbi-kyc-verify.in kyc.support@fakebank`;
  const created = await page.request.post('/api/analyze/message', { data: { text: raw, save: true, title: 'QA Theme PDF Case' } });
  assert.ok(created.ok(), `case create failed: ${created.status()}`);
  const caseId = (await created.json()).caseId as string;

  await page.goto(`/app/cases/${caseId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('QA Theme PDF Case')).toBeVisible({ timeout: 10_000 });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark', 'first PDF was not generated in dark mode');

  const { PDFParse } = await import('pdf-parse');
  const { readFileSync } = await import('node:fs');
  const extract = async (name: string) => {
    const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Report PDF', exact: true }).click();
    const download = await downloadPromise;
    const path = join(ARTIFACTS, `${name}.pdf`);
    await download.saveAs(path);
    const parser = new PDFParse({ data: new Uint8Array(readFileSync(path)) });
    const parsed = await parser.getText();
    await parser.destroy();
    return parsed.text;
  };
  const normalize = (text: string) =>
    text
      // Pagination footers: the total page count grows when the download adds a
      // timeline event, so the second PDF can have one extra page/header.
      .replace(/--\s*\d+\s*of\s*\d+\s*--/g, '')
      // Repeated running headers (case id / report id / page no / timestamp).
      .replace(
        /T\s+R\s+A\s+C\s+E\s+TRC-[A-Z0-9-]+\s*\/\s*RPT-[A-Z0-9-]+\s+\d+\s+Deterministic rule-based analysis; no machine learning used\.\s+\w+, \d{1,2} \w+ \d{4} at \d{1,2}:\d{1,2}:\d+ [ap]m IST/g,
        '',
      )
      // Volatile "Report RPT-... generated" timeline row added by downloading.
      .replace(/\d{1,2}\s+[A-Za-z]{3},\s*\d{2}:\d{2}\s+report\s+Report\s+RPT-[A-Z0-9-]+\s+generated/g, '')
      .replace(/Generated .*? IST/gi, 'Generated <stamp> IST')
      .replace(/\w+, \d{1,2} \w+ \d{4} at \d{1,2}:\d{1,2}:\d+ [ap]m IST/g, '<timestamp>')
      .replace(/\d{1,2} [A-Za-z]{3}, \d{2}:\d{2}/g, '<short-timestamp>')
      .replace(/RPT-[A-Z0-9-]+/g, '<report-id>')
      .replace(/SHA-256\s+[a-f0-9]{64}/gi, 'SHA-256 <hash>')
      .replace(/\s+/g, ' ')
      .trim();

  const darkPdf = normalize(await extract('theme-pdf-dark'));
  assert.ok(darkPdf.includes('QA THEME PDF'), 'dark-theme PDF missing marker');
  await page.getByTestId('theme-toggle').click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme), { timeout: 5000 }).toBe('light');
  const lightPdf = normalize(await extract('theme-pdf-light'));
  assert.equal(lightPdf, darkPdf, 'console theme changed the PDF text content');
  console.log(`[EVIDENCE] PDF text identical across themes after variable fields (${darkPdf.length} chars)`);
  await shot(page, 'theme-pdf-light');
  await noConsoleErrors(errors);
});

test('16 console typography scales and scanner overlay aligns', async ({ page }) => {
  const errors = watchConsole(page, 'typography');
  await page.goto('/app/scan');
  await expect(page.getByTestId('console-root')).toBeVisible();

  const type = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('[data-testid="console-root"]')!;
    const small = root.querySelector<HTMLElement>('[class~="text-[9px]"]')!;
    const muted = root.querySelector<HTMLElement>('[class*="text-ink-3"]')!;
    return {
      rootFontSize: getComputedStyle(root).fontSize,
      rootWeight: getComputedStyle(root).fontWeight,
      smallFontSize: getComputedStyle(small).fontSize,
      mutedWeight: getComputedStyle(muted).fontWeight,
    };
  });
  assert.deepEqual(type, { rootFontSize: '17px', rootWeight: '500', smallFontSize: '11px', mutedWeight: '600' });
  console.log(`[EVIDENCE] console type tokens: ${JSON.stringify(type)}`);

  await page.getByLabel('Message evidence').fill(SCAM_SMS);
  await expect(page.getByTestId('highlight').first()).toBeVisible();

  for (const width of [1280, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    const metrics = await page.evaluate(() => {
      const overlay = document.querySelector<HTMLElement>('[data-testid="scanner-overlay"]')!;
      const input = document.querySelector<HTMLTextAreaElement>('[data-testid="scanner-input"]')!;
      const o = overlay.getBoundingClientRect();
      const i = input.getBoundingClientRect();
      const os = getComputedStyle(overlay);
      const is = getComputedStyle(input);
      return {
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        overlayRect: { left: o.left, top: o.top, width: o.width, height: o.height },
        inputRect: { left: i.left, top: i.top, width: i.width, height: i.height },
        fontSizes: [os.fontSize, is.fontSize],
        lineHeights: [os.lineHeight, is.lineHeight],
        overlayPadding: [os.paddingTop, os.paddingRight, os.paddingBottom, os.paddingLeft],
        inputPadding: [is.paddingTop, is.paddingRight, is.paddingBottom, is.paddingLeft],
        overlayBorder: os.borderTopWidth,
      };
    });
    assert.equal(metrics.scrollWidth, metrics.viewport, `scanner overflows at ${width}px`);
    assert.deepEqual(metrics.fontSizes, ['15px', '15px'], `font mismatch at ${width}px`);
    assert.equal(metrics.lineHeights[0], metrics.lineHeights[1], `line-height mismatch at ${width}px`);
    assert.deepEqual(metrics.overlayPadding, metrics.inputPadding, `padding mismatch at ${width}px`);
    assert.equal(metrics.overlayBorder, '0px', `overlay border offsets highlights at ${width}px`);
    for (const key of ['left', 'top', 'width', 'height'] as const) {
      assert.ok(
        Math.abs(metrics.overlayRect[key] - metrics.inputRect[key]) <= 0.5,
        `${key} misaligned at ${width}px: ${metrics.overlayRect[key]} vs ${metrics.inputRect[key]}`,
      );
    }
    console.log(`[EVIDENCE] scanner overlay @${width}: ${JSON.stringify(metrics)}`);
    await shot(page, `scanner-overlay-${width}`);
  }

  const input = page.getByTestId('scanner-input');
  await input.fill(`${SCAM_SMS}\n`.repeat(20));
  await input.evaluate((el: HTMLTextAreaElement) => {
    el.scrollTop = 120;
    el.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expect
    .poll(() => page.getByTestId('scanner-overlay').evaluate((el) => el.scrollTop), { timeout: 5000 })
    .toBe(120);
  console.log('[EVIDENCE] scanner overlay scroll follows textarea (120px)');

  await page.goto('/');
  const landing = await page.evaluate(() => ({
    consoleRoots: document.querySelectorAll('[data-testid="console-root"]').length,
    bodyFontSize: getComputedStyle(document.body).fontSize,
    sampleFontSize: getComputedStyle(document.querySelector<HTMLElement>('[class~="text-[12px]"]')!).fontSize,
  }));
  assert.deepEqual(landing, { consoleRoots: 0, bodyFontSize: '15px', sampleFontSize: '12px' });
  console.log(`[EVIDENCE] landing typography unchanged: ${JSON.stringify(landing)}`);
  await noConsoleErrors(errors);
});

test('17 scanner highlight marks align with the underlying text glyphs', async ({ page }) => {
  const errors = watchConsole(page, 'visual-overlay-alignment');
  await page.goto('/app/scan');
  await expect(page.getByTestId('console-root')).toBeVisible();
  await page.getByLabel('Message evidence').fill(SCAM_SMS);
  await expect(page.getByTestId('highlight').first()).toBeVisible();

  for (const width of [1280, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    const alignment = await page.evaluate(() => {
      const input = document.querySelector<HTMLTextAreaElement>('[data-testid="scanner-input"]')!;
      const overlay = document.querySelector<HTMLElement>('[data-testid="scanner-overlay"]')!;
      const mark = overlay.querySelector<HTMLElement>('[data-testid="highlight"]')!;
      const markText = mark.textContent ?? '';
      const idx = input.value.indexOf(markText);
      if (!markText || idx < 0) return { error: 'mark text missing from input' };

      // Re-render the textarea text in a hidden div using the textarea's exact
      // computed text metrics, then measure the same substring with a Range.
      const cs = getComputedStyle(input);
      const ir = input.getBoundingClientRect();
      const mirror = document.createElement('div');
      mirror.textContent = input.value;
      Object.assign(mirror.style, {
        position: 'fixed',
        left: `${ir.left}px`,
        top: `${ir.top}px`,
        width: `${ir.width}px`,
        height: `${ir.height}px`,
        boxSizing: 'border-box',
        padding: cs.padding,
        border: '0px solid transparent',
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        fontStyle: cs.fontStyle,
        lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word',
        wordBreak: 'break-word',
        pointerEvents: 'none',
        visibility: 'hidden',
      });
      document.body.appendChild(mirror);
      const range = document.createRange();
      range.setStart(mirror.firstChild!, idx);
      range.setEnd(mirror.firstChild!, idx + markText.length);
      const glyph = range.getClientRects()[0] ?? range.getBoundingClientRect();
      const mr = mark.getBoundingClientRect();
      mirror.remove();
      return {
        mark: { left: mr.left, top: mr.top, width: mr.width, height: mr.height },
        glyph: { left: glyph.left, top: glyph.top, width: glyph.width, height: glyph.height },
        text: markText,
      };
    });
    assert.ok(!('error' in alignment), alignment.error);
    assert.ok(
      Math.abs(alignment.mark.left - alignment.glyph.left) <= 1.5,
      `highlight x is offset at ${width}px: ${JSON.stringify(alignment)}`,
    );
    assert.ok(
      Math.abs(alignment.mark.width - alignment.glyph.width) <= 1.5,
      `highlight width differs at ${width}px: ${JSON.stringify(alignment)}`,
    );
    console.log(`[EVIDENCE] visual overlay alignment @${width}: ${JSON.stringify(alignment)}`);
    await shot(page, `visual-overlay-${width}`);
  }
  await noConsoleErrors(errors);
});
