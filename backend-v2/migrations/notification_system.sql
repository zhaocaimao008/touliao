-- 通知历史记录表
CREATE TABLE IF NOT EXISTS notification_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  type TEXT NOT NULL,
  priority TEXT DEFAULT 'normal',
  channels INTEGER DEFAULT 0,
  status TEXT DEFAULT 'sent',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  CHECK (priority IN ('critical', 'high', 'normal', 'low'))
);

CREATE INDEX IF NOT EXISTS idx_notification_history_user_id ON notification_history(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_history_created_at ON notification_history(created_at);

-- 用户通知偏好设置
CREATE TABLE IF NOT EXISTS user_notification_preferences (
  user_id TEXT PRIMARY KEY,
  email_enabled BOOLEAN DEFAULT 1,
  sms_enabled BOOLEAN DEFAULT 0,
  dingtalk_enabled BOOLEAN DEFAULT 0,
  wechat_work_enabled BOOLEAN DEFAULT 0,
  app_push_enabled BOOLEAN DEFAULT 1,
  notification_frequency TEXT DEFAULT 'immediate',
  quiet_hours_start TEXT,
  quiet_hours_end TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(user_id)
);

-- 设备token表 (用于推送)
CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token TEXT NOT NULL,
  platform TEXT NOT NULL,
  device_name TEXT,
  is_active BOOLEAN DEFAULT 1,
  last_used INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(user_id, token, platform)
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id ON device_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_platform ON device_tokens(platform);

-- 通知模板表
CREATE TABLE IF NOT EXISTS notification_templates (
  name TEXT PRIMARY KEY,
  templates TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 通知重复移除表 (用于去重)
CREATE TABLE IF NOT EXISTS notification_dedup (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  notification_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(user_id, notification_hash)
);

CREATE INDEX IF NOT EXISTS idx_notification_dedup_expires_at ON notification_dedup(expires_at);

-- 添加用户相关字段（如果表不存在这些列）
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS dingtalk_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wechat_work_id TEXT;

CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
