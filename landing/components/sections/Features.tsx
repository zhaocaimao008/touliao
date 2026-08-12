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
      <div className="mt-20 space-y-24">
        {features.items.map((item, i) => {
          const flip = i % 2 === 1;
          return (
            <Reveal key={item.title}>
              <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
                {/* 文案 */}
                <div className={flip ? 'lg:order-2' : ''}>
                  <span
                    className="inline-flex px-4 py-1.5 text-xs font-medium uppercase tracking-wide"
                    style={{
                      background: '#F2E3D6',
                      color: '#C4612F',
                      borderRadius: '999px',
                      letterSpacing: '0.05em'
                    }}
                  >
                    {item.tag}
                  </span>
                  <h3
                    className="mt-5 tracking-tight"
                    style={{
                      fontFamily: '"Playfair Display", "Noto Serif SC", serif',
                      fontSize: 'clamp(1.75rem, 3vw, 2.25rem)',
                      fontWeight: 400,
                      color: '#1F2421',
                      letterSpacing: '-0.01em',
                      lineHeight: 1.2
                    }}
                  >
                    {item.title}
                  </h3>
                  <p
                    className="mt-4 leading-relaxed"
                    style={{
                      fontSize: '1rem',
                      fontWeight: 300,
                      color: '#5C635D',
                      lineHeight: '1.7'
                    }}
                  >
                    {item.desc}
                  </p>
                  <ul className="mt-8 space-y-3">
                    {item.bullets.map((b) => (
                      <li
                        key={b}
                        className="flex items-start gap-3"
                        style={{
                          fontSize: '0.9375rem',
                          color: '#1F2421'
                        }}
                      >
                        <span
                          className="flex shrink-0 items-center justify-center"
                          style={{
                            width: '20px',
                            height: '20px',
                            borderRadius: '999px',
                            background: '#F2E3D6',
                            color: '#C4612F',
                            fontSize: '11px',
                            fontWeight: 600,
                            marginTop: '2px'
                          }}
                        >
                          ✓
                        </span>
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
                {/* 视觉占位块 - 真实截图框 */}
                <div className={flip ? 'lg:order-1' : ''}>
                  <div
                    className="warm-card relative aspect-[4/3] overflow-hidden"
                    style={{
                      borderRadius: '1.25rem',
                      background: 'linear-gradient(135deg, #FBF9F5 0%, #F7F4EF 100%)'
                    }}
                  >
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span style={{ fontSize: '4rem', opacity: 0.3 }}>
                        {item.tag === '聊天'
                          ? '💬'
                          : item.tag === '朋友圈'
                            ? '🖼️'
                            : item.tag === '收藏'
                              ? '⭐'
                              : '👥'}
                      </span>
                    </div>
                    <div
                      className="absolute bottom-4 left-4 px-3 py-1.5 text-xs font-medium"
                      style={{
                        background: 'rgba(255, 255, 255, 0.9)',
                        color: '#5C635D',
                        borderRadius: '8px',
                        backdropFilter: 'blur(8px)',
                        border: '1px solid rgba(231, 225, 215, 0.5)'
                      }}
                    >
                      {item.tag} · 功能示意
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
