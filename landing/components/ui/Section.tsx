import { type ReactNode } from 'react';
import { Container } from './Container';

/** 区块外壳：统一纵向 padding，可选 id 锚点与背景变体 */
export function Section({
  id,
  children,
  className = '',
  tone = 'light',
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  tone?: 'light' | 'muted' | 'dark';
}) {
  const toneClass =
    tone === 'dark'
      ? 'bg-ink-900 text-white'
      : tone === 'muted'
        ? 'bg-ink-50'
        : 'bg-white';
  return (
    <section id={id} className={`py-20 sm:py-28 ${toneClass} ${className}`}>
      <Container>{children}</Container>
    </section>
  );
}

/** 区块标题组（小标 + 大标 + 副文） */
export function SectionHeading({
  eyebrow,
  title,
  sub,
  tone = 'light',
}: {
  eyebrow?: string;
  title: string;
  sub?: string;
  tone?: 'light' | 'dark';
}) {
  const subColor = tone === 'dark' ? 'text-ink-100/70' : 'text-ink-600';
  return (
    <div className="mx-auto max-w-2xl text-center">
      {eyebrow && (
        <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-brand-600">
          {eyebrow}
        </p>
      )}
      <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
        {title}
      </h2>
      {sub && <p className={`mt-4 text-lg ${subColor}`}>{sub}</p>}
    </div>
  );
}
