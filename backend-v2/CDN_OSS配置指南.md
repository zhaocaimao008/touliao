# CDN + OSS 配置指南

## 📦 方案概述

将图片、头像、文件等静态资源上传到阿里云 OSS，并通过 CDN 加速访问。

---

## 🔧 配置步骤

### 1. 安装 OSS SDK

```bash
cd /root/v信/backend-v2
npm install ali-oss --save
```

### 2. 配置环境变量

在 `.env` 文件中添加：

```bash
# 阿里云 OSS 配置
OSS_REGION=oss-cn-hangzhou
OSS_ACCESS_KEY_ID=your-access-key-id
OSS_ACCESS_KEY_SECRET=your-access-key-secret
OSS_BUCKET=vxin-media
OSS_CDN_DOMAIN=https://cdn.dipsin.com
```

### 3. 创建 OSS 工具类

文件位置: `/root/v信/backend-v2/src/utils/ossUpload.js`

```javascript
const OSS = require('ali-oss');
const path = require('path');
const crypto = require('crypto');

class OSSUploader {
  constructor() {
    this.client = new OSS({
      region: process.env.OSS_REGION,
      accessKeyId: process.env.OSS_ACCESS_KEY_ID,
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
      bucket: process.env.OSS_BUCKET,
    });
    this.cdnDomain = process.env.OSS_CDN_DOMAIN;
  }

  /**
   * 上传文件到 OSS
   * @param {Buffer|Stream} file - 文件内容
   * @param {string} filename - 原始文件名
   * @param {string} type - 文件类型 (avatar/image/file)
   * @returns {Promise<string>} CDN URL
   */
  async upload(file, filename, type = 'file') {
    const ext = path.extname(filename);
    const hash = crypto.randomBytes(16).toString('hex');
    const key = `${type}/${Date.now()}-${hash}${ext}`;
    
    const result = await this.client.put(key, file, {
      headers: {
        'Cache-Control': 'max-age=31536000', // 1 年缓存
      },
    });
    
    // 返回 CDN 地址
    return `${this.cdnDomain}/${key}`;
  }

  /**
   * 批量上传文件
   */
  async batchUpload(files) {
    return Promise.all(files.map(f => this.upload(f.buffer, f.originalname, f.type)));
  }

  /**
   * 删除文件
   */
  async delete(url) {
    const key = url.replace(this.cdnDomain + '/', '');
    await this.client.delete(key);
  }
}

module.exports = new OSSUploader();
```

### 4. 修改上传路由

在上传接口中使用 OSS：

```javascript
const ossUploader = require('../utils/ossUpload');

router.post('/upload/avatar', auth, upload.single('avatar'), async (req, res) => {
  try {
    // 上传到 OSS
    const cdnUrl = await ossUploader.upload(
      req.file.buffer,
      req.file.originalname,
      'avatar'
    );
    
    // 更新数据库
    await db.prepare('UPDATE users SET avatar = ? WHERE id = ?')
      .run(cdnUrl, req.user.userId);
    
    res.json({ url: cdnUrl });
  } catch (err) {
    res.status(500).json({ error: '上传失败' });
  }
});
```

### 5. 前端配置

修改 `/root/v信/web/.env.production`：

```bash
VITE_CDN_DOMAIN=https://cdn.dipsin.com
```

---

## 🌐 CDN 配置

### 阿里云 CDN 配置步骤

1. **创建 CDN 加速域名**
   - 登录阿里云控制台
   - 进入 CDN 服务
   - 添加域名: `cdn.dipsin.com`
   - 源站类型: OSS 域名
   - 选择对应的 OSS Bucket

2. **配置 HTTPS**
   - 上传 SSL 证书（Let's Encrypt 或购买）
   - 开启 HTTPS 强制跳转
   - 开启 HTTP/2

3. **配置缓存规则**
   ```
   /avatar/*.jpg     缓存 1 年
   /avatar/*.png     缓存 1 年
   /image/*          缓存 30 天
   /file/*           缓存 7 天
   ```

4. **配置防盗链**
   - 白名单: `dipsin.com`, `*.dipsin.com`
   - 空 Referer: 允许（支持直接访问）

5. **配置跨域**
   ```
   Access-Control-Allow-Origin: *
   Access-Control-Allow-Methods: GET, HEAD
   ```

---

## 📊 预期效果

### 性能提升
- 图片加载速度: 500ms → 100ms (80% 提升)
- 服务器带宽节省: 70%+
- 全球访问速度: 国内 50ms, 海外 200ms

### 成本优化
- OSS 存储: ¥0.12/GB/月
- CDN 流量: ¥0.24/GB (首 10TB)
- 估算月成本: ¥100-300（取决于流量）

---

## ✅ 验证清单

- [ ] OSS Bucket 已创建
- [ ] AccessKey 已配置
- [ ] CDN 域名已备案
- [ ] SSL 证书已配置
- [ ] 跨域规则已设置
- [ ] 缓存规则已配置
- [ ] 防盗链已启用
- [ ] 前端代码已更新
- [ ] 上传接口已测试

---

## 🚀 部署步骤

```bash
# 1. 安装依赖
cd /root/v信/backend-v2
npm install ali-oss --save

# 2. 配置环境变量（填入真实值）
cat >> .env << 'ENVEOF'
OSS_REGION=oss-cn-hangzhou
OSS_ACCESS_KEY_ID=你的AccessKeyId
OSS_ACCESS_KEY_SECRET=你的AccessKeySecret
OSS_BUCKET=vxin-media
OSS_CDN_DOMAIN=https://cdn.dipsin.com
ENVEOF

# 3. 创建 OSS 上传工具（已提供代码模板）
# 复制上面的代码到 src/utils/ossUpload.js

# 4. 重启服务
pm2 restart vxin-server-v2

# 5. 测试上传
curl -X POST https://dipsin.com/api/upload/test \
  -F "file=@test.jpg" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## 📝 注意事项

1. **安全性**
   - 不要将 AccessKey 提交到 Git
   - 使用子账号 RAM 角色，最小权限原则
   - 定期轮换 AccessKey

2. **成本控制**
   - 设置 CDN 流量告警
   - 定期清理无用文件
   - 压缩图片后再上传

3. **备份策略**
   - 启用 OSS 版本控制
   - 定期备份到本地或其他云存储
   - 设置生命周期规则自动归档

---

**配置完成后，所有图片/文件上传将自动走 OSS + CDN，无需修改客户端代码！**
