import tokens from './tokens.json';

export function feedbackDuration(message, kind = 'info') {
  const t = tokens.components.toast;
  const base = kind === 'error' ? t.errorDuration : t.duration;
  return Math.min(t.maximumDuration, Math.max(base, Array.from(String(message)).length * t.readMillisPerCharacter));
}
