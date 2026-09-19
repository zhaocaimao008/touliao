import React, { forwardRef } from 'react';

/** Presentation only. Business callbacks and pending state remain with callers. */
export const TouliaoButton = forwardRef(function TouliaoButton({
  variant = 'primary', loading = false, disabled = false, children, className = '', type = 'button', ...props
}, ref) {
  return <button {...props} ref={ref} type={type} disabled={disabled || loading}
    aria-busy={loading || undefined} className={`tl-button tl-button--${variant} ${className}`}>
    <span className="tl-button-label" style={loading ? { visibility: 'hidden' } : undefined}>{children}</span>
    {loading && <span className="tl-button-spinner" aria-hidden="true" />}
  </button>;
});
export const PrimaryButton = props => <TouliaoButton {...props} variant="primary" />;
export const SecondaryButton = props => <TouliaoButton {...props} variant="secondary" />;
export const GhostButton = props => <TouliaoButton {...props} variant="ghost" />;
export const TextButton = props => <TouliaoButton {...props} variant="text" />;
export const DangerButton = props => <TouliaoButton {...props} variant="danger" />;
// Re-export the existing Icon System button; do not introduce a second icon API.
export { IconButton } from './Icon';
