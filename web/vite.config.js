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
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) return 'vendor-react';
          if (id.includes('socket.io-client')) return 'vendor-socket';
          if (id.includes('jsqr'))   return 'vendor-jsqr';  // QR 扫描，仅扫码时加载
          if (id.includes('@capacitor')) return null;        // Capacitor 动态加载，不打包
          // 文档预览四件套体积很大(pdf.js+docx-preview+xlsx+jszip 合计超1MB)，且只在
          // 用户真正点开 PDF/Word/Excel/PPT 消息时才用得到（FilePreview.jsx 里全部是
          // await import() 动态引入）。必须单独分桶，否则会被下面的 catch-all 'vendor'
          // 一起打进主包，拖慢所有用户的首屏加载——哪怕他们从不打开任何文档。
          if (id.includes('pdfjs-dist'))   return 'vendor-pdf';
          if (id.includes('docx-preview')) return 'vendor-docx';
          if (id.includes('/xlsx/'))       return 'vendor-xlsx';
          if (id.includes('jszip'))        return 'vendor-jszip';
          if (id.includes('axios') || id.includes('timeago') || id.includes('dompurify') || id.includes('qrcode'))
            return 'vendor-misc';
          return 'vendor';
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
