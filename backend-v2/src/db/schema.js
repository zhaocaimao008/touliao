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
  migrations.forEach((sql, idx) => {
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

// ── Schema Drift 防回归断言（启动时执行）───────────────────────────
// P0-PROD-SCHEMA-DRIFT 根因：schema_migrations 标记已 applied，但实际列缺失
// （生产库初始化早于 76/77/78 序号内容变更，runner 按 idx 跳过不重放）。
// 最小 guard：启动/部署时断言 production-required 列存在，缺失即抛错中止启动，
// 避免「迁移元数据=applied、实际列=缺失」静默漂移到用户 500。
const REQUIRED_COLUMNS = {
  conversation_clears: ['user_id', 'conversation_id', 'cleared_at', 'cleared_rowid'],
};

// 幂等修复：conversation_clears 缺 cleared_rowid 时补列（P0 HOTFIX 逻辑）。
// 表 0 行时无 UPDATE 需要；有历史行时回填 0。返回是否实际执行了修复。
function ensureClearWatermarkColumn(db) {
  const cols = new Set(db.prepare('PRAGMA table_info(conversation_clears)').all().map(c => c.name));
  if (cols.has('cleared_rowid')) return false;
  db.exec('ALTER TABLE conversation_clears ADD COLUMN cleared_rowid INTEGER DEFAULT 0');
  db.exec('UPDATE conversation_clears SET cleared_rowid = 0 WHERE cleared_rowid IS NULL');
  return true;
}

function assertRequiredColumns(db) {
  const missing = [];
  for (const [table, cols] of Object.entries(REQUIRED_COLUMNS)) {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(table);
    if (!exists) { missing.push(`table:${table}`); continue; }
    const actual = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
    for (const col of cols) if (!actual.has(col)) missing.push(`${table}.${col}`);
  }
  if (missing.length) {
    throw new Error(`[db] Schema drift detected — 迁移标记已 applied 但列缺失: ${missing.join(', ')}。` +
      `请检查迁移记录与实际 schema 一致性（勿直接伪造 applied 记录）。`);
  }
}

module.exports = { applySchema, applyFts, ensureClearWatermarkColumn, assertRequiredColumns };
