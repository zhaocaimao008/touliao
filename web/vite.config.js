import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import viteCompression from 'vite-plugin-compression';
import { promisify } from 'node:util';
import { brotliCompress as brotliCompressCb, constants as zlibConstants } from 'node:zlib';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Service Worker 脚本（public/sw.js、public/push-sw.js）每次构建都必须产出新的 .gz：线上 nginx
// 开了 gzip_static，deploy.yml 用 `rsync -a`（不带 --delete）发布 dist/。脚本一旦小于压缩阈值
// 而不再产出 .gz，/var/www 里上一版的 sw.js.gz 会留下并被优先发给所有支持 gzip 的浏览器，
// 浏览器拿到的仍是旧 worker，退役版 sw.js 永远生效不了。所以这两个文件不设阈值。
const SW_SCRIPT = /[\\/](?:sw|push-sw)\.js$/;
const COMPRESSIBLE = /\.(?:js|mjs|json|css|html)$/i; // vite-plugin-compression 的默认过滤

const PRECOMPRESS_THRESHOLD = 1024;

// .br 预压缩：给 deploy/nginx/snippets/touliao-brotli.conf 的 brotli_static 用（nginx 尚未装 brotli
// 模块时 .br 只是躺在 /var/www 里不会被发送，无害）。规则与 .gz 完全一致：同一过滤、普通资源 1KB 阈值、
// SW 脚本不设阈值（理由同上：brotli_static 同样会优先发残留的旧 sw.js.br）。
// 不用 vite-plugin-compression 再开一个 brotliCompress 实例：0.5.1 的 mtime 缓存是模块级共享的，
// gzip 实例处理过的文件会被第二个实例当成"未变化"跳过，结果一个 .br 都不产（实测）。
// desktop 构建（Electron 走 file:// 直接读 dist，整个 dist 打进安装包）用不上预压缩文件，不产 .br。
const brotliCompress = promisify(brotliCompressCb);
async function listFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(full));
    else out.push(full);
  }
  return out;
}
function brotliPrecompress() {
  let outDir;
  return {
    name: 'touliao-brotli-precompress',
    apply: 'build',
    enforce: 'post',
    configResolved(config) { outDir = path.resolve(config.root, config.build.outDir); },
    async closeBundle() {
      const files = (await listFiles(outDir)).filter(f => COMPRESSIBLE.test(f));
      await Promise.all(files.map(async file => {
        const buf = await readFile(file);
        if (!SW_SCRIPT.test(file) && buf.length < PRECOMPRESS_THRESHOLD) return;
        const br = await brotliCompress(buf, { params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
          [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
          [zlibConstants.BROTLI_PARAM_SIZE_HINT]: buf.length,
        } });
        await writeFile(`${file}.br`, br);
      }));
    },
  };
}

