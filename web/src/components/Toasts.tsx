import { useCallback, useEffect, useRef, useState } from "react";

export type ToastKind = "pending" | "success" | "error" | "info";
export type ToastItem = { id: number; kind: ToastKind; title: string; detail?: string; hash?: string; until?: number };

/** How long a finished notification stays on screen. Pending ones stay until their transaction resolves. */
export const TOAST_MS = 5000;

/**
 * Notification stack state. Every wallet action is one item that moves pending -> success or error, and a finished
 * item disappears after TOAST_MS. Hovering the stack pauses the countdown so a message can be read or copied.
 */
export function useToasts() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const hovered = useRef(false);

  const push = useCallback((t: Omit<ToastItem, "id">) => {
    const id = nextId.current++;
    const until = t.kind === "pending" ? undefined : Date.now() + TOAST_MS;
    setItems((l) => [...l.slice(-5), { ...t, id, until }]);
    return id;
  }, []);

  const update = useCallback((id: number, patch: Partial<Omit<ToastItem, "id">>) => {
    setItems((l) =>
      l.map((t) => {
        if (t.id !== id) return t;
        const next = { ...t, ...patch };
        next.until = next.kind === "pending" ? undefined : Date.now() + TOAST_MS;
        return next;
      }),
    );
  }, []);

  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);

  const setHover = useCallback((on: boolean) => {
    hovered.current = on;
    if (!on) setItems((l) => l.map((t) => (t.until ? { ...t, until: Date.now() + TOAST_MS } : t)));
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (hovered.current) return;
      const now = Date.now();
      setItems((l) => (l.some((t) => t.until && t.until <= now) ? l.filter((t) => !t.until || t.until > now) : l));
    }, 250);
    return () => clearInterval(timer);
  }, []);

  return { items, push, update, dismiss, setHover };
}

export function ToastStack({ items, explorerTx, onDismiss, onHover }: { items: ToastItem[]; explorerTx: (hash: string) => string; onDismiss: (id: number) => void; onHover: (on: boolean) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="toasts" role="region" aria-label="Notifications" onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
      {items.map((t) => (
        <div key={t.id} className={`toast-item ${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
          <span className="tdot" aria-hidden="true" />
          <div className="tbody">
            <b>{t.title}</b>
            {t.detail && <span>{t.detail}</span>}
            {t.hash && <a href={explorerTx(t.hash)} target="_blank" rel="noreferrer">View transaction</a>}
          </div>
          <button className="tclose" onClick={() => onDismiss(t.id)} aria-label="Dismiss">×</button>
        </div>
      ))}
    </div>
  );
}
