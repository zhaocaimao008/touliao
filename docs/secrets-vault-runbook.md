# 投聊凭据保险库 · 换服务器免重办指南（2026-09-07 启用）

## 为什么存在
2026-09 旧服务器（Vultr 日服 45.77.131.33）宕机时，推送凭据（个推/APNs/FCM/VAPID）随旧机
`.env` 一起丢失，新机必须逐个去各平台后台重办。为杜绝再发生，本机建立 **GPG-AES256 加密保险库**：
推送与后端凭据全部进库，换服务器 = 解包即用，**不需要再登 Apple / 个推后台**。

## 保险库位置（当前生产机 13.212.117.22）
- 加密包：`/root/touliao-secrets-vault/touliao-secrets-<日期>.gpg`（每跑一次备份脚本生成新包）
- 口令文件：`/root/touliao-secrets-vault/.passphrase`（root 600）
- 备份脚本：`/root/touliao-secrets-vault/backup-vault.sh`
- 追加密钥目录：`/root/touliao-secrets-vault/extra/`（放 p8 / firebase json / getui 文本等，会随包加密）
- 用户副本：`/home/ubuntu/touliao-secrets-<日期>.gpg`（**请下载保存到你自己的网盘/邮箱/密码管理器**）
- **口令**：由 Hermes 在对话中交付过，请保存在你的密码管理器；口令只此一份人读副本，丢了等于密文不可解

## 何时跑备份（一条命令）
改了 `backend-v2/.env`（换 JWT、改推送、加配置）或往 `extra/` 放了新密钥文件之后：
```
sudo bash /root/touliao-secrets-vault/backup-vault.sh
sudo cp /root/touliao-secrets-vault/touliao-secrets-<最新>.gpg /home/ubuntu/   # 顺手更新用户副本
```

## 待入库清单（当前缺，拿到就跑一次备份）
- [ ] iOS APNs：Apple Developer → Keys 新建 APNs key → 下载的 `.p8` 放 `extra/apns-key.p8`
      （同时抄下 Key ID 与 Team ID → 之后写进 `.env` 的 APNS_P8/APNS_KEY_ID/APNS_TEAM_ID）
- [ ] Android 个推：个推开发者平台应用详情页的 AppKey/AppSecret/MasterSecret 记录文本
      → `extra/getui.txt`（AppID 可从现网 APK manifest 用 aapt2 读回）
- [ ] （可选）FCM service account json → `extra/firebase-service.json`
- 已入库：VAPID 公/私钥（Web Push）、JWT_SECRET、ADMIN 凭据、后端全部 `.env`

## 换服务器恢复步骤（新机）
1. 装 gpg：`apt install gpg`
2. 拿到加密包 + 口令（从你的网盘/密码管理器）
3. 解密：
   ```
   gpg -d touliao-secrets-<日期>.gpg > /tmp/v.tar.gz && tar xzf /tmp/v.tar.gz -C <后端目录>/
   # extra/ 内的 p8/firebase/getui 文件放到对应路径
   ```
4. 按仓库 README/部署文档启动后端（`pm2 start`），推送直接可用——**无需重申请任何凭证**
5. 验证：`curl /api/notifications/vapid-public-key` 返回 200；`pm2 logs touliao-backend` 无推送报错

## 纪律
- 加密包可以放任何地方（含公开网盘）——无口令不可解；**口令绝不与包同放一处**
- 密钥永不进 git（仓库历史已确认无凭据提交）
- 每次凭据变动必须重跑备份脚本，保持库为最新
