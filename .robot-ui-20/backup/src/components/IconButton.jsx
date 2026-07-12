import React from 'react';

/**
 * IconButton — 无障碍图标按钮
 * 统一替代散落的 `<div onClick>` 图标按钮：
 *  - 原生 <button>：可 Tab 聚焦、Enter/Space 触发、支持 disabled
 *  - 强制 aria-label（无可见文字时必填），屏幕阅读器可识别
 *  - 44×44 最小命中区（移动端触控友好），图标居中
 */
const IconButton = React.memo(function IconButton({
  label,
  onClick,
  children,
  size = 40,
  disabled = false,
  active = false,
  className = '',
  title,
  ...rest
}) {
  return (
    <button
      type="button"
      className={`wc-icon-btn${active ? ' is-active' : ''} ${className}`.trim()}
      aria-label={label}
      aria-pressed={active || undefined}
      title={title || label}
      disabled={disabled}
      onClick={onClick}
      style={{ width: size, height: size }}
      {...rest}
    >
      {children}
    </button>
  );
});

export default IconButton;
