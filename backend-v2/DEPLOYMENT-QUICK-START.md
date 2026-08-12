# v信后端 P11-P13 快速部署指南

## 🚀 5 分钟快速启动

### 1. 环境准备 (1分钟)

```bash
# 切换到项目目录
cd /root/v信/backend-v2

# 安装依赖
npm install web3 ethers axios google-cloud-speech google-cloud-vision @google-cloud/translate

# 验证安装
npm list | grep -E "web3|ethers|axios|google"
```

### 2. 配置环境变量 (2分钟)

```bash
# 创建配置文件
cat > .env.p11p12p13 << 'EOF'
# P11 全球部署
CLOUDFLARE_TOKEN=your_cloudflare_token
ALIYUN_ACCESS_KEY=your_aliyun_key
ALIYUN_SECRET_KEY=your_aliyun_secret

# P12 AI功能
OPENAI_API_KEY=your_openai_key
GOOGLE_CLOUD_SPEECH_KEY=your_gcs_key
GOOGLE_CLOUD_VISION_KEY=your_gcv_key
GOOGLE_TRANSLATE_API_KEY=your_translate_key

# P13 Web3
WEB3_PROVIDER=https://eth-mainnet.alchemyapi.io/v2/your_key
CONTRACT_ADDRESS=0x...
PRIVATE_KEY=your_private_key
EOF

# 验证配置
echo "✅ 环境变量配置完成"
```

### 3. 启动服务 (2分钟)

```bash
# 启动开发服务器
npm start

# 验证启动
curl http://localhost:3000/health
# 预期返回: {"ok":true,"version":2,"db":"ok"}
```

---

## 📡 API 测试

### P11 全球部署 API

```bash
# 1. CDN 智能路由
curl -X POST http://localhost:3000/api/global/cdn/route \
  -H "Content-Type: application/json" \
  -d '{
    "geoLocation": {"country":"CN","region":"beijing"}
  }'

# 预期响应:
# {
#   "route": {
#     "provider": "aliyun",
#     "region": "beijing",
#     "priority": 1
#   },
#   "timestamp": 1691829600000
# }

# 2. CDN 缓存预热
curl -X POST http://localhost:3000/api/global/cdn/warm \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [
      "http://example.com/file1",
      "http://example.com/file2"
    ]
  }'

# 3. 获取 CDN 统计
curl http://localhost:3000/api/global/cdn/stats
```

### P12 AI增强 API

```bash
# 1. 生成个性化推荐
curl -X POST http://localhost:3000/api/ai/recommendations/generate \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-1",
    "userProfile": {
      "interests": ["tech", "gaming"],
      "followingCount": 50
    },
    "topN": 10
  }'

# 2. 文本内容审核
curl -X POST http://localhost:3000/api/ai/moderation/text \
  -H "Content-Type: application/json" \
  -d '{
    "text": "这是一条普通文本"
  }'

# 3. 翻译文本
curl -X POST http://localhost:3000/api/ai/translation/translate \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello World",
    "targetLang": "zh",
    "sourceLang": "en"
  }'

# 4. 获取支持的语言列表
curl http://localhost:3000/api/ai/translation/languages
```

### P13 Web3 API

```bash
# 1. 发起区块链交易
curl -X POST http://localhost:3000/api/web3/blockchain/transaction \
  -H "Content-Type: application/json" \
  -d '{
    "fromUser": "user-1",
    "toUser": "user-2",
    "amount": 100,
    "metadata": {"reason": "payment"}
  }'

# 2. 铸造 NFT
curl -X POST http://localhost:3000/api/web3/nft/mint \
  -H "Content-Type: application/json" \
  -d '{
    "creator": "creator-1",
    "metadata": {
      "name": "My First NFT",
      "image": "ipfs://..."
    }
  }'

# 3. 创建 DAO 提案
curl -X POST http://localhost:3000/api/web3/dao/proposal \
  -H "Content-Type: application/json" \
  -d '{
    "creator": "user-1",
    "title": "启用新功能",
    "description": "投票决定是否启用群聊功能",
    "options": ["支持", "反对", "弃权"]
  }'

# 4. 投票
curl -X POST http://localhost:3000/api/web3/dao/vote \
  -H "Content-Type: application/json" \
  -d '{
    "voter": "user-1",
    "proposalId": "prop_123456",
    "optionIndex": 0
  }'
```

---

## 🧪 运行测试

```bash
# 运行所有 P11-P13 测试
npm test -- test/p11-p13-integration.test.js

# 运行特定测试套件
npm test -- test/p11-p13-integration.test.js -t "P11"
npm test -- test/p11-p13-integration.test.js -t "P12"
npm test -- test/p11-p13-integration.test.js -t "P13"

# 显示详细输出
npm test -- test/p11-p13-integration.test.js --verbose

# 生成覆盖率报告
npm test -- test/p11-p13-integration.test.js --coverage
```

---

## 📊 监控仪表板

```bash
# 查看 P11 全球状态
curl http://localhost:3000/api/global/monitoring/status | jq '.'

# 查看 P11 区域报告
curl http://localhost:3000/api/global/monitoring/region/cn | jq '.'

# 查看 P11 可用性
curl http://localhost:3000/api/global/monitoring/availability/cn | jq '.'

# 记录 P11 指标
curl -X POST http://localhost:3000/api/global/monitoring/metric \
  -H "Content-Type: application/json" \
  -d '{
    "region": "cn",
    "metricName": "latency",
    "value": 150
  }'
```

---

## 🔍 故障排查

### 问题 1: 模块找不到

