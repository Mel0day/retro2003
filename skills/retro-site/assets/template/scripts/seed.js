// 手动导入演示数据：npm run seed（加 --force 跳过「只在空库导入」的检查）
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { seedDemo } from './seed-data.js';

const config = loadConfig();
const { ctx, close } = createApp(config);
const done = seedDemo(ctx, { onlyIfEmpty: !process.argv.includes('--force') });
console.log(done ? '演示数据已导入，演示账号密码均为 demo1234。' : '库里已有会员或已导入过，跳过。');
close();
