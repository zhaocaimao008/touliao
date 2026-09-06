export const MAX_MOMENT_VIDEO_BYTES = 200 * 1024 * 1024;

const VIDEO_EXTENSIONS = new Set([
  'mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'flv',
  'mpg', 'mpeg', '3gp', '3g2', 'ogv',
]);

export function validateMomentVideo(file) {
  if (!file || file.size === 0) return 'empty';
  if (file.size > MAX_MOMENT_VIDEO_BYTES) return 'too-large';
  const extension = String(file.name || '').split('.').pop().toLowerCase();
  if (!VIDEO_EXTENSIONS.has(extension)) return 'unsupported';
  return null;
}
