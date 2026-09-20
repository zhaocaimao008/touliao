// 独立的 vitest 配置：不复用 app 的 vite.config.js（其 ESM 插件在 CJS 环境下
// 加载冲突）。当前单测均为纯逻辑（reducer 等），无需 React 插件与 DOM 环境。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.{js,jsx}'],
    environment: 'node',
  },
});
