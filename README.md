# v信

私有化部署的私密通讯应用 —— 聊天、朋友圈、收藏，三端实时同步。

## 项目结构

| 目录 | 说明 |
|------|------|
| `landing/` | 营销落地页（Next.js 静态导出） |
| `backend-v2/` | 后端服务 |
| `android/` | Android 原生客户端 |
| `ios/` | iOS 原生客户端 |

各目录内有独立的 README / 构建说明，详见对应子目录。

## 版本与发布

各端为独立产品线，版本号以各自 manifest 为单一真相源（桌面 2.x / 移动 1.x），
**不强行统一**。发布 tag 一律带端前缀，各触发各的工作流：

| tag 形态 | 触发 | 用途 |
|---------|------|------|
| `desktop-v<版本>` | `windows-build.yml` | 桌面端打包 + 部署更新源 |
| `android-v<版本>` | `android-release.yml` | 安卓签名 APK + 部署 |

> ⚠️ 禁止再打裸 `v*` tag（会同时误触发多端发布）。完整规范见 [VERSIONING.md](./VERSIONING.md)。
