import { Section, SectionHeading } from '../ui/Section';
import { Reveal } from '../ui/Reveal';
import { features } from '@/lib/content';

export function Features() {
  return (
    <Section id="features" tone="light">
      <SectionHeading
        eyebrow="功能亮点"
        title={features.heading}
        sub={features.sub}
      />
      <div className="mt-16 space-y-16">
        {features.items.map((item, i) => {
          const flip = i % 2 === 1;
          return (
            <Reveal key={item.title}>
              <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
                {/* 文案 */}
                <div className={flip ? 'lg:order-2' : ''}>
                  <span className="inline-flex rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-700">
                    {item.tag}
                  </span>
                  <h3 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
                    {item.title}
                  </h3>
                  <p className="mt-3 text-ink-600">{item.desc}</p>
                  <ul className="mt-6 grid grid-cols-2 gap-3">
                    {item.bullets.map((b) => (
                      <li
                        key={b}
                        className="flex items-center gap-2 text-sm text-ink-800"
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[11px] text-brand-700">
                          ✓
                        </span>
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
                {/* 视觉占位块 */}
                <div className={flip ? 'lg:order-1' : ''}>
                  <div className="relative aspect-[4/3] overflow-hidden rounded-xl2 border border-ink-100 bg-gradient-to-br from-brand-50 to-ink-50 shadow-soft">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-6xl opacity-80">
                        {item.tag === '聊天'
                          ? '💬'
                          : item.tag === '朋友圈'
                            ? '🖼️'
                            : item.tag === '收藏'
                              ? '⭐'
                              : '👥'}
                      </span>
                    </div>
                    <div className="absolute bottom-3 left-3 rounded-lg bg-white/80 px-3 py-1 text-xs font-medium text-ink-600 backdrop-blur">
                      {item.tag} · 示意
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}
