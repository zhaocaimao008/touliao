import tokens from './tokens.json';

export const AVATAR_TIERS = Object.freeze(tokens.components.avatar.sizes);
export const AVATAR_ROLES = Object.freeze(tokens.components.avatar.roles);
export function avatarPx(size = 'list') {
  const resolved = AVATAR_TIERS[AVATAR_ROLES[size] || size];
  if (resolved) return resolved;
  // Existing numeric callers and old numeric strings retain their actual size.
  const value = typeof size === 'number' || /^\d+(\.\d+)?$/.test(size) ? Number(size) : NaN;
  return Number.isFinite(value) && value > 0 ? value : AVATAR_TIERS[AVATAR_ROLES.list];
}
