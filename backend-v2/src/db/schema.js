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
      server_sequence INTEGER,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id),
      FOREIGN KEY (sender_id) REFERENCES users(id)
    );

    -- AI 助手 turn 生命周期（Codex Thread/Turn/Item 模型落地）
    -- 一次用户输入 → 一轮 AI 处理 = 一条 turn；status: started/completed/failed
    CREATE TABLE IF NOT EXISTS ai_turns (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      bot_id TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'started',
      input_preview TEXT DEFAULT '',
      output_preview TEXT DEFAULT '',
      token_usage INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      error TEXT DEFAULT '',
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_ai_turns_conv ON ai_turns(conversation_id, created_at);

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

    CREATE TABLE IF NOT EXISTS file_registry (
      path TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      conversation_id TEXT DEFAULT '',
      kind TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
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
    // 已读回执持久化（三态展示：已发送/已送达/已读；Redis ackManager 仅做实时缓存，
    // 此处为最终态，TTL 过期/重启不丢）
    `CREATE TABLE IF NOT EXISTS message_reads (
      message_id TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      read_at    INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY (message_id, user_id)
    )`,
    "CREATE INDEX IF NOT EXISTS idx_reads_msg ON message_reads(message_id)",
    "CREATE INDEX IF NOT EXISTS idx_reads_user ON message_reads(user_id)",
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
    // 群邀请权限：0=仅管理员可邀请(默认)，1=普通成员也可邀请
    "ALTER TABLE conversations ADD COLUMN member_can_invite INTEGER DEFAULT 0",
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
    // ── 隐私：好友不能直接邀请我进群（1=开启保护，好友需先征得我同意/我扫码才入群）──
    "ALTER TABLE user_settings ADD COLUMN no_direct_group_invite INTEGER DEFAULT 0",
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
      cleared_rowid   INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, conversation_id)
    )`,
    // 存量 clears 回填：先补列（新库建表已含；旧库幂等 ALTER），再回填同秒精确水位线
    "ALTER TABLE conversation_clears ADD COLUMN cleared_rowid INTEGER DEFAULT 0",
    "UPDATE conversation_clears SET cleared_rowid = COALESCE((SELECT MAX(m.rowid) FROM messages m WHERE m.conversation_id = conversation_clears.conversation_id AND m.created_at <= conversation_clears.cleared_at), 0) WHERE cleared_rowid = 0",
    // ── 标记未读：用户手动将某会话标为未读 ──
    "ALTER TABLE conversation_settings ADD COLUMN manually_unread INTEGER DEFAULT 0",
    // ── 阅后即焚：每个用户对某会话独立设置的销毁秒数（0=关闭）──
    "ALTER TABLE conversation_settings ADD COLUMN burn_after INTEGER DEFAULT 0",
    // ── 好友标签/分组 ──
    `CREATE TABLE IF NOT EXISTS friend_labels (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      name       TEXT NOT NULL,
      color      TEXT DEFAULT '#6D5AE6',
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
    // ── 特权账户 + 精确最后在线时间 ─────────────────────────────
    // is_privileged=1 的账户可查看好友「最后在线精确到分」
    // last_online_at：Unix 秒，socket 连接时更新；断线时也更新（记录离线时刻）
    "ALTER TABLE users ADD COLUMN is_privileged INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN last_online_at INTEGER DEFAULT 0",
    "CREATE INDEX IF NOT EXISTS idx_users_privileged ON users(is_privileged) WHERE is_privileged=1",
    // ── 勿扰时段（夜间免打扰）：quiet_enabled 开关 + HH:MM 起止时间。
    //    开启且当前时刻落在时段内时，推送/通知被抑制（消息本身照常入库送达）──
    "ALTER TABLE user_settings ADD COLUMN quiet_enabled INTEGER DEFAULT 0",
    "ALTER TABLE user_settings ADD COLUMN quiet_start TEXT DEFAULT '23:00'",
    "ALTER TABLE user_settings ADD COLUMN quiet_end TEXT DEFAULT '07:00'",
    // ── 来电铃声：classic=经典双音(默认) / dual=交替双音 / triple=三连音 / soft=轻柔单音。
    //    四端按 key 映射各自的 ToneGenerator/CallTonePlayer/WebAudio 合成参数 ──
    "ALTER TABLE user_settings ADD COLUMN ringtone TEXT DEFAULT 'classic'",
    // ── 消息定时发送：pending 待发 / sent 已发 / cancelled 已取消。
    //    进程内定时器每 30s 扫描到期的 pending 消息并发出；服务重启后凭表中 pending 恢复 ──
    `CREATE TABLE IF NOT EXISTS scheduled_messages (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_id       TEXT NOT NULL,
      content         TEXT NOT NULL,
      type            TEXT DEFAULT 'text',
      send_at         INTEGER NOT NULL,
      status          TEXT DEFAULT 'pending',
      created_at      INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id),
      FOREIGN KEY (sender_id) REFERENCES users(id)
    )`,
    "CREATE INDEX IF NOT EXISTS idx_scheduled_msgs_status ON scheduled_messages(status, send_at)",
    "CREATE INDEX IF NOT EXISTS idx_scheduled_msgs_sender ON scheduled_messages(sender_id, status)",
    // ── 定时消息发出后在 messages 上留标记，前端气泡渲染「定时」角标 ──
    "ALTER TABLE messages ADD COLUMN is_scheduled INTEGER DEFAULT 0",
    // ── 语音消息转写缓存：ASR 结果落此列，二次点「转文字」直接命中，幂等 ──
    "ALTER TABLE messages ADD COLUMN transcript TEXT DEFAULT NULL",
    // ── 红包过期回收查询索引：reclaimExpired 每10分钟扫 status='active' AND created_at<cutoff，
    //    无此索引则全表扫描。局部索引仅覆盖 active 行，随红包被领/过期而收缩，体积极小。──
    "CREATE INDEX IF NOT EXISTS idx_red_packets_status_time ON red_packets(status, created_at) WHERE status='active'",
    // ── 个人删除（per-user tombstone）：仅对执行删除的账号生效，对方/群成员不受影响。
    //    撤回（deleted=2）是会话级，个人删除是用户级：两者独立，撤回时清 content 但
    //    不影响 user_message_deletions；个人删除后 history/missed/search 对该用户不可见。
    `CREATE TABLE IF NOT EXISTS user_message_deletions (
      message_id TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      deleted_at INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY (message_id, user_id),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    "CREATE INDEX IF NOT EXISTS idx_user_msg_deletions_user ON user_message_deletions(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_user_msg_deletions_msg ON user_message_deletions(message_id)",
    // ── 统一附件系统（2026-08-29）：补齐精确 mime/size，供前端渲染文件卡片
    //    （文件展示名沿用既有 content 字段，不重复建列）。
    "ALTER TABLE messages ADD COLUMN file_mime TEXT DEFAULT NULL",
    "ALTER TABLE messages ADD COLUMN file_size INTEGER DEFAULT NULL",
    // ── 撤回后阻断附件访问(见 app.js resolveUploadAccess 的 stillLive 查询)，按
    //    file_url 高频查询，需要索引。
    "CREATE INDEX IF NOT EXISTS idx_messages_file_url ON messages(file_url) WHERE file_url != ''",
    // ── 转发文件到新会话后的授权登记（只由服务端 forward() 写入，绝不接受客户端参数，
    //    保持 file_registry 体系"引用行不可信、只信服务端登记"的安全红线不变）。
    `CREATE TABLE IF NOT EXISTS file_registry_shares (
      path TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY (path, conversation_id)
    )`,
    "CREATE INDEX IF NOT EXISTS idx_file_registry_shares_path ON file_registry_shares(path)",
    // ── 统一设备同步游标：消息创建序号 + 追加式会话事件流 ──────────────
    "ALTER TABLE messages ADD COLUMN server_sequence INTEGER DEFAULT NULL",
    `CREATE TABLE IF NOT EXISTS conversation_sequences (
      conversation_id TEXT PRIMARY KEY,
      last_sequence INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS conversation_events (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      server_sequence INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      message_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      target_user_id TEXT DEFAULT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE(conversation_id, server_sequence),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )`,
    `WITH ranked AS (
       SELECT rowid AS rid,
              ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY created_at, rowid) AS seq
       FROM messages
     )
     UPDATE messages
     SET server_sequence=(SELECT seq FROM ranked WHERE ranked.rid=messages.rowid)
     WHERE server_sequence IS NULL`,
    `INSERT INTO conversation_sequences (conversation_id,last_sequence)
     SELECT conversation_id, COALESCE(MAX(server_sequence),0)
     FROM messages GROUP BY conversation_id
     ON CONFLICT(conversation_id) DO UPDATE SET last_sequence=MAX(last_sequence,excluded.last_sequence)`,
    `INSERT OR IGNORE INTO conversation_events
       (id,conversation_id,server_sequence,event_type,message_id,actor_id,payload,created_at)
     SELECT 'backfill:'||id,conversation_id,server_sequence,'message_created',id,sender_id,'{}',created_at
     FROM messages WHERE server_sequence IS NOT NULL`,
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_conversation_sequence ON messages(conversation_id,server_sequence) WHERE server_sequence IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS idx_conversation_events_sync ON conversation_events(conversation_id,server_sequence)",
    "CREATE INDEX IF NOT EXISTS idx_conversation_events_target ON conversation_events(conversation_id,target_user_id,server_sequence)",
    // ── 批量转发结果与幂等键 ─────────────────────────────────────
    "ALTER TABLE messages ADD COLUMN batch_id TEXT DEFAULT NULL",
    "ALTER TABLE messages ADD COLUMN client_batch_id TEXT DEFAULT NULL",
    `CREATE TABLE IF NOT EXISTS message_forward_batches (
      batch_id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      client_batch_id TEXT NOT NULL,
      status TEXT NOT NULL,
      total INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      failed_message_ids TEXT NOT NULL DEFAULT '[]',
      retryable_message_ids TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER DEFAULT (strftime('%s','now')),
      updated_at INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE(actor_id, client_batch_id)
    )`,
    "CREATE INDEX IF NOT EXISTS idx_forward_batches_actor ON message_forward_batches(actor_id, created_at DESC)",
    "ALTER TABLE conversation_events ADD COLUMN batch_id TEXT DEFAULT NULL",
    "ALTER TABLE conversation_events ADD COLUMN client_batch_id TEXT DEFAULT NULL",
    "CREATE INDEX IF NOT EXISTS idx_conversation_events_batch ON conversation_events(batch_id, server_sequence)",
    // ── 内容审核关键词黑名单兜底（2026-09-02，P12 审核 mock 下线后生产环境唯一的审核机制）──
    `CREATE TABLE IF NOT EXISTS content_blacklist (
      id TEXT PRIMARY KEY,
      word TEXT NOT NULL UNIQUE,
      created_by TEXT DEFAULT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    )`,
    // ── 多管理员（2026-09-02）：此前只有 .env 里硬编码的单一账号，无法区分谁做了什么。
    // env 管理员路径永久保留、永不下线（见 admin.service.js verifyCredentials），这张表
    // 只是"新增"而非"替代"——DB 挂了这张表出问题，env 账号依然能登录，后台入口不会被锁死。
    `CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      disabled INTEGER NOT NULL DEFAULT 0,
      created_by TEXT DEFAULT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    )`,
    // ── 推送文案多语言（2026-09-04）：此前推送文案在服务端写死简体中文
    // （'新消息'/'收到一条新消息'/'[图片]'…），而前端有 zh-CN/en/zh-TW 三套完整词典。
    // 推送是用户在 App 之外唯一看得到的文案，英文用户锁屏收到的却是简中，
    // 整套前端 i18n 到这一步全丢。服务端异步发推送时没有请求上下文可协商语言，
    // 只能持久化用户偏好——客户端切语言时上报，写到这一列。
    // 缺省 zh-CN 与既有行为一致，老用户不受影响。
    "ALTER TABLE user_settings ADD COLUMN lang TEXT DEFAULT 'zh-CN'",
    // ── F1 批次（2026-09-05）──────────────────────────────────────
    // 朋友圈发视频：video=视频URL，cover=可选封面图URL；空串=无（老行为不变，纯图文动态两列恒为''）
    "ALTER TABLE moments ADD COLUMN video TEXT DEFAULT ''",
    "ALTER TABLE moments ADD COLUMN cover TEXT DEFAULT ''",
    // 会话归档：按用户按会话，0=未归档(默认，老行为不变)/1=已归档
    "ALTER TABLE conversation_settings ADD COLUMN archived INTEGER DEFAULT 0",
    // Q01: additive authority; old sessions are imported once, preserving historical jti values.
    // The old UA-unique table is never used to authenticate or to restore revoked sessions.
    `CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device TEXT DEFAULT '未知设备', platform TEXT DEFAULT 'Web', ip TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      last_seen INTEGER DEFAULT (strftime('%s','now'))
    )`,
    `INSERT OR IGNORE INTO auth_sessions (id,user_id,device,platform,ip,created_at,last_seen)
      SELECT id,user_id,device,platform,ip,created_at,last_seen FROM user_sessions`,
    "CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id)",
    // Old grants cannot be mapped safely to a physical session. They require password login.
    "ALTER TABLE device_accounts ADD COLUMN session_id TEXT DEFAULT NULL",
    "CREATE INDEX IF NOT EXISTS idx_device_accounts_session ON device_accounts(user_id,session_id)",
    // Ambiguous legacy push ownership must be re-registered by the active client.
    `DELETE FROM device_tokens WHERE token IN (
      SELECT token FROM device_tokens GROUP BY token HAVING COUNT(*) > 1
    )`,
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_device_tokens_owner ON device_tokens(token)",
    `DELETE FROM push_subscriptions WHERE endpoint IN (
      SELECT endpoint FROM push_subscriptions GROUP BY endpoint HAVING COUNT(*) > 1
    )`,
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_owner ON push_subscriptions(endpoint)",
    "ALTER TABLE push_subscriptions ADD COLUMN session_id TEXT REFERENCES auth_sessions(id) ON DELETE CASCADE",
    "ALTER TABLE device_tokens ADD COLUMN session_id TEXT REFERENCES auth_sessions(id) ON DELETE CASCADE",
    "CREATE INDEX IF NOT EXISTS idx_push_subscriptions_session ON push_subscriptions(session_id)",
    "CREATE INDEX IF NOT EXISTS idx_device_tokens_session ON device_tokens(session_id)",
    // Historical subscriptions cannot be safely attributed to a login session.
    // Active clients register again; never guess which old device should keep receiving messages.
    "DELETE FROM push_subscriptions WHERE session_id IS NULL",
    "DELETE FROM device_tokens WHERE session_id IS NULL",
    // F-06: append-only migration, also runnable independently against an isolated DB.
    `CREATE TABLE IF NOT EXISTS financial_idempotency (
      actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      operation TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      PRIMARY KEY (actor_id, operation, idempotency_key)
    )`,
    ...require('./migrations/batch2'),
    ...require('./migrations/batch4'),
    // 删除聊天（仅自己）：1=从我的会话列表隐藏，直到出现个人清空水位之后的新消息（对齐微信"删除聊天"）
    "ALTER TABLE conversation_settings ADD COLUMN hidden INTEGER DEFAULT 0",
    // 删除好友记录（user_id 删除了 contact_id）：双方不再是好友且存在该记录时禁止私聊/通话（对齐微信），
    // 重新加为好友即清除。普通陌生人私聊（如群成员之间）不受影响。
    `CREATE TABLE IF NOT EXISTS contact_deletions (
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      contact_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      PRIMARY KEY (user_id, contact_id)
    )`,
    // 勿扰时段按用户时区判定（IANA 名，如 Asia/Shanghai）。客户端保存勿扰设置时上报；
    // NULL = 未上报，推送侧按 DEFAULT_TIMEZONE 兜底。此前按服务器 UTC 计算，中国用户
    // 设 23:00~07:00 实际拦的是北京时间 07:00~15:00。
    "ALTER TABLE user_settings ADD COLUMN timezone TEXT DEFAULT NULL",
    // 2026-10-12：web_vitals / call_reports（客户端遥测）
    ...require('./migrations/batch5'),
  ];

  // ── 迁移执行：版本追踪 + 错误分级 ────────────────────────────────
  // schema_migrations 记录已成功执行的迁移序号（幂等：已执行的直接跳过）。
  // 「已存在/重复列」是幂等重跑的正常现象，静默；其余错误（磁盘满、约束冲突、
  // 语法错误）说明数据库处于非预期状态，直接抛出中止启动，避免后续迁移在
  // 损坏的 schema 上继续执行、放大问题（此前仅打日志继续跑会掩盖真实故障）。

  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    idx        INTEGER PRIMARY KEY,
    applied_at INTEGER DEFAULT (strftime('%s','now'))
  )`);
  const isBenign = (msg) =>
    msg.includes('already exists') ||
    msg.includes('duplicate column name');
  const markApplied = db.prepare('INSERT OR IGNORE INTO schema_migrations (idx) VALUES (?)');
  const alreadyApplied = new Set(
    db.prepare('SELECT idx FROM schema_migrations').all().map(r => r.idx)
  );
  migrationsSnapshot = migrations;   // 供 verifySchemaDrift 启动时全量核对（防 idx 漂移漏建）
  // Schema writes and version markers commit together: a crash cannot leave a copied authority
  // without its marker (which would otherwise resurrect removed sessions on the next startup).
  db.transaction(() => migrations.forEach((sql, idx) => {
    if (alreadyApplied.has(idx)) return; // 已成功执行过，跳过
    try {
      db.prepare(sql).run();
      markApplied.run(idx);
    } catch (e) {
      if (isBenign(e.message)) {
        // 幂等重跑遇到「已存在」：视为成功，记入版本表以后跳过
        markApplied.run(idx);
        return;
      }
      // 真实故障：中止启动，暴露问题而非继续在损坏 schema 上跑
      console.error('[db] Migration FAILED (aborting):', `#${idx}`, sql.slice(0, 120), '|', e.message);
      throw new Error(`数据库迁移 #${idx} 失败: ${e.message}`);
    }
  }))();
}

