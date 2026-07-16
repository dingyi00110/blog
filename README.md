# 永不宕机 / NeverDown

一个基于 Hexo 的极简双语、多作者博客。独立账号 CMS 使用 MySQL 保存账号与内容，发布时生成 Markdown 并原子化部署到阿里云服务器。

## 本地开发

要求 Node.js 20 或更高版本。

```bash
npm install
npm run dev
```

访问 `http://localhost:4000`。生产构建使用：

```bash
npm run build
```

## 内容约定

文章位于 `source/_posts`。关键字段：

- `author`：作者 ID，必须存在于 `themes/neverdown/_config.yml`。
- `lang`：`zh` 或 `en`。
- `translation_key`：对应中英文文章使用相同标识。
- `comments`：是否显示评论区。

## 上线清单

1. 修改 `_config.yml` 中的正式 `url`。
2. 修改 `themes/neverdown/_config.yml` 的仓库、作者、Giscus 和 Umami 配置。
3. 修改 `source/admin/config.yml` 的仓库、域名及 OAuth 网关。
4. 按 [独立账号 CMS（MySQL）部署手册](docs/INDEPENDENT_CMS_MYSQL.md)启用十位作者的网页登录。
5. 按 [部署说明](docs/DEPLOYMENT.md)配置阿里云及 GitHub Secrets。
6. 域名备案完成后配置 DNS，并使用 Certbot 开启 HTTPS。

完整的当前环境部署与排障流程见 [CMS 与阿里云部署操作手册](docs/CMS_ALIYUN_RUNBOOK.md)。

无域名公网后台的证书配置见 [公网 IP HTTPS 与 CMS 开放](docs/IP_HTTPS.md)。

## 当前能力

- 响应式开发者风格主题
- 深色、浅色、跟随系统
- 中文和英文文章及互译链接
- 多作者页面和文章署名
- MySQL 独立账号 Markdown CMS
- 本地全文搜索、RSS、Sitemap
- Giscus 评论预留
- Umami 自托管统计预留
- GitHub Actions 原子化部署与版本回滚基础
