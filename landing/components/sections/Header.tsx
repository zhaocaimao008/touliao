import { Container } from '../ui/Container';
import { Button } from '../ui/Button';
import { site, nav } from '@/lib/content';

/** 顶部导航：半透明吸顶，移动端隐藏菜单项保留 CTA */
export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-ink-100/70 bg-white/80 backdrop-blur-md">
      <Container className="flex h-16 items-center justify-between">
        <a href="#top" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            v
          </span>
          <span className="text-lg font-bold tracking-tight">{site.name}</span>
        </a>

        <nav className="hidden items-center gap-8 md:flex">
          {nav.items.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-sm font-medium text-ink-600 transition-colors hover:text-brand-700"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <Button href={nav.cta.href} className="px-4 py-2">
          {nav.cta.label}
        </Button>
      </Container>
    </header>
  );
}
