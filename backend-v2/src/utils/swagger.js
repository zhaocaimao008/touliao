'use strict';
/**
 * Swagger/OpenAPI 文档配置
 * 自动生成交互式 API 文档
 */

const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'v信 API 文档',
      version: '2.0.0',
      description: '实时消息应用后端 API 文档（自动生成）',
      contact: {
        name: 'API Support',
        url: 'https://github.com/vxin/issues',
      },
    },
    servers: [
      {
        url: 'http://localhost:3002/api',
        description: '开发环境',
      },
      {
        url: '/api',
        description: '当前域（Nginx 反代）',
      },
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'vxin_token',
          description: 'JWT token in httpOnly cookie',
        },
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '用户 ID' },
            phone: { type: 'string', description: '电话号码' },
            nickname: { type: 'string', description: '昵称' },
            avatar: { type: 'string', description: '头像 URL' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Conversation: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            type: { type: 'string', enum: ['private', 'group'] },
            lastMessage: { type: 'string' },
            unreadCount: { type: 'integer' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Message: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            conversationId: { type: 'string' },
            senderId: { type: 'string' },
            content: { type: 'string' },
            type: { type: 'string', enum: ['text', 'image', 'file', 'call'] },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string', description: '错误消息' },
            code: { type: 'string', description: '错误代码' },
            status: { type: 'integer', description: 'HTTP 状态码' },
          },
        },
      },
    },
  },
  apis: [
    './src/routes/auth.js',
    './src/routes/user.js',
    './src/routes/conversation.js',
    './src/routes/message.js',
  ],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
