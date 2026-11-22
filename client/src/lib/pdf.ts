import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ReportPayload } from '@shared/types';
import { shortDate, shortDateTime } from './format';

function ascii(value: unknown): string {
  return String(value ?? '')
    .replace(/₹/g, 'Rs ')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[—–]/g, '-')
    .replace(/·/g, '|')
    .replace(/…/g, '...');
}

const INK: [number, number, number] = [16, 16, 20];
const MUTED: [number, number, number] = [108, 108, 118];
const ACCENT: [number, number, number] = [110, 110, 235];
const HAIR: [number, number, number] = [226, 226, 232];

export function buildReportPdf(payload: ReportPayload): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  const c = payload.case;
  const analysis = payload.analysis as any;

  /* ------------------------------- cover -------------------------------- */
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, W, H, 'F');
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.setCharSpace(4);
  doc.text('TRACE', M, 92);
  doc.setCharSpace(0);

  doc.setDrawColor(...ACCENT);
  doc.setLineWidth(1.4);
  doc.line(M, 112, M + 64, 112);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.setCharSpace(1.6);
  doc.text('CYBERCRIME INVESTIGATION REPORT', M, 134);
  doc.setCharSpace(0);

  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(ascii(c.id), M, 250);

  doc.setFontSize(27);
  const titleLines = doc.splitTextToSize(ascii(c.title), W - M * 2);
  doc.text(titleLines, M, 282);

  let y = 282 + titleLines.length * 31 + 16;
  doc.setDrawColor(...HAIR);
  doc.setLineWidth(0.8);
  doc.line(M, y, W - M, y);
  y += 24;

  const meta: [string, string][] = [
    ['Risk', `${c.risk_label}  (${c.risk_score}/100)`],
    ['Source', c.source_type.toUpperCase()],
    ['Status', c.status.toUpperCase()],
    ['Created', shortDate(c.created_at)],
    ['Generated', payload.generatedAtIst],
    ['Analyst', payload.analyst],
    ['Indicators', String(payload.entities.length)],
    ['Report ID', payload.reportId],
  ];
  doc.setFontSize(9);
  meta.forEach(([k, v], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = M + col * ((W - M * 2) / 2);
    const yy = y + row * 34;
    doc.setTextColor(...MUTED);
    doc.setFont('helvetica', 'normal');
    doc.text(ascii(k).toUpperCase(), x, yy);
    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'bold');
    doc.text(ascii(v), x, yy + 14);
  });

  doc.setDrawColor(...HAIR);
  doc.line(M, H - 92, W - M, H - 92);
  doc.setTextColor(...MUTED);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  const coverNote = doc.splitTextToSize(
    'Deterministic, explainable analysis. No machine learning or generative model produced any finding in this report. Scores are sums of documented rule weights capped at 100.',
    W - M * 2,
  );
  doc.text(coverNote, M, H - 76);
  doc.setFont('courier', 'normal');
  doc.setFontSize(7);
  doc.text(`SHA-256  ${payload.integrityHash}`, M, H - 42);

  /* --------------------------- content pages ---------------------------- */
  doc.addPage();
  let page = 2;
  let cursorY = 0;

  const headerFooter = () => {
    doc.setDrawColor(...HAIR);
    doc.setLineWidth(0.6);
    doc.line(M, 40, W - M, 40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...INK);
    doc.setCharSpace(2);
    doc.text('TRACE', M, 32);
    doc.setCharSpace(0);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MUTED);
    doc.text(`${c.id}  /  ${payload.reportId}`, M + 52, 32);
    doc.text(`${page}`, W - M, 32, { align: 'right' });
    doc.line(M, H - 40, W - M, H - 40);
    doc.setFontSize(7);
    doc.text('Deterministic rule-based analysis; no machine learning used.', M, H - 28);
    doc.text(payload.generatedAtIst, W - M, H - 28, { align: 'right' });
  };
  headerFooter();
  cursorY = 68;

  const ensure = (space: number) => {
    if (cursorY + space > H - 64) {
      doc.addPage();
      page += 1;
      headerFooter();
      cursorY = 68;
    }
  };

  const heading = (num: string, title: string) => {
    ensure(56);
    doc.setTextColor(...ACCENT);
    doc.setFont('courier', 'bold');
    doc.setFontSize(9);
    doc.text(num, M, cursorY);
    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text(ascii(title), M + 26, cursorY + 1);
    doc.setDrawColor(...HAIR);
    doc.setLineWidth(0.7);
    doc.line(M, cursorY + 14, W - M, cursorY + 14);
    cursorY += 32;
  };

  const body = (text: string, size = 9.4) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    doc.setTextColor(48, 48, 56);
    const lines = doc.splitTextToSize(ascii(text), W - M * 2);
    ensure(lines.length * (size + 4) + 8);
    doc.text(lines, M, cursorY);
    cursorY += lines.length * (size + 4) + 10;
  };

  const monoBlock = (text: string) => {
    doc.setFont('courier', 'normal');
    doc.setFontSize(7.8);
    const lines = doc.splitTextToSize(ascii(text), W - M * 2 - 20);
    const boxH = Math.min(lines.length * 11 + 18, H - 140);
    ensure(boxH + 10);
    doc.setFillColor(247, 247, 249);
    doc.setDrawColor(...HAIR);
    doc.roundedRect(M, cursorY - 10, W - M * 2, boxH, 3, 3, 'FD');
    doc.setTextColor(30, 30, 36);
    doc.text(lines.slice(0, Math.floor((boxH - 18) / 11)), M + 10, cursorY + 6);
    cursorY += boxH + 12;
  };

  const table = (head: string[], rows: string[][], widths: Record<number, number>, fontSize = 7.6) => {
    autoTable(doc, {
      startY: cursorY,
      head: [head],
      body: rows,
      margin: { left: M, right: M, top: 56, bottom: 52 },
      styles: {
        font: 'helvetica',
        fontSize,
        cellPadding: { top: 5, bottom: 5, left: 6, right: 6 },
        textColor: [40, 40, 48],
        lineColor: [230, 230, 236],
        lineWidth: 0.4,
        overflow: 'linebreak',
      },
      headStyles: {
        fillColor: [14, 14, 18],
        textColor: [245, 245, 248],
        fontSize: 7,
        fontStyle: 'bold',
        lineWidth: 0,
      },
      alternateRowStyles: { fillColor: [249, 249, 251] },
      columnStyles: Object.fromEntries(Object.entries(widths).map(([k, v]) => [k, { cellWidth: v }])),
      didDrawPage: () => {
        if (doc.getNumberOfPages() > page) {
          page = doc.getNumberOfPages();
          headerFooter();
        }
      },
    });
    cursorY = (doc as any).lastAutoTable.finalY + 18;
  };

  /* 1 — executive summary */
  heading('01', 'Executive summary');
  body(
    `${c.id} is a ${c.risk_label.toLowerCase()}-risk ${c.source_type} case scoring ${c.risk_score}/100. ${payload.rules.length} detection rule${payload.rules.length === 1 ? '' : 's'} triggered, and ${payload.entities.length} indicator${payload.entities.length === 1 ? '' : 's'} were extracted and normalised into the entity index.`,
  );
  if (payload.correlations.length) {
    body(
      `Entity correlation found ${payload.correlations.length} indicator${payload.correlations.length === 1 ? '' : 's'} reused across other cases. Reuse is the strongest link between otherwise separate complaints: ${payload.correlations
        .slice(0, 3)
        .map((x) => `${x.type} ${x.value}`)
        .join('; ')}.`,
    );
  } else {
    body('No indicator in this case currently appears in another case. Correlation will strengthen as related complaints are ingested.');
  }
  if (analysis?.summary) body(analysis.summary);

  /* 2 — original input */
  heading('02', 'Original input');
  body('The following is the evidence exactly as submitted. It has not been rewritten or summarised.', 8.6);
  monoBlock(c.raw_input);

  /* 3 — rules */
  heading('03', 'Detection rules triggered');
  if (payload.rules.length) {
    table(
      ['Rule', 'Wt', 'Evidence', 'Why it matters'],
      payload.rules.map((r: any) => [
        ascii(r.name ?? r.id),
        String(r.weight ?? ''),
        ascii((r.evidence ?? []).join('\n') || '—'),
        ascii(r.explanation ?? ''),
      ]),
      { 0: 92, 1: 24, 2: 208, 3: 175 },
    );
    body(`Total weight: ${payload.rules.reduce((s: number, r: any) => s + (r.weight ?? 0), 0)} (capped at 100).`, 8.4);
  } else {
    body('No rules triggered. This is a negative result, not a certification of legitimacy.');
  }

  /* 4 — indicators */
  heading('04', 'Extracted indicators');
  if (payload.entities.length) {
    table(
      ['Type', 'Value', 'Cases', 'Risk'],
      payload.entities.map((e) => [ascii(e.type), ascii(e.value), String(e.cases), String(e.risk)]),
      { 0: 74, 1: 300, 2: 50, 3: 50 },
    );
  } else {
    body('No normalised indicators were extracted from this evidence.');
  }

  /* 5 — correlation */
  heading('05', 'Entity correlation');
  if (payload.correlations.length) {
    body('These indicators appear in more than one case. They are the pivot points for expanding the investigation.');
    table(
      ['Indicator', 'Type', 'Cases'],
      payload.correlations.map((x) => [ascii(x.value), ascii(x.type), ascii(x.cases.join('\n'))]),
      { 0: 210, 1: 66, 2: 223 },
    );
  } else {
    body('No shared indicators across cases at time of generation.');
  }

  /* 6 — technical */
  heading('06', 'Technical analysis');
  if (Array.isArray(analysis?.heuristics) && analysis.heuristics.length) {
    table(
      ['Check', 'Wt', 'Result', 'Evidence'],
      analysis.heuristics.map((h: any) => [
        ascii(h.name),
        String(h.weight),
        h.triggered ? 'FLAG' : 'PASS',
        ascii((h.evidence ?? []).join('; ') || h.explanation || '—'),
      ]),
      { 0: 118, 1: 24, 2: 38, 3: 319 },
    );
    if (analysis.breakdown) {
      body(
        `Breakdown: protocol ${analysis.breakdown.protocol}; subdomain ${analysis.breakdown.subdomain || '(none)'}; domain ${analysis.breakdown.domain}; TLD ${analysis.breakdown.tld}; path ${analysis.breakdown.path || '/'}; query ${analysis.breakdown.query || '(none)'}.`,
        8.6,
      );
    }
    if (analysis.enrichment) {
      const e = analysis.enrichment;
      body(
        `Registration: ${e.registration.registrar}; created ${e.registration.createdAt ? shortDate(e.registration.createdAt) : 'unknown'} (${e.registration.ageDays ?? '?'} days); mode ${e.mode}. DNS A: ${(e.dns?.a ?? []).join(', ') || 'none'}. TLS issuer: ${e.tls?.issuer ?? 'unknown'}. Redirects: ${(e.redirects ?? []).map((r: any) => `${r.status} ${r.url}`).join(' -> ')}.`,
        8.4,
      );
    }
  } else if (Array.isArray(analysis?.permissions)) {
    table(
      ['Permission', 'Dangerous', 'Wt', 'Reason'],
      analysis.permissions.map((p: any) => [ascii(p.name), p.dangerous ? 'YES' : 'no', String(p.weight), ascii(p.reason)]),
      { 0: 180, 1: 44, 2: 22, 3: 253 },
    );
    body(
      `Package ${analysis.packageName} v${analysis.versionName} (code ${analysis.versionCode}); minSdk ${analysis.minSdk}; targetSdk ${analysis.targetSdk}; manifest ${analysis.manifestFormat.toUpperCase()}; ${analysis.components.length} components.`,
      8.6,
    );
    body(`SHA-256: ${analysis.sha256}\nMD5: ${analysis.md5}\nCertificate: ${analysis.certificate?.present ? 'present' : 'absent'}${analysis.certificate?.debugSigned ? ' (debug-signed)' : ''}.`, 7.8);
  } else if (Array.isArray(analysis?.keywords) && analysis.keywords.length) {
    table(
      ['Category', 'Matched text'],
      analysis.keywords.map((k: any) => [ascii(k.category), ascii(k.matches.join(', '))]),
      { 0: 96, 1: 403 },
    );
  } else {
    body('No additional technical detail recorded for this source type.');
  }

  /* 7 — timeline */
  heading('07', 'Investigation timeline');
  if (payload.timeline.length) {
    table(
      ['When', 'Type', 'Event'],
      [...payload.timeline]
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((e) => [ascii(shortDateTime(e.created_at)), ascii(e.type), ascii(e.message)]),
      { 0: 110, 1: 70, 2: 319 },
    );
  } else {
    body('No events recorded.');
  }

  /* 8 — notes */
  heading('08', 'Analyst notes');
  body(payload.notes || 'No analyst notes recorded.');

  /* 9 — methodology */
  heading('09', 'Methodology & integrity');
  body(payload.methodology);
  body(
    'TRACE applies deterministic pattern extraction and weighted rules. Each score is the sum of triggered weights, capped at 100, with the exact matched evidence retained. Network enrichment (RDAP, DNS, TLS, redirects) uses a four-second budget per source and falls back to documented local fixtures; the report states whether live or cached data was used.',
    8.8,
  );
  ensure(46);
  doc.setFont('courier', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(...MUTED);
  doc.text('REPORT PAYLOAD SHA-256', M, cursorY);
  doc.setTextColor(...INK);
  doc.text(payload.integrityHash, M, cursorY + 12);
  cursorY += 30;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text(`Generated ${payload.generatedAt} (${payload.generatedAtIst}).`, M, cursorY);

  return doc;
}

export function downloadReportPdf(payload: ReportPayload): void {
  const doc = buildReportPdf(payload);
  doc.save(`${payload.case.id}-trace-report.pdf`);
}
