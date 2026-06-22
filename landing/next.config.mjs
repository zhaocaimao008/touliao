/** @type {import('next').NextConfig} */
const nextConfig = {
  // 静态导出：next build 产出纯静态 out/，可托管到任意静态主机（Cloudflare Pages / Nginx 等）
  output: 'export',
  // 静态导出下无服务端图片优化，关闭以直接使用 <img>/next-image 原图
  images: { unoptimized: true },
  // 目录式路由，输出 about/index.html 这种结构，静态主机更友好
  trailingSlash: true,
};

export default nextConfig;
