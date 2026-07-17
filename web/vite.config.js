import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// desktop 模式：vite build --mode desktop
// web 模式（默认）：vite build
const isDesktop = (mode) => mode === 'desktop';

export default defineConfig(({ mode, command }) => ({
  // 单文件内联仅用于 desktop(Electron file://) 与移动端(Capacitor) 打包；
  // 纯 web 构建走多 chunk + 路由级代码分割，减小首屏体积。
  plugins: [react(), ...(isDesktop(mode) ? [viteSingleFile()] : [])],
  publicDir: 'public',

  // desktop 构建使用相对路径，保证 file:// 协议下 public/ 静态资源可寻址
  // viteSingleFile 将所有 JS/CSS 内联进 index.html，base 主要影响非内联资源
  base: isDesktop(mode) ? './' : '/',

  // ── oxc (Vite 8+)：所有 build 命令均剥离 console.* / debugger
  // 用 command==='build' 而非检查 mode 名，防止 --mode staging 等非标准 mode 漏掉
  oxc: command === 'build' ? {
    drop: ['console', 'debugger'],
    legalComments: 'none',
  } : undefined,

  build: {
    sourcemap:             false,
    cssCodeSplit:          false,
    chunkSizeWarningLimit: 1000,
    minify:                'esbuild',

    rollupOptions: {
      output: {
        // desktop/移动端：不分包（viteSingleFile 内联一切）；
        // 纯 web：拆出稳定第三方库为长缓存 vendor chunk，
        //         页面级 chunk 由 App.jsx 的 React.lazy 自动产生。
        manualChunks: isDesktop(mode) ? undefined : (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('react-router')) return 'vendor-router';
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react';
            if (id.includes('socket.io')) return 'vendor-socket';
            if (id.includes('axios')) return 'vendor-axios';
            return 'vendor';
          }
        },
        entryFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },

  server: {
    proxy: {
      '/api':       'http://localhost:3002',
      '/uploads':   'http://localhost:3002',
      '/socket.io': { target: 'http://localhost:3002', ws: true },
    },
  },
}));
