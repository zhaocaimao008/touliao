/** Native disabled controls lose focus; restore it only if the user has not moved on. */
export async function keepSettingFocus(action) {
  const control = document.activeElement;
  try {
    return await action();
  } finally {
    requestAnimationFrame(() => {
      if (document.activeElement === document.body && control?.isConnected && !control.disabled) {
        control.focus({ preventScroll: true });
      }
    });
  }
}
