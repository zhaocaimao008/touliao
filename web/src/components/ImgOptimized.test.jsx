import { expect, test, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ImgOptimized from './ImgOptimized';

vi.mock('../utils/url', () => ({ getThumbUrl: src => src.replace(/\.png$/, '_thumb.webp') }));

// 首个 useState 是"已进入视口"：服务端渲染没有 IntersectionObserver，直接置为可见；其余 state 取初值
const hooks = vi.hoisted(() => ({ cursor: 0 }));
vi.mock('react', async original => ({ ...(await original()),
  useState: initial => [hooks.cursor++ === 0 ? true : (typeof initial === 'function' ? initial() : initial), () => {}],
}));

test('渐进加载的原图层铺满容器，不按原始像素尺寸绘制', () => {
  const html = renderToStaticMarkup(<ImgOptimized src="/uploads/files/a.png" data-testid="msg-image" />);
  const imgs = html.match(/<img[^>]*>/g);
  expect(imgs).toHaveLength(2);
  expect(imgs[0]).toContain('a_thumb.webp');
  expect(imgs[1]).toContain('src="/uploads/files/a.png"');
  expect(imgs[1]).toMatch(/width:100%/);
  expect(imgs[1]).toMatch(/height:100%/);
  expect(imgs[1]).toMatch(/object-fit:cover/);
});
