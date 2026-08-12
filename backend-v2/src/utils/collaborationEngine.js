/**
 * P9.1: 实时协作引擎
 * 基于 Operational Transformation (OT) 的实时编辑
 */

class CollaborationEngine {
  constructor() {
    this.documents = new Map();
    this.operations = new Map();
    this.clients = new Map();
  }

  /**
   * 创建文档
   */
  createDocument(docId, initialContent = '') {
    this.documents.set(docId, {
      id: docId,
      content: initialContent,
      version: 0,
      createdAt: Date.now(),
      clients: new Set(),
    });
    this.operations.set(docId, []);
    return this.documents.get(docId);
  }

  /**
   * 应用操作转换 (OT)
   */
  applyOperation(docId, operation, clientId) {
    const doc = this.documents.get(docId);
    if (!doc) throw new Error('文档不存在');

    // 获取之前的操作
    const ops = this.operations.get(docId) || [];
    
    // 转换新操作
    let transformedOp = operation;
    for (const prevOp of ops) {
      transformedOp = this.transform(transformedOp, prevOp);
    }

    // 应用操作到内容
    doc.content = this.applyOp(doc.content, transformedOp);
    doc.version++;

    // 存储操作
    ops.push(transformedOp);
    
    // 广播到其他客户端
    this.broadcast(docId, { type: 'operation', op: transformedOp, version: doc.version }, clientId);

    return { version: doc.version, content: doc.content };
  }

  /**
   * 操作转换算法 (简化版)
   */
  transform(op1, op2) {
    // 实现 OT 算法
    // 这是简化版，实际需要更复杂的逻辑
    if (op1.pos < op2.pos) {
      return op1;
    }
    return { ...op1, pos: op1.pos + op2.length };
  }

  /**
   * 应用单个操作
   */
  applyOp(content, op) {
    if (op.type === 'insert') {
      return content.slice(0, op.pos) + op.text + content.slice(op.pos);
    } else if (op.type === 'delete') {
      return content.slice(0, op.pos) + content.slice(op.pos + op.length);
    }
    return content;
  }

  /**
   * 广播操作
   */
  broadcast(docId, message, excludeClientId) {
    const doc = this.documents.get(docId);
    doc.clients.forEach(clientId => {
      if (clientId !== excludeClientId) {
        const ws = this.clients.get(clientId);
        if (ws) ws.send(JSON.stringify(message));
      }
    });
  }

  /**
   * 获取文档
   */
  getDocument(docId) {
    return this.documents.get(docId);
  }

  /**
   * 获取操作历史
   */
  getOperationHistory(docId) {
    return this.operations.get(docId) || [];
  }
}

module.exports = CollaborationEngine;
