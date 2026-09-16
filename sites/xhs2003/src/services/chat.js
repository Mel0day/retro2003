// 聊天室推送中心：每个房间维护 SSE 连接集合，负责广播和在线名单
export function createChatHub(ctx) {
  const rooms = new Map(); // roomId -> Set<client>
  const ping = setInterval(() => {
    for (const set of rooms.values()) for (const c of set) c.res.write(': ping\n\n');
  }, 25_000);
  ping.unref();

  const send = (client, event, data) => {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  function presence(roomId) {
    const set = rooms.get(roomId) || new Set();
    const names = new Map();
    let guests = 0;
    for (const c of set) {
      if (c.user) names.set(c.user.id, { id: c.user.id, name: c.user.username });
      else guests++;
    }
    return { members: [...names.values()], guests };
  }

  function broadcast(roomId, event, data) {
    const set = rooms.get(roomId);
    if (!set) return;
    for (const c of set) send(c, event, data);
  }

  return {
    join(roomId, client) {
      if (!rooms.has(roomId)) rooms.set(roomId, new Set());
      const set = rooms.get(roomId);
      const already = client.user && [...set].some((c) => c.user?.id === client.user.id);
      set.add(client);
      broadcast(roomId, 'presence', presence(roomId));
      return { firstConnection: !already };
    },
    leave(roomId, client) {
      const set = rooms.get(roomId);
      if (!set) return { lastConnection: false };
      set.delete(client);
      const stillThere = client.user && [...set].some((c) => c.user?.id === client.user.id);
      broadcast(roomId, 'presence', presence(roomId));
      return { lastConnection: !!client.user && !stillThere };
    },
    broadcast,
    presence,
    count(roomId) { return rooms.get(roomId)?.size || 0; },
    close() {
      clearInterval(ping);
      for (const set of rooms.values()) for (const c of set) { try { c.res.end(); } catch { /* 忽略 */ } }
      rooms.clear();
    },
  };
}

export const CHAT_COLORS = ['#000000', '#cc0000', '#006600', '#000099', '#993399', '#cc6600', '#008080', '#ff3399'];
export const CHAT_ACTIONS = ['', '微笑着', '大声地', '悄悄地', '哭着', '得意地', '无奈地', '深情地'];

// 发送聊天消息并广播，返回消息对象。content 为纯文本，前端需转义显示。
export function postChatMessage(ctx, { room, user, content, color = '#000000', toName = '', action = '' }) {
  const text = String(content || '').replace(/[\r\n]+/g, ' ').trim();
  if (!text) throw Object.assign(new Error('消息不能为空'), { status: 400 });
  if ([...text].length > 200) throw Object.assign(new Error('一次最多说 200 个字'), { status: 400 });
  const c = CHAT_COLORS.includes(color) ? color : '#000000';
  const a = CHAT_ACTIONS.includes(action) ? action : '';
  const to = String(toName || '').trim().slice(0, 16);
  const info = ctx.db.prepare(`INSERT INTO chat_messages (room_id, user_id, username, color, to_name, action, content, kind)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'msg')`).run(room.id, user.id, user.username, c, to, a, text);
  const msg = ctx.db.prepare('SELECT id, username, user_id, color, to_name, action, content, kind, created_at FROM chat_messages WHERE id = ?').get(info.lastInsertRowid);
  ctx.chat.broadcast(room.id, 'message', msg);
  return msg;
}

export function postSystemChat(ctx, room, text) {
  const info = ctx.db.prepare(`INSERT INTO chat_messages (room_id, username, content, kind) VALUES (?, '系统', ?, 'system')`).run(room.id, text);
  const msg = ctx.db.prepare('SELECT id, username, user_id, color, to_name, action, content, kind, created_at FROM chat_messages WHERE id = ?').get(info.lastInsertRowid);
  ctx.chat.broadcast(room.id, 'message', msg);
  return msg;
}

export function recentChat(ctx, roomId, limit = 50) {
  return ctx.db.prepare(`SELECT id, username, user_id, color, to_name, action, content, kind, created_at
    FROM chat_messages WHERE room_id = ? ORDER BY id DESC LIMIT ?`).all(roomId, limit).reverse();
}
