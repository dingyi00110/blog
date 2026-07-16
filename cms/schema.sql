CREATE TABLE IF NOT EXISTS cms_users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'author') NOT NULL DEFAULT 'author',
  bio_zh VARCHAR(500) NOT NULL DEFAULT '',
  bio_en VARCHAR(500) NOT NULL DEFAULT '',
  avatar VARCHAR(500) NOT NULL DEFAULT '/images/avatar-default.svg',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cms_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cms_sessions (
  token_hash CHAR(64) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_address VARCHAR(64) NOT NULL DEFAULT '',
  user_agent VARCHAR(500) NOT NULL DEFAULT '',
  PRIMARY KEY (token_hash),
  KEY ix_cms_sessions_user (user_id),
  KEY ix_cms_sessions_expiry (expires_at),
  CONSTRAINT fk_cms_sessions_user FOREIGN KEY (user_id) REFERENCES cms_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cms_posts (
  id CHAR(36) NOT NULL,
  slug VARCHAR(180) NOT NULL,
  title VARCHAR(250) NOT NULL,
  description TEXT NOT NULL,
  body LONGTEXT NOT NULL,
  author_id BIGINT UNSIGNED NOT NULL,
  lang ENUM('zh', 'en') NOT NULL DEFAULT 'zh',
  translation_key VARCHAR(180) NULL,
  categories JSON NOT NULL,
  tags JSON NOT NULL,
  cover VARCHAR(500) NULL,
  comments BOOLEAN NOT NULL DEFAULT TRUE,
  status ENUM('draft', 'published') NOT NULL DEFAULT 'draft',
  published_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cms_posts_slug_lang (slug, lang),
  KEY ix_cms_posts_author (author_id),
  KEY ix_cms_posts_status (status),
  CONSTRAINT fk_cms_posts_author FOREIGN KEY (author_id) REFERENCES cms_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cms_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id VARCHAR(64) NULL,
  details JSON NULL,
  ip_address VARCHAR(64) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_cms_audit_created (created_at),
  KEY ix_cms_audit_user (user_id),
  CONSTRAINT fk_cms_audit_user FOREIGN KEY (user_id) REFERENCES cms_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

