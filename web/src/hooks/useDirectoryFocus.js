import { useEffect, useRef } from 'react';

export function useDirectoryFocus(containerRef, section) {
  const previous = useRef('contacts');
  useEffect(() => {
    const from = previous.current;
    previous.current = section;
    if (from === section) return;
    const container = containerRef.current;
    const target = section === 'contacts'
      ? [...(container?.querySelectorAll('[data-directory-section]') || [])].find(node => node.dataset.directorySection === from)
      : container?.querySelector('.cl-section-back');
    const details = target?.closest('details');
    if (details) details.open = true;
    target?.focus({ preventScroll: true });
  }, [containerRef, section]);
}
