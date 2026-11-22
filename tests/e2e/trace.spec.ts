import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { expect, test, type Page } from '@playwright/test';

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
  const path = join(SCREENSHOTS, `${name}.png`);
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

  await page.locator('.react-flow__node-entity').first().click({ force: true });
  await expect(page.getByRole('dialog', { name: 'Entity details' })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');
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
