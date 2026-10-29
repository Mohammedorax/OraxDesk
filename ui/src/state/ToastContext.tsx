import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastKind = "info" | "success" | "warning" | "danger";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastContextValue {
  toasts: Toast[];
  push: (kind: ToastKind, message: string, action?: { label: string; run: () => void }) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 4000;
/**
 * How long a toast offering an action stays.
 *
 * Four seconds is fine for "copied"; it is not enough to notice that a machine
 * was deleted, decide to undo it, and reach the button. A toast with an action
 * is a question, and a question that disappears while it is being read is a
 * no. Destructive toasts all carry Undo, so this is the one that matters.
 */
const AUTO_DISMISS_ACTION_MS = 12000;
const MAX_STACK = 3;

export function ToastProvider({ children }: { children: ReactNode }): ReactNode {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string, action?: { label: string; run: () => void }) => {
      const id = nextId.current++;
      setToasts((prev) => {
        const next = [
          ...prev,
          { id, kind, message, actionLabel: action?.label, onAction: action?.run },
        ];
        return next.slice(-MAX_STACK);
      });
      window.setTimeout(() => dismiss(id), action ? AUTO_DISMISS_ACTION_MS : AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToasts(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToasts outside ToastProvider");
  return ctx;
}
