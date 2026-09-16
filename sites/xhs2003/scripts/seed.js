// 用法：npm run seed          导入演示数据（数据库已有笔记时跳过）
//       npm run seed -- --force  即使已有数据也追加导入
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { seedDemo } from './seed-data.js';

const { ctx, close } = createApp(loadConfig());
seedDemo(ctx, { onlyIfEmpty: !process.argv.includes('--force') });
close();
