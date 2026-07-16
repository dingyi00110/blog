# 独立账号 CMS（MySQL）部署手册

本方案不要求作者拥有 GitHub 账号。作者通过普通用户名和密码登录，MySQL 保存账号、会话、文章与审计日志；发布时服务自动导出 Hexo Markdown、构建并原子切换线上版本。GitHub 仅作为可选的服务器机器人备份目标。

## 1. 安全边界

当前博客没有域名和 HTTPS，因此 CMS API 只允许 Nginx 本机请求。管理员和作者必须通过 SSH 隧道访问：

```text
开发者电脑 http://localhost:8080/admin/
        ↓ SSH 隧道
阿里云 Nginx 127.0.0.1:80
        ↓
CMS API 127.0.0.1:3001
        ↓
MySQL 127.0.0.1:3306
```

不要让作者直接在公网访问 `http://39.102.210.194/admin/`，否则密码会通过明文 HTTP 传输。正式多人使用前应完成域名备案和 HTTPS。

## 2. MySQL 数据库

如果数据库和专用用户已经创建，只需确认用户拥有目标数据库的建表和读写权限。推荐数据库名和用户：

```sql
CREATE DATABASE neverdown_cms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'neverdown_cms'@'127.0.0.1' IDENTIFIED BY '替换为高强度随机密码';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON neverdown_cms.* TO 'neverdown_cms'@'127.0.0.1';
FLUSH PRIVILEGES;
```

导入表结构：

```bash
cd /usr/local/dlq/blog
mysql -h 127.0.0.1 -u neverdown_cms -p neverdown_cms < cms/schema.sql
```

输入密码后验证：

```bash
mysql -h 127.0.0.1 -u neverdown_cms -p \
  -e 'SHOW TABLES' neverdown_cms
```

应看到：`cms_users`、`cms_sessions`、`cms_posts` 和 `cms_audit_logs`。

## 3. 安装项目依赖

```bash
cd /usr/local/dlq/blog
git -c http.version=HTTP/1.1 pull --ff-only
npm ci
npm run cms:check
npm run build
```

## 4. 创建 CMS 系统用户

```bash
sudo useradd \
  --system \
  --home /nonexistent \
  --shell /usr/sbin/nologin \
  neverdown
```

若提示用户已存在，可以忽略。

准备目录和权限：

```bash
sudo mkdir -p /etc/neverdown /var/www/neverdown/releases
sudo chown -R neverdown:neverdown \
  /usr/local/dlq/blog \
  /var/www/neverdown
sudo install -m 755 deploy/neverdown-activate /usr/local/bin/neverdown-activate
```

## 5. 配置 CMS 环境变量

首次安装：

```bash
sudo install \
  -o root \
  -g neverdown \
  -m 640 \
  cms/cms.env.example \
  /etc/neverdown/cms.env
sudo nano /etc/neverdown/cms.env
```

填写：

```ini
CMS_HOST=127.0.0.1
CMS_PORT=3001
CMS_SITE_ORIGIN=http://localhost:8080
CMS_REPO_DIR=/usr/local/dlq/blog
CMS_RELEASE_ROOT=/var/www/neverdown
CMS_SESSION_HOURS=24
CMS_GIT_PUSH=false
CMS_GIT_REMOTE=origin
CMS_GIT_BRANCH=main

MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=neverdown_cms
MYSQL_USER=neverdown_cms
MYSQL_PASSWORD=数据库用户密码
```

禁止把 `/etc/neverdown/cms.env` 提交到 GitHub。

## 6. 创建第一个管理员

Node.js 22 可以直接读取受保护的环境文件：

```bash
cd /usr/local/dlq/blog
sudo -u neverdown /usr/bin/node \
  --env-file=/etc/neverdown/cms.env \
  cms/create-admin.js
```

脚本会无回显读取至少 12 个字符的初始密码。默认用户名为 `admin`。需要自定义用户名和显示名时：

```bash
sudo -u neverdown env \
  CMS_ADMIN_USERNAME=denkin \
  CMS_ADMIN_DISPLAY_NAME='Denkin' \
  /usr/bin/node \
  --env-file=/etc/neverdown/cms.env \
  cms/create-admin.js
```

重复运行会重置同名管理员的密码。

## 7. 安装 systemd 服务

```bash
sudo install -m 644 \
  systemd/neverdown-cms.service \
  /etc/systemd/system/neverdown-cms.service
sudo systemctl daemon-reload
sudo systemctl enable --now neverdown-cms
sudo systemctl status neverdown-cms --no-pager
```

健康检查：

```bash
curl http://127.0.0.1:3001/health
```

预期：

```json
{"status":"ok"}
```

日志：

```bash
sudo journalctl -u neverdown-cms -n 100 --no-pager
```

旧 OAuth 服务不再需要：

```bash
sudo systemctl disable --now neverdown-oauth
```

确认新 CMS 正常后，可以保留旧文件一段时间再手工清理。

## 8. 更新 Nginx

