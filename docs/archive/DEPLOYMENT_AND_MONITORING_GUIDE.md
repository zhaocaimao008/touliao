# v信后端 P3 阶段 — 部署和监控完整指南

## 环境验证清单

### 1. 后端应用验证

```bash
# 检查应用健康状态
curl http://localhost:3002/health

# 检查 API 文档
curl http://localhost:3002/api-docs

# 检查性能指标
curl http://localhost:3002/metrics | head -20

# 检查 JSON 指标
curl http://localhost:3002/api/metrics | jq .
```

**预期输出**:
- 健康检查: `{"ok":true,"version":2}`
- Prometheus 指标: `vxin_requests_total`, `vxin_request_duration_seconds` 等
- JSON 指标: `{"requests":{...}, "cache":{...}, "database":{...}}`

### 2. 依赖检查

```bash
cd /root/v信/backend-v2

# 检查必需的包
npm list | grep -E "sentry|redis|prometheus|winston|swagger"

# 验证关键模块
node -e "require('./src/utils/sentry'); console.log('✅ Sentry OK')"
node -e "require('./src/utils/cache'); console.log('✅ Cache OK')"
node -e "require('./src/utils/monitoring'); console.log('✅ Monitoring OK')"
node -e "require('./src/utils/logger'); console.log('✅ Logger OK')"
```

## 监控栈部署

### 方案 A: Docker Compose 部署（推荐）

**前置条件**:
- Docker Desktop 或 Docker Engine
- Docker Compose

**启动脚本**:

```bash
#!/bin/bash
cd /root/v信

# 1. 启动后端
cd backend-v2
npm start &

# 2. 启动监控栈
cd ../grafana
docker-compose up -d

cd ../elk
docker-compose up -d

echo "所有服务已启动"
```

**验证**:
```bash
# 检查容器状态
docker-compose ps

# 查看容器日志
docker-compose logs -f grafana
docker-compose logs -f prometheus
```

### 方案 B: 手动启动（无 Docker）

#### Prometheus 本地运行

```bash
# 1. 安装 Prometheus (macOS/Linux)
brew install prometheus  # macOS
# 或下载: https://prometheus.io/download/

# 2. 配置文件: prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'vxin-backend'
    static_configs:
      - targets: ['localhost:3002']
    metrics_path: '/metrics'

# 3. 启动
prometheus --config.file=prometheus.yml
# 访问: http://localhost:9090
```

#### Grafana 本地运行

```bash
# 1. 安装 Grafana
brew install grafana  # macOS
# 或下载: https://grafana.com/grafana/download

# 2. 启动
grafana-server --config=/usr/local/etc/grafana/grafana.ini

# 3. 访问
# http://localhost:3000 (admin/admin)

# 4. 配置数据源
# - 设置 → Data Sources → Add data source
# - Type: Prometheus
# - URL: http://localhost:9090
# - Save & Test

# 5. 导入仪表板
# - Dashboards → Import
# - 粘贴 grafana/vxin-dashboard.json 的内容
```

#### ELK Stack 本地运行

```bash
# 需要 Elasticsearch, Logstash, Kibana 分别安装和配置
# 推荐使用 Docker 或 Docker Compose
```

## 告警规则配置

### Grafana 告警规则

#### 1. 错误率告警

```
规则名: HighErrorRate
数据源: Prometheus
条件: 
  - `(sum(rate(vxin_requests_total{status=~"5.."}[5m])) / sum(rate(vxin_requests_total[5m]))) > 0.01`
  - 持续时间: 5 分钟
通知渠道: Email / Slack / 页面通知
```

#### 2. 响应时间告警

```
规则名: SlowResponse
条件:
  - `histogram_quantile(0.99, rate(vxin_request_duration_seconds_bucket[5m])) > 1`
  - 持续时间: 5 分钟
通知: 性能下降警告
```

#### 3. 缓存命中率告警

```
规则名: LowCacheHitRate
条件:
  - `vxin_cache_hit_rate < 0.5`
  - 持续时间: 10 分钟
通知: 缓存效率低警告
```

### 在 Grafana 中创建告警

1. 打开仪表板的面板
2. 点击面板标题 → Edit
3. 进入 Alert 标签
4. 点击 "Create Alert"
5. 配置条件和通知

## 性能基准测试

### 本地运行测试

```bash
cd /root/v信/backend-v2

# 运行 E2E 测试
npm test -- test/e2e.test.js --testTimeout=30000

# 运行性能基准测试
npm test -- test/performance.test.js --testTimeout=60000

# 运行特定测试套件
npm test -- test/performance.test.js -t "缓存性能基准"

# 生成覆盖率报告
npm run test:coverage
```

### 性能基准预期结果

| 指标 | 目标值 | 实际值 |
|------|--------|--------|
| 缓存命中延迟 | < 5ms | - |
| 100并发读取 | 100% 成功 | - |
| 吞吐量 | > 100 req/s | - |
| 平均响应时间 | < 100ms | - |
| 内存泄漏检测 | < 50MB 增长 | - |

