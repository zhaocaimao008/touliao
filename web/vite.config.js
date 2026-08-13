import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import viteCompression from 'vite-plugin-compression';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '8.0.0'),
  },
  plugins: [
    react(),
    viteCompression({ algorithm: 'gzip', ext: '.gz', threshold: 8192, deleteOriginFile: false }),
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
      '/api':       { target: 'http://localhost:3002', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3002', changeOrigin: true, ws: true },
    },
  },
});
