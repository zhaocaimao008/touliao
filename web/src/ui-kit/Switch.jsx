import React from 'react';

export default function TouliaoSwitch({ value, disabled = false, onChange, label, labelledBy }) {
  return <button type="button" role="switch" className="tl-switch"
    aria-checked={!!value} aria-label={labelledBy ? undefined : label} aria-labelledby={labelledBy}
    disabled={disabled} onClick={event => { event.stopPropagation(); onChange?.(!value); }}>
    <span className="tl-switch-track" aria-hidden="true"><span className="tl-switch-thumb" /></span>
  </button>;
}