```bash
cd /usr/local/dlq/blog
sudo cp nginx/neverdown.conf /etc/nginx/sites-available/neverdown
sudo nginx -t
sudo systemctl reload nginx
```

服务器内部测试：

```bash
curl -H 'Host: 39.102.210.194' \
  http://127.0.0.1/cms-api/health
```

预期返回 `{"status":"ok"}`。从公网直接请求 `/cms-api/health` 应返回 403，这是当前无 HTTPS 模式的安全设计。

## 9. 首次发布后台静态文件

```bash
cd /usr/local/dlq/blog
npm run build
RELEASE="independent-cms-$(date +%Y%m%d%H%M%S)"
sudo -u neverdown mkdir -p "/var/www/neverdown/releases/$RELEASE"
sudo -u neverdown cp -a public/. "/var/www/neverdown/releases/$RELEASE/"
sudo -u neverdown /usr/local/bin/neverdown-activate "$RELEASE"
```

## 10. 建立 SSH 隧道并登录

在作者电脑运行：

```bash
ssh \
  -o ExitOnForwardFailure=yes \
  -N \
  -L 8080:127.0.0.1:80 \
  SSH_USER@39.102.210.194
```

保持终端开启，在另一个终端测试：

```bash
curl http://localhost:8080/cms-api/health
curl -I http://localhost:8080/admin/
```

浏览器访问：

```text
http://localhost:8080/admin/
```

使用第 6 步创建的用户名和密码登录。

## 11. 添加作者

管理员登录后进入“作者”，点击“添加作者”，填写：

- 用户名：英文、数字、下划线或短横线
- 显示名称
- 至少 12 个字符的初始密码
- 角色：作者或管理员
- 中英文简介

作者只能查看和修改自己的文章；管理员可以查看全部文章和管理账号。作者首次登录后应通过管理员重置为独立随机密码。当前版本不发送邮件，也没有“忘记密码”邮件流程。

## 12. 写作和发布

后台支持：

- 草稿保存
- Markdown 正文与安全预览
- 中文/英文语言字段
- 中英文翻译关联标识
- 分类和标签
- 图片上传，单张最大 5 MB
- 作者归属
- 直接发布
- 撤回与删除 API
- 审计日志

点击“发布”后依次执行：

1. MySQL 将文章标记为已发布。
2. 导出 `source/_posts/cms-*.md`。
3. 导出 `source/_data/authors.json`。
4. 执行 `npm run build`。
5. 创建新 release 并原子切换 `/var/www/neverdown/current`。
6. 如果启用 `CMS_GIT_PUSH=true`，提交并推送 Markdown 与图片。

发布期间不要关闭页面。构建失败时旧版本仍保持在线。

## 13. GitHub 机器人备份（可选）

默认：

```ini
CMS_GIT_PUSH=false
```

若要启用，给服务器的 `neverdown` 用户配置可写的 GitHub SSH Deploy Key，并确认：

```bash
sudo -u neverdown git -C /usr/local/dlq/blog status
sudo -u neverdown git -C /usr/local/dlq/blog push --dry-run
```

然后设置：

```ini
CMS_GIT_PUSH=true
```

重启：

```bash
sudo systemctl restart neverdown-cms
```

Git 推送失败不会撤回已经成功的站点发布，后台会显示“Git 备份失败”，同时 systemd 日志会记录原因。

## 14. 备份

每日备份 MySQL：

```bash
mysqldump -h 127.0.0.1 -u neverdown_cms -p \
  --single-transaction neverdown_cms \
  > neverdown-cms-$(date +%F).sql
```

还应备份：

- `/etc/neverdown/cms.env`
- `source/images/uploads/`
- `/var/www/neverdown/releases/`
- GitHub 仓库

备份文件应存到另一台机器或阿里云 OSS，不要只保存在同一块服务器磁盘。

## 15. 正式域名上线

域名完成 ICP 备案并启用 HTTPS 后：

1. 将 `CMS_SITE_ORIGIN` 改为正式 HTTPS 地址。
2. 删除 Nginx `/cms-api/` 中仅允许 `127.0.0.1` 的限制，或改为额外的访问控制。
3. 使用 Certbot 配置 HTTPS。
4. 重启 CMS。
5. 作者直接访问 `https://正式域名/admin/`，不再需要 SSH 隧道。

即使启用 HTTPS，也建议为后台增加限速、登录告警和定期密码轮换。

## 16. 日常代码更新

创建 `neverdown` 系统用户并把仓库交给它之后，后续更新也使用该用户，避免 Git 报目录所有权不安全：

```bash
sudo -u neverdown git -C /usr/local/dlq/blog \
  -c http.version=HTTP/1.1 pull --ff-only
sudo -u neverdown npm --prefix /usr/local/dlq/blog ci
sudo -u neverdown npm --prefix /usr/local/dlq/blog run build
sudo systemctl restart neverdown-cms
```

如果更新包含 `cms/schema.sql` 变更，应先阅读迁移说明并备份 MySQL，不要盲目重复执行破坏性数据库修改。本项目当前表结构使用 `CREATE TABLE IF NOT EXISTS`，首次部署可以安全导入。
