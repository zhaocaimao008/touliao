import React from 'react';
import paths from './icon-paths.json';

// Geometry comes from the supplied, offline design kit. Never render user HTML.
export default function Icon({ name, size = 20, className = '', style, slashed = false, ...props }) {
  const nodes = paths[name];
  if (!nodes) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
      {...props} className={`tl-icon ${className}`} style={{ ...style, fill: 'none' }}
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {nodes.map(([tag, attributes], index) => React.createElement(tag, { ...attributes, key: index }))}
      {slashed && <line x1="3" y1="3" x2="21" y2="21" />} 
    </svg>
  );
}
