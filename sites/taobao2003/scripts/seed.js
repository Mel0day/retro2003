// 手动导入演示数据：npm run seed（只在库里还没有会员时导入；加 --force 跳过检查，只建议在全新库上用）
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { seedDemo } from './seed-data.js';

const config = loadConfig();
const { ctx, close } = createApp(config);
const done = seedDemo(ctx, { onlyIfEmpty: !process.argv.includes('--force') });
console.log(done ? '演示数据已导入。演示账号密码均为 demo1234。' : '数据库里已有会员或已经导入过，跳过。');
close();
