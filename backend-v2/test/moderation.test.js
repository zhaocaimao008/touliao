'use strict';
// DB_PATH 等隔离测试库环境变量已由 jest.config 的 setupFiles(test/testEnv.js) 设置。
const { db } = require('../src/db/connection');
const moderation = require('../src/modules/moderation/moderation.service');

describe('内容审核关键词黑名单', () => {
  afterEach(() => {
    db.prepare("DELETE FROM content_blacklist WHERE word LIKE 'modtest-%'").run();
    moderation.load(); // 清空测试词后立即重新加载缓存，避免污染其他测试文件
  });

  test('空黑名单不拦截任何内容', () => {
    expect(() => moderation.assertClean('随便什么正常内容')).not.toThrow();
    expect(moderation.firstMatch('随便什么正常内容')).toBeNull();
  });

  test('命中黑名单词抛出错误（子串匹配）', () => {
    moderation.addWord('modtest-违禁词');
    expect(() => moderation.assertClean('这句话里包含modtest-违禁词在中间')).toThrow('违规');
    expect(moderation.firstMatch('这句话里包含modtest-违禁词在中间')).toBe('modtest-违禁词');
  });

  test('大小写不敏感', () => {
    moderation.addWord('modtest-BadWord');
    expect(() => moderation.assertClean('contains modtest-badword here')).toThrow();
  });

  test('未命中的内容不受影响', () => {
    moderation.addWord('modtest-敏感词甲');
    expect(() => moderation.assertClean('这是完全不相关的正常内容')).not.toThrow();
  });

  test('删除关键词后不再拦截', () => {
    const { id } = moderation.addWord('modtest-临时词');
    expect(() => moderation.assertClean('含modtest-临时词的内容')).toThrow();
    moderation.removeWord(id);
    expect(() => moderation.assertClean('含modtest-临时词的内容')).not.toThrow();
  });

  test('重复添加同一关键词报错', () => {
    moderation.addWord('modtest-重复词');
    expect(() => moderation.addWord('modtest-重复词')).toThrow('已存在');
  });

  test('listWords 返回已添加的词', () => {
    moderation.addWord('modtest-列表词');
    const words = moderation.listWords().map(w => w.word);
    expect(words).toContain('modtest-列表词');
  });

  test('空字符串/非法输入不报错也不匹配', () => {
    expect(moderation.firstMatch('')).toBeNull();
    expect(moderation.firstMatch(null)).toBeNull();
    expect(moderation.firstMatch(undefined)).toBeNull();
  });

  test('添加空关键词报错', () => {
    expect(() => moderation.addWord('   ')).toThrow();
  });
});
