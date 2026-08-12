/**
 * P7.1: API Gateway - 微服务入口
 * 路由 + 认证 + 限流 + 链路追踪
 */

const express = require('express');
const httpProxy = require('express-http-proxy');
const jwt = require('jsonwebtoken');

class APIGateway {
  constructor(options = {}) {
    this.app = express();
    this.port = process.env.GATEWAY_PORT || 3000;
    this.services = {
      user: process.env.USER_SERVICE_URL || 'http://localhost:3001',
      message: process.env.MESSAGE_SERVICE_URL || 'http://localhost:3002',
      social: process.env.SOCIAL_SERVICE_URL || 'http://localhost:3003',
    };
    this.jwtSecret = process.env.JWT_SECRET;
  }

  /**
   * 初始化路由
   */
  setupRoutes() {
    // 认证中间件
    const authenticate = (req, res, next) => {
      const token = req.headers.authorization?.split(' ')[1];
      if (!token) return res.status(401).json({ error: '未授权' });
      
      try {
        req.user = jwt.verify(token, this.jwtSecret);
        next();
      } catch (err) {
        res.status(401).json({ error: '无效的令牌' });
      }
    };

    // 用户服务路由
    this.app.use('/api/auth', httpProxy(this.services.user));
    this.app.use('/api/users', httpProxy(this.services.user));
    
    // 消息服务路由 (需要认证)
    this.app.use('/api/messages', authenticate, 
      httpProxy(this.services.message, {
        proxyReqPathResolver: (req) => {
          return `/api/messages${req.path}?userId=${req.user.id}`;
        },
      })
    );
    
    // 社交服务路由
    this.app.use('/api/friends', authenticate, httpProxy(this.services.social));
    this.app.use('/api/groups', authenticate, httpProxy(this.services.social));
    
    // 健康检查
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', gateway: 'v2.3-microservices' });
    });
  }

  /**
   * 启动网关
   */
  start() {
    this.setupRoutes();
    this.app.listen(this.port, () => {
      console.log(`🚀 API Gateway 启动在 :${this.port}`);
    });
  }
}

module.exports = APIGateway;
