import { loadConfig } from './config.js';
import { createApp } from './app.js';

const config = loadConfig();
const { app, ctx, close } = createApp(config);

if (config.seedDemo) {
  const { seedDemo } = await import('../scripts/seed-data.js');
  seedDemo(ctx, { onlyIfEmpty: true });
}

const server = app.listen(config.port, config.host, () => {
  console.log(`[xhs2003] ${ctx.settings.get('site_name')} 已启动：http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
});

function shutdown(sig) {
  console.log(`[xhs2003] 收到 ${sig}，正在关闭…`);
  server.close(() => { close(); process.exit(0); });
  ctx.chat.close();
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
