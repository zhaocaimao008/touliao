import React from 'react';
import paths from './icon-paths.json';
import registry from './icon-registry.json';

export const ICON_SIZES = Object.freeze(registry.sizes);
export const ICON_ROLES = Object.freeze(registry.roles);
export function iconForMessageType(type) {
  return ({ text: 'text', image: 'image', sticker: 'image', voice: 'voice', video: 'video',
    file: 'fileContent', contact_card: 'contact', contact: 'contact', red_packet: 'redPacket',
    transfer: 'transfer', merged: 'mergedMessages', call: 'phone' })[type] || 'allTypes';
}

// A semantic name is the only public geometry API. Color inherits a themed surface unless a tone is explicit.
export default function Icon({ name, size = 'sm', role, tone, className = '', style, ...props }) {
  const asset = registry.icons[name];
  if (!asset) throw new Error(`Unregistered Touliao icon: ${name}`);
  const token = role ? registry.roles[role] : size;
  if (!(token in registry.sizes)) throw new Error(`Unregistered Touliao icon size: ${token}`);
  const color = tone ? `var(--icon-${tone.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)})` : undefined;
  return (
    <svg {...props} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
      data-icon={name} data-icon-size={token} data-icon-tone={tone}
      className={`tl-icon ${className}`} style={{ ...style, width: `var(--tl-icon-size, var(--icon-${token}))`, height: `var(--tl-icon-size, var(--icon-${token}))`, ...(color ? { color } : {}), fill: 'none' }}
      fill="none" stroke="currentColor" strokeWidth={registry.strokeWidth} strokeLinecap={registry.linecap} strokeLinejoin={registry.linejoin}>
      {paths[asset].map(([tag, attributes], index) => React.createElement(tag, { ...attributes, key: index }))}
    </svg>
  );
}

export function IconButton({ icon, label, size = 'md', tone, className = '', children, ...props }) {
  return <button type="button" {...props} aria-label={label} className={`tl-icon-button ${className}`}>
    <Icon name={icon} size={size} tone={tone} />{children}
  </button>;
}
export const ToolbarIcon = props => <Icon {...props} role="toolbar" />;
export const TabIcon = props => <Icon {...props} role="tab" />;
export const ChatActionIcon = props => <Icon {...props} role="chatAction" />;