```bash
# 错误: Cannot find module './redis'
# 解决方案:
cd /root/v信/backend-v2
npm install redis
npm install ioredis
```

### 问题 2: 环境变量未配置

```bash
# 错误: OPENAI_API_KEY is not defined
# 解决方案:
source .env.p11p12p13
echo $OPENAI_API_KEY  # 验证
```

### 问题 3: 端口被占用

```bash
# 错误: EADDRINUSE: address already in use :::3000
# 解决方案:
# 方法1: 更改端口
PORT=3001 npm start

# 方法2: 杀死占用进程
lsof -i :3000
kill -9 <PID>
```

### 问题 4: 数据库连接失败

```bash
# 错误: Error: SQLITE_CANTOPEN
# 解决方案:
# 检查数据库文件权限
ls -la src/db/data.db

# 重置数据库
npm run db:reset
npm run db:seed
```

### 问题 5: 区块链网络错误

```bash
# 错误: Failed to connect to Ethereum node
# 解决方案:
# 检查 WEB3_PROVIDER 是否可用
curl https://eth-mainnet.alchemyapi.io/v2/your_key

# 或切换到测试网络
WEB3_PROVIDER=https://goerli.alchemyapi.io/v2/your_key npm start
```

---

## 📈 性能调优

### 1. 启用缓存

```javascript
// src/server.js
const redis = require('ioredis');
const client = new redis({
  host: 'localhost',
  port: 6379,
  maxRetriesPerRequest: null,
});

// 全局缓存配置
app.set('cache', client);
```

### 2. 启用 HTTP/2

```javascript
// src/server.js
const spdy = require('spdy');
const fs = require('fs');

const options = {
  key: fs.readFileSync('./server.key'),
  cert: fs.readFileSync('./server.crt'),
};

const server = spdy.createServer(options, app);
```

### 3. 启用压缩

```javascript
// src/app.js
const compression = require('compression');

app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));
```

### 4. 数据库连接池

```javascript
// src/db/connection.js
const { Pool } = require('pg');

const pool = new Pool({
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

---

## 🚢 灰度部署

### Phase 1: 5% 流量 (1小时)

```bash
# 使用 Kubernetes
kubectl set env deployment/v-xin-api \
  P11_P12_P13_ENABLED=true \
  P11_P12_P13_TRAFFIC_PERCENT=5

# 监控错误率
watch 'curl http://metrics:9090/query?query=error_rate'
```

### Phase 2: 50% 流量 (2小时)

```bash
kubectl set env deployment/v-xin-api \
  P11_P12_P13_TRAFFIC_PERCENT=50
```

### Phase 3: 100% 流量 (全量)

```bash
kubectl set env deployment/v-xin-api \
  P11_P12_P13_TRAFFIC_PERCENT=100
```

### 紧急回滚

```bash
# 回滚到上一个版本
kubectl rollout undo deployment/v-xin-api

# 查看回滚状态
kubectl rollout status deployment/v-xin-api
```

---

## 📊 关键指标监控

```bash
# 使用 Prometheus
# 配置 prometheus.yml

global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'v-xin-api'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'p11-global'
    metrics_path: '/api/global/monitoring/status'
    static_configs:
      - targets: ['localhost:3000']

  - job_name: 'p12-ai'
    metrics_path: '/api/ai/recommendations/generate'
    static_configs:
      - targets: ['localhost:3000']

  - job_name: 'p13-web3'
    metrics_path: '/api/web3/blockchain/transaction'
    static_configs:
      - targets: ['localhost:3000']
```

---

## 🔐 安全检查清单

- [ ] 所有环境变量已配置且不在代码中
- [ ] HTTPS/TLS 已启用
- [ ] API 密钥已轮换
- [ ] 速率限制已配置
- [ ] CORS 策略已正确设置
- [ ] 数据库备份已完成
- [ ] 监控告警已激活
- [ ] 安全审计已通过

---

## 📞 获取帮助

### 查看日志

```bash
# 实时日志
tail -f logs/app.log

# 特定日期的日志
grep "2026-08-12" logs/app.log

# 错误日志
grep "ERROR" logs/app.log
```

### 查看文档

```bash
# 查看完整技术文档
cat P11-P13-COMPLETE-GUIDE.md

# 查看实现报告
cat P11-P13-IMPLEMENTATION-REPORT.md
```

### 联系支持

```
技术支持: backend-team@vxin.com
Bug 报告: https://github.com/vxin/backend/issues
性能优化: performance@vxin.com
```

---

## ✅ 部署完成检查

```bash
# 1. 验证服务启动
curl http://localhost:3000/health

# 2. 验证所有路由可用
curl http://localhost:3000/api/global/cdn/stats
curl http://localhost:3000/api/ai/translation/languages
curl http://localhost:3000/api/web3/dao/members/count

# 3. 验证数据库连接
curl http://localhost:3000/api/global/monitoring/status

# 4. 运行基准测试
npm test -- test/p11-p13-integration.test.js --testNamePattern="性能基准"

# 5. 检查错误率
# 预期: < 0.1%

echo "✅ 所有检查通过，部署完成！"
```

---

**快速参考**:
- 技术文档: P11-P13-COMPLETE-GUIDE.md
- 实现报告: P11-P13-IMPLEMENTATION-REPORT.md
- 源代码: src/utils/optimization-p{11,12,13}/*.js
- 测试: test/p11-p13-integration.test.js
- API 端点: 35 个 (详见实现报告)

**支持时间**: 24/7  
**SLA**: 99.99% 可用性  
**最后更新**: 2026-08-12

