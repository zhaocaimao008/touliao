/** @type {import('next').NextConfig} */
const nextConfig = {
  // 静态导出：next build 产出纯静态 out/，可托管到任意静态主机（Cloudflare Pages / Nginx 等）
  output: 'export',
  // 落地页托管在 dipsin.com/welcome 子路径（根路径 / 留给 Web 应用）。
  // basePath 让导出产物的资源路径(_next 等)与内部链接都带 /welcome 前缀，
  // 否则子路径下绝对资源路径 /_next/* 会被根应用接管而 404。
  basePath: '/welcome',

  // 静态导出下无服务端图片优化，关闭以直接使用 <img>/next-image 原图
  images: { unoptimized: true },
  // 目录式路由，输出 about/index.html 这种结构，静态主机更友好
  trailingSlash: true,
};

export default nextConfig;
