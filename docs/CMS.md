# 多作者 CMS 配置

后台入口为 `/admin/`，使用 Sveltia CMS。作者不需要使用 Git 命令，但需要拥有 GitHub 账号并被授予仓库写入权限。

当前临时测试地址为 `https://39-102-210-194.sslip.io`，OAuth 回调为 `https://39-102-210-194.sslip.io/oauth/callback`。该 sslip.io 主机名自动解析到阿里云公网 IP，用于满足 CMS 的 HTTPS 要求；正式上线后仍应换成自有域名。

## 1. 创建 GitHub OAuth App

在 GitHub 的 Developer settings 中创建 OAuth App：

- Homepage URL：正式博客地址
- Authorization callback URL：OAuth 网关提供的回调地址

GitHub 不允许把 OAuth Client Secret 放在静态站点中，所以必须部署一个 OAuth 网关。可在阿里云上运行兼容 Decap CMS GitHub backend 的 OAuth 服务，或使用受信任的托管网关。

本项目已经包含一个无需第三方 npm 依赖的 Node.js 网关，代码位于 `oauth/server.js`，systemd 服务模板位于 `systemd/neverdown-oauth.service`。

获得网关地址后，修改 `source/admin/config.yml`：

```yaml
backend:
  name: github
  repo: 组织或用户名/仓库名
  branch: main
  base_url: https://auth.your-domain.com
  auth_endpoint: auth
```

## 2. 添加作者

每增加一位作者，需要完成三处配置：

1. 将其 GitHub 账号添加为仓库协作者。
2. 在 `themes/neverdown/_config.yml` 的 `authors` 中添加作者资料。
3. 在 `source/admin/config.yml` 的作者选项中添加相同 ID。

示例：

```yaml
# theme config
authors:
  alice:
    name: Alice
    bio_zh: 前端开发者
    bio_en: Front-end developer
    avatar: /images/authors/alice.webp

# CMS author field options
- { label: Alice, value: alice }
```

每位作者都可以直接提交到 `main`，因此发布后会立即触发部署。如果以后需要审核，把 `publish_mode` 改为 `editorial_workflow`，并保护 `main` 分支。

## 3. 图片

后台上传的图片默认进入 `source/images/uploads`。初期这样最容易维护；图片数量明显增长后，建议切换到阿里云 OSS 和 CDN。

## 安全建议

- 禁止共享作者账号。
- GitHub 账号开启双因素认证。
- OAuth Client Secret 只放在网关环境变量中。
- 定期检查仓库协作者名单。
- 开启 GitHub 仓库和阿里云服务器的登录告警。