// ── FTS5 trigram 全文索引 + 同步触发器 ───────────────────────────
// 2026-10-11：FTS 行的 rowid 与 messages.rowid 对齐，触发器改为按 rowid 删除。
//   旧布局里 FTS 行 rowid 由 FTS5 自增分配，触发器只能 `DELETE ... WHERE message_id = OLD.id`；
//   而 message_id 是 UNINDEXED 列，FTS5 只有 MATCH 与 rowid 能走索引，其余等值过滤一律全表
//   扫描（EXPLAIN: SCAN messages_fts VIRTUAL TABLE INDEX 0:）。撤回/编辑/焚毁每条一次全扫，
//   clearConversation 一条 UPDATE 命中 N 行就是 N 次全扫（N × FTS 总行数），且都在主线程
//   .immediate() 事务里：5 万行 FTS 清空 1000 条实测 4~8 s，事件循环和写锁一起被卡住。
//   对齐后 `WHERE rowid = OLD.rowid` 是 rowid 点查（INDEX 0:=），同场景约 10 ms。
//   message_id / conversation_id 两列原样保留：所有读路径（JOIN m.id = fts.message_id、
//   fts.conversation_id 过滤）一行不用改；继续按 message_id 连接还保证万一有残留 FTS 行、
//   其 rowid 又被新消息复用时，不会把旧正文错配到新消息上。
//   ⚠ messages 是隐式 rowid 表（id TEXT PRIMARY KEY），VACUUM 可能重排其 rowid（cleared_rowid
//   水位线同样依赖 rowid 稳定，不要对生产库跑 VACUUM）。万一发生，下方启动抽查会发现错位并自动重建。
const FTS_TABLE_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    message_id      UNINDEXED,
    conversation_id UNINDEXED,
    content,
    tokenize        = 'trigram'
  )`;

// 以 messages 为唯一事实来源回填（过滤条件与旧版「空表回填」、insert 触发器一致），显式写 rowid。
const FTS_BACKFILL_SQL = `
  INSERT INTO messages_fts (rowid, message_id, conversation_id, content)
  SELECT rowid, id, conversation_id, content
  FROM   messages
  WHERE  type = 'text' AND deleted = 0
  ORDER  BY rowid`;

// 触发器每次启动 DROP + CREATE，条件改动对存量库立即生效。
//   insert 用 INSERT OR REPLACE：rowid 现在是「一条消息一行」的键，若该 rowid 上已有残留行
//   （如补录工具 ftsSearch.indexMessage 不带 rowid 插入、被 FTS5 自增分到了 max+1；或硬删消息后
//   rowid 被复用），普通 INSERT 会报 constraint failed 并连带让消息本身的 INSERT 失败——
//   发消息失败远比替换掉一行陈旧索引严重。（所有 messages 写入都是普通 INSERT，外层不会覆盖此冲突策略）
//   delete 收紧为 OLD.deleted=0 AND OLD.type='text'：只有这类行才可能有 FTS 行（insert/edit/回填
//   都只收 type='text' AND deleted=0），图片/文件/系统消息与重复撤回直接跳过。
const FTS_TRIGGERS_SQL = `
  DROP TRIGGER IF EXISTS fts_messages_insert;
  DROP TRIGGER IF EXISTS fts_messages_delete;
  DROP TRIGGER IF EXISTS fts_messages_edit;

  CREATE TRIGGER fts_messages_insert
  AFTER INSERT ON messages WHEN NEW.type='text' AND NEW.deleted=0
  BEGIN
    INSERT OR REPLACE INTO messages_fts(rowid, message_id, conversation_id, content)
    VALUES (NEW.rowid, NEW.id, NEW.conversation_id, NEW.content);
  END;

  CREATE TRIGGER fts_messages_delete
  AFTER UPDATE OF deleted ON messages WHEN OLD.deleted=0 AND NEW.deleted != 0 AND OLD.type='text'
  BEGIN
    DELETE FROM messages_fts WHERE rowid = OLD.rowid;
  END;

  CREATE TRIGGER fts_messages_edit
  AFTER UPDATE OF content ON messages WHEN NEW.type='text' AND NEW.deleted=0
  BEGIN
    DELETE FROM messages_fts WHERE rowid = OLD.rowid;
    INSERT INTO messages_fts(rowid, message_id, conversation_id, content)
    VALUES (NEW.rowid, NEW.id, NEW.conversation_id, NEW.content);
  END;
