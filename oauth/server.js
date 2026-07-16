'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { URL, URLSearchParams } = require('node:url');

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
const clientId = process.env.GITHUB_CLIENT_ID;
const clientSecret = process.env.GITHUB_CLIENT_SECRET;
const siteUrl = String(process.env.SITE_URL || '').replace(/\/$/, '');
const callbackUrl = process.env.CALLBACK_URL;
const oauthScope = process.env.GITHUB_SCOPE || 'repo';
const stateSecret = process.env.STATE_SECRET;
const secureCookie = siteUrl.startsWith('https://') ? '; Secure' : '';

for (const [name, value] of Object.entries({
  GITHUB_CLIENT_ID: clientId,
  GITHUB_CLIENT_SECRET: clientSecret,
  SITE_URL: siteUrl,
  CALLBACK_URL: callbackUrl,
  STATE_SECRET: stateSecret
})) {
  if (!value) throw new Error(`${name} is required`);
}

function send(res, status, body, type = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...headers
  });
  res.end(body);
}

function sign(value) {
  return crypto.createHmac('sha256', stateSecret).update(value).digest('base64url');
}

function cookieValue(req, name) {
  const cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map(part => {
    const index = part.indexOf('=');
    return index < 0 ? ['', ''] : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }));
  return cookies[name];
}

function safeEqual(left, right) {
  const a = Buffer.from(left || '');
  const b = Buffer.from(right || '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function callbackPage(result, payload) {
  const message = `authorization:github:${result}:${JSON.stringify(payload)}`;
  const jsString = value => JSON.stringify(value).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><title>GitHub authorization</title></head><body><p>Authorization ${result}. This window can be closed.</p><script>
    (() => {
      const targetOrigin = ${jsString(siteUrl)};
      const message = ${jsString(message)};
      const reply = event => {
        if (event.origin !== targetOrigin || !String(event.data).startsWith('authorizing:github')) return;
        window.opener.postMessage(message, targetOrigin);
      };
      window.addEventListener('message', reply, false);
      if (window.opener) window.opener.postMessage('authorizing:github', targetOrigin);
    })();
  </script></body></html>`;
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);

  if (requestUrl.pathname === '/health') {
    return send(res, 200, 'ok');
  }

  if (requestUrl.pathname === '/auth') {
    const nonce = crypto.randomBytes(32).toString('base64url');
    const state = `${nonce}.${sign(nonce)}`;
    const authorize = new URL('https://github.com/login/oauth/authorize');
    authorize.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      scope: oauthScope,
      state
    }).toString();
    return send(res, 302, '', 'text/plain; charset=utf-8', {
      Location: authorize.toString(),
      'Set-Cookie': `oauth_state=${encodeURIComponent(state)}; Path=/; HttpOnly${secureCookie}; SameSite=Lax; Max-Age=600`
    });
  }

  if (requestUrl.pathname === '/callback') {
    const code = requestUrl.searchParams.get('code');
    const state = requestUrl.searchParams.get('state') || '';
    const storedState = decodeURIComponent(cookieValue(req, 'oauth_state') || '');
    const [nonce, signature] = state.split('.');
    if (!code || !nonce || !safeEqual(signature, sign(nonce)) || !safeEqual(state, storedState)) {
      return send(res, 400, callbackPage('error', { message: 'Invalid or expired OAuth state' }), 'text/html; charset=utf-8');
    }

    try {
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'NeverDown-CMS-OAuth' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: callbackUrl })
      });
      const data = await tokenResponse.json();
      if (!tokenResponse.ok || !data.access_token) throw new Error(data.error_description || data.error || 'Token exchange failed');
      return send(res, 200, callbackPage('success', { token: data.access_token, provider: 'github' }), 'text/html; charset=utf-8', {
        'Set-Cookie': `oauth_state=; Path=/; HttpOnly${secureCookie}; SameSite=Lax; Max-Age=0`
      });
    } catch (error) {
      return send(res, 502, callbackPage('error', { message: error.message }), 'text/html; charset=utf-8');
    }
  }

  return send(res, 404, 'Not found');
});

server.listen(port, host, () => {
  console.log(`NeverDown OAuth gateway listening on http://${host}:${port}`);
});
