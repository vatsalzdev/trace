import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
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
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </EntityDrawerProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