`;

// 判定 messages_fts 是否需要按 rowid 对齐布局（重）建；返回原因，无需重建返回 null。
//   'empty' ：FTS 为空——保留原「空表即从 messages 回填」行为（新库 / 被清空过），不必 DROP；
//   'legacy'：insert 触发器不是 rowid 版本——旧布局（FTS rowid 自增，与 messages.rowid 无关），
//             或曾回滚到旧代码跑过一段（期间旧触发器写入的行又是自增 rowid）。
//             以触发器定义而非 schema_migrations 序号作标记，正是为了「回滚→再升级」时能再次重建；
//             也不占用 migrations 数组的 idx，不引入序号漂移风险。
//   'drift' ：抽查 rowid 最大的 64 行，message_id 与同 rowid 的 messages.id 不一致（VACUUM 重排、
//             不带 rowid 的补录行、硬删后残留）——自愈重建。FTS5 按 rowid 倒序扫 64 行 + messages
//             rowid 点查，启动开销恒定，与库大小无关。
function ftsRebuildReason(db) {
  if (!db.prepare('SELECT 1 FROM messages_fts LIMIT 1').get()) return 'empty';
  const trigger = db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='fts_messages_insert'").get();
  if (!trigger || !/NEW\.rowid/i.test(trigger.sql)) return 'legacy';
  const drift = db.prepare(`
    SELECT 1
    FROM (SELECT rowid AS rid, message_id FROM messages_fts ORDER BY rowid DESC LIMIT 64) f
    LEFT JOIN messages m ON m.rowid = f.rid
    WHERE m.id IS NOT f.message_id
    LIMIT 1`).get();
  return drift ? 'drift' : null;
}

function applyFts(db) {
  try {
    // 建表、判定、重建、换触发器在同一个 IMMEDIATE 事务里：任一步失败整体回滚，库保持原布局 +
    // 原触发器（搜索照常可用，只是删除仍是旧的全扫代价），不会出现「表已按 rowid 重建但触发器
    // 仍按 message_id 删」或反之的半成品。启动期同步执行，早于 readDb 打开与 writer worker
    // 首次写入；IMMEDIATE 先拿写锁，避免与仍在退出的旧进程交错写入。
    db.transaction(() => {
      db.prepare(FTS_TABLE_SQL).run();
      const reason = ftsRebuildReason(db);
      if (reason) {
        const startedAt = Date.now();
        if (reason !== 'empty') {
          // 整表重建：DROP + CREATE 远快于逐行 DELETE（FTS5 普通表删一行要重新分词）。
          // 回填源是 messages 本身，现有可搜索内容（type='text' AND deleted=0）原样保留。
          db.exec('DROP TABLE messages_fts');
          db.prepare(FTS_TABLE_SQL).run();
        }
        const rows = db.prepare(FTS_BACKFILL_SQL).run().changes;
        if (reason !== 'empty') {
          const msg = `[db] messages_fts 已按 messages.rowid 重建（${reason}）：${rows} 行，${Date.now() - startedAt} ms`;
          if (reason === 'drift') console.warn(msg); else console.log(msg);
        }
      }
      db.exec(FTS_TRIGGERS_SQL);
    }).immediate();
  } catch (e) {
    console.warn('[db] FTS5 setup skipped:', e.message);
  }
}

// ── Schema Drift 防回归断言（启动时执行）───────────────────────────
// P0-PROD-SCHEMA-DRIFT 根因：schema_migrations 标记已 applied，但实际列缺失
// （生产库初始化早于 76/77/78 序号内容变更，runner 按 idx 跳过不重放）。
// 2026-09-02 第二例（message_reads idx18 / user_settings.ringtone idx102）：
// migrations 数组中部插入新迁移 → idx 撞上已记录旧 idx → 建表/加列被跳过。
// 防回归策略（增强）：
//   1) 人工关键清单 REQUIRED_COLUMNS（表存在 + 关键列）
//   2) 启动时对【每条已 applied 的迁移】做结构断言（expectMigration 解析预期
//      对象并核对真实结构）——缺任何对象即抛错中止启动，把漂移暴露在部署期
//      而非用户 500（与 scripts/schema-audit.js 同逻辑，可独立人工巡检）。
const REQUIRED_COLUMNS = {
  conversation_clears: ['user_id', 'conversation_id', 'cleared_at', 'cleared_rowid'],
  message_reads: ['message_id', 'user_id', 'read_at'],
};

// applySchema 内的 migrations 数组快照（供 verifySchemaDrift 全量核对）。
let migrationsSnapshot = null;

// 解析迁移 SQL 的预期结构效果；数据修复类（UPDATE/INSERT/WITH…）返回 null 跳过。
function expectMigration(sql) {
  const one = s => s.replace(/["'`]/g, '');
  let m;
  if ((m = sql.match(/CREATE TABLE IF NOT EXISTS (\S+)/))) return { type: 'table', obj: one(m[1]) };
  if ((m = sql.match(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\S+)/))) return { type: 'index', obj: one(m[1]) };
  if ((m = sql.match(/ALTER TABLE (\S+) ADD COLUMN (\S+)/))) return { type: 'column', table: one(m[1]), obj: one(m[2]) };
  if ((m = sql.match(/ALTER TABLE (\S+) ADD (\S+) (\S+)/))) return { type: 'column', table: one(m[1]), obj: one(m[2]) };
  return null;
}

