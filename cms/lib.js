'use strict';

const crypto = require('node:crypto');
const mysql = require('mysql2/promise');

const required = name => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

function databaseConfig() {
  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    database: required('MYSQL_DATABASE'),
    user: required('MYSQL_USER'),
    password: required('MYSQL_PASSWORD'),
    charset: 'utf8mb4',
    connectionLimit: 10,
    timezone: 'Z'
  };
}

function createPool() {
  return mysql.createPool(databaseConfig());
}

function scrypt(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) => error ? reject(error) : resolve(key));
  });
}

async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12) throw new Error('密码至少需要 12 个字符');
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

async function verifyPassword(password, encoded) {
  const [algorithm, saltText, keyText] = String(encoded).split('$');
  if (algorithm !== 'scrypt' || !saltText || !keyText) return false;
  const expected = Buffer.from(keyText, 'base64url');
  const actual = await scrypt(password, Buffer.from(saltText, 'base64url'));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = { createPool, hashPassword, verifyPassword, tokenHash };

