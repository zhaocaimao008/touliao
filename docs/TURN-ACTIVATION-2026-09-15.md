# TURN 启用记录

## 当前状态

用户确认已添加云防火墙规则后，2026-09-15 15:03 UTC 已将投聊专用 TURN 配置启用到生产后端。
后端版本保持 8.0.5，客户端无需因本次配置启用重新构建；Web、Windows、Android、iOS 的新通话通过现有凭据接口获取 ICE 配置。

- UDP 3478、TCP 3478、TLS/TCP 5349 三个入口。
- UDP 中继端口范围 41000-41999；配置沿用原有鉴权、配额和私网目标限制。
- 临时凭据有效期 3600 秒，永久共享密钥不下发客户端，不进入 Git。
- 保留原 STUN 及直连能力，客户端在需要时使用 TURN，不强制所有正式通话走中继。

## 验证

- [第一轮外网测试](https://github.com/zhaocaimao008/touliao/actions/runs/34984869549)：三个入口真实 Allocate 成功，无效凭据被拒绝，合并 ICE 配置的 relay-only 双向音视频及数据通道通过。
- 将测试加强为每次只允许一个 TURN URL，避免合并配置掩盖某个入口的媒体故障。
- [首次单通道测试](https://github.com/zhaocaimao008/touliao/actions/runs/34985146007)曾出现 UDP 媒体连接超时，三种传输的 Allocate 均正常。未在此时启用生产；保留失败记录并增加 ICE 诊断和逐通道结果输出，没有取消失败门禁或增加自动重试吞错。
- [增强诊断后的测试](https://github.com/zhaocaimao008/touliao/actions/runs/34985581593)和[独立复测](https://github.com/zhaocaimao008/touliao/actions/runs/34985820925)连续通过。UDP、TCP、TLS 各自均确认双方候选为 relay、收到音频包、解码视频帧、数据通道双向收发成功。
- 上述 UDP 超时未重现，尚不能确定其具体原因，不能把后续成功解释为已定位并修复所有网络抖动。
- TURN 协议 5 项单测及 shell 合约检查通过，测试脚本语法检查通过。
- 生产 `GET /api/turn/credentials` 使用专用临时测试身份验证：Bearer 和 Cookie 两种登录方式都返回三个 TURN URL，HMAC 与实际配置一致，TTL 为 3600 秒；未登录、过期 JWT、撤销后的会话均返回 401。
- 临时身份及会话已清理。数据库完整性正常、外键错误 0；测试前后用户 13、消息 107、会话 11、登录会话 16、迁移 154 未变。
- 生产健康检查正常；公网 Web 资源保持原构建，桌面和手机登录页裂图 0、脚本错误 0、水平溢出 0。
- 部署后[私有异地备份及恢复验证](https://github.com/zhaocaimao008/touliao-private-backups/actions/runs/34985935339)通过。

## 变更边界

只向生产 `.env` 合并 `TURN_SECRET`、`TURN_URLS`、`TURN_TTL`，其他配置逐项核对未变，权限保持 600。
仅重启 `touliao-backend`，PID 为 540974，重启计数由 15 增至 16，后续未发生额外重启。
另外三个项目进程 PID 未变，投聊和 newchat 的 coturn 容器均未重启；原有移动分身草稿未修改或提交。

私有证据目录：`/home/ubuntu/touliao-turn-activation-evidence-20260915`，包括启动前配置、配置哈希、生产接口结果及外网测试日志，不要整体上传。
该目录中的 `activate-turn.cjs rollback` 只在当前配置仍匹配本次启用结果时恢复原配置，随后需要单独重启投聊后端。

## 剩余验收

云端浏览器验证使用合成音视频及同一 TURN 服务器，不能替代不同运营商真机、锁屏来电、长通话及负载验收，也不是整个中继端口范围的逐端口扫描。
Windows 发布者证书仍是独立未完成事项，不受本次 TURN 启用影响。
