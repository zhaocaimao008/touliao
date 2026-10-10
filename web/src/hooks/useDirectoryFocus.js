import { useEffect, useRef } from 'react';

export function useDirectoryFocus(containerRef, section, home = 'contacts') {
  const previous = useRef(home);
  useEffect(() => {
    const from = previous.current;
    previous.current = section;
    if (from === section) return;
    const container = containerRef.current;
    const target = section === home
      ? [...(container?.querySelectorAll('[data-directory-section]') || [])].find(node => node.dataset.directorySection === from) || container?.querySelector('.cl-section-back')
      : container?.querySelector('[data-directory-initial-focus]') || container?.querySelector('.cl-section-back');
    const details = target?.closest('details');
    if (details) details.open = true;
    target?.focus({ preventScroll: true });
  }, [containerRef, section, home]);
}
