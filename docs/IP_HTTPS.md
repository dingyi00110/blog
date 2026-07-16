# 公网 IP HTTPS 与 CMS 开放

本方案使用 Let’s Encrypt 的短期 IP 地址证书，让作者无需域名、GitHub 或 SSH 隧道，直接访问：

```text
https://39.102.210.194/admin/
```

Let’s Encrypt 的 IP 地址证书自 2026 年起正式开放，证书有效期约 6 天。必须使用 Certbot 5.4 或更高版本，并确保自动续期每天运行。

## 1. 开放 443

在阿里云安全组允许 TCP 443，来源 `0.0.0.0/0`。

## 2. 安装新版 Certbot

Ubuntu 22.04 APT 中的 Certbot 通常过旧。使用 Snap 安装最新版：

```bash
sudo snap install core
sudo snap refresh core
sudo snap install --classic certbot
/snap/bin/certbot --version
```

版本必须不低于 5.4。

## 3. 准备 HTTP-01 Webroot

先使用项目中的 HTTP 配置：

```bash
cd /usr/local/dlq/blog
sudo mkdir -p /var/www/letsencrypt/.well-known/acme-challenge
sudo cp nginx/neverdown.conf /etc/nginx/sites-available/neverdown
sudo nginx -t
sudo systemctl reload nginx
```

测试验证路径：

```bash
echo ip-certificate-test | sudo tee \
  /var/www/letsencrypt/.well-known/acme-challenge/test
curl http://39.102.210.194/.well-known/acme-challenge/test
```

必须返回 `ip-certificate-test`。

## 4. 申请证书

先申请非可信测试证书：

```bash
sudo /snap/bin/certbot certonly \
  --staging \
  --preferred-profile shortlived \
  --webroot \
  --webroot-path /var/www/letsencrypt \
  --cert-name 39.102.210.194-staging \
  --ip-address 39.102.210.194
```

测试成功后申请正式证书：

```bash
sudo /snap/bin/certbot certonly \
  --preferred-profile shortlived \
  --webroot \
  --webroot-path /var/www/letsencrypt \
  --cert-name 39.102.210.194 \
  --ip-address 39.102.210.194
```

证书路径：

```text
/etc/letsencrypt/live/39.102.210.194/fullchain.pem
/etc/letsencrypt/live/39.102.210.194/privkey.pem
```

## 5. 启用 HTTPS

```bash
sudo cp nginx/neverdown-https.conf /etc/nginx/sites-available/neverdown
sudo nginx -t
sudo systemctl reload nginx
```

HTTPS 配置会公开 CMS API，同时对登录和普通 API 分别限速，并添加必要的安全响应头。

## 6. 更新 CMS Origin

编辑 `/etc/neverdown/cms.env`：

```ini
CMS_SITE_ORIGIN=https://39.102.210.194
```

重启：

```bash
sudo systemctl restart neverdown-cms
sudo systemctl status neverdown-cms --no-pager
```

登录 Cookie 会自动增加 `Secure`，写请求只接受正确的 HTTPS Origin。

## 7. 重新构建和发布

```bash
cd /usr/local/dlq/blog
sudo -u neverdown env HOME=/var/lib/neverdown npm run build
RELEASE="ip-https-$(date +%Y%m%d%H%M%S)"
sudo -u neverdown mkdir -p "/var/www/neverdown/releases/$RELEASE"
sudo -u neverdown cp -a public/. "/var/www/neverdown/releases/$RELEASE/"
sudo -u neverdown /usr/local/bin/neverdown-activate "$RELEASE"
```

## 8. 自动续期

```bash
sudo install -m 755 \
  deploy/certbot-reload-nginx \
  /etc/letsencrypt/renewal-hooks/deploy/neverdown-reload-nginx

systemctl list-timers | grep certbot

sudo /snap/bin/certbot renew \
  --cert-name 39.102.210.194 \
  --dry-run
```

IP 证书只有约 6 天有效期，必须确认自动续期正常，建议增加到期监控。

## 9. 验证

```bash
curl -I https://39.102.210.194/
curl https://39.102.210.194/cms-api/health
```

作者最终访问：

```text
https://39.102.210.194/admin/
```
