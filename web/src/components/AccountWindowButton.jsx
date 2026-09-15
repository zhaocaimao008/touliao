import React from 'react';
import './AccountWindowButton.css';
import { openAccountWindow } from '../utils/clientStorage';

export default function AccountWindowButton() {
  if (window.Capacitor?.isNativePlatform?.()) return null;
  return <button type="button" className="auth-window-button" onClick={openAccountWindow}>打开独立账号窗口</button>;
}
