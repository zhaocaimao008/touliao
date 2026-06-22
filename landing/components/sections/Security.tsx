import { Section, SectionHeading } from '../ui/Section';
import { Reveal } from '../ui/Reveal';
import { security } from '@/lib/content';

export function Security() {
  return (
    <Section id="security" tone="dark" className="relative overflow-hidden">
      {/* 网格底纹 + 青色辉光 */}
      <div aria-hidden className="grid-mask pointer-events-none absolute inset-0 -z-10" />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 top-10 -z-10 h-72 w-72 rounded-full bg-brand-500/20 blur-3xl"
      />
      <SectionHeading
        eyebrow="安全与信任"
        title={security.heading}
        sub={security.sub}
        tone="dark"
      />
      <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {security.items.map((item, i) => (
          <Reveal key={item.title} delay={i * 80}>
            <div className="h-full rounded-xl2 border border-white/10 bg-white/[0.04] p-6 backdrop-blur transition-colors hover:border-brand-400/40">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500/15 text-2xl ring-1 ring-brand-400/30">
                {item.icon}
              </div>
              <h3 className="mt-5 text-lg font-semibold text-white">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-100/70">
                {item.desc}
              </p>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
