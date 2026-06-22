import { type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'onDark';

const base =
  'inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

const variants: Record<Variant, string> = {
  primary:
    'bg-brand-600 text-white shadow-soft hover:bg-brand-700 hover:shadow-lift active:translate-y-px',
  secondary:
    'bg-white text-ink-900 ring-1 ring-ink-100 shadow-soft hover:ring-brand-300 hover:text-brand-700',
  ghost: 'text-ink-600 hover:text-brand-700',
  onDark:
    'bg-white text-ink-900 hover:bg-brand-50 active:translate-y-px shadow-soft',
};

export function Button({
  children,
  href,
  variant = 'primary',
  className = '',
  disabled = false,
  download = false,
}: {
  children: ReactNode;
  href?: string;
  variant?: Variant;
  className?: string;
  disabled?: boolean;
  download?: boolean;
}) {
  const cls = `${base} ${variants[variant]} ${className}`;
  if (href && !disabled) {
    const external = /^https?:\/\//.test(href);
    return (
      <a
        href={href}
        className={cls}
        {...(download ? { download: true } : {})}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {children}
      </a>
    );
  }
  return (
    <button className={cls} disabled={disabled}>
      {children}
    </button>
  );
}
