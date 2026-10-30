import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { trimToastStack } from "./toastStack";

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
 * How long a toast that has to be read stays.
 *
 * Four seconds is fine for "copied"; it is not enough to notice that a machine
 * was deleted, decide to undo it, and reach the button, nor to read the reason
 * inside an error and act on it. A toast with an action is a question, and a
 * question that disappears while it is being read is a no. Errors are the one
 * kind whose message is the whole value, so they get the same time.
 */
const AUTO_DISMISS_LONG_MS = 12000;
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
        return trimToastStack(next, MAX_STACK);
      });
      const keepReading = action !== undefined || kind === "danger";
      window.setTimeout(
        () => dismiss(id),
        keepReading ? AUTO_DISMISS_LONG_MS : AUTO_DISMISS_MS,
      );
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
