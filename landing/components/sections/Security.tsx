import { Section, SectionHeading } from '../ui/Section';
import { Reveal } from '../ui/Reveal';
import { security } from '@/lib/content';

export function Security() {
  return (
    <Section id="security" tone="dark" className="relative overflow-hidden">
      {/* 细网格底纹 */}
      <div aria-hidden className="grid-mask pointer-events-none absolute inset-0 -z-10" />
      {/* 温暖辉光 - 改为深棕/赤陶而非品牌紫 */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 top-8 -z-10 h-80 w-80 rounded-full blur-3xl opacity-20"
        style={{ background: '#C4612F' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-16 bottom-8 -z-10 h-64 w-64 rounded-full blur-3xl opacity-15"
        style={{ background: '#A94E22' }}
      />
      <SectionHeading
        eyebrow="安全与信任"
        title={security.heading}
        sub={security.sub}
        tone="dark"
      />
      <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {security.items.map((item, i) => (
          <Reveal key={item.title} delay={i * 80}>
            <div
              className="h-full p-6 transition-all duration-200"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '1rem',
                backdropFilter: 'blur(8px)',
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.background = 'rgba(255,255,255,0.07)';
                el.style.borderColor = 'rgba(196, 97, 47, 0.3)';
                el.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.background = 'rgba(255,255,255,0.04)';
                el.style.borderColor = 'rgba(255,255,255,0.08)';
                el.style.transform = 'translateY(0)';
              }}
            >
              <div
                className="flex h-12 w-12 items-center justify-center text-2xl"
                style={{
                  background: 'rgba(196, 97, 47, 0.15)',
                  borderRadius: '12px',
                  border: '1px solid rgba(196, 97, 47, 0.25)'
                }}
              >
                {item.icon}
              </div>
              <h3 className="mt-5 text-base font-semibold text-white">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)' }}>
                {item.desc}
              </p>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
