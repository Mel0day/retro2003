-- __NAME__ 数据库结构。金额（如果有）一律用「分」保存的整数。
-- 骨架自带：会员、会话、站点设置、内容条目、留言。按你的产品把 entries 改成真正的业务表。

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE users (
  id             INTEGER PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  city           TEXT NOT NULL DEFAULT '',
  intro          TEXT NOT NULL DEFAULT '',
  banned         INTEGER NOT NULL DEFAULT 0,
  ban_reason     TEXT NOT NULL DEFAULT '',
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  last_login_at  INTEGER,
  last_ip        TEXT NOT NULL DEFAULT ''
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  remember    INTEGER NOT NULL DEFAULT 0,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  ip          TEXT NOT NULL DEFAULT '',
  ua          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- 示例业务表：一条「内容」。换成你自己的（帖子、宝贝、歌曲、文档……）
CREATE TABLE entries (
  id           INTEGER PRIMARY KEY,
  author_id    INTEGER NOT NULL REFERENCES users(id),
  channel      TEXT NOT NULL DEFAULT '',
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  image        TEXT NOT NULL DEFAULT '',
  views        INTEGER NOT NULL DEFAULT 0,
  likes        INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'public' CHECK (status IN ('public', 'hidden', 'deleted')),
  search_text  TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_entries_list ON entries(status, created_at);
CREATE INDEX idx_entries_author ON entries(author_id, status);

CREATE TABLE comments (
  id          INTEGER PRIMARY KEY,
  entry_id    INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  hidden      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_comments_entry ON comments(entry_id, id);
