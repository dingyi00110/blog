# CMS 与阿里云部署文档

项目最初使用 Sveltia CMS 和 GitHub OAuth，现已迁移到 MySQL 独立账号 CMS。旧 OAuth 网关代码和配置已经移除，作者不再需要 GitHub 账号。

请使用以下文档：

- [独立账号 CMS（MySQL）部署手册](INDEPENDENT_CMS_MYSQL.md)：数据库、账号、CMS 服务、SSH 隧道、发布、备份和正式域名迁移。
- [阿里云静态站点部署](DEPLOYMENT.md)：GitHub Actions、原子发布和回滚基础。

旧服务器上的 OAuth 服务可以停止：

```bash
sudo systemctl disable --now neverdown-oauth
```