export default defineConfig(({ mode }) => ({
  // desktop(Electron file:// 加载) 必须用相对路径，否则 /assets/... 指向磁盘根目录白屏
  base: mode === 'desktop' ? './' : '/',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '8.0.0'),
  },
  plugins: [
    react(),
    viteCompression({ algorithm: 'gzip', ext: '.gz', threshold: PRECOMPRESS_THRESHOLD, deleteOriginFile: false,
      filter: file => COMPRESSIBLE.test(file) && !SW_SCRIPT.test(file) }),
    viteCompression({ algorithm: 'gzip', ext: '.gz', threshold: 0, deleteOriginFile: false, filter: SW_SCRIPT }),
    ...(mode === 'desktop' ? [] : [brotliPrecompress()]),
  ],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    minify: 'esbuild',
    target: 'es2020',
    cssCodeSplit: true,   // 开启 CSS 按 chunk 拆分：auth.css 随 Login 懒加载
    rollupOptions: {
      external: (id) => id.startsWith('@capacitor/'),
      output: {
        // 分桶用 rolldown 的 codeSplitting.groups 而不是 manualChunks：
        // manualChunks 对编译期注入的虚拟模块（\0vite/preload-helper、
        // \0@oxc-project+runtime/helpers/*）返回的分组会被 rolldown 忽略，rolldown 自行
        // 把它们并进「体积最大的共同消费者」——实测并进了 vendor-pdf。后果是入口 chunk
        // 为了拿 defineProperty / __vitePreload 两个 helper 函数，静态 import 了整个
        // pdf.js（467KB / gzip 139KB）：所有用户（包括还停在登录页、一辈子不打开 PDF 的）
        // 冷启动都要下载+解析它，把下面几个懒加载分桶的收益全部抵消。
        // groups 支持 test 函数且对虚拟模块生效，故用它把 helper 固定到 vendor-runtime。
        // priority 越大越先匹配；同 priority 按声明序。
        codeSplitting: {
          groups: [
            // 编译期注入的运行时 helper（id 以 \0 开头的虚拟模块）：必须自成一块，
            // 否则就会重演上面说的「入口静态引用 pdf.js」。
            { name: 'vendor-runtime', priority: 100, test: (id) => id.charCodeAt(0) === 0 },

            { name: 'vendor-react',  priority: 90, test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/ },
            { name: 'vendor-socket', priority: 90, test: /node_modules[\\/](socket\.io-client|socket\.io-parser|engine\.io-client|engine\.io-parser)[\\/]/ },
            { name: 'vendor-jsqr',   priority: 90, test: /node_modules[\\/]jsqr[\\/]/ },   // QR 扫描，仅扫码时加载

            // 文档预览四件套体积很大(pdf.js+docx-preview+xlsx+jszip 合计超1MB)，且只在
            // 用户真正点开 PDF/Word/Excel/PPT 消息时才用得到（FilePreview.jsx 里全部是
            // await import() 动态引入）。必须单独分桶，否则会被下面的 catch-all 'vendor'
            // 一起打进主包，拖慢所有用户的首屏加载——哪怕他们从不打开任何文档。
            { name: 'vendor-pdf',    priority: 90, test: /node_modules[\\/]pdfjs-dist[\\/]/ },
            { name: 'vendor-docx',   priority: 90, test: /node_modules[\\/]docx-preview[\\/]/ },
            { name: 'vendor-xlsx',   priority: 90, test: /node_modules[\\/]xlsx[\\/]/ },
            { name: 'vendor-jszip',  priority: 90, test: /node_modules[\\/]jszip[\\/]/ },

            // dompurify 只被 DocumentRenderers（Excel 预览）动态 import；qrcode 当前无前端引用
            // （二维码由服务端生成）。二者必须各自成块：若与 axios 同组，入口为拿 axios
            // 会把它们一起拉下来，登录页白白多下载/解析。
            { name: 'vendor-dompurify', priority: 85, test: /node_modules[\\/]dompurify[\\/]/ },
            { name: 'vendor-qrcode',    priority: 85, test: /node_modules[\\/](qrcode|pngjs|dijkstrajs)[\\/]/ },
            { name: 'vendor-misc',   priority: 80, test: /node_modules[\\/](axios|timeago\.js)[\\/]/ },
            { name: 'vendor',        priority: 10, test: /node_modules/ },
          ],
        },
        chunkFileNames:  'assets/[name]-[hash].js',
        entryFileNames:  'assets/[name]-[hash].js',
        // Module workers need a JavaScript MIME type under strict nosniff.
        // Many static hosts do not map .mjs; .js is consistently served as JS.
        assetFileNames: asset => asset.names.some(name => name.endsWith('.mjs'))
          ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash].[ext]',
      },
    },
    chunkSizeWarningLimit: 800,
  },
  server: {
    port: 5173,
    proxy: {
      '/api':       { target: 'http://localhost:3003', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3003', changeOrigin: true, ws: true },
    },
  },
}));
