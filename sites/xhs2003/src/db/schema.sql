-- 小红书 2003 数据库结构 v1。所有时间字段均为 Unix 秒。

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE users (
  id             INTEGER PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','moderator','admin')),
  banned         INTEGER NOT NULL DEFAULT 0,
  title          TEXT NOT NULL DEFAULT '',
  points         INTEGER NOT NULL DEFAULT 0,
  avatar_color   TEXT NOT NULL DEFAULT '#69c',
  avatar_path    TEXT NOT NULL DEFAULT '',
  signature      TEXT NOT NULL DEFAULT '',
  location       TEXT NOT NULL DEFAULT '',
  gender         TEXT NOT NULL DEFAULT '' CHECK (gender IN ('','male','female')),
  question       TEXT NOT NULL DEFAULT '',
  answer_hash    TEXT NOT NULL DEFAULT '',
  note_count     INTEGER NOT NULL DEFAULT 0,
  post_count     INTEGER NOT NULL DEFAULT 0,
  last_bonus_day TEXT NOT NULL DEFAULT '',
  last_login_at  INTEGER,
  last_seen_at   INTEGER,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_users_points ON users(points DESC);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,           -- sha256(token)
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  remember    INTEGER NOT NULL DEFAULT 0,
  expires_at  INTEGER NOT NULL,
  ip          TEXT NOT NULL DEFAULT '',
  ua          TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE uploads (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  path        TEXT NOT NULL UNIQUE,        -- 相对 /uploads/ 的路径
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  purpose     TEXT NOT NULL DEFAULT 'note',
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_uploads_user ON uploads(user_id);

-- ---------- 笔记 ----------
CREATE TABLE channels (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0,
  note_count  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE notes (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id     INTEGER NOT NULL REFERENCES channels(id),
  title          TEXT NOT NULL,
  content        TEXT NOT NULL,
  summary        TEXT NOT NULL DEFAULT '',
  cover          TEXT NOT NULL DEFAULT '',
  has_image      INTEGER NOT NULL DEFAULT 0,
  hits           INTEGER NOT NULL DEFAULT 0,
  likes          INTEGER NOT NULL DEFAULT 0,
  flowers        INTEGER NOT NULL DEFAULT 0,
  favorites      INTEGER NOT NULL DEFAULT 0,
  comment_count  INTEGER NOT NULL DEFAULT 0,
  featured       INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden')),
  edited_at      INTEGER,
  edited_by      TEXT NOT NULL DEFAULT '',
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_notes_created ON notes(status, created_at DESC);
CREATE INDEX idx_notes_channel ON notes(channel_id, status, created_at DESC);
CREATE INDEX idx_notes_user ON notes(user_id, created_at DESC);
CREATE INDEX idx_notes_hits ON notes(status, hits DESC);

CREATE TABLE tags (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  use_count   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE note_tags (
  note_id  INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  sort     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (note_id, tag_id)
);
CREATE INDEX idx_note_tags_tag ON note_tags(tag_id);

CREATE TABLE comments (
  id          INTEGER PRIMARY KEY,
  note_id     INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  guest_name  TEXT NOT NULL DEFAULT '',
  content     TEXT NOT NULL,
  floor       INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','pending','deleted')),
  ip          TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_comments_note ON comments(note_id, status, floor);
CREATE INDEX idx_comments_status ON comments(status, created_at DESC);

CREATE TABLE note_likes (
  note_id     INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  voter       TEXT NOT NULL,               -- u:<userId> 或 v:<visitorId>
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (note_id, voter)
);
CREATE INDEX idx_note_likes_time ON note_likes(created_at);

CREATE TABLE favorites (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id     INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, note_id)
);

CREATE TABLE flowers (
  id          INTEGER PRIMARY KEY,
  note_id     INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day         TEXT NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (note_id, user_id, day)
);
CREATE INDEX idx_flowers_time ON flowers(created_at);

CREATE TABLE reports (
  id           INTEGER PRIMARY KEY,
  target_type  TEXT NOT NULL CHECK (target_type IN ('note','comment','thread','post','photo','user')),
  target_id    INTEGER NOT NULL,
  reporter_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  handled_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  handled_at   INTEGER,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_reports_status ON reports(status, created_at DESC);

-- ---------- 社交 ----------
CREATE TABLE friends (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, friend_id)
);

CREATE TABLE messages (
  id                INTEGER PRIMARY KEY,
  from_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- NULL 表示系统消息
  to_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,
  read_at           INTEGER,
  sender_deleted    INTEGER NOT NULL DEFAULT 0,
  receiver_deleted  INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_messages_to ON messages(to_id, receiver_deleted, created_at DESC);
CREATE INDEX idx_messages_from ON messages(from_id, sender_deleted, created_at DESC);

CREATE TABLE points_log (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta       INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_points_log_user ON points_log(user_id, created_at DESC);

-- ---------- 购物 ----------
CREATE TABLE products (
  id                  INTEGER PRIMARY KEY,
  category            TEXT NOT NULL DEFAULT '',
  name                TEXT NOT NULL,
  price_cents         INTEGER NOT NULL,
  market_price_cents  INTEGER NOT NULL DEFAULT 0,
  stock               INTEGER NOT NULL DEFAULT 0,
  sales               INTEGER NOT NULL DEFAULT 0,
  image               TEXT NOT NULL DEFAULT '',
  description         TEXT NOT NULL DEFAULT '',
  featured            INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'on' CHECK (status IN ('on','off')),
  sort                INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_products_cat ON products(status, category);

CREATE TABLE orders (
  id            INTEGER PRIMARY KEY,
  order_no      TEXT NOT NULL UNIQUE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id    INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name  TEXT NOT NULL,
  price_cents   INTEGER NOT NULL,
  qty           INTEGER NOT NULL,
  total_cents   INTEGER NOT NULL,
  receiver      TEXT NOT NULL,
  phone         TEXT NOT NULL,
  address       TEXT NOT NULL,
  payment       TEXT NOT NULL CHECK (payment IN ('cod','postal','bank')),
  remark        TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','shipped','done','cancelled')),
  tracking_no   TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_orders_user ON orders(user_id, created_at DESC);
CREATE INDEX idx_orders_status ON orders(status, created_at DESC);

-- ---------- 论坛 ----------
CREATE TABLE forum_categories (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL,
  sort   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE forum_boards (
  id            INTEGER PRIMARY KEY,
  category_id   INTEGER NOT NULL REFERENCES forum_categories(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  sort          INTEGER NOT NULL DEFAULT 0,
  thread_count  INTEGER NOT NULL DEFAULT 0,
  post_count    INTEGER NOT NULL DEFAULT 0,
  last_thread_id INTEGER,
  last_post_at  INTEGER
);

CREATE TABLE forum_threads (
  id                 INTEGER PRIMARY KEY,
  board_id           INTEGER NOT NULL REFERENCES forum_boards(id) ON DELETE CASCADE,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  sticky             INTEGER NOT NULL DEFAULT 0,
  digest             INTEGER NOT NULL DEFAULT 0,
  locked             INTEGER NOT NULL DEFAULT 0,
  is_poll            INTEGER NOT NULL DEFAULT 0,
  hits               INTEGER NOT NULL DEFAULT 0,
  reply_count        INTEGER NOT NULL DEFAULT 0,
  last_post_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  last_post_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status             TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden')),
  created_at         INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_threads_board ON forum_threads(board_id, status, sticky DESC, last_post_at DESC);
CREATE INDEX idx_threads_replies ON forum_threads(status, reply_count DESC);

CREATE TABLE forum_posts (
  id          INTEGER PRIMARY KEY,
  thread_id   INTEGER NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  floor       INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden')),
  edited_at   INTEGER,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_posts_thread ON forum_posts(thread_id, floor);
CREATE INDEX idx_posts_user ON forum_posts(user_id, created_at DESC);

CREATE TABLE poll_options (
  id         INTEGER PRIMARY KEY,
  thread_id  INTEGER NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  votes      INTEGER NOT NULL DEFAULT 0,
  sort       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_poll_options_thread ON poll_options(thread_id, sort);

CREATE TABLE poll_votes (
  thread_id   INTEGER NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_id   INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (thread_id, user_id)
);

-- ---------- 相册 ----------
CREATE TABLE albums (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  cover        TEXT NOT NULL DEFAULT '',
  photo_count  INTEGER NOT NULL DEFAULT 0,
  hits         INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_albums_user ON albums(user_id, updated_at DESC);

CREATE TABLE photos (
  id          INTEGER PRIMARY KEY,
  album_id    INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  upload_id   INTEGER REFERENCES uploads(id) ON DELETE SET NULL,
  path        TEXT NOT NULL,
  size        INTEGER NOT NULL DEFAULT 0,
  caption     TEXT NOT NULL DEFAULT '',
  hits        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_photos_album ON photos(album_id, id);
CREATE INDEX idx_photos_created ON photos(created_at DESC);

-- ---------- 聊天室 ----------
CREATE TABLE chat_rooms (
  id      INTEGER PRIMARY KEY,
  slug    TEXT NOT NULL UNIQUE,
  name    TEXT NOT NULL,
  topic   TEXT NOT NULL DEFAULT '',
  sort    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE chat_messages (
  id          INTEGER PRIMARY KEY,
  room_id     INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username    TEXT NOT NULL DEFAULT '',
  color       TEXT NOT NULL DEFAULT '#000000',
  to_name     TEXT NOT NULL DEFAULT '',
  action      TEXT NOT NULL DEFAULT '',
  content     TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'msg' CHECK (kind IN ('msg','system')),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_chat_room ON chat_messages(room_id, id DESC);

-- ---------- 运营 ----------
CREATE TABLE announcements (
  id          INTEGER PRIMARY KEY,
  content     TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE ads (
  id          INTEGER PRIMARY KEY,
  slot        TEXT NOT NULL CHECK (slot IN ('header','sidebar')),
  title       TEXT NOT NULL,
  subtitle    TEXT NOT NULL DEFAULT '',
  cta         TEXT NOT NULL DEFAULT '',
  link        TEXT NOT NULL DEFAULT '',
  style       TEXT NOT NULL DEFAULT 'rainbow' CHECK (style IN ('rainbow','solid','image')),
  bg          TEXT NOT NULL DEFAULT '#003366',
  image       TEXT NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE links (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL,
  url   TEXT NOT NULL,
  sort  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE pages (
  slug        TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
