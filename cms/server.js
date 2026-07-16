'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const express = require('express');
const helmet = require('helmet');
const multer = require('multer');
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');
const YAML = require('yaml');
const { createPool, hashPassword, verifyPassword, tokenHash } = require('./lib');

const execFileAsync = promisify(execFile);
const app = express();
const pool = createPool();
const host = process.env.CMS_HOST || '127.0.0.1';
const port = Number(process.env.CMS_PORT || 3001);
const siteOrigin = String(process.env.CMS_SITE_ORIGIN || 'http://localhost:8080').replace(/\/$/, '');
const repoDir = path.resolve(process.env.CMS_REPO_DIR || process.cwd());
const releaseRoot = path.resolve(process.env.CMS_RELEASE_ROOT || '/var/www/neverdown');
const sessionHours = Math.max(1, Number(process.env.CMS_SESSION_HOURS || 24));
const gitPushEnabled = process.env.CMS_GIT_PUSH === 'true';
const gitRemote = process.env.CMS_GIT_REMOTE || 'origin';
const gitBranch = process.env.CMS_GIT_BRANCH || 'main';
const sessionCookie = 'neverdown_session';
const loginAttempts = new Map();
let publishQueue = Promise.resolve();

app.set('trust proxy', 'loopback');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '2mb' }));

function parseCookies(header) {
  return Object.fromEntries(String(header || '').split(';').map(part => {
    const index = part.indexOf('=');
    return index < 0 ? ['', ''] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
}

function cookieOptions(maxAge) {
  const secure = siteOrigin.startsWith('https://') ? '; Secure' : '';
  return `Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=${maxAge}`;
}

function normalizeList(value) {
  const input = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(input.map(item => String(item).trim()).filter(Boolean))].slice(0, 30);
}

function slugify(value) {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 160);
}

function postPayload(body) {
  const title = String(body.title || '').trim().slice(0, 250);
  const slug = slugify(body.slug || title);
  const lang = body.lang === 'en' ? 'en' : 'zh';
  if (!title) throw Object.assign(new Error('标题不能为空'), { status: 400 });
  if (!slug) throw Object.assign(new Error('请填写英文或数字文章别名'), { status: 400 });
  return {
    title,
    slug,
    description: String(body.description || '').trim().slice(0, 5000),
    body: String(body.body || '').slice(0, 1000000),
    lang,
    translationKey: String(body.translation_key || '').trim().slice(0, 180) || null,
    categories: normalizeList(body.categories),
    tags: normalizeList(body.tags),
    cover: String(body.cover || '').trim().slice(0, 500) || null,
    comments: body.comments !== false
  };
}

function jsonColumn(value) {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || '[]'); } catch (_) { return []; }
}

function publicUser(row) {
  return { id: row.id, username: row.username, display_name: row.display_name, role: row.role, bio_zh: row.bio_zh, bio_en: row.bio_en, avatar: row.avatar, active: Boolean(row.active) };
}

async function audit(user, req, action, entityType, entityId = null, details = null) {
  await pool.execute(
    'INSERT INTO cms_audit_logs (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
    [user?.id || null, action, entityType, entityId, details ? JSON.stringify(details) : null, req.ip || '']
  );
}

app.use((req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.get('origin');
    if (origin && origin !== siteOrigin) return res.status(403).json({ error: 'Origin not allowed' });
  }
  next();
});

async function authenticate(req, res, next) {
  try {
    const token = parseCookies(req.headers.cookie)[sessionCookie];
    if (!token) return res.status(401).json({ error: '请先登录' });
    const [rows] = await pool.execute(
      `SELECT u.*, s.token_hash FROM cms_sessions s
       JOIN cms_users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP() AND u.active = TRUE`,
      [tokenHash(token)]
    );
    if (!rows.length) return res.status(401).json({ error: '登录已过期' });
    req.user = publicUser(rows[0]);
    pool.execute('UPDATE cms_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token_hash = ?', [rows[0].token_hash]).catch(() => {});
    next();
  } catch (error) { next(error); }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
  next();
}

app.get('/health', async (_req, res, next) => {
  try { await pool.query('SELECT 1'); res.json({ status: 'ok' }); } catch (error) { next(error); }
});

