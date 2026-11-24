import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { clsx } from 'clsx'
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react'

// ───────────── Logo ─────────────
export function ZaionMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="var(--brand)" />
      <path d="M20 18H47L46 24.5L29.5 39.5H44.5L42.5 46H17L18 39.5L34.5 24.5H18.5Z" fill="#0B1120" />
    </svg>
  )
}

// ───────────── Botões ─────────────
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap',
        size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-4 text-sm',
        variant === 'primary' && 'bg-brand text-[#06281d] hover:bg-brand-strong hover:text-white',
        variant === 'secondary' && 'border border-line bg-card text-fg hover:bg-card-hover',
        variant === 'ghost' && 'text-muted hover:bg-card hover:text-fg',
        variant === 'danger' && 'border border-bad/40 bg-bad/10 text-bad hover:bg-bad/20',
        className
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  )
}

// ───────────── Layout ─────────────
export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="animate-in mx-auto max-w-[1400px] px-8 py-7">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="space-y-5">{children}</div>
    </div>
  )
}

export function Card({ title, subtitle, actions, children, className, padded = true }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={clsx('rounded-xl border border-line bg-card', className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div>
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  )
}

export function Stat({ label, value, hint, tone, icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'brand'; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <div className="flex items-center justify-between text-xs font-medium text-muted">
        <span>{label}</span>
        {icon && <span className="text-muted">{icon}</span>}
      </div>
      <div
        className={clsx(
          'tabular mt-2 text-2xl font-semibold tracking-tight',
          tone === 'ok' && 'text-ok',
          tone === 'warn' && 'text-warn',
          tone === 'bad' && 'text-bad',
          tone === 'brand' && 'text-brand'
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  )
}

export function Badge({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'brand' | 'info'; children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        tone === 'neutral' && 'bg-line/60 text-muted',
        tone === 'ok' && 'bg-ok/15 text-ok',
        tone === 'warn' && 'bg-warn/15 text-warn',
        tone === 'bad' && 'bg-bad/15 text-bad',
        tone === 'brand' && 'bg-brand-soft text-brand',
        tone === 'info' && 'bg-info/15 text-info',
        className
      )}
    >
      {children}
    </span>
  )
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-12 text-center">
      {icon && <div className="mb-3 text-muted">{icon}</div>}
      <div className="text-sm font-semibold">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Loading({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-muted justify-center">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  )
}

export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'bad' | 'ok'; title?: string; children: ReactNode }) {
  const Icon = tone === 'warn' ? AlertTriangle : tone === 'bad' ? XCircle : tone === 'ok' ? CheckCircle2 : Info
  return (
    <div
      className={clsx(
        'flex gap-3 rounded-xl border px-4 py-3 text-sm',
        tone === 'info' && 'border-info/30 bg-info/5',
        tone === 'warn' && 'border-warn/30 bg-warn/5',
        tone === 'bad' && 'border-bad/30 bg-bad/5',
        tone === 'ok' && 'border-ok/30 bg-ok/5'
      )}
    >
      <Icon className={clsx('mt-0.5 h-4 w-4 shrink-0', tone === 'info' && 'text-info', tone === 'warn' && 'text-warn', tone === 'bad' && 'text-bad', tone === 'ok' && 'text-ok')} />
      <div>
        {title && <div className="font-semibold">{title}</div>}
        <div className="text-muted [&_strong]:text-fg">{children}</div>
      </div>
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <Notice tone="bad" title="Não foi possível carregar">
      {error}
      {onRetry && (
        <div className="mt-2">
          <Button size="sm" onClick={onRetry}>
            Tentar novamente
          </Button>
        </div>
      )}
    </Notice>
  )
}

// ───────────── Formulários ─────────────
export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  )
}

const inputCls = 'h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg placeholder:text-muted/70 focus:border-brand focus:outline-none'

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx(inputCls, props.className)} />
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx(inputCls, 'h-auto py-2 font-mono text-[13px] leading-relaxed', props.className)} />
}

