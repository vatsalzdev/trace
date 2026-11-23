import type { EntityType, RiskLabel } from '@shared/types';

export function riskClass(label?: RiskLabel | string): string {
  if (label === 'HIGH') return 'risk-pill risk-high';
  if (label === 'MEDIUM') return 'risk-pill risk-medium';
  return 'risk-pill risk-low';
}

export function riskColor(label?: RiskLabel | string): string {
  if (label === 'HIGH') return 'var(--danger)';
  if (label === 'MEDIUM') return 'var(--warn)';
  return 'var(--ok)';
}

export function verdictText(verdict?: string): string {
  return (verdict ?? 'NO_INDICATORS').replace(/_/g, ' ');
}

export function verdictColor(verdict?: string): string {
  if (verdict === 'MALICIOUS') return 'var(--danger)';
  if (verdict === 'SUSPICIOUS') return 'var(--warn)';
  if (verdict === 'INCONCLUSIVE') return 'var(--ink-3)';
  return 'var(--ok)';
}

export function relativeTime(iso: string): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

export function shortDate(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function shortDateTime(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function istStamp(): string {
  return `${new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date())} IST`;
}

export function truncate(value: string, max = 42): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export const ENTITY_META: Record<EntityType | 'case', { label: string; short: string; color: string; shape: string }> = {
  domain: { label: 'Domain', short: 'DOM', color: 'var(--entity-domain)', shape: 'rounded' },
  url: { label: 'URL', short: 'URL', color: 'var(--entity-url)', shape: 'rounded' },
  phone: { label: 'Phone', short: 'TEL', color: 'var(--entity-phone)', shape: 'pill' },
  upi: { label: 'UPI ID', short: 'UPI', color: 'var(--entity-upi)', shape: 'pill' },
  email: { label: 'Email', short: 'EML', color: 'var(--entity-email)', shape: 'rounded' },
  package: { label: 'Package', short: 'PKG', color: 'var(--entity-package)', shape: 'square' },
  apk_hash: { label: 'APK hash', short: 'HASH', color: 'var(--entity-package)', shape: 'square' },
  ip: { label: 'IP address', short: 'IP', color: 'var(--entity-ip)', shape: 'circle' },
  wallet: { label: 'Wallet', short: 'WLT', color: 'var(--entity-wallet)', shape: 'circle' },
  ifsc: { label: 'IFSC', short: 'IFSC', color: 'var(--entity-ifsc)', shape: 'rounded' },
  account: { label: 'Account', short: 'ACC', color: 'var(--entity-account)', shape: 'rounded' },
  case: { label: 'Case', short: 'CASE', color: 'var(--entity-case)', shape: 'square' },
};

export function entityLabel(type: EntityType | 'case'): string {
  return ENTITY_META[type]?.label ?? type;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