app.post('/auth/login', async (req, res, next) => {
  try {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const attempts = (loginAttempts.get(key) || []).filter(time => now - time < 15 * 60 * 1000);
    if (attempts.length >= 5) return res.status(429).json({ error: '登录尝试过多，请 15 分钟后再试' });
    const username = String(req.body.username || '').trim();
    const [rows] = await pool.execute('SELECT * FROM cms_users WHERE username = ? AND active = TRUE LIMIT 1', [username]);
    const valid = rows.length && await verifyPassword(String(req.body.password || ''), rows[0].password_hash);
    if (!valid) {
      attempts.push(now); loginAttempts.set(key, attempts);
      await audit(null, req, 'login_failed', 'session', null, { username });
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    loginAttempts.delete(key);
    const token = crypto.randomBytes(32).toString('base64url');
    await pool.execute(
      `INSERT INTO cms_sessions (token_hash, user_id, expires_at, ip_address, user_agent)
       VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? HOUR), ?, ?)`,
      [tokenHash(token), rows[0].id, sessionHours, req.ip || '', String(req.get('user-agent') || '').slice(0, 500)]
    );
    res.setHeader('Set-Cookie', `${sessionCookie}=${encodeURIComponent(token)}; ${cookieOptions(sessionHours * 3600)}`);
    await audit(publicUser(rows[0]), req, 'login', 'session');
    res.json({ user: publicUser(rows[0]) });
  } catch (error) { next(error); }
});

app.post('/auth/logout', authenticate, async (req, res, next) => {
  try {
    const token = parseCookies(req.headers.cookie)[sessionCookie];
    await pool.execute('DELETE FROM cms_sessions WHERE token_hash = ?', [tokenHash(token)]);
    res.setHeader('Set-Cookie', `${sessionCookie}=; ${cookieOptions(0)}`);
    await audit(req.user, req, 'logout', 'session');
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.get('/auth/me', authenticate, (req, res) => res.json({ user: req.user }));

app.get('/users', authenticate, async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT id, username, display_name, role, bio_zh, bio_en, avatar, active FROM cms_users ORDER BY display_name');
    res.json({ users: rows.map(publicUser) });
  } catch (error) { next(error); }
});

app.post('/users', authenticate, adminOnly, async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim();
    const displayName = String(req.body.display_name || '').trim().slice(0, 100);
    if (!/^[a-z0-9_-]{3,64}$/i.test(username) || !displayName) return res.status(400).json({ error: '用户名或显示名称格式不正确' });
    const passwordHash = await hashPassword(String(req.body.password || ''));
    const [result] = await pool.execute(
      `INSERT INTO cms_users (username, display_name, password_hash, role, bio_zh, bio_en, avatar)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [username, displayName, passwordHash, req.body.role === 'admin' ? 'admin' : 'author', String(req.body.bio_zh || '').slice(0, 500), String(req.body.bio_en || '').slice(0, 500), String(req.body.avatar || '/images/avatar-default.svg').slice(0, 500)]
    );
    await audit(req.user, req, 'create', 'user', String(result.insertId), { username });
    res.status(201).json({ id: result.insertId });
  } catch (error) { next(error); }
});

app.patch('/users/:id', authenticate, adminOnly, async (req, res, next) => {
  try {
    const fields = [];
    const values = [];
    for (const [key, value, max] of [['display_name', req.body.display_name, 100], ['bio_zh', req.body.bio_zh, 500], ['bio_en', req.body.bio_en, 500], ['avatar', req.body.avatar, 500]]) {
      if (value !== undefined) { fields.push(`${key} = ?`); values.push(String(value).slice(0, max)); }
    }
    if (req.body.role !== undefined) { fields.push('role = ?'); values.push(req.body.role === 'admin' ? 'admin' : 'author'); }
    if (req.body.active !== undefined) { fields.push('active = ?'); values.push(Boolean(req.body.active)); }
    if (req.body.password) { fields.push('password_hash = ?'); values.push(await hashPassword(String(req.body.password))); }
    if (!fields.length) return res.status(400).json({ error: '没有可更新字段' });
    values.push(req.params.id);
    await pool.execute(`UPDATE cms_users SET ${fields.join(', ')} WHERE id = ?`, values);
    await audit(req.user, req, 'update', 'user', req.params.id);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.get('/posts', authenticate, async (req, res, next) => {
  try {
    const admin = req.user.role === 'admin';
    const [rows] = await pool.execute(
      `SELECT p.id, p.slug, p.title, p.description, p.lang, p.status, p.published_at, p.updated_at,
              u.id author_id, u.display_name author_name
       FROM cms_posts p JOIN cms_users u ON u.id = p.author_id
       ${admin ? '' : 'WHERE p.author_id = ?'} ORDER BY p.updated_at DESC`,
      admin ? [] : [req.user.id]
    );
    res.json({ posts: rows });
  } catch (error) { next(error); }
});

app.get('/posts/:id', authenticate, async (req, res, next) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM cms_posts WHERE id = ? LIMIT 1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: '文章不存在' });
    if (req.user.role !== 'admin' && Number(rows[0].author_id) !== Number(req.user.id)) return res.status(403).json({ error: '无权访问此文章' });
    rows[0].categories = jsonColumn(rows[0].categories);
    rows[0].tags = jsonColumn(rows[0].tags);
    rows[0].comments = Boolean(rows[0].comments);
    res.json({ post: rows[0] });
  } catch (error) { next(error); }
});

app.post('/posts', authenticate, async (req, res, next) => {
  try {
    const data = postPayload(req.body);
    const id = crypto.randomUUID();
    const authorId = req.user.role === 'admin' && req.body.author_id ? Number(req.body.author_id) : req.user.id;
    await pool.execute(
      `INSERT INTO cms_posts (id, slug, title, description, body, author_id, lang, translation_key, categories, tags, cover, comments)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.slug, data.title, data.description, data.body, authorId, data.lang, data.translationKey, JSON.stringify(data.categories), JSON.stringify(data.tags), data.cover, data.comments]
    );
    await audit(req.user, req, 'create', 'post', id);
    res.status(201).json({ id });
  } catch (error) { next(error); }
});

