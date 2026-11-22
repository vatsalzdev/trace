import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Info, TriangleAlert, X } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

const ToastContext = createContext<{ toast: (message: string, kind?: ToastKind) => void }>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, message, kind }].slice(-3));
    window.setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-5 right-5 z-[220] flex w-[320px] flex-col gap-2">
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, transition: { duration: 0.15 } }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              className="glass flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-[12.5px] text-ink"
              data-testid="toast"
            >
              <span className="mt-0.5 shrink-0">
                {item.kind === 'success' ? (
                  <Check size={14} className="text-ok" />
                ) : item.kind === 'error' ? (
                  <TriangleAlert size={14} className="text-danger" />
                ) : (
                  <Info size={14} className="text-accent" />
                )}
              </span>
              <span className="leading-snug text-ink-2">{item.message}</span>
              <button
                onClick={() => setItems((prev) => prev.filter((t) => t.id !== item.id))}
                className="ml-auto mt-0.5 text-ink-3 transition-colors hover:text-ink"
                aria-label="Dismiss"
              >
                <X size={12} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
