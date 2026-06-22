import { Section, SectionHeading } from '../ui/Section';
import { Button } from '../ui/Button';
import { Reveal } from '../ui/Reveal';
import { download } from '@/lib/content';

export function Download() {
  return (
    <Section id="download" tone="muted">
      <SectionHeading
        eyebrow="下载与体验"
        title={download.heading}
        sub={download.sub}
      />
      <div className="mx-auto mt-14 grid max-w-4xl gap-6 sm:grid-cols-3">
        {download.platforms.map((p, i) => (
          <Reveal key={p.key} delay={i * 80}>
            <div className="flex h-full flex-col items-center rounded-xl2 border border-ink-100 bg-white p-8 text-center shadow-soft">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-3xl ring-1 ring-brand-100">
                {p.icon}
              </div>
              <h3 className="mt-5 text-lg font-semibold">{p.name}</h3>
              <p className="mt-1 text-sm text-ink-600">{p.desc}</p>
              <div className="mt-6 w-full">
                <Button
                  href={p.available ? p.href : undefined}
                  variant={p.available ? 'primary' : 'secondary'}
                  disabled={!p.available}
                  download={p.key === 'android'}
                  className="w-full"
                >
                  {p.cta}
                </Button>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
