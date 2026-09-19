import React, { forwardRef, useId, useState } from 'react';
import TouliaoIcon from './Icon';
import { useI18n } from '../contexts/I18nContext';

/** TEXT / PASSWORD / SEARCH / CODE / MULTILINE. Validation stays with callers. */
const TouliaoField = forwardRef(function TouliaoField({ id, label, icon, variant = 'TEXT',
  error, hint, onClear, className = '', controlClassName = '', wrapperStyle, disabled, readOnly, type, value, onFocus, onBlur, ...props }, ref) {
  const autoId = useId();
  const fieldId = id || autoId;
  const { t } = useI18n();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const multiline = variant === 'MULTILINE';
  const password = variant === 'PASSWORD';
  const Control = multiline ? 'textarea' : 'input';
  const state = disabled ? 'DISABLED' : readOnly ? 'READONLY' : error ? 'ERROR' : focused ? 'FOCUSED' : value ? 'FILLED' : 'DEFAULT';
  const description = [props['aria-describedby'], (error || hint) && `${fieldId}-description`].filter(Boolean).join(' ') || undefined;
  return <div className={`auth-field tl-field ${focused ? 'focused' : ''} ${value ? 'has-value' : ''} ${className}`} style={wrapperStyle} data-state={state} data-variant={variant}>
    {label && <label className="auth-field-label" htmlFor={fieldId}>{label}</label>}
    <div className="auth-field-input-wrap tl-field-control">
      {icon && <span className="auth-field-icon" aria-hidden="true">{icon}</span>}
      <Control {...props} id={fieldId} ref={ref} className={`auth-field-input ${controlClassName}`} value={value}
        disabled={disabled} readOnly={readOnly}
        type={multiline ? undefined : password ? (revealed ? 'text' : 'password') : type || (variant === 'SEARCH' ? 'search' : 'text')}
        inputMode={props.inputMode || (variant === 'CODE' ? 'numeric' : undefined)}
        aria-invalid={error ? true : undefined} aria-describedby={description}
        onFocus={event => { setFocused(true); onFocus?.(event); }} onBlur={event => { setFocused(false); onBlur?.(event); }} />
      {password && <button type="button" className="auth-pwd-toggle" disabled={disabled}
        onClick={() => setRevealed(v => !v)} aria-label={t(revealed ? 'auth.hidePassword' : 'auth.showPassword')} aria-pressed={revealed}>
        <TouliaoIcon name={revealed ? 'showPassword' : 'hidePassword'} size="sm" />
      </button>}
      {onClear && value && !readOnly && !disabled && <button type="button" className="auth-pwd-toggle" onClick={onClear} aria-label={t('common.clear')}><TouliaoIcon name="close" size="sm" /></button>}
    </div>
    {(error || hint) && <div id={`${fieldId}-description`} className="tl-field-description">{error || hint}</div>}
  </div>;
});
export default TouliaoField;
