# 阿里云部署

## 服务器准备

推荐 Ubuntu LTS、Nginx 和一个无密码登录的专用部署用户。以具备相应权限的账号执行：

```bash
sudo mkdir -p /var/www/neverdown/releases
sudo chown -R DEPLOY_USER:DEPLOY_USER /var/www/neverdown
sudo install -m 755 deploy/neverdown-activate /usr/local/bin/neverdown-activate
sudo cp nginx/neverdown.conf /etc/nginx/sites-available/neverdown
sudo ln -s /etc/nginx/sites-available/neverdown /etc/nginx/sites-enabled/neverdown
sudo nginx -t
sudo systemctl reload nginx
```

先将 `nginx/neverdown.conf` 中的域名替换为正式域名。正式上线时使用 Certbot 申请证书并开启 HTTPS。

## GitHub Secrets

在仓库的 Actions secrets 中配置：

- `ALIYUN_HOST`：服务器 IP 或域名
- `ALIYUN_USER`：部署用户
- `ALIYUN_SSH_PRIVATE_KEY`：部署专用 Ed25519 私钥
- `ALIYUN_SSH_HOST_KEY`：`ssh-keyscan` 得到的完整主机公钥行

不要把私钥或 OAuth Secret 提交到仓库。

## 发布与回滚

推送至 `main` 后，Actions 会先完整构建，再上传新版本。服务器只有在确认新版本包含 `index.html` 后才切换 `current` 软链接，因此构建或上传失败不会破坏当前网站。

需要回滚时，在服务器查看 `/var/www/neverdown/releases`，然后执行：

```bash
sudo -u DEPLOY_USER /usr/local/bin/neverdown-activate RELEASE_NAME
```

系统默认保留最近五个版本。文章原文还会完整保存在 GitHub 历史中。

## 评论和统计

- 评论：在 GitHub 启用 Discussions、安装 Giscus App，然后把生成的仓库 ID 和分类 ID 写入主题配置，并设置 `comments.enable: true`。
- 统计：在阿里云以 Docker 部署 Umami，把地址和网站 ID 写入主题配置。未配置时不会加载任何统计脚本。

