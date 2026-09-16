-- 淘宝网 2003 数据库结构。金额一律以「分」为单位的整数保存。

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 会员：买家和卖家是同一个账号（C2C）。role=admin 为淘宝小二（站长）。
CREATE TABLE users (
  id             INTEGER PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  city           TEXT NOT NULL DEFAULT '',
  shop_intro     TEXT NOT NULL DEFAULT '',
  balance_cents  INTEGER NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  banned         INTEGER NOT NULL DEFAULT 0,
  ban_reason     TEXT NOT NULL DEFAULT '',
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  last_login_at  INTEGER,
  last_ip        TEXT NOT NULL DEFAULT ''
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,            -- sha256(令牌)
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  remember    INTEGER NOT NULL DEFAULT 0,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  ip          TEXT NOT NULL DEFAULT '',
  ua          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- 宝贝。status：onsale 出售中 / warehouse 仓库中 / deleted 已删除（软删除，订单快照仍可查看）
CREATE TABLE items (
  id            INTEGER PRIMARY KEY,
  seller_id     INTEGER NOT NULL REFERENCES users(id),
  cat           TEXT NOT NULL,
  title         TEXT NOT NULL,
  descr         TEXT NOT NULL DEFAULT '',
  tag           TEXT NOT NULL DEFAULT '',
  price_cents   INTEGER NOT NULL CHECK (price_cents > 0),
  orig_cents    INTEGER NOT NULL DEFAULT 0 CHECK (orig_cents >= 0),
  stock         INTEGER NOT NULL CHECK (stock >= 0),
  sold          INTEGER NOT NULL DEFAULT 0 CHECK (sold >= 0),
  city          TEXT NOT NULL DEFAULT '',
  detail        TEXT NOT NULL DEFAULT '',
  images        TEXT NOT NULL DEFAULT '[]',   -- JSON 数组，最多 3 张图片地址
  status        TEXT NOT NULL DEFAULT 'onsale' CHECK (status IN ('onsale', 'warehouse', 'deleted')),
  blocked       INTEGER NOT NULL DEFAULT 0,   -- 淘宝小二强制下架
  block_reason  TEXT NOT NULL DEFAULT '',
  search_text   TEXT NOT NULL DEFAULT '',     -- 归一化后的标题/描述/标签/卖家名，用于搜索
  views         INTEGER NOT NULL DEFAULT 0,
  listed_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_items_list ON items(status, blocked, cat);
CREATE INDEX idx_items_seller ON items(seller_id, status);

-- 购物车：owner_key 为 u:<会员 id> 或 v:<访客 id>
CREATE TABLE carts (
  owner_key   TEXT NOT NULL,
  item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  qty         INTEGER NOT NULL CHECK (qty > 0),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (owner_key, item_id)
);

-- 订单：一个卖家一张。status：paid 买家已付款 / shipped 卖家已发货 / done 交易成功 / closed 交易关闭
CREATE TABLE orders (
  id                 INTEGER PRIMARY KEY,
  no                 TEXT NOT NULL UNIQUE,
  buyer_id           INTEGER NOT NULL REFERENCES users(id),
  seller_id          INTEGER NOT NULL REFERENCES users(id),
  goods_cents        INTEGER NOT NULL CHECK (goods_cents > 0),
  ship               TEXT NOT NULL CHECK (ship IN ('post', 'ems')),
  ship_fee_cents     INTEGER NOT NULL CHECK (ship_fee_cents >= 0),
  total_cents        INTEGER NOT NULL CHECK (total_cents > 0),
  receiver           TEXT NOT NULL,
  address            TEXT NOT NULL,
  tel                TEXT NOT NULL,
  note               TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL CHECK (status IN ('paid', 'shipped', 'done', 'closed')),
  logistics_company  TEXT NOT NULL DEFAULT '',
  logistics_no       TEXT NOT NULL DEFAULT '',
  close_reason       TEXT NOT NULL DEFAULT '',
  closed_by          TEXT NOT NULL DEFAULT '',
  created_at         INTEGER NOT NULL,
  shipped_at         INTEGER,
  auto_confirm_at    INTEGER,
  done_at            INTEGER,
  closed_at          INTEGER
);
CREATE INDEX idx_orders_buyer ON orders(buyer_id, created_at);
CREATE INDEX idx_orders_seller ON orders(seller_id, created_at);
CREATE INDEX idx_orders_status ON orders(status, auto_confirm_at);

-- 交易快照：下单时的宝贝标题、价格、图片
CREATE TABLE order_items (
  id           INTEGER PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id      INTEGER NOT NULL REFERENCES items(id),
  title        TEXT NOT NULL,
  cat          TEXT NOT NULL,
  image        TEXT NOT NULL DEFAULT '',
  price_cents  INTEGER NOT NULL,
  qty          INTEGER NOT NULL CHECK (qty > 0)
);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_item ON order_items(item_id);

CREATE TABLE order_logs (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  actor       TEXT NOT NULL,
  text        TEXT NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_order_logs_order ON order_logs(order_id);

-- 信用评价。role 是被评价的一方在这笔交易里的身份：seller = 买家评卖家，buyer = 卖家评买家。
-- counted：同一评价人对同一会员（同一身份）30 天内只计一次信用分。order_id 为空的是演示用的历史评价。
CREATE TABLE ratings (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER REFERENCES orders(id),
  item_id     INTEGER REFERENCES items(id),
  item_title  TEXT NOT NULL DEFAULT '',
  role        TEXT NOT NULL CHECK (role IN ('seller', 'buyer')),
  from_id     INTEGER NOT NULL REFERENCES users(id),
  to_id       INTEGER NOT NULL REFERENCES users(id),
  grade       INTEGER NOT NULL CHECK (grade IN (1, 0, -1)),
  text        TEXT NOT NULL DEFAULT '',
  reply       TEXT NOT NULL DEFAULT '',
  counted     INTEGER NOT NULL DEFAULT 1,
  hidden      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (order_id, role)
);
CREATE INDEX idx_ratings_to ON ratings(to_id, role, created_at);
CREATE INDEX idx_ratings_pair ON ratings(from_id, to_id, role, created_at);
CREATE INDEX idx_ratings_item ON ratings(item_id);

-- 宝贝留言（公开问答）
CREATE TABLE questions (
  id          INTEGER PRIMARY KEY,
  item_id     INTEGER NOT NULL REFERENCES items(id),
  asker_id    INTEGER NOT NULL REFERENCES users(id),
  seller_id   INTEGER NOT NULL REFERENCES users(id),
  text        TEXT NOT NULL,
  reply       TEXT NOT NULL DEFAULT '',
  hidden      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  replied_at  INTEGER
);
CREATE INDEX idx_questions_item ON questions(item_id, id);
CREATE INDEX idx_questions_seller ON questions(seller_id, replied_at);

CREATE TABLE favorites (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id     INTEGER NOT NULL REFERENCES items(id),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, item_id)
);

CREATE TABLE addresses (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver    TEXT NOT NULL,
  address     TEXT NOT NULL,
  tel         TEXT NOT NULL,
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_addresses_user ON addresses(user_id);

-- 支付宝账户明细（演示用虚拟资金）。amount_cents 正数为收入，负数为支出。
CREATE TABLE alipay_logs (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents   INTEGER NOT NULL,
  balance_cents  INTEGER NOT NULL,
  order_no       TEXT NOT NULL DEFAULT '',
  text           TEXT NOT NULL,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_alipay_logs_user ON alipay_logs(user_id, id);
