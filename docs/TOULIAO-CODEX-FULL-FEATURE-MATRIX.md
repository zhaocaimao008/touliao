# 投聊全功能矩阵（2026-08-31）

| 功能 | Backend | Web | Windows | Android | iOS | 总结 |
|---|---|---|---|---|---|---|
| 登录/注册/登出 | `CI_PASS` | `RUNTIME_PASS` | `PARTIAL` | `CODE_PASS` | `CODE_PASS` | 桌面/真机需实测 |
| 文本消息+ACK | `CI_PASS` | `RUNTIME_PASS` | `PARTIAL` | `CODE_PASS` | `CODE_PASS` | 无统一 sequence |
| client_msg_id 幂等 | `CI_PASS` | `PARTIAL` | `PARTIAL` | `CODE_PASS` | `CODE_PASS` | Web 全套 E2E 有 1 次 flake |
| 离线/断线补拉 | `PARTIAL` | `RUNTIME_PASS` | `PARTIAL` | `FAIL` | `CODE_PASS` | Android 缺 reconnect catch-up |
| 多设备同步 | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | 消息删/撤已有，呼出通话未齐 |
| 已读/未读 | `CI_PASS` | `RUNTIME_PASS` | `PARTIAL` | `CODE_PASS` | `CODE_PASS` | 真机后台与多设备需测 |
| 撤回（UI 无痕） | `CI_PASS` | `RUNTIME_PASS` | `PARTIAL` | `CODE_PASS` | `CODE_PASS` | 跨端历史/搜索需真机回归 |
| 个人删除 | `CI_PASS` | `CODE_PASS` | `PARTIAL` | `CODE_PASS` | `CODE_PASS` | 多设备运行态未全测 |
| 好友搜索/申请/接受/拒绝 | `CI_PASS` | `RUNTIME_PASS` | `PARTIAL` | `CODE_PASS` | `CODE_PASS` | Web 申请/拒绝同步 E2E 通过 |
| 删除/重加/拉黑/备注 | `CI_PASS` | `CODE_PASS` | `PARTIAL` | `CODE_PASS` | `CODE_PASS` | 缺四端运行矩阵 |
| 建群/群发/退群 | `CI_PASS` | `RUNTIME_PASS` | `PARTIAL` | `CODE_PASS` | `CODE_PASS` | Web E2E 通过 |
| 邀请/踢人/解散/管理员 | `CI_PASS` | `CODE_PASS` | `PARTIAL` | `CODE_PASS` | `CODE_PASS` | 越权有测试，真机同步未齐 |
| 超大群实时消息 | `CODE_PASS` | `CODE_PASS` | `CODE_PASS` | `CODE_PASS` | `FAIL` | iOS 未消费 notify |
| 图片 | `CI_PASS` | `RUNTIME_PASS` | `PARTIAL` | `CODE_PASS` | `CODE_PASS` | Web 上传/灯箱 E2E 通过 |
| 视频 | `CI_PASS` | `CODE_PASS` | `PARTIAL` | `CODE_PASS` | `CODE_PASS` | 跨端真机 required |
| 语音/音频 | `CI_PASS` | `CODE_PASS` | `PARTIAL` | `CODE_PASS` | `CODE_PASS` | 跨端真机 required |
| PDF/Word/Excel/PPT/TXT | `CODE_PASS` | `CODE_PASS` | `PARTIAL` | `CODE_PASS` | `CODE_PASS` | 支持与降级策略不完全一致 |
| 大文件/分片 | `CI_PASS` | `RUNTIME_PASS` | `PARTIAL` | `CODE_PASS` | `CODE_PASS` | Web 9 MB E2E 通过 |
| 附件权限/Range | `CI_PASS` | `RUNTIME_PASS` | `PARTIAL` | `REAL_DEVICE_REQUIRED` | `REAL_DEVICE_REQUIRED` | 生产库附件孤儿待处理 |
| 1v1 语音/视频通话 | `PARTIAL` | `RUNTIME_PASS` | `REAL_DEVICE_REQUIRED` | `REAL_DEVICE_REQUIRED` | `REAL_DEVICE_REQUIRED` | Web 信令通过，媒体非跨网真机 |
| 多设备响铃/呼出态 | `PARTIAL` | `FAIL` | `FAIL` | `FAIL` | `FAIL` | `call:outgoing` 无客户端消费 |
| STUN/TURN | `CODE_PASS` | `REAL_DEVICE_REQUIRED` | `REAL_DEVICE_REQUIRED` | `REAL_DEVICE_REQUIRED` | `REAL_DEVICE_REQUIRED` | 临时凭据代码正确，relay 未实测 |
| 推送/通知 | `CODE_PASS` | `CODE_PASS` | `PARTIAL` | `REAL_DEVICE_REQUIRED` | `REAL_DEVICE_REQUIRED` | 锁屏/杀进程需真机 |
| 弱网 outbox | `CODE_PASS` | `PARTIAL` | `PARTIAL` | `CODE_PASS` | `CODE_PASS` | 全套 E2E 1 flake |
| 搜索/收藏/动态/红包/钱包 | `CI_PASS` | `CODE_PASS` | `PARTIAL` | `CODE_PASS` | `CODE_PASS` | 非最高优先级，缺全端运行测试 |

Windows 与 Web 共用渲染层，因此“有代码”通常对齐，但 Windows 的文件系统、更新、通知、媒体设备、休眠恢复不能由 Web E2E 代替。
