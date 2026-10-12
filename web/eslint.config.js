import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'dist-electron/**', 'build/**', 'node_modules/**', 'android/**', 'ios/**', 'electron/**', 'public/sw/**', 'scripts/check-capacitor-versions.mjs', '*.config.js', 'fix-css.py'] },
  js.configs.recommended,
  {
    // public/sw.js（退役版 worker）：经典脚本，运行在 ServiceWorkerGlobalScope。npm run lint（CI 用）
    // 会查它；ecmaVersion 2019 = 旧版 sw.js 已用到的语法上限，保证跑得动旧 worker 的浏览器都能装上。
    files: ['public/sw.js'],
    languageOptions: { ecmaVersion: 2019, sourceType: 'script', globals: { ...globals.serviceworker } },
  },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, __APP_VERSION__: 'readonly' },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: '18.2' } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      // React Compiler stylistic rules → warn (not real bugs in this codebase's
      // intentional external-sync effects); real bug-catchers stay as errors.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/globals': 'warn',
    },
  },
];