## 监控数据收集

### 关键指标收集

```bash
# 1. 启用指标采集
# - 后端已自动启用
# - 访问 http://localhost:3002/metrics 验证

# 2. 指标保留策略
# - Prometheus: 默认 15 天
# - 可在 prometheus.yml 中配置

# 3. 数据备份
# - Prometheus 数据目录: ~/.local/share/prometheus/
# - 定期备份到外部存储
```

### 日志收集

```bash
# 1. 日志位置
# - 应用日志: backend-v2/logs/combined.log
# - 错误日志: backend-v2/logs/error.log

# 2. 实时监控
tail -f backend-v2/logs/combined.log

# 3. 日志查询
grep "error" backend-v2/logs/combined.log
grep "duration" backend-v2/logs/combined.log | grep "> 1000"
```

## 故障排除

### 后端无法启动

```bash
# 1. 检查依赖
npm install

# 2. 检查环境变量
echo $DATABASE_URL
echo $REDIS_URL

# 3. 检查数据库连接
curl http://localhost:5432  # PostgreSQL

# 4. 检查 Redis
redis-cli ping

# 5. 查看日志
tail -50 /tmp/vxin-backend.log
```

### 监控数据不更新

```bash
# 1. 检查 Prometheus 是否抓取数据
curl http://localhost:9090/api/v1/query?query=vxin_requests_total

# 2. 检查后端是否暴露指标
curl http://localhost:3002/metrics | grep vxin_requests_total

# 3. 检查 Prometheus 配置
cat prometheus.yml | grep -A 10 "vxin-backend"

# 4. 重启 Prometheus
# 如果使用 Docker:
docker restart vxin-prometheus
# 如果本地运行: Ctrl+C, 重新启动
```

### Grafana 无法显示数据

```bash
# 1. 检查数据源
# Settings → Data Sources → Test
# 应该看到 "Data source is working"

# 2. 检查时间范围
# 右上角时间选择器 → Last 7 days

# 3. 重新导入仪表板
# Dashboards → Import
# 粘贴 vxin-dashboard.json 内容

# 4. 检查指标是否存在
# Explore → Metrics Browser
# 搜索 "vxin_"
```

## 生产部署检查清单

- [ ] 后端应用正常运行
- [ ] 所有依赖已安装 (sentry, redis, prometheus 等)
- [ ] 环境变量已配置 (SENTRY_DSN, DATABASE_URL 等)
- [ ] Prometheus 正常采集指标
- [ ] Grafana 仪表板显示数据
- [ ] 告警规则已配置
- [ ] 日志收集已启用
- [ ] 备份策略已制定
- [ ] 团队已培训
- [ ] 文档已更新

## 7天数据收集计划

### 第 1-2 天: 基线建立
- 运行性能基准测试
- 记录基础指标
- 配置告警规则
- **输出**: 基线报告 (`baseline-report-day1.md`)

### 第 3-5 天: 正常运行观察
- 持续监控关键指标
- 收集错误日志
- 观察缓存命中率
- 监控内存使用
- **输出**: 运行日志 (`monitoring-log-day3-5.md`)

### 第 6-7 天: 压力测试和分析
- 模拟高并发场景
- 测试告警响应
- 分析性能瓶颈
- 生成最终报告
- **输出**: 最终分析报告 (`final-analysis-report.md`)

## 监控仪表板快速参考

### Grafana 仪表板 URL 路由

- **总览**: http://localhost:3000/d/vxin-backend
- **详细视图**: http://localhost:3000/explore
- **告警**: http://localhost:3000/alerting/list
- **数据源**: http://localhost:3000/datasources

### 常用 Grafana 快捷键

- `g` + `h`: 返回首页
- `ctrl` + `k`: 搜索
- `d` + `r`: 刷新仪表板
- `t`: 显示时间选择器

### Prometheus 常用查询

```promql
# 请求速率 (5 分钟)
rate(vxin_requests_total[5m])

# 响应时间 p95
histogram_quantile(0.95, rate(vxin_request_duration_seconds_bucket[5m]))

# 缓存命中率
vxin_cache_hit_rate * 100

# 错误率
sum(rate(vxin_requests_total{status=~"5.."}[5m])) / sum(rate(vxin_requests_total[5m]))
```

## 文档和资源

| 资源 | 链接 |
|------|------|
| Prometheus 官方文档 | https://prometheus.io/docs/ |
| Grafana 官方文档 | https://grafana.com/docs/ |
| Sentry 官方文档 | https://docs.sentry.io/ |
| ELK Stack 官方文档 | https://www.elastic.co/guide/ |
| v信 P3 完成报告 | `./P3完成报告_20260611.md` |
| Grafana 部署指南 | `./backend-v2/GRAFANA_SETUP.md` |
| ELK 部署指南 | `./backend-v2/ELK_SETUP.md` |
| Sentry 部署指南 | `./backend-v2/SENTRY_SETUP.md` |

---

**最后更新**: 2026-06-11
**维护人**: 开发团队
**下一次审核**: 2026-06-18 (7天后)
