import { Container } from '../ui/Container';
import { site, footer } from '@/lib/content';

export function Footer() {
  return (
    <footer className="border-t border-ink-100 bg-white py-14">
      <Container>
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* 品牌 */}
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
                v
              </span>
              <span className="text-lg font-bold tracking-tight">
                {site.name}
              </span>
            </div>
            <p className="mt-3 max-w-xs text-sm text-ink-600">
              {footer.brandLine}
            </p>
          </div>

          {/* 链接列 */}
          {footer.columns.map((col) => (
            <div key={col.title}>
              <h4 className="text-sm font-semibold text-ink-900">{col.title}</h4>
              <ul className="mt-4 space-y-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-sm text-ink-600 transition-colors hover:text-brand-700"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-2 border-t border-ink-100 pt-6 text-sm text-ink-400 sm:flex-row">
          <p>{footer.copyright}</p>
          {footer.beian && (
            <a
              href="https://beian.miit.gov.cn/"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-brand-700"
            >
              {footer.beian}
            </a>
          )}
        </div>
      </Container>
    </footer>
  );
}
