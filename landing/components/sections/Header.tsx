import { Container } from '../ui/Container';
import { Button } from '../ui/Button';
import { site, nav } from '@/lib/content';

/** 顶部导航：半透明吸顶，移动端隐藏菜单项保留 CTA */
export function Header() {
  return (
    <header
      className="sticky top-0 z-50"
      style={{
        background: 'rgba(247, 244, 239, 0.85)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(231, 225, 215, 0.6)'
      }}
    >
      <Container className="flex h-16 items-center justify-between">
        <a href="#top" className="flex items-center gap-2.5 group">
          <span
            className="flex h-9 w-9 items-center justify-center text-sm font-bold transition-transform group-hover:scale-105"
            style={{
              background: 'linear-gradient(135deg, #C4612F 0%, #A94E22 100%)',
              color: 'white',
              borderRadius: '10px',
              boxShadow: '0 2px 8px rgba(196, 97, 47, 0.2)'
            }}
          >
            v
          </span>
          <span
            className="font-medium tracking-tight"
            style={{
              fontSize: '1.125rem',
              color: '#1F2421',
              fontWeight: 500
            }}
          >
            {site.name}
          </span>
        </a>

        <nav className="hidden items-center gap-8 md:flex">
          {nav.items.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-sm font-medium transition-colors"
              style={{ color: '#5C635D' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#C4612F')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#5C635D')}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <Button
          href={nav.cta.href}
          style={{
            background: '#C4612F',
            color: 'white',
            padding: '0.625rem 1.5rem',
            borderRadius: '999px',
            fontSize: '0.875rem',
            fontWeight: 500,
            border: 'none',
            boxShadow: '0 2px 6px rgba(196, 97, 47, 0.2)',
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e: any) => {
            e.currentTarget.style.background = '#A94E22';
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = '0 3px 10px rgba(196, 97, 47, 0.28)';
          }}
          onMouseLeave={(e: any) => {
            e.currentTarget.style.background = '#C4612F';
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 2px 6px rgba(196, 97, 47, 0.2)';
          }}
        >
          {nav.cta.label}
        </Button>
      </Container>
    </header>
  );
}
