import { Container } from '../ui/Container';
import { Button } from '../ui/Button';
import { Reveal } from '../ui/Reveal';
import { PhoneMock } from './PhoneMock';
import { hero } from '@/lib/content';

export function Hero() {
  return (
    <div id="top" className="relative overflow-hidden bg-white">
      {/* 顶部柔光背景 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 -z-10 mx-auto h-[480px] max-w-5xl rounded-full bg-gradient-to-b from-brand-100/70 to-transparent blur-3xl"
      />
      <Container className="grid items-center gap-12 py-20 sm:py-28 lg:grid-cols-2 lg:gap-8">
        <div className="text-center lg:text-left">
          <Reveal>
            <span className="inline-flex items-center rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-sm font-medium text-brand-700">
              {hero.pill}
            </span>
          </Reveal>

          <Reveal delay={80}>
            <h1 className="mt-6 text-balance text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
              {hero.title[0]}
              <br />
              <span className="text-brand-600">{hero.title[1]}</span>
            </h1>
          </Reveal>

          <Reveal delay={160}>
            <p className="mx-auto mt-6 max-w-xl text-lg text-ink-600 lg:mx-0">
              {hero.subtitle}
            </p>
          </Reveal>

          <Reveal delay={240}>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row lg:justify-start">
              <Button href={hero.primary.href} className="w-full sm:w-auto">
                {hero.primary.label}
              </Button>
              <Button
                href={hero.secondary.href}
                variant="secondary"
                className="w-full sm:w-auto"
              >
                {hero.secondary.label} →
              </Button>
            </div>
          </Reveal>

          <Reveal delay={320}>
            <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-ink-600 lg:justify-start">
              {hero.trustBar.map((t) => (
                <li key={t.label} className="flex items-center gap-1.5">
                  <span>{t.icon}</span>
                  {t.label}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>

        <Reveal delay={200} className="flex justify-center">
          <PhoneMock />
        </Reveal>
      </Container>
    </div>
  );
}
