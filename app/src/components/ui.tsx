import { useEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Cat, Dog, LoaderCircle, Rabbit, X } from 'lucide-react';
import type { Species, Status } from '../lib/types';
import { STATUS_LABEL } from '../lib/format';

// ---------------------------------------------------------------- buttons
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode;
};
export function Button({ variant = 'secondary', size = 'md', loading, icon, children, className = '', disabled, ...rest }: BtnProps) {
  return (
    <button className={`btn btn-${variant} btn-${size} ${className}`} disabled={disabled || loading} {...rest}>
      {loading ? <LoaderCircle className="spin" size={16} /> : icon}
      {children && <span>{children}</span>}
    </button>
  );
}

// ---------------------------------------------------------------- fields
interface FieldProps { label: string; error?: string; hint?: string; children: ReactNode; className?: string; required?: boolean }
export function Field({ label, error, hint, children, className = '', required }: FieldProps) {
  return (
    <label className={`field ${error ? 'has-error' : ''} ${className}`}>
      <span className="field-label">{label}{required && <i aria-hidden="true"> *</i>}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input className="input" {...p} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select className="input" {...p} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className="input" rows={3} {...p} />;

// ---------------------------------------------------------------- badges
export function StatusBadge({ status }: { status: Status }) {
  return <span className={`status status-${status}`}><i />{STATUS_LABEL[status]}</span>;
}
export function PlanBadge({ plan }: { plan: string | null }) {
  return plan ? <span className="pill pill-plan">{plan}</span> : <span className="pill">Particular</span>;
}
export function SpeciesIcon({ species, size = 18 }: { species: Species; size?: number }) {
  const I = species === 'gato' ? Cat : species === 'outro' ? Rabbit : Dog;
  return <span className={`species species-${species}`}><I size={size} strokeWidth={1.8} /></span>;
}

// ---------------------------------------------------------------- feedback
export function Spinner({ label = 'Carregando…' }: { label?: string }) {
  return <div className="loading"><LoaderCircle className="spin" size={20} /><span>{label}</span></div>;
}
export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

// ---------------------------------------------------------------- overlays
export function Drawer({ open, onClose, title, children, footer, wide }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className={`drawer ${wide ? 'drawer-wide' : ''}`} role="dialog" aria-modal="true">
        <header className="drawer-head">
          <div className="drawer-title">{title}</div>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </header>
        <div className="drawer-body">{children}</div>
        {footer && <footer className="drawer-foot">{footer}</footer>}
      </aside>
    </div>,
    document.body
  );
}

export function Confirm({ open, title, text, confirmLabel, danger, onConfirm, onCancel, busy, children }: {
  open: boolean; title: string; text: string; confirmLabel: string; danger?: boolean;
  onConfirm: () => void; onCancel: () => void; busy?: boolean; children?: ReactNode;
}) {
  useEscape(open, onCancel);
  if (!open) return null;
  return createPortal(
    <div className="overlay overlay-center" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog" role="alertdialog" aria-modal="true">
        <h2>{title}</h2>
        <p>{text}</p>
        {children && <div className="dialog-extra">{children}</div>}
        <div className="dialog-actions">
          <Button onClick={onCancel}>Voltar</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function useEscape(active: boolean, fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && ref.current();
    document.addEventListener('keydown', h);
    document.body.classList.add('no-scroll');
    return () => { document.removeEventListener('keydown', h); document.body.classList.remove('no-scroll'); };
  }, [active]);
}

// ---------------------------------------------------------------- toasts
type Toast = { id: number; text: string; kind: 'ok' | 'error' };
let push: (t: Omit<Toast, 'id'>) => void = () => {};
export const toast = {
  ok: (text: string) => push({ text, kind: 'ok' }),
  error: (text: string) => push({ text, kind: 'error' })
};
export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    let n = 0;
    push = (t) => {
      const id = ++n;
      setItems((xs) => [...xs.slice(-2), { ...t, id }]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4200);
    };
  }, []);
  return createPortal(
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>)}
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------- misc
export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? 'is-active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