// 幂等修复：conversation_clears 缺 cleared_rowid 时补列（P0 HOTFIX 逻辑）。
// 表 0 行时无 UPDATE 需要；有历史行时回填 0。返回是否实际执行了修复。
function ensureClearWatermarkColumn(db) {
  const cols = new Set(db.prepare('PRAGMA table_info(conversation_clears)').all().map(c => c.name));
  if (cols.has('cleared_rowid')) return false;
  db.exec('ALTER TABLE conversation_clears ADD COLUMN cleared_rowid INTEGER DEFAULT 0');
  db.exec('UPDATE conversation_clears SET cleared_rowid = 0 WHERE cleared_rowid IS NULL');
  return true;
}

/**
 * Schema drift 核对（2026-09-02 起）：返回缺失清单，不抛错。
 * 调用方决定策略：deploy/CI 可 SCHEMA_DRIFT_ABORT=1 强中止；
 * 默认降级 —— 打 error 日志 + /health 返回 503（deploy 健康检查拦住并自动回滚），
 * 避免「非变更重启（手动 restart / crash 自愈）」时把可用服务直接打死。
 * 返回 [{ idx, type, obj, sql }]，无漂移返回 []。
 */
function verifySchemaDrift(db) {
  const missing = [];
  // 1) 人工关键清单：表存在 + 关键列存在
  for (const [table, cols] of Object.entries(REQUIRED_COLUMNS)) {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(table);
    if (!exists) { missing.push({ idx: 'manual', type: 'table', obj: table, sql: '(REQUIRED_COLUMNS)' }); continue; }
    const actual = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
    for (const col of cols) if (!actual.has(col)) missing.push({ idx: 'manual', type: 'column', obj: `${table}.${col}`, sql: '(REQUIRED_COLUMNS)' });
  }
  // 2) 全量核对：每条【已 applied 的迁移】的预期对象（表/索引/列）必须真实存在。
  //    2026-09-02 增强：此前只手工覆盖个别关键表，防不住所有「idx 撞车被跳过」的
  //    漂移（message_reads idx18、user_settings.ringtone idx102 均因此漏建）。
  if (migrationsSnapshot) {
    const applied = new Set(db.prepare('SELECT idx FROM schema_migrations').all().map(r => r.idx));
    migrationsSnapshot.forEach((sql, idx) => {
      if (!applied.has(idx)) return;
      const e = expectMigration(sql);
      if (!e) return;   // 数据修复类语句（UPDATE/INSERT/WITH…）无法结构核对，跳过
      let present;
      if (e.type === 'table') {
        present = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(e.obj);
      } else if (e.type === 'index') {
        present = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(e.obj);
      } else {
        const t = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(e.table);
        if (!t) { missing.push({ idx, type: 'table', obj: e.table, sql: sql.replace(/\s+/g, ' ').slice(0, 120) }); return; }
        const cols = new Set(db.prepare(`PRAGMA table_info(${e.table})`).all().map(c => c.name));
        present = cols.has(e.obj);
      }
      if (!present) missing.push({ idx, type: e.type, obj: e.obj, sql: sql.replace(/\s+/g, ' ').slice(0, 120) });
    });
  }
  return missing;
}

module.exports = { applySchema, applyFts, ensureClearWatermarkColumn, verifySchemaDrift };
