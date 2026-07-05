'use strict';
/**
 * 数据库 schema —— 数据契约，与现有 wechat.db 完全一致。
 *
 * 全部语句幂等（CREATE TABLE IF NOT EXISTS / 迁移包 try-catch）。
 * 由于 backend-v2 连接的是生产已初始化的同一个库，这里的执行只是
 * 「确保结构存在」；若用于全新库，也能从零建出完整结构。
 *
 * ⚠ 改动此文件等于改数据库结构，需同步评估对运行中数据的影响。
 */

function applySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      avatar TEXT DEFAULT '',
      cover_photo TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      wechat_id TEXT DEFAULT '',
      status TEXT DEFAULT 'online',
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      remark TEXT DEFAULT '',
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (contact_id) REFERENCES users(id),
      UNIQUE(user_id, contact_id)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'private',
      name TEXT DEFAULT '',
      avatar TEXT DEFAULT '',
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at INTEGER DEFAULT (strftime('%s', 'now')),
      PRIMARY KEY (conversation_id, user_id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      content TEXT NOT NULL,
      file_url TEXT DEFAULT '',
      reply_to_id TEXT DEFAULT NULL,
      deleted INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id),
      FOREIGN KEY (sender_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS message_reactions (
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      PRIMARY KEY (message_id, user_id),
      FOREIGN KEY (message_id) REFERENCES messages(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS conversation_settings (
      user_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      pinned INTEGER DEFAULT 0,
      muted INTEGER DEFAULT 0,
      last_read_at INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, conversation_id)
    );

    CREATE TABLE IF NOT EXISTS friend_requests (
      id TEXT PRIMARY KEY,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      message TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (from_id) REFERENCES users(id),
      FOREIGN KEY (to_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS moments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      images TEXT DEFAULT '[]',
      likes TEXT DEFAULT '[]',
      visibility TEXT DEFAULT 'all',
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS moment_comments (
      id TEXT PRIMARY KEY,
      moment_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (moment_id) REFERENCES moments(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      content TEXT NOT NULL,
      extra TEXT DEFAULT '{}',
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS blocked_users (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      blocked_id TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (blocked_id) REFERENCES users(id),
      UNIQUE(user_id, blocked_id)
    );

    CREATE TABLE IF NOT EXISTS red_packets (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      total_amount INTEGER NOT NULL,
      total_count INTEGER NOT NULL,
      claimed_count INTEGER DEFAULT 0,
      greeting TEXT DEFAULT '恭喜发财，大吉大利',
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (sender_id) REFERENCES users(id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );

    CREATE TABLE IF NOT EXISTS red_packet_claims (
      packet_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      claimed_at INTEGER DEFAULT (strftime('%s', 'now')),
      PRIMARY KEY (packet_id, user_id),
      FOREIGN KEY (packet_id) REFERENCES red_packets(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY,
      add_by_vxin_id INTEGER DEFAULT 1,
      add_by_phone INTEGER DEFAULT 1,
      require_verify INTEGER DEFAULT 1,
      profile_visible INTEGER DEFAULT 1,
      block_unknown_messages INTEGER DEFAULT 0,
      message_notify INTEGER DEFAULT 1,
      detail_preview INTEGER DEFAULT 1,
      sound INTEGER DEFAULT 1,
      vibrate INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // ── 幂等迁移（顺序敏感，逐条 try-catch）──────────────────────
  const migrations = [
    "ALTER TABLE users ADD COLUMN wechat_id TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN cover_photo TEXT DEFAULT ''",
    "ALTER TABLE messages ADD COLUMN reply_to_id TEXT DEFAULT NULL",
    "ALTER TABLE messages ADD COLUMN deleted INTEGER DEFAULT 0",
    "ALTER TABLE messages ADD COLUMN edited INTEGER DEFAULT 0",
    "ALTER TABLE messages ADD COLUMN duration INTEGER DEFAULT 0",
    "ALTER TABLE moments ADD COLUMN visibility TEXT DEFAULT 'all'",
    "ALTER TABLE moment_comments ADD COLUMN reply_to_user TEXT DEFAULT ''",
    "ALTER TABLE conversations ADD COLUMN owner_id TEXT DEFAULT NULL",
    "ALTER TABLE conversations ADD COLUMN announcement TEXT DEFAULT ''",
    "ALTER TABLE conversations ADD COLUMN no_private_chat INTEGER DEFAULT 0",
    "ALTER TABLE conversations ADD COLUMN mute_all INTEGER DEFAULT 0",
    "ALTER TABLE conversation_members ADD COLUMN role TEXT DEFAULT 'member'",
    `CREATE TABLE IF NOT EXISTS pinned_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      pinned_by TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE(conversation_id, message_id)
    )`,
    "ALTER TABLE conversation_settings ADD COLUMN last_read_message_id TEXT DEFAULT NULL",
    `CREATE TABLE IF NOT EXISTS message_deliveries (
      message_id   TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      delivered_at INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY (message_id, user_id)
    )`,
    "CREATE INDEX IF NOT EXISTS idx_deliveries_msg ON message_deliveries(message_id)",
    "CREATE INDEX IF NOT EXISTS idx_deliveries_user ON message_deliveries(user_id)",
    "ALTER TABLE conversation_members ADD COLUMN nickname TEXT DEFAULT NULL",
    // 后台封禁标记（禁止登录，可逆）
    "ALTER TABLE users ADD COLUMN banned INTEGER DEFAULT 0",
    `CREATE TABLE IF NOT EXISTS group_invite_tokens (
      token           TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      created_by      TEXT NOT NULL,
      expires_at      INTEGER NOT NULL,
      created_at      INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )`,
    "CREATE INDEX IF NOT EXISTS idx_invite_conv ON group_invite_tokens(conversation_id)",
    "ALTER TABLE conversations ADD COLUMN no_add_friend INTEGER DEFAULT 0",
    "CREATE INDEX IF NOT EXISTS idx_messages_conv_time ON messages(conversation_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id)",
    "CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_conv_members_user ON conversation_members(user_id)",
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      subscription TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE(user_id, endpoint),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS device_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL,
      platform TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE(user_id, token),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    "CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(conversation_id, created_at, sender_id) WHERE deleted=0",
    `CREATE TABLE IF NOT EXISTS moment_likes (
      moment_id  TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY (moment_id, user_id),
      FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE
    )`,
    "CREATE INDEX IF NOT EXISTS idx_moment_likes_moment ON moment_likes(moment_id)",
    `CREATE TABLE IF NOT EXISTS user_sessions (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      device     TEXT DEFAULT '未知设备',
      platform   TEXT DEFAULT 'Web',
      ip         TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      last_seen  INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE(user_id, device, platform),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    "CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id)",
    "ALTER TABLE conversations ADD COLUMN group_number TEXT DEFAULT ''",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_group_number ON conversations(group_number) WHERE group_number != ''",
    // 后台运行时设置（key-value），如可改的邀请码、TOTP 密钥
    `CREATE TABLE IF NOT EXISTS admin_settings (
      key   TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER DEFAULT (strftime('%s','now'))
    )`,
    // 后台可信设备/IP 白名单（陌生设备/IP 拦截）
    `CREATE TABLE IF NOT EXISTS admin_trusted (
      id         TEXT PRIMARY KEY,
      device_id  TEXT NOT NULL,
      ip         TEXT NOT NULL,
      label      TEXT DEFAULT '',
      created_at INTEGER DEFAULT (strftime('%s','now')),
      last_seen  INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE(device_id, ip)
    )`,
    // ── 通话记录（WebRTC 1对1 信令落库，生成通话历史/未接来电）──
    `CREATE TABLE IF NOT EXISTS call_logs (
      id         TEXT PRIMARY KEY,
      caller_id  TEXT NOT NULL,
      callee_id  TEXT NOT NULL,
      type       TEXT DEFAULT 'audio',
      status     TEXT DEFAULT 'missed',
      started_at INTEGER DEFAULT (strftime('%s','now')),
      ended_at   INTEGER DEFAULT NULL,
      duration   INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    )`,
    "CREATE INDEX IF NOT EXISTS idx_call_logs_caller ON call_logs(caller_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_call_logs_callee ON call_logs(callee_id, created_at)",
    // ── 朋友圈索引（表已在主 schema 建好，补查询索引）──
    "CREATE INDEX IF NOT EXISTS idx_moments_user ON moments(user_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_moments_time ON moments(created_at)",
    "CREATE INDEX IF NOT EXISTS idx_moment_comments_moment ON moment_comments(moment_id, created_at)",
    // ── 红包状态（active/expired，配合过期回收标记）──
    "ALTER TABLE red_packets ADD COLUMN status TEXT DEFAULT 'active'",
    // ── 设备多账号（丝滑切换）：记录本设备(wallet)已密码登录过的账号，
    //    切换时凭 wallet cookie 重签发 token，无需再输密码 ──
    `CREATE TABLE IF NOT EXISTS device_accounts (
      wallet_id  TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      last_used  INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY (wallet_id, user_id)
    )`,
    // ── 用户自定义表情包（收藏的表情，点一下直接发）──
    `CREATE TABLE IF NOT EXISTS user_stickers (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      url        TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    )`,
    "CREATE INDEX IF NOT EXISTS idx_user_stickers ON user_stickers(user_id, created_at DESC)",
    // ── 收藏去重（CO1）：dedup_key 由应用层计算，局部唯一索引仅约束新行，
    //    存量行 dedup_key=NULL 不受约束，迁移不会因历史重复数据失败 ──
    "ALTER TABLE collections ADD COLUMN dedup_key TEXT DEFAULT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_dedup ON collections(user_id, dedup_key) WHERE dedup_key IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS idx_collections_user ON collections(user_id, created_at DESC)",
    // ── 朋友圈互动通知（MO2）：谁赞了/评论了你的动态。动态删除时级联清理 ──
    `CREATE TABLE IF NOT EXISTS moment_notifications (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,           -- 接收者（动态作者）
      actor_id   TEXT NOT NULL,           -- 触发者（点赞/评论的人）
      moment_id  TEXT NOT NULL,
      type       TEXT NOT NULL,           -- 'like' | 'comment'
      comment_id TEXT DEFAULT NULL,
      is_read    INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE CASCADE
    )`,
    "CREATE INDEX IF NOT EXISTS idx_moment_notif_user ON moment_notifications(user_id, created_at DESC)",
    // ── 朋友圈举报（MO6）：用户举报某条动态，落库供后台审核。动态删除时级联清理 ──
    `CREATE TABLE IF NOT EXISTS moment_reports (
      id          TEXT PRIMARY KEY,
      moment_id   TEXT NOT NULL,
      reporter_id TEXT NOT NULL,           -- 举报人
      reason      TEXT DEFAULT '',         -- 举报理由（可选短文本）
      status      TEXT DEFAULT 'pending',  -- 'pending' | 'reviewed' | 'dismissed'
      created_at  INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE CASCADE,
      UNIQUE(moment_id, reporter_id)       -- 同一人对同一动态只记一次
    )`,
    "CREATE INDEX IF NOT EXISTS idx_moment_reports_status ON moment_reports(status, created_at DESC)",
    // ── 缺失索引补全 ──
    "CREATE INDEX IF NOT EXISTS idx_blocked_users_user ON blocked_users(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_friend_req_from ON friend_requests(from_id)",
    "CREATE INDEX IF NOT EXISTS idx_friend_req_to ON friend_requests(to_id)",
    // ── token 黑名单持久化（Redis 不可用时的 SQLite 备用）──
    `CREATE TABLE IF NOT EXISTS token_blacklist (
      token      TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_token_blacklist_exp ON token_blacklist(expires_at)",
    // ── 聊天专属背景（P2）：按用户按会话的背景图 URL；NULL=用全局默认 ──
    "ALTER TABLE conversation_settings ADD COLUMN background TEXT DEFAULT NULL",
    // ── 全局默认聊天背景（P2）：NULL/'' = 无背景 ──
    "ALTER TABLE user_settings ADD COLUMN chat_background TEXT DEFAULT NULL",
    // ── 朋友圈"最近 N 天可见"（P2）：他人查看本人动态的时间窗，0=全部可见 ──
    "ALTER TABLE user_settings ADD COLUMN moments_visible_days INTEGER DEFAULT 0",
    // ── 朋友圈分组可见（P2）：visibility=include 时为白名单、exclude 时为黑名单的好友 id JSON 数组 ──
    "ALTER TABLE moments ADD COLUMN visible_to TEXT DEFAULT NULL",
    // ── 钱包账本（红包真实扣款/入账）──────────────────────────────
    //   balance 单位=金币(整数)。每次增减都在 wallet_transactions 留一条带 balance_after 的流水，
    //   余额与流水在同一事务内更新，保证可对账、不丢账。
    `CREATE TABLE IF NOT EXISTS wallets (
      user_id    TEXT PRIMARY KEY,
      balance    INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER DEFAULT (strftime('%s','now'))
    )`,
    `CREATE TABLE IF NOT EXISTS wallet_transactions (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      amount        INTEGER NOT NULL,        -- 带符号：正=入账，负=出账
      balance_after INTEGER NOT NULL,        -- 变动后余额，便于对账
      type          TEXT NOT NULL,           -- recharge|red_packet_send|red_packet_claim|red_packet_refund
      ref_id        TEXT DEFAULT NULL,       -- 关联业务 id（如红包 id）
      memo          TEXT DEFAULT '',
      created_at    INTEGER DEFAULT (strftime('%s','now'))
    )`,
    "CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON wallet_transactions(user_id, created_at DESC)",
    // ── 群音视频通话记录（mesh 多人通话）。1对1 仍走 call_logs，互不污染 ──
    `CREATE TABLE IF NOT EXISTS group_call_logs (
      id                TEXT PRIMARY KEY,
      conversation_id   TEXT NOT NULL,
      started_by        TEXT NOT NULL,
      type              TEXT NOT NULL,           -- audio|video
      status            TEXT DEFAULT 'ongoing',  -- ongoing|ended
      participant_count INTEGER DEFAULT 1,       -- 累计参与过的人数峰值
      started_at        INTEGER DEFAULT (strftime('%s','now')),
      ended_at          INTEGER DEFAULT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_group_call_conv ON group_call_logs(conversation_id, started_at DESC)",
    // ── 消息幂等：clientMsgId (sender_id + client_msg_id 唯一索引) ──
    "ALTER TABLE messages ADD COLUMN client_msg_id TEXT DEFAULT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_msg ON messages(sender_id, client_msg_id) WHERE client_msg_id IS NOT NULL",
    // ── 密码重置时间戳（M1）：JWT iat < password_changed_at 的 token 视为无效 ──
    "ALTER TABLE users ADD COLUMN password_changed_at INTEGER DEFAULT 0",
    // ── 按用户清空会话（H-2）：每人各自的清空时间戳，history 按此过滤 ──
    `CREATE TABLE IF NOT EXISTS conversation_clears (
      user_id         TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      cleared_at      INTEGER NOT NULL,
      PRIMARY KEY (user_id, conversation_id)
    )`,
    // ── 标记未读：用户手动将某会话标为未读 ──
    "ALTER TABLE conversation_settings ADD COLUMN manually_unread INTEGER DEFAULT 0",
    // ── 阅后即焚：每个用户对某会话独立设置的销毁秒数（0=关闭）──
    "ALTER TABLE conversation_settings ADD COLUMN burn_after INTEGER DEFAULT 0",
    // ── 好友标签/分组 ──
    `CREATE TABLE IF NOT EXISTS friend_labels (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      name       TEXT NOT NULL,
      color      TEXT DEFAULT '#07C160',
      created_at INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS friend_label_members (
      label_id   TEXT NOT NULL,
      friend_id  TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY (label_id, friend_id),
      FOREIGN KEY (label_id) REFERENCES friend_labels(id) ON DELETE CASCADE
    )`,
    "CREATE INDEX IF NOT EXISTS idx_friend_labels_user ON friend_labels(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_conv_settings_conv ON conversation_settings(conversation_id)",
    // 主消息列表查询 WHERE conversation_id=? AND deleted=0 ORDER BY created_at
    // 比 idx_messages_conv_time 更精确，跳过已删除消息
    "CREATE INDEX IF NOT EXISTS idx_messages_conv_del_time ON messages(conversation_id, deleted, created_at)",
    // message_reactions 按 message_id 查所有表情（PRIMARY KEY 前缀已覆盖，此为显式优化）
    "CREATE INDEX IF NOT EXISTS idx_reactions_msg ON message_reactions(message_id)",
    // conversation_members 按 conversation_id 加载成员列表（PRIMARY KEY 前缀已覆盖，显式标注）
    "CREATE INDEX IF NOT EXISTS idx_conv_members_conv ON conversation_members(conversation_id)",
    // friend_requests: 防止应用层 SELECT+INSERT 竞态产生重复 pending 行（DB 级兜底）
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_req_unique_pending ON friend_requests(from_id, to_id) WHERE status='pending'",
    // ── 每用户专属邀请码 + 邀请关系（裂变）──────────────────────────
    //   invite_code：用户自己的 6 位数字邀请码（唯一，注册后回填，可发给好友拉新）
    //   invited_by ：注册时填了谁的邀请码，则记其 user_id（NULL=管理员全局码或无邀请人）
    "ALTER TABLE users ADD COLUMN invite_code TEXT DEFAULT NULL",
    "ALTER TABLE users ADD COLUMN invited_by TEXT DEFAULT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_code ON users(invite_code) WHERE invite_code IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS idx_users_invited_by ON users(invited_by)",
  ];
  migrations.forEach(sql => {
    try { db.prepare(sql).run(); }
    catch (e) {
      // 幂等：仅忽略"列/表/索引已存在"错误，其余错误记录日志
      if (!e.message.includes('already exists') && !e.message.includes('duplicate column name')) {
        console.error('[db] Migration failed:', sql.slice(0, 120), '|', e.message);
      }
    }
  });
}

// ── FTS5 trigram 全文索引 + 同步触发器 ───────────────────────────
function applyFts(db) {
  try {
    db.prepare(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        message_id      UNINDEXED,
        conversation_id UNINDEXED,
        content,
        tokenize        = 'trigram'
      )
    `).run();

    const ftsEmpty = db.prepare('SELECT COUNT(*) AS n FROM messages_fts').get().n === 0;
    if (ftsEmpty) {
      db.prepare(`
        INSERT INTO messages_fts (message_id, conversation_id, content)
        SELECT id, conversation_id, content
        FROM   messages
        WHERE  type = 'text' AND deleted = 0
      `).run();
    }

    // Drop and recreate triggers so condition changes take effect on existing DBs
    db.exec(`
      DROP TRIGGER IF EXISTS fts_messages_insert;
      DROP TRIGGER IF EXISTS fts_messages_delete;
      DROP TRIGGER IF EXISTS fts_messages_edit;

      CREATE TRIGGER fts_messages_insert
      AFTER INSERT ON messages WHEN NEW.type='text' AND NEW.deleted=0
      BEGIN
        INSERT INTO messages_fts(message_id, conversation_id, content)
        VALUES (NEW.id, NEW.conversation_id, NEW.content);
      END;

      CREATE TRIGGER fts_messages_delete
      AFTER UPDATE OF deleted ON messages WHEN NEW.deleted != 0
      BEGIN
        DELETE FROM messages_fts WHERE message_id = OLD.id;
      END;

      CREATE TRIGGER fts_messages_edit
      AFTER UPDATE OF content ON messages WHEN NEW.type='text' AND NEW.deleted=0
      BEGIN
        DELETE FROM messages_fts WHERE message_id = OLD.id;
        INSERT INTO messages_fts(message_id, conversation_id, content)
        VALUES (NEW.id, NEW.conversation_id, NEW.content);
      END;
    `);
  } catch (e) {
    console.warn('[db] FTS5 setup skipped:', e.message);
  }
}

module.exports = { applySchema, applyFts };
