import React, { Suspense, lazy } from 'react';
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SettingsProvider } from './contexts/SettingsContext';
import { I18nProvider } from './contexts/I18nContext';
import { SocketProvider } from './contexts/SocketContext';
import ElectronTitlebar from './components/ElectronTitlebar';
import ErrorBoundary from './components/ErrorBoundary';

// 路由级代码分割：每个页面拆成独立 chunk，减小首屏 bundle。
// Home 体量最大（聊天主页 + ChatWindow 等），懒加载收益最高。
const Login          = lazy(() => import('./pages/Login'));
const Register       = lazy(() => import('./pages/Register'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const Home           = lazy(() => import('./pages/Home'));

// Electron 使用 HashRouter（file:// 不支持 pushState）；Web 用 BrowserRouter
const Router = window.__ELECTRON_CONFIG__ ? HashRouter : BrowserRouter;

// 懒加载页面切换时的加载态（与 PrivateRoute 的 loading 视觉一致）
const RouteFallback = () => (
  <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh' }}>加载中…</div>
);

const PrivateRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh' }}>加载中…</div>;
  return user ? children : <Navigate to="/login" />;
};

export default function App() {
  const isElectron = !!window.__ELECTRON_CONFIG__;
  return (
    // 最外层兜底：任何子树渲染异常都降级为友好错误页，绝不白屏
    <ErrorBoundary>
    <I18nProvider>
    <SettingsProvider>
    <AuthProvider>
      {/* ── Skip-link：无障碍跳过导航 ── */}
      <a href="#main-content" className="skip-link" style={{
        position: 'absolute', left: '-9999px', zIndex: 9999,
        padding: '8px 16px', background: 'var(--color-primary, #6D5AE6)', color: '#fff',
        fontSize: 14, textDecoration: 'none', borderRadius: '0 0 4px 0',
      }}>跳过导航，直达内容</a>
      {isElectron && <ElectronTitlebar />}
      <div id="main-content" role="main" style={isElectron ? { paddingTop: 30, height: '100vh', boxSizing: 'border-box', overflow: 'hidden' } : {}}>
        <Router>
          {/* Suspense 兜底懒加载 chunk 拉取期间的加载态 */}
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/*" element={
                <PrivateRoute>
                  {/* 内层边界：聊天主页崩溃时不连累已登录外壳，可单独重试 */}
                  <ErrorBoundary>
                    <SocketProvider>
                      <Home />
                    </SocketProvider>
                  </ErrorBoundary>
                </PrivateRoute>
              } />
            </Routes>
          </Suspense>
        </Router>
      </div>
    </AuthProvider>
    </SettingsProvider>
    </I18nProvider>
    </ErrorBoundary>
  );
}
