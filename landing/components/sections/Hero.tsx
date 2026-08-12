import { Container } from '../ui/Container';
import { Button } from '../ui/Button';
import { Reveal } from '../ui/Reveal';
import { PhoneMock } from './PhoneMock';
import { hero } from '@/lib/content';

export function Hero() {
  return (
    <div id="top" className="relative overflow-hidden" style={{ background: '#F7F4EF' }}>
      {/* 温暖渐变背景 - 奶油到浅驼 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-32 -z-10 mx-auto h-[560px] max-w-6xl rounded-full opacity-40 blur-3xl"
        style={{
          background: 'radial-gradient(ellipse at center, #E7D4C5 0%, #F7F4EF 70%)'
        }}
      />

      <Container className="grid items-center gap-16 py-24 sm:py-32 lg:grid-cols-2 lg:gap-12">
        <div className="text-center lg:text-left">
          <Reveal>
            <span
              className="inline-flex items-center px-4 py-1.5 text-xs font-medium tracking-wide uppercase"
              style={{
                background: '#F2E3D6',
                color: '#C4612F',
                borderRadius: '999px',
                letterSpacing: '0.05em'
              }}
            >
              {hero.pill}
            </span>
          </Reveal>

          <Reveal delay={80}>
            <h1
              className="mt-8 text-balance leading-[1.05] tracking-tight"
              style={{
                fontFamily: '"Playfair Display", "Noto Serif SC", serif',
                fontSize: 'clamp(2.5rem, 5vw, 4rem)',
                fontWeight: 400,
                color: '#1F2421',
                letterSpacing: '-0.02em'
              }}
            >
              {hero.title[0]}
              <br />
              <span style={{ fontStyle: 'italic', color: '#C4612F' }}>
                {hero.title[1]}
              </span>
            </h1>
          </Reveal>

          <Reveal delay={160}>
            <p
              className="mx-auto mt-6 max-w-xl leading-relaxed lg:mx-0"
              style={{
                fontSize: '1.0625rem',
                fontWeight: 300,
                color: '#5C635D',
                lineHeight: '1.7'
              }}
            >
              {hero.subtitle}
            </p>
          </Reveal>

          <Reveal delay={240}>
            <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row lg:justify-start">
              <Button
                href={hero.primary.href}
                className="group w-full sm:w-auto"
                style={{
                  background: '#C4612F',
                  color: 'white',
                  padding: '0.875rem 2rem',
                  borderRadius: '999px',
                  fontWeight: 500,
                  fontSize: '0.9375rem',
                  border: 'none',
                  boxShadow: '0 2px 8px rgba(196, 97, 47, 0.24)',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#A94E22';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(196, 97, 47, 0.32)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#C4612F';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(196, 97, 47, 0.24)';
                }}
              >
                {hero.primary.label}
              </Button>
              <Button
                href={hero.secondary.href}
                variant="secondary"
                className="w-full sm:w-auto"
                style={{
                  background: 'transparent',
                  color: '#1F2421',
                  padding: '0.875rem 2rem',
                  borderRadius: '999px',
                  fontWeight: 500,
                  fontSize: '0.9375rem',
                  border: '1px solid #E7E1D7',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#FFFFFF';
                  e.currentTarget.style.borderColor = '#C4612F';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.borderColor = '#E7E1D7';
                }}
              >
                {hero.secondary.label} →
              </Button>
            </div>
          </Reveal>

          <Reveal delay={320}>
            <ul
              className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 lg:justify-start"
              style={{ fontSize: '0.875rem', color: '#5C635D' }}
            >
              {hero.trustBar.map((t) => (
                <li key={t.label} className="flex items-center gap-2">
                  <span style={{ fontSize: '1.125rem' }}>{t.icon}</span>
                  {t.label}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>

        <Reveal delay={200} className="flex justify-center lg:justify-end">
          <div className="relative">
            {/* 真实产品截图框架 */}
            <div
              className="relative overflow-hidden"
              style={{
                width: '320px',
                height: '640px',
                borderRadius: '2.5rem',
                background: 'white',
                boxShadow: '0 20px 60px rgba(31, 36, 33, 0.12), 0 0 0 1px rgba(31, 36, 33, 0.04)',
                border: '8px solid #1F2421'
              }}
            >
              <PhoneMock />
            </div>
            {/* 装饰圆点 */}
            <div
              className="absolute -right-4 -top-4 h-24 w-24 rounded-full opacity-20"
              style={{ background: '#C4612F', filter: 'blur(24px)' }}
            />
            <div
              className="absolute -bottom-8 -left-8 h-32 w-32 rounded-full opacity-15"
              style={{ background: '#C4612F', filter: 'blur(32px)' }}
            />
          </div>
        </Reveal>
      </Container>
    </div>
  );
}
