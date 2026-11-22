import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { EntityDrawerProvider } from '@/components/EntityDrawer';
import { Shell } from '@/components/Shell';
import { ToastProvider } from '@/components/Toast';
import Landing from '@/landing/Landing';
import ApkInspector from '@/pages/ApkInspector';
import CaseDetail from '@/pages/CaseDetail';
import Cases from '@/pages/Cases';
import CommandCenter from '@/pages/CommandCenter';
import Graph from '@/pages/Graph';
import MessageScanner from '@/pages/MessageScanner';
import Reports from '@/pages/Reports';
import UrlIntelligence from '@/pages/UrlIntelligence';

function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-6 text-center text-ink">
      <div className="mono text-[10px] uppercase tracking-[0.18em] text-ink-3">404 · Trace</div>
      <h1 className="text-[32px] font-medium tracking-[-0.035em]">Page not found</h1>
      <p className="max-w-[44ch] text-[13px] text-ink-2">
        That address is not part of the investigation console. Return to the command centre to continue.
      </p>
      <Link to="/app" className="btn btn-primary h-9 px-4">
        Open console
      </Link>
    </main>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <EntityDrawerProvider>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/app" element={<Shell />}>
              <Route index element={<CommandCenter />} />
              <Route path="scan" element={<MessageScanner />} />
              <Route path="url" element={<UrlIntelligence />} />
              <Route path="apk" element={<ApkInspector />} />
              <Route path="graph" element={<Graph />} />
              <Route path="cases" element={<Cases />} />
              <Route path="cases/:id" element={<CaseDetail />} />
              <Route path="reports" element={<Reports />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </EntityDrawerProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
