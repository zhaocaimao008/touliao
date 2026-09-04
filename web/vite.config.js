import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import viteCompression from 'vite-plugin-compression';

export default defineConfig(({ mode }) => ({
  // desktop(Electron file:// 加载) 必须用相对路径，否则 /assets/... 指向磁盘根目录白屏
  base: mode === 'desktop' ? './' : '/',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '8.0.0'),
  },
  plugins: [
    react(),
    viteCompression({ algorithm: 'gzip', ext: '.gz', threshold: 1024, deleteOriginFile: false }),
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

            { name: 'vendor-misc',   priority: 80, test: /node_modules[\\/](axios|timeago\.js|dompurify|qrcode)[\\/]/ },
            { name: 'vendor',        priority: 10, test: /node_modules/ },
          ],
        },
        chunkFileNames:  'assets/[name]-[hash].js',
        entryFileNames:  'assets/[name]-[hash].js',
        assetFileNames:  'assets/[name]-[hash].[ext]',
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
