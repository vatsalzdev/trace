import { ArrowUpRight, FileText, FolderOpen, GitBranch, Globe2, LayoutDashboard, PackageSearch, ScanLine } from 'lucide-react';

const NAV = [
  { icon: LayoutDashboard, label: 'Command Center', active: true },
  { icon: ScanLine, label: 'Message Scanner' },
  { icon: Globe2, label: 'URL Intelligence' },
  { icon: PackageSearch, label: 'APK Inspector' },
  { icon: GitBranch, label: 'Relationship Graph' },
  { icon: FolderOpen, label: 'Cases' },
  { icon: FileText, label: 'Reports' },
];

const ROWS = [
  { id: 'TRC-2026-0011', title: 'SBI KYC Update APK — banker trojan', source: 'APK', risk: 'HIGH', score: 100, entities: 12, age: '12d' },
  { id: 'TRC-2026-0007', title: 'Instant loan app — sideloaded APK', source: 'MSG', risk: 'HIGH', score: 95, entities: 7, age: '25d' },
  { id: 'TRC-2026-0003', title: 'SBI YONO re-activation with KYC fee', source: 'MSG', risk: 'HIGH', score: 90, entities: 6, age: '37d' },
  { id: 'TRC-2026-0008', title: 'SBI secure-login typosquat', source: 'URL', risk: 'HIGH', score: 100, entities: 4, age: '21d' },
];

