'use strict';

const { createPool, hashPassword } = require('./lib');

function hiddenPrompt(prompt) {
  if (!process.stdin.isTTY) return Promise.reject(new Error('CMS_ADMIN_PASSWORD is required when stdin is not a TTY'));
  return new Promise(resolve => {
    let value = '';
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const onData = key => {
      if (key === '\r' || key === '\n') {
        process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', onData); process.stdout.write('\n'); resolve(value);
      } else if (key === '\u0003') {
        process.stdout.write('\n'); process.exit(130);
      } else if (key === '\u007f') {
        value = value.slice(0, -1);
      } else if (!key.startsWith('\u001b')) value += key;
    };
    process.stdin.on('data', onData);
  });
}

async function main() {
  const username = process.env.CMS_ADMIN_USERNAME || 'admin';
  const displayName = process.env.CMS_ADMIN_DISPLAY_NAME || 'NeverDown Admin';
  const password = process.env.CMS_ADMIN_PASSWORD || await hiddenPrompt('管理员初始密码（至少 12 个字符）：');
  if (!/^[a-z0-9_-]{3,64}$/i.test(username)) throw new Error('Invalid admin username');

  const pool = createPool();
  const passwordHash = await hashPassword(password);
  await pool.execute(
    `INSERT INTO cms_users (username, display_name, password_hash, role, active)
     VALUES (?, ?, ?, 'admin', TRUE)
     ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), password_hash = VALUES(password_hash), role = 'admin', active = TRUE`,
    [username, displayName, passwordHash]
  );
  await pool.end();
  console.log(`Administrator '${username}' is ready.`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
