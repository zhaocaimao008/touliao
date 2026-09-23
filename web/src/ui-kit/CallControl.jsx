import React from 'react';

/** Shared presentation only: call state, route selection and callbacks stay with callers. */
export default function CallControl({ icon, label, tone = 'default', danger = false,
  active, pressed, large = false, disabled = false, onClick, testid, className = '' }) {
  const selected = pressed ?? active;
  return <button type="button" className={`tl-call-control ${className}`}
    data-tone={danger ? 'danger' : tone} data-large={large || undefined}
    aria-label={label} aria-pressed={selected} disabled={disabled}
    data-testid={testid} onClick={onClick}>
    <span className="tl-call-control-disc"><span className="tl-call-control-icon">{icon}</span></span>
    <span className="tl-call-control-label" aria-hidden="true">{label}</span>
  </button>;
}