export function ConsoleMock() {
  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-line-2 bg-bg-1 text-left shadow-[0_80px_140px_-50px_rgba(0,0,0,0.95)]">
      <div className="flex h-9 items-center gap-4 border-b border-line px-4">
        <span className="text-[9px] font-semibold tracking-[0.18em] text-ink">TRACE</span>
        <span className="mono text-[8px] text-ink-3">Console / Command Center</span>
        <div className="ml-auto flex items-center gap-3">
          <span className="mono text-[7.5px] uppercase tracking-[0.12em] text-ink-3">⌘K</span>
          <span className="flex items-center gap-1">
            <span className="h-1 w-1 rounded-full bg-ok" />
            <span className="mono text-[7px] uppercase tracking-[0.1em] text-ink-3">online</span>
          </span>
        </div>
      </div>
      <div className="flex">
        <div className="w-[148px] shrink-0 border-r border-line p-2.5">
          <div className="label mb-2 text-[7px]">Workspace</div>
          {NAV.map((item) => (
            <div
              key={item.label}
              className={`mb-0.5 flex items-center gap-2 rounded px-2 py-[5px] text-[8.5px] ${
                item.active ? 'bg-bg-2 text-ink' : 'text-ink-3'
              }`}
            >
              <item.icon size={9} strokeWidth={1.7} />
              {item.label}
              {item.active && <span className="ml-auto h-2.5 w-[1.5px] rounded bg-accent" />}
            </div>
          ))}
        </div>
        <div className="min-w-0 flex-1 p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[16px] font-medium tracking-[-0.03em] text-ink">Command Center</div>
              <div className="mono mt-0.5 text-[7.5px] text-ink-3">22 Nov 2026 · 30 day window · 14 cases indexed</div>
            </div>
            <div className="flex gap-1">
              {['7D', '30D', 'ALL'].map((t) => (
                <span key={t} className={`rounded px-1.5 py-0.5 text-[7px] ${t === '30D' ? 'bg-bg-3 text-ink' : 'text-ink-3'}`}>
                  {t}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-2">
            {[
              { label: 'Cases', value: '14', delta: '+4 this week' },
              { label: 'High risk', value: '12', delta: '86% of caseload' },
              { label: 'Indicators', value: '35', delta: '5 reused' },
              { label: 'Avg. risk', value: '83', delta: 'weighted mean' },
            ].map((s) => (
              <div key={s.label} className="rounded-md border border-line bg-bg-2 px-2.5 py-2">
                <div className="label text-[6.5px]">{s.label}</div>
                <div className="num mt-1 text-[17px] leading-none tracking-[-0.04em] text-ink">{s.value}</div>
                <div className="mono mt-1 text-[6.5px] text-ink-3">{s.delta}</div>
              </div>
            ))}
          </div>

          <div className="mt-2.5 grid grid-cols-[1.5fr_1fr] gap-2">
            <div className="rounded-md border border-line bg-bg-2 p-2.5">
              <div className="flex items-center justify-between">
                <div className="label text-[6.5px]">Threat activity</div>
                <div className="mono text-[6.5px] text-ink-3">cases / day</div>
              </div>
              <svg viewBox="0 0 300 88" className="mt-2 w-full">
                <defs>
                  <linearGradient id="mock-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8b8bff" stopOpacity="0.22" />
                    <stop offset="100%" stopColor="#8b8bff" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[18, 40, 62, 84].map((y) => (
                  <line key={y} x1="0" y1={y} x2="300" y2={y} stroke="rgba(255,255,255,0.045)" strokeWidth="0.5" />
                ))}
                <path
                  d="M0 72 C22 70 28 58 48 60 S78 40 96 46 S126 62 146 40 S176 26 196 34 S222 18 244 26 S276 12 300 18 L300 88 L0 88 Z"
                  fill="url(#mock-fill)"
                />
                <path
                  d="M0 72 C22 70 28 58 48 60 S78 40 96 46 S126 62 146 40 S176 26 196 34 S222 18 244 26 S276 12 300 18"
                  fill="none"
                  stroke="#8b8bff"
                  strokeWidth="1"
                  strokeOpacity="0.8"
                />
                <circle cx="244" cy="26" r="1.8" fill="#8b8bff" />
              </svg>
            </div>
            <div className="rounded-md border border-line bg-bg-2 p-2.5">
              <div className="label text-[6.5px]">Top recurring</div>
              <div className="mt-2 space-y-1.5">
                {[
                  ['kyc.support@fakebank', 'UPI', '5'],
                  ['sbi-kyc-verify.in', 'DOM', '5'],
                  ['9812345670', 'TEL', '5'],
                  ['185.62.190.44', 'IP', '3'],
                ].map(([value, type, count]) => (
                  <div key={value} className="flex items-center gap-1.5">
                    <span className="mono min-w-0 flex-1 truncate text-[7.5px] text-ink-2">{value}</span>
                    <span className="mono text-[6px] text-ink-3">{type}</span>
                    <span className="mono text-[6.5px] text-accent">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-2.5 overflow-hidden rounded-md border border-line bg-bg-2">
            <div className="grid grid-cols-[70px_1fr_40px_42px_32px_26px] items-center gap-2 border-b border-line px-2.5 py-1.5">
              {['CASE', 'TITLE', 'SOURCE', 'RISK', 'ENT', 'AGE'].map((h) => (
                <span key={h} className="mono text-[5.8px] tracking-[0.1em] text-ink-3">
                  {h}
                </span>
              ))}
            </div>
            {ROWS.map((row) => (
              <div
                key={row.id}
                className="grid grid-cols-[70px_1fr_40px_42px_32px_26px] items-center gap-2 border-b border-line/60 px-2.5 py-[6px] last:border-0"
              >
                <span className="mono text-[6.5px] text-ink-3">{row.id}</span>
                <span className="truncate text-[7.5px] text-ink-2">{row.title}</span>
                <span className="mono text-[6px] text-ink-3">{row.source}</span>
                <span className="mono text-[6px] text-danger">{row.risk}</span>
                <span className="mono text-[6.5px] text-ink-3">{row.entities}</span>
                <span className="mono text-[6px] text-ink-3">{row.age}</span>
              </div>
            ))}
          </div>

          <div className="mt-2 flex items-center justify-between">
            <span className="mono text-[6.5px] text-ink-3">Every score is the sum of documented rule weights.</span>
            <span className="flex items-center gap-1 text-[7px] text-ink-2">
              Open case <ArrowUpRight size={7} />
            </span>
          </div>
        </div>
      </div>
      <div className="scanline" />
    </div>
  );
}
