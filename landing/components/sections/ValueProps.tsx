import { Section, SectionHeading } from '../ui/Section';
import { Card, IconBadge } from '../ui/Card';
import { Reveal } from '../ui/Reveal';
import { valueProps } from '@/lib/content';

export function ValueProps() {
  return (
    <Section id="value" tone="muted">
      <SectionHeading
        eyebrow="为什么选 v信"
        title={valueProps.heading}
        sub={valueProps.sub}
      />
      <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {valueProps.cards.map((card, i) => (
          <Reveal key={card.title} delay={i * 80}>
            <Card className="h-full">
              <IconBadge>{card.icon}</IconBadge>
              <h3 className="mt-5 text-lg font-semibold">{card.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">
                {card.desc}
              </p>
            </Card>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