export function Select({ options, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { options: Array<{ value: string | number; label: string }> }) {
  return (
    <select {...props} className={clsx(inputCls, 'pr-8', props.className)}>
      {options.map((o) => (
        <option key={String(o.value)} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={clsx('inline-flex cursor-pointer items-center gap-2.5 text-sm', disabled && 'opacity-50 cursor-not-allowed')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx('relative h-5 w-9 rounded-full transition-colors', checked ? 'bg-brand' : 'bg-line')}
      >
        <span className={clsx('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
      {label}
    </label>
  )
}

export function Chips({ options, value, onChange }: { options: Array<{ value: string | number; label: string }>; value: Array<string | number>; onChange: (v: Array<string | number>) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.value)
        return (
          <button
            type="button"
            key={String(o.value)}
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={clsx('rounded-md border px-2.5 py-1 text-xs transition-colors', on ? 'border-brand bg-brand-soft text-brand' : 'border-line text-muted hover:text-fg')}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: Array<{ value: T; label: string }> }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={clsx('rounded-md px-3 py-1.5 text-xs font-medium transition-colors', value === t.value ? 'bg-card text-fg shadow-sm' : 'text-muted hover:text-fg')}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ───────────── Modal ─────────────
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] p-6" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={clsx('animate-in flex max-h-[90vh] w-full flex-col rounded-2xl border border-line bg-surface shadow-2xl', wide ? 'max-w-4xl' : 'max-w-lg')}
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-card hover:text-fg" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>
  )
}

// ───────────── Toasts & confirmação ─────────────
type Toast = { id: number; tone: 'ok' | 'bad' | 'info' | 'warn'; text: string }
type ConfirmReq = { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; resolve: (v: boolean) => void }

const FeedbackCtx = createContext<{ toast: (tone: Toast['tone'], text: string) => void; confirm: (o: Omit<ConfirmReq, 'resolve'>) => Promise<boolean> } | null>(null)

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [confirmReq, setConfirmReq] = useState<ConfirmReq | null>(null)
  const toast = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, tone, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'bad' ? 8000 : 4000)
  }, [])
  const confirm = useCallback((o: Omit<ConfirmReq, 'resolve'>) => new Promise<boolean>((resolve) => setConfirmReq({ ...o, resolve })), [])
  const close = (v: boolean) => {
    confirmReq?.resolve(v)
    setConfirmReq(null)
  }
  return (
    <FeedbackCtx.Provider value={{ toast, confirm }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[60] flex w-96 flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="animate-in">
            <Notice tone={t.tone}>{t.text}</Notice>
          </div>
        ))}
      </div>
      <Modal
        open={!!confirmReq}
        onClose={() => close(false)}
        title={confirmReq?.title ?? ''}
        footer={
          <>
            <Button onClick={() => close(false)}>Cancelar</Button>
            <Button variant={confirmReq?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
              {confirmReq?.confirmLabel ?? 'Confirmar'}
            </Button>
          </>
        }
      >
        <div className="text-sm text-muted">{confirmReq?.message}</div>
      </Modal>
    </FeedbackCtx.Provider>
  )
}

export function useFeedback() {
  const c = useContext(FeedbackCtx)
  if (!c) throw new Error('FeedbackProvider ausente')
  return c
}

/** Executa ação com toast de sucesso/erro. */
export function useAction() {
  const { toast } = useFeedback()
  const [busy, setBusy] = useState<string | null>(null)
  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, success?: string | ((r: T) => string | null)): Promise<T | undefined> => {
      setBusy(key)
      try {
        const r = await fn()
        const msg = typeof success === 'function' ? success(r) : success
        if (msg) toast('ok', msg)
        return r
      } catch (e) {
        toast('bad', (e as Error).message)
        return undefined
      } finally {
        setBusy(null)
      }
    },
    [toast]
  )
  return { run, busy }
}

// ───────────── Tabela ─────────────
export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            {head.map((h, i) => (
              <th key={i} className="px-4 py-2.5 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
      {empty && <div className="py-10 text-center text-sm text-muted">Nenhum registro.</div>}
    </div>
  )
}

export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => <td className={clsx('px-4 py-2.5 align-middle', className)}>{children}</td>
