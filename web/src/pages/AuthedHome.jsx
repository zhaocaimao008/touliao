import React from 'react';
import { SocketProvider } from '../contexts/SocketContext';
import { FilePreviewProvider } from '../contexts/FilePreviewContext';
import Home from './Home';

// 已登录区域外壳：SocketProvider（及 socket.io-client）随 Home 分包一起懒加载，
// 登录页/注册页首屏不再下载、解析 socket.io-client。
export default function AuthedHome() {
  return (
    <SocketProvider>
      <FilePreviewProvider><Home /></FilePreviewProvider>
    </SocketProvider>
  );
}
