import { type ReactNode } from 'react';

/** 通用卡片：亮色描边 + 软阴影，hover 微抬升 */
export function Card({
  children,
  className = '',
  interactive = true,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div
      className={`rounded-xl2 border border-ink-100 bg-white p-6 shadow-soft ${
        interactive
          ? 'transition-all duration-300 hover:-translate-y-1 hover:border-brand-200 hover:shadow-lift'
          : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}

/** 圆形图标徽底（emoji / 字符） */
export function IconBadge({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-2xl ring-1 ring-brand-100">
      {children}
    </div>
  );
}
