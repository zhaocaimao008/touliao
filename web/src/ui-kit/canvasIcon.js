import registry from './icon-registry.json';
import paths from './icon-paths.json';
import tokens from './tokens.json';

// Browser tab favicons need a bitmap. Geometry still belongs to the semantic registry.
export function iconFavicon(name) {
  const shapes = paths[registry.icons[name]];
  if (!shapes || shapes.some(([tag]) => tag !== 'path')) {
    throw new Error(`Favicon requires a registered path icon: ${name}`);
  }
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  const palette = tokens.color[document.body.classList.contains('dark-mode') ? 'dark' : 'light'];
  context.fillStyle = getComputedStyle(document.body).getPropertyValue('--icon-danger').trim() || palette.danger;
  context.beginPath();
  context.arc(32, 32, 32, 0, Math.PI * 2);
  context.fill();
  const size = registry.sizes.xl;
  context.translate((64 - size) / 2, (64 - size) / 2);
  context.scale(size / registry.viewBox[2], size / registry.viewBox[3]);
  context.strokeStyle = palette.iconOnDark;
  context.lineWidth = registry.strokeWidth;
  context.lineCap = registry.linecap;
  context.lineJoin = registry.linejoin;
  for (const [, attributes] of shapes) context.stroke(new Path2D(attributes.d));
  return canvas.toDataURL('image/png');
}
