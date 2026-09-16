import express from 'express';
import { requireRole } from '../services/auth.js';
import dashboard from './admin/dashboard.js';
import users from './admin/users.js';
import content from './admin/content.js';
import forum from './admin/forum.js';
import shop from './admin/shop.js';
import chat from './admin/chat.js';
import site from './admin/site.js';

// 后台菜单：admin 为 true 的只有站长可见，其余版主也可访问
export const ADMIN_MENU = [
  { group: '常用', items: [
    { key: 'dashboard', url: '/admin', label: '后台首页' },
    { key: 'notes', url: '/admin/notes', label: '笔记管理' },
    { key: 'comments', url: '/admin/comments', label: '留言审核' },
    { key: 'reports', url: '/admin/reports', label: '举报处理' },
  ] },
  { group: '会员与内容', items: [
    { key: 'users', url: '/admin/users', label: '会员管理', admin: true },
    { key: 'channels', url: '/admin/channels', label: '频道管理', admin: true },
    { key: 'forum', url: '/admin/forum', label: '论坛版块', admin: true },
    { key: 'chat', url: '/admin/chat', label: '聊天室', admin: true },
  ] },
  { group: '购物', items: [
    { key: 'products', url: '/admin/products', label: '商品管理', admin: true },
    { key: 'orders', url: '/admin/orders', label: '订单管理', admin: true },
  ] },
  { group: '运营', items: [
    { key: 'announcements', url: '/admin/announcements', label: '公告跑马灯', admin: true },
    { key: 'ads', url: '/admin/ads', label: '广告管理', admin: true },
    { key: 'links', url: '/admin/links', label: '友情链接', admin: true },
    { key: 'pages', url: '/admin/pages', label: '单页管理', admin: true },
    { key: 'settings', url: '/admin/settings', label: '站点设置', admin: true },
  ] },
];

export const requireAdmin = requireRole('admin');

export default function adminRoutes(ctx) {
  const r = express.Router();
  r.use(requireRole('moderator'));
  r.use((req, res, next) => {
    res.locals.adminMenu = ADMIN_MENU;
    // 后台操作完成后重定向并带上 ?msg= 或 ?err= 显示提示
    res.locals.flash = String(req.query.err || req.query.msg || '').slice(0, 200);
    res.locals.flashError = !!req.query.err;
    next();
  });
  r.use(dashboard(ctx));
  r.use(content(ctx));
  r.use(users(ctx));
  r.use(forum(ctx));
  r.use(shop(ctx));
  r.use(chat(ctx));
  r.use(site(ctx));
  return r;
}
