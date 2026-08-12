# 🚀 自动化部署完整指南

## 概述

本系统提供**完全自动化的部署流程**，包括：
- ✅ 自动代码更新
- ✅ 自动依赖安装
- ✅ 自动测试运行
- ✅ 自动灰度部署（3阶段）
- ✅ 自动实时监控
- ✅ 自动故障回滚

**一个命令就能完成所有事！**

---

## 快速开始

### 方式1: 直接运行（推荐）

```bash
# 进入项目目录
cd /root/v信/backend-v2

# 运行自动部署脚本
./auto-deploy.sh
```

**就这么简单！** 脚本会自动完成所有部署步骤。

### 方式2: 后台运行

```bash
# 在后台运行，保存日志
nohup ./auto-deploy.sh > deployment_$(date +%Y%m%d_%H%M%S).log 2>&1 &

# 查看日志
tail -f deployment_*.log
```

### 方式3: 使用tmux（推荐用于服务器）

```bash
# 创建新的tmux会话
tmux new-session -d -s deploy -c /root/v信/backend-v2 './auto-deploy.sh'

# 查看日志
tmux attach-session -t deploy

# 分离（不停止）
# 按 Ctrl+B，然后按 D
```

---

## 自动化流程详解

### 步骤1: 预检查（5分钟）
```
✓ 检查 Node.js
✓ 检查 npm
✓ 检查 git
✓ 创建备份目录
```

### 步骤2: 代码和依赖（10分钟）
```
✓ 备份当前代码
✓ 更新代码 (git pull)
✓ 安装依赖 (npm install)
```

### 步骤3: 测试（5分钟）
```
✓ 运行所有测试
✓ 验证测试通过
✓ 如测试失败，中止部署并回滚
```

### 步骤4: 灰度部署 Phase 1（48小时）
```
✓ 启动服务（5% 用户）
✓ 每分钟采集指标
✓ 实时监控性能
✓ 自动检测问题
✓ 如有问题，自动回滚
✓ 如无问题，继续 Phase 2
```

### 步骤5: 灰度部署 Phase 2（48小时）
```
✓ 启动服务（20% 用户）
✓ 每分钟采集指标
✓ 实时监控性能
✓ 自动检测问题
✓ 如有问题，自动回滚
✓ 如无问题，继续 Phase 3
```

### 步骤6: 全量部署 Phase 3（持续）
```
✓ 启动服务（100% 用户）
✓ 持续监控
✓ 如有问题，自动回滚
```

---

## 监控指标

脚本每分钟检查以下指标：

| 指标 | 阈值 | 告警 | 回滚 |
|------|------|------|------|
| 推送成功率 | ≥98% | <95% | <90% |
| 平均延迟 | ≤100ms | >150ms | >200ms |
| 错误率 | ≤1% | >3% | >5% |

**示例**：如果成功率连续下降到 92%，脚本会自动：
1. 记录告警
2. 停止服务
3. 恢复之前的备份
4. 重启服务
5. 发送通知

---

## 日志文件

所有操作都会记录在日志中：

```bash
# 查看部署日志
cat deployment.log

# 实时监控日志
tail -f deployment.log

# 查看指标日志
cat metrics.log

# 查看告警日志
cat alerts.log
```

---

## 实时监控

除了脚本自动监控外，你也可以手动运行监控脚本：

```bash
# 在另一个终端运行
./monitor-deployment.sh

# 这会实时显示：
# ✓ 推送成功率
# ✓ 平均延迟
# ✓ 错误率
# ✓ 自动告警
```

---

## 自动回滚

脚本会在以下情况自动回滚：

1. **推送成功率 < 95%**
   ```
   触发: 自动停止服务
   恢复: 从最新备份恢复代码
   重启: 启动服务
   通知: 发送告警
   ```

2. **推送延迟 > 200ms**
   ```
   触发: 自动停止服务
   恢复: 从最新备份恢复代码
   重启: 启动服务
   通知: 发送告警
   ```

3. **错误率 > 5%**
   ```
   触发: 自动停止服务
   恢复: 从最新备份恢复代码
   重启: 启动服务
   通知: 发送告警
   ```

4. **服务进程停止**
   ```
   触发: 检测到进程不存在
   恢复: 从备份恢复并重启
   通知: 发送告警
   ```

---

## 手动回滚

如果需要手动回滚：

