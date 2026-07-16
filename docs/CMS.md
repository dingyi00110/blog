# CMS 配置

项目已经从 Sveltia + GitHub OAuth 迁移到 MySQL 独立账号 CMS。作者不需要 GitHub 账号，也不需要学习 Git 或命令行。

请使用 [独立账号 CMS（MySQL）部署手册](INDEPENDENT_CMS_MYSQL.md)。

旧的 `neverdown-oauth` 服务不再使用。确认新 CMS 正常后，可在服务器执行：

```bash
sudo systemctl disable --now neverdown-oauth
```
