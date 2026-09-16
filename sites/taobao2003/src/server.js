import { loadConfig } from './config.js';
import { createApp } from './app.js';

const config = loadConfig();
const { app, ctx, close } = createApp(config);

if (config.seedDemo) {
  const { seedDemo } = await import('../scripts/seed-data.js');
  if (seedDemo(ctx, { onlyIfEmpty: true })) console.log('[taobao2003] 已导入演示数据');
}

const server = app.listen(config.port, config.host, () => {
  console.log(`[taobao2003] 淘宝网 2003 已启动：http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
});

function shutdown(sig) {
  console.log(`[taobao2003] 收到 ${sig}，正在关闭…`);
  server.close(() => { close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
