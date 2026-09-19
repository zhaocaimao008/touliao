import React, { useId } from 'react';
import TouliaoIcon from './Icon';
import TouliaoSwitch from './Switch';

export function SettingSection({ children, className = '', style }) {
  return <div className={`wc-card tl-setting-section ${className}`} style={style}>{children}</div>;
}

export function SettingCell({ icon, label, value, desc, onClick, right, danger, disabled = false }) {
  const id = useId();
  const accessory = React.isValidElement(right) && right.type === TouliaoSwitch
    ? React.cloneElement(right, { labelledBy: id }) : right;
  return <div className={`wc-crow tl-setting-cell${onClick ? ' wc-crow-clickable' : ''}${danger ? ' tl-setting-danger' : ''}`}
    role={onClick ? 'button' : undefined} tabIndex={onClick && !disabled ? 0 : undefined}
    aria-disabled={disabled || undefined}
    onClick={disabled ? undefined : onClick}
    onKeyDown={onClick ? event => { if (event.target === event.currentTarget && !disabled && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onClick(event); } } : undefined}>
    {icon && <div className="wc-crow-icon">{icon}</div>}
    <div className="wc-crow-body">
      <div id={id} className="wc-crow-label">{label}</div>
      {desc && <div className="wc-crow-desc">{desc}</div>}
    </div>
    {value != null && <span className="wc-crow-value">{value}</span>}
    {accessory}
    {onClick && !right && <TouliaoIcon name="disclosure" size="sm" />}
  </div>;
}
