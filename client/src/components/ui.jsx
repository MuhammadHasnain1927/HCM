import { forwardRef, useId, useState } from 'react';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Info, Loader2 } from 'lucide-react';

const cx = (...classes) => classes.filter(Boolean).join(' ');

const BUTTON_VARIANTS = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 focus-visible:ring-brand-500 disabled:bg-brand-700/60',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus-visible:ring-slate-400',
  ghost: 'text-slate-600 hover:bg-slate-100 focus-visible:ring-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500',
};

export function Button({ variant = 'primary', loading = false, className, children, disabled, ...props }) {
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed',
        BUTTON_VARIANTS[variant],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export const Input = forwardRef(function Input({ label, error, hint, className, type = 'text', ...props }, ref) {
  const id = useId();
  const [show, setShow] = useState(false);
  const isPassword = type === 'password';
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={id}
          ref={ref}
          type={isPassword && show ? 'text' : type}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={cx(
            'block w-full rounded-lg border bg-white px-3 py-2.5 text-sm shadow-sm transition placeholder:text-slate-400',
            'focus:outline-none focus:ring-2',
            error
              ? 'border-red-400 focus:border-red-500 focus:ring-red-200'
              : 'border-slate-300 focus:border-brand-600 focus:ring-brand-100',
            isPassword && 'pr-10',
          )}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
            aria-label={show ? 'Hide password' : 'Show password'}
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        )}
      </div>
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-sm text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

export function Select({ label, error, children, className, ...props }) {
  const id = useId();
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">
          {label}
        </label>
      )}
      <select
        id={id}
        className={cx(
          'block w-full rounded-lg border bg-white px-3 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2',
          error ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:border-brand-600 focus:ring-brand-100',
        )}
        {...props}
      >
        {children}
      </select>
      {error && <p className="mt-1.5 text-sm text-red-600">{error}</p>}
    </div>
  );
}

export function Card({ className, children }) {
  return <div className={cx('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>{children}</div>;
}

const ALERT_STYLES = {
  error: { box: 'border-red-200 bg-red-50 text-red-800', Icon: AlertCircle },
  success: { box: 'border-emerald-200 bg-emerald-50 text-emerald-800', Icon: CheckCircle2 },
  info: { box: 'border-sky-200 bg-sky-50 text-sky-800', Icon: Info },
};

export function Alert({ type = 'info', children, className }) {
  if (!children) return null;
  const { box, Icon } = ALERT_STYLES[type];
  return (
    <div role={type === 'error' ? 'alert' : 'status'} className={cx('flex gap-2 rounded-lg border px-3 py-2.5 text-sm', box, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function Spinner({ className }) {
  return <Loader2 className={cx('size-5 animate-spin text-brand-700', className)} aria-label="Loading" />;
}

export function FullPageLoader({ label = 'Loading...' }) {
  return (
    <div className="flex h-full min-h-screen flex-col items-center justify-center gap-3 text-sm text-slate-500">
      <Spinner className="size-7" />
      {label}
    </div>
  );
}

export function EmptyState({ icon: Icon = Info, title, children, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 rounded-full bg-brand-50 p-3 text-brand-700">
        <Icon className="size-6" aria-hidden />
      </div>
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {children && <p className="mt-1 max-w-sm text-sm text-slate-500">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Logo({ className }) {
  return (
    <div className={cx('flex items-center gap-2.5', className)}>
      <img src="/favicon.svg" alt="" className="size-8" />
      <span className="text-lg font-semibold tracking-tight text-slate-900">
        HCM <span className="text-brand-700">Lite</span>
      </span>
    </div>
  );
}