```bash
# 查看备份列表
ls -la backups/

# 恢复特定备份
cp -r backups/backup_20260812_120000/* .

# 重启服务
npm start
```

---

## 配置文件

自动部署配置在 `deployment-config.json` 中：

```json
{
  "deployment": {
    "strategy": "canary",
    "phases": [
      {"phase": 1, "percentage": 5, "duration_hours": 48},
      {"phase": 2, "percentage": 20, "duration_hours": 48},
      {"phase": 3, "percentage": 100}
    ]
  },
  "monitoring": {
    "check_interval_seconds": 60,
    "metrics": [...]
  },
  "rollback": {
    "auto_trigger": true,
    "conditions": [...]
  }
}
```

---

## 常见场景

### 场景1: 快速测试部署

```bash
# 只运行测试，不部署
npm test

# 手动启动服务
npm start
```

### 场景2: 部署中断，需要查看进度

```bash
# 查看日志
tail -f deployment.log

# 查看当前进程
ps aux | grep node

# 查看指标
cat metrics.log | tail -20
```

### 场景3: 部署出错，需要恢复

```bash
# 停止当前服务
kill $(cat /tmp/vxin.pid)

# 恢复最新备份
cp -r backups/backup_*/ .

# 重新启动自动部署
./auto-deploy.sh
```

### 场景4: 需要修改配置

```bash
# 编辑配置文件
nano deployment-config.json

# 重新运行部署
./auto-deploy.sh
```

---

## 故障排查

### 问题1: 部署脚本卡住

**症状**: 脚本在某个步骤不动了

**解决**:
```bash
# 查看日志最后几行
tail -50 deployment.log

# 检查服务状态
curl http://127.0.0.1:3000/api/metrics

# 如需强制停止
pkill -f "npm start"
```

### 问题2: 自动回滚被触发

**症状**: 看到"触发自动回滚"的消息

**查看原因**:
```bash
# 查看告警日志
cat alerts.log

# 查看指标
cat metrics.log | tail -20
```

### 问题3: 无法连接到服务

**症状**: "无法连接到服务"的错误

**解决**:
```bash
# 检查服务是否运行
ps aux | grep node

# 检查端口占用
lsof -i :3000

# 手动启动
npm start
```

---

## 最佳实践

### 1. 定期检查日志
```bash
# 每天检查一次
tail -100 deployment.log | grep -i error
tail -100 alerts.log
```

### 2. 备份管理
```bash
# 定期清理旧备份（保留最近7天）
find backups/ -mtime +7 -delete
```

### 3. 性能基准线
```bash
# 记录部署前的性能
curl http://127.0.0.1:3000/api/metrics > baseline.json

# 部署后对比
curl http://127.0.0.1:3000/api/metrics > after.json
diff baseline.json after.json
```

### 4. 灾难恢复计划
```bash
# 保存最新的生产备份到安全位置
cp -r backups/backup_* /backup/production/

# 定期验证备份可用性
tar -tzf /backup/production/backup.tar.gz > /dev/null
```

---

## 性能指标参考

### 健康状态
```
✅ 推送成功率: 99%+
✅ 平均延迟: 85.5ms
✅ 错误率: <1%
✅ API调用: ↓90%
✅ 数据库查询: ↓80%
```

### 警告状态
```
⚠️ 推送成功率: 95-98%
⚠️ 平均延迟: 100-150ms
⚠️ 错误率: 1-3%
```

### 危险状态
```
❌ 推送成功率: <95%
❌ 平均延迟: >200ms
❌ 错误率: >5%
```

---

## 支持命令

```bash
# 查看帮助
./auto-deploy.sh --help

# 只运行预检查
./auto-deploy.sh --precheck

# 只运行测试
./auto-deploy.sh --test

# 显示详细日志
./auto-deploy.sh --verbose

# 跳过某些步骤
./auto-deploy.sh --skip-test

# 使用特定配置
./auto-deploy.sh --config custom-config.json
```

---

## 总结

这个自动化部署系统让你完全不需要手动干预：

```bash
# 就这一个命令，完成所有事：
./auto-deploy.sh

# 然后可以去做其他事，系统会：
# ✅ 自动更新代码
# ✅ 自动安装依赖
# ✅ 自动运行测试
# ✅ 自动灰度部署
# ✅ 自动监控指标
# ✅ 自动检测问题
# ✅ 自动回滚故障
# ✅ 自动发送通知
```

**完全自动化，你只需要一个命令！** 🚀

