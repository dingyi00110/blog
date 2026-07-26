# AGENTS.md

本文档供在本仓库中工作的 AI Agent 和开发者使用。修改代码前应先阅读本文，并以实际代码与配置为最终依据。

## 维护者偏好

- 维护者叫 Denkin。
- Denkin 喜欢新技术，希望方案现代、简洁、可维护。
- Denkin 比较懒：优先提供可以直接执行的命令、自动化流程和低维护成本的实现，避免不必要的手工步骤。
- 沟通和项目文档默认使用中文；代码标识符、命令和已有英文界面文案保持项目原有风格。

## 项目概览

本项目名为“永不宕机 / NeverDown”，是一个基于 Hexo 7 的极简双语、多作者技术与生活博客，同时自带独立账号 CMS。

- 网站生成器：Hexo 7.3，Node.js 20 及以上版本。
- 主题：仓库内自研主题 `themes/neverdown`，使用 EJS、原生 CSS 和原生 JavaScript。
- 内容：中文和英文文章，支持翻译配对、多作者、分类、标签、RSS、Sitemap 和本地全文搜索。
- CMS：Express 5 + MySQL，账号、会话、草稿、文章和审计日志存储在 MySQL。
- 发布：CMS 可导出 Markdown、构建静态站并原子切换版本；推送 `main` 也会触发 GitHub Actions 部署到阿里云。
- 生产服务：Nginx 提供静态站和 `/cms-api/` 反向代理，systemd 托管 CMS API。

## 常用命令

```bash
npm install          # 本地安装依赖；CI 和服务器部署优先使用 npm ci
npm run dev          # 启动 Hexo 开发服务器，默认访问 http://localhost:4000
npm run build        # 清理并生成 public/ 静态站
npm run check        # 当前等同于完整 Hexo 清理与构建
npm run cms:check    # 检查 CMS 服务、管理员脚本和后台前端 JS 语法
```

提交改动前至少运行与改动范围对应的检查：博客、主题、模板或文章改动运行 `npm run build`；CMS 或后台 JS 改动同时运行 `npm run cms:check`。项目目前没有单元测试套件。

## 目录结构

```text
_config.yml                    Hexo 站点配置、URL、路由和生成器配置
themes/neverdown/              自研主题
  _config.yml                  菜单、作者、评论、统计和主题资源配置
  layout/                      EJS 页面和局部模板
  languages/                   zh-CN / en 界面翻译
  source/css/style.css         网站全部主题样式
  source/js/main.js            主题切换、移动导航、代码复制和搜索
scripts/                       自动加载的 Hexo helper、generator 和内容净化器
source/_posts/                 手写文章及 CMS 导出的 cms-*.md
source/_data/authors.json      CMS 发布时生成的作者资料（首次发布前可能不存在）
source/admin/                  无框架 CMS 后台静态前端；Hexo 配置为跳过渲染
source/images/uploads/         CMS 上传图片目录（按需创建）
cms/                           Express API、MySQL 表结构、管理员创建脚本和环境示例
docs/                          CMS、阿里云、HTTPS 和部署操作手册
nginx/                         HTTP/HTTPS Nginx 配置
systemd/                       CMS systemd 服务定义
deploy/neverdown-activate      原子切换版本并保留最近五个 release
.github/workflows/deploy.yml   main 分支静态站构建和部署工作流
public/                        Hexo 构建产物，已忽略，禁止手工编辑或提交
```

## 内容与双语约定

手写文章放在 `source/_posts/`。文章 front matter 的重要字段如下：

- `title`：文章标题。
- `date` / `updated`：发布时间与更新时间。
- `author`：作者 ID；必须能在主题配置 `authors` 或 CMS 生成的 `source/_data/authors.json` 中找到。
- `lang`：只能使用 `zh` 或 `en`；缺失或其他值会按中文处理。
- `translation_key`：中英文对应文章使用完全相同的非空标识，语言切换才会跳到配对文章。
- `categories` / `tags`：YAML 列表。
- `description`：文章摘要，也用于卡片和 SEO 描述。
- `cover`：可选封面地址。
- `comments`：是否允许评论；还需主题全局评论配置启用且 Giscus ID 完整。

永久链接格式为 `:lang/posts/:title/`。CMS 的 slug 只允许小写英文字母、数字和连字符，且数据库中 `(slug, lang)` 唯一。新增双语内容时应同时检查 `/zh/`、`/en/` 语言首页以及互译链接。

CMS 发布会删除并重新生成所有 `source/_posts/cms-*.md`，因此不要手工编辑或创建以 `cms-` 开头的文章文件；源内容应在 CMS/MySQL 中修改。普通手写 Markdown 不受该清理过程影响。

## Hexo 与主题实现

