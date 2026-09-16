// 固定窗口限速，进程内存储。key 通常是「动作:IP」或「动作:用户」。
export function createRateLimiter({ disabled = false } = {}) {
  const hits = new Map();
  const timer = setInterval(() => {
    const t = Date.now();
    for (const [k, v] of hits) if (v.reset < t) hits.delete(k);
  }, 60_000);
  timer.unref();

  return {
    // 返回 true 表示放行
    check(key, limit, windowMs) {
      if (disabled) return true;
      const t = Date.now();
      let e = hits.get(key);
      if (!e || e.reset < t) { e = { count: 0, reset: t + windowMs }; hits.set(key, e); }
      e.count += 1;
      return e.count <= limit;
    },
    reset(key) { hits.delete(key); },
  };
}