app.put('/posts/:id', authenticate, async (req, res, next) => {
  try {
    const [rows] = await pool.execute('SELECT author_id FROM cms_posts WHERE id = ? LIMIT 1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: '文章不存在' });
    if (req.user.role !== 'admin' && Number(rows[0].author_id) !== Number(req.user.id)) return res.status(403).json({ error: '无权修改此文章' });
    const data = postPayload(req.body);
    const authorId = req.user.role === 'admin' && req.body.author_id ? Number(req.body.author_id) : rows[0].author_id;
    await pool.execute(
      `UPDATE cms_posts SET slug=?, title=?, description=?, body=?, author_id=?, lang=?, translation_key=?, categories=?, tags=?, cover=?, comments=? WHERE id=?`,
      [data.slug, data.title, data.description, data.body, authorId, data.lang, data.translationKey, JSON.stringify(data.categories), JSON.stringify(data.tags), data.cover, data.comments, req.params.id]
    );
    await audit(req.user, req, 'update', 'post', req.params.id);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.delete('/posts/:id', authenticate, async (req, res, next) => {
  try {
    const [rows] = await pool.execute('SELECT author_id, status FROM cms_posts WHERE id = ? LIMIT 1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: '文章不存在' });
    if (req.user.role !== 'admin' && Number(rows[0].author_id) !== Number(req.user.id)) return res.status(403).json({ error: '无权删除此文章' });
    await pool.execute('DELETE FROM cms_posts WHERE id = ?', [req.params.id]);
    await audit(req.user, req, 'delete', 'post', req.params.id);
    if (rows[0].status === 'published') queuePublish().catch(console.error);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.post('/posts/:id/publish', authenticate, async (req, res, next) => {
  try {
    const [rows] = await pool.execute('SELECT author_id FROM cms_posts WHERE id = ? LIMIT 1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: '文章不存在' });
    if (req.user.role !== 'admin' && Number(rows[0].author_id) !== Number(req.user.id)) return res.status(403).json({ error: '无权发布此文章' });
    await pool.execute(`UPDATE cms_posts SET status='published', published_at=COALESCE(published_at, UTC_TIMESTAMP()) WHERE id=?`, [req.params.id]);
    await audit(req.user, req, 'publish', 'post', req.params.id);
    const result = await queuePublish();
    res.json({ ok: true, release: result.release, git: result.git });
  } catch (error) { next(error); }
});

app.post('/posts/:id/unpublish', authenticate, async (req, res, next) => {
  try {
    const [rows] = await pool.execute('SELECT author_id FROM cms_posts WHERE id = ? LIMIT 1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: '文章不存在' });
    if (req.user.role !== 'admin' && Number(rows[0].author_id) !== Number(req.user.id)) return res.status(403).json({ error: '无权撤回此文章' });
    await pool.execute(`UPDATE cms_posts SET status='draft' WHERE id=?`, [req.params.id]);
    await audit(req.user, req, 'unpublish', 'post', req.params.id);
    const result = await queuePublish();
    res.json({ ok: true, release: result.release, git: result.git });
  } catch (error) { next(error); }
});

app.post('/preview', authenticate, (req, res) => {
  const source = String(req.body.markdown || '').slice(0, 1000000);
  const rendered = marked.parse(source, { gfm: true, breaks: false });
  const html = sanitizeHtml(rendered, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'figure', 'figcaption']),
    allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, img: ['src', 'alt', 'title', 'loading'] },
    allowedSchemes: ['http', 'https', 'mailto']
  });
  res.json({ html });
});

const uploadDir = path.join(repoDir, 'source/images/uploads');
const imageExtensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, uploadDir),
    filename: (_req, file, callback) => callback(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${imageExtensions[file.mimetype] || ''}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => callback(null, Boolean(imageExtensions[file.mimetype]))
});

app.post('/uploads', authenticate, (req, res, next) => {
  fs.mkdir(uploadDir, { recursive: true }).then(() => upload.single('file')(req, res, error => {
    if (error) return next(error);
    if (!req.file) return res.status(400).json({ error: '请选择 JPG、PNG、WebP 或 GIF 图片' });
    audit(req.user, req, 'upload', 'file', req.file.filename).catch(console.error);
    res.status(201).json({ url: `/images/uploads/${req.file.filename}` });
  })).catch(next);
});

async function exportPosts() {
  const [rows] = await pool.query(
    `SELECT p.*, u.username author_username FROM cms_posts p
     JOIN cms_users u ON u.id = p.author_id WHERE p.status = 'published' ORDER BY p.published_at`
  );
  const postsDir = path.join(repoDir, 'source/_posts');
  const dataDir = path.join(repoDir, 'source/_data');
  await fs.mkdir(postsDir, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });
  const [users] = await pool.query('SELECT username, display_name, bio_zh, bio_en, avatar FROM cms_users WHERE active = TRUE ORDER BY display_name');
  const authors = Object.fromEntries(users.map(user => [user.username, {
    name: user.display_name,
    bio_zh: user.bio_zh,
    bio_en: user.bio_en,
    avatar: user.avatar
  }]));
  await fs.writeFile(path.join(dataDir, 'authors.json'), `${JSON.stringify(authors, null, 2)}\n`, { encoding: 'utf8', mode: 0o640 });
  const existing = await fs.readdir(postsDir);
  await Promise.all(existing.filter(name => name.startsWith('cms-') && name.endsWith('.md')).map(name => fs.unlink(path.join(postsDir, name))));
  for (const row of rows) {
    const frontmatter = {
      title: row.title,
      date: new Date(row.published_at).toISOString(),
      updated: new Date(row.updated_at).toISOString(),
      author: row.author_username,
      lang: row.lang,
      translation_key: row.translation_key || undefined,
      categories: jsonColumn(row.categories),
      tags: jsonColumn(row.tags),
      description: row.description,
      cover: row.cover || undefined,
      comments: Boolean(row.comments)
    };
    const content = `---\n${YAML.stringify(frontmatter)}---\n\n${row.body.trim()}\n`;
    await fs.writeFile(path.join(postsDir, `cms-${row.id}.md`), content, { encoding: 'utf8', mode: 0o640 });
  }
}

async function run(command, args, options = {}) {
  return execFileAsync(command, args, { cwd: repoDir, maxBuffer: 10 * 1024 * 1024, ...options });
}

async function publishSite() {
  await exportPosts();
  await run('npm', ['run', 'build']);
  const release = `cms-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
  const target = path.join(releaseRoot, 'releases', release);
  await fs.mkdir(target, { recursive: true });
  await run('cp', ['-a', `${path.join(repoDir, 'public')}/.`, target], { cwd: '/' });
  await execFileAsync('/usr/local/bin/neverdown-activate', [release], { cwd: '/' });
  let git = 'disabled';
  if (gitPushEnabled) {
    try {
      await run('git', ['add', 'source/_posts', 'source/_data/authors.json', 'source/images/uploads']);
      try { await run('git', ['commit', '-m', `content(cms): publish ${release}`]); } catch (error) {
        if (!String(error.stdout || '').includes('nothing to commit')) throw error;
      }
      await run('git', ['-c', 'http.version=HTTP/1.1', 'push', gitRemote, `HEAD:${gitBranch}`]);
      git = 'pushed';
    } catch (error) {
      console.error('Git backup failed:', error.stderr || error.message);
      git = 'failed';
    }
  }
  return { release, git };
}

function queuePublish() {
  const task = publishQueue.then(publishSite, publishSite);
  publishQueue = task.catch(() => {});
  return task;
}

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: '用户名或文章别名已经存在' });
  if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: '图片不能超过 5 MB' });
  res.status(error.status || 500).json({ error: error.status ? error.message : '服务器内部错误' });
});

async function start() {
  await pool.query('SELECT 1');
  await pool.execute('DELETE FROM cms_sessions WHERE expires_at <= UTC_TIMESTAMP()');
  app.listen(port, host, () => console.log(`NeverDown CMS API listening on http://${host}:${port}`));
}

start().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