- `scripts/helpers.js` 提供语言判断、作者资料、阅读时间、翻译配对和语言 URL 等 helper。
- `scripts/language-index-generator.js` 生成 `/zh/` 与 `/en/` 首页；根首页仍由 Hexo 默认索引生成器负责。
- `scripts/authors-generator.js` 生成 `/authors/`，并合并主题静态作者与 CMS 作者数据。
- `scripts/sanitize-content.js` 在文章渲染后使用 `sanitize-html` 清理 HTML。新增嵌入标签或属性时，必须同步评估并更新白名单，不能绕过净化。
- 页面骨架在 `themes/neverdown/layout/layout.ejs`，公共区块在 `layout/_partial/`。
- UI 文案优先通过 `themes/neverdown/languages/zh-CN.yml` 和 `en.yml` 的 Hexo i18n 键维护；新增键时两个语言文件要同步。
- 前端不使用打包器或框架。保持原生 JS、渐进增强、响应式布局、键盘可操作性以及深色/浅色/跟随系统三态主题。
- 全文搜索由 `hexo-generator-searchdb` 生成 `/search.xml`，浏览器端最多展示 12 条匹配结果。

## CMS 架构与权限

CMS API 入口为 `cms/server.js`，后台前端统一请求 `/cms-api`。数据库包含：

- `cms_users`：管理员与作者账号。
- `cms_sessions`：只保存 SHA-256 后的会话令牌。
- `cms_posts`：草稿与已发布文章。
- `cms_audit_logs`：登录、编辑、发布、上传等操作记录。

权限规则：管理员能管理账号、查看全部文章并指定作者；普通作者只能查看、修改、发布和删除自己的文章。所有写接口均检查请求 Origin，会话 Cookie 使用 `HttpOnly`、`SameSite=Strict`，HTTPS 时附带 `Secure`。密码使用 Node.js `scrypt`，最少 12 个字符；登录按 IP 限制为 15 分钟内最多 5 次失败。

图片上传支持 JPG、PNG、WebP、GIF，单张上限 5 MB，保存到 `source/images/uploads/`。Markdown 预览和 Hexo 最终文章均经过 HTML 净化。修改认证、权限、上传、HTML 白名单或发布命令属于高风险改动，需要特别检查越权、路径穿越、XSS、CSRF、命令注入和敏感信息泄露。

CMS 依赖以下环境变量，示例见 `cms/cms.env.example`：`CMS_HOST`、`CMS_PORT`、`CMS_SITE_ORIGIN`、`CMS_REPO_DIR`、`CMS_RELEASE_ROOT`、`CMS_SESSION_HOURS`、Git 备份配置以及 `MYSQL_*`。真实密码、私钥、Cookie、证书和生产 `.env` 绝不能写入仓库或日志。

## 发布流程

CMS 发布/撤回流程是串行队列：

1. 从 MySQL 导出所有已发布文章为 `source/_posts/cms-*.md`。
2. 导出启用作者为 `source/_data/authors.json`。
3. 执行 `npm run build`。
4. 将 `public/` 复制到 `/var/www/neverdown/releases/<release>`。
5. 调用 `/usr/local/bin/neverdown-activate` 原子切换 `current` 软链接。
6. 可选提交并推送导出内容作为 Git 备份；Git 备份失败不会回滚已完成的网站发布。

`deploy/neverdown-activate` 会先确认 release 含 `index.html`，再原子切换，并只保留最近五个版本。不要把这一安全检查改成先删除当前版本或直接覆盖线上目录。

另一条发布路径是推送 `main`：GitHub Actions 使用 Node.js 22 执行 `npm ci` 和 `npm run build`，上传构建产物后通过 SSH/rsync 部署并调用同一激活脚本。所需 Secrets 名称记录在 `docs/DEPLOYMENT.md`。

## 生产环境注意事项

- 当前站点 URL 和示例生产入口为 `https://39.102.210.194`，正式域名变化时需同步检查 `_config.yml`、CMS Origin、Nginx 和证书文档。
- CMS 默认监听 `127.0.0.1:3001`，由 Nginx 将 `/cms-api/` 转发到 API 根路径。
- HTTP 配置目前只允许本机访问 `/cms-api/`；HTTPS 开放方式及公网 IP 短期证书流程见 `docs/IP_HTTPS.md`。
- systemd 服务以 `neverdown` 用户运行，文件权限掩码为 `0027`，仅对仓库、release、状态和缓存目录开放写权限。
- 部署、证书或服务器操作前优先阅读 `docs/CMS_ALIYUN_RUNBOOK.md`、`docs/INDEPENDENT_CMS_MYSQL.md` 和 `docs/DEPLOYMENT.md`，不要凭猜测执行生产命令。

## 修改原则与交付检查

- 不要编辑 `node_modules/`、`public/`、`.deploy_git/`、`db.json` 等生成物。
- 不要无意覆盖工作区中已有的未提交改动；修改前后检查 `git status` 和相关 diff。
- 依赖版本应通过 `package.json` 与 `package-lock.json` 一起维护。
- 数据库结构修改必须更新 `cms/schema.sql`，并为已部署数据库提供明确、可重复执行的迁移步骤；不能假设重新建库。
- API 字段变化要同时更新 `cms/server.js`、`source/admin/app.js`、后台 HTML 表单以及相关文档。
- 主题配置键、作者字段或语言行为变化时，要检查 helper、generator、EJS 模板和中英文文案是否同步。
- 完成后说明改了什么、运行了哪些检查、是否存在未验证的生产依赖。不要为了让检查通过而隐藏错误或提交敏感配置。
