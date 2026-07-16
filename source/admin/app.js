'use strict';

const API = '/cms-api';
const state = { user: null, users: [], posts: [], current: null };
const $ = selector => document.querySelector(selector);

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    credentials: 'same-origin',
    headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login') showLogin();
    throw new Error(data.error || `请求失败 (${response.status})`);
  }
  return data;
}

function showLogin() {
  $('#login-view').hidden = false;
  $('#app-view').hidden = true;
  state.user = null;
}

function showApp() {
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  $('#current-user').textContent = `${state.user.display_name} · ${state.user.role}`;
  document.querySelectorAll('.admin-only').forEach(element => element.hidden = state.user.role !== 'admin');
}

function message(form, text, success = false) {
  const output = form.querySelector('.form-message');
  if (!output) return;
  output.textContent = text;
  output.style.color = success ? 'var(--accent)' : 'var(--danger)';
}

async function bootstrap() {
  try {
    const result = await api('/auth/me');
    state.user = result.user;
    showApp();
    await Promise.all([loadPosts(), loadUsers()]);
  } catch (_) { showLogin(); }
}

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  message(form, '正在登录…', true);
  try {
    const values = Object.fromEntries(new FormData(form));
    const result = await api('/auth/login', { method: 'POST', body: JSON.stringify(values) });
    state.user = result.user;
    form.reset();
    showApp();
    await Promise.all([loadPosts(), loadUsers()]);
  } catch (error) { message(form, error.message); }
});

$('#logout-button').addEventListener('click', async () => {
  try { await api('/auth/logout', { method: 'POST', body: '{}' }); } finally { showLogin(); }
});

async function loadPosts() {
  state.posts = (await api('/posts')).posts;
  renderPostList();
}

async function loadUsers() {
  state.users = (await api('/users')).users;
  renderUsers();
}

function renderPostList() {
  const list = $('#post-list');
  list.replaceChildren();
  for (const post of state.posts) {
    const button = document.createElement('button');
    button.className = `post-item${state.current?.id === post.id ? ' active' : ''}`;
    const title = document.createElement('strong'); title.textContent = post.title;
    const meta = document.createElement('small');
    const lang = document.createElement('span'); lang.textContent = post.lang === 'en' ? 'EN' : '中文';
    const status = document.createElement('span'); status.className = `status ${post.status}`; status.textContent = post.status === 'published' ? '已发布' : '草稿';
    meta.append(lang, status); button.append(title, meta);
    button.addEventListener('click', () => openPost(post.id));
    list.append(button);
  }
}

function renderUsers() {
  const list = $('#user-list');
  list.replaceChildren();
  for (const user of state.users) {
    const card = document.createElement('article'); card.className = 'user-card';
    const title = document.createElement('h3'); title.textContent = user.display_name;
    const meta = document.createElement('p'); meta.textContent = `@${user.username} · ${user.role} · ${user.active ? '启用' : '停用'}`;
    const bio = document.createElement('small'); bio.textContent = user.bio_zh || '暂无简介';
    card.append(title, meta, bio); list.append(card);
  }
}

function switchView(name) {
  $('#editor-view').hidden = name !== 'posts';
  $('#users-view').hidden = name !== 'users';
  document.querySelectorAll('.nav-button').forEach(button => button.classList.toggle('active', button.dataset.view === name));
}

document.querySelectorAll('.nav-button').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
$('#new-user-button').addEventListener('click', () => $('#user-dialog').showModal());
$('#user-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api('/users', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    message(form, '账号创建成功', true); form.reset(); await loadUsers();
    setTimeout(() => $('#user-dialog').close(), 700);
  } catch (error) { message(form, error.message); }
});

$('#new-post-button').addEventListener('click', () => {
  state.current = null;
  renderEditor({ lang: 'zh', comments: true, author_id: state.user.id, categories: [], tags: [] });
  switchView('posts'); renderPostList();
});

async function openPost(id) {
  try {
    state.current = (await api(`/posts/${id}`)).post;
    renderEditor(state.current); switchView('posts'); renderPostList();
  } catch (error) { window.alert(error.message); }
}

function editorData(form) {
  const data = Object.fromEntries(new FormData(form));
  data.comments = form.elements.comments.checked;
  data.categories = data.categories.split(',').map(value => value.trim()).filter(Boolean);
  data.tags = data.tags.split(',').map(value => value.trim()).filter(Boolean);
  return data;
}

function renderEditor(post) {
  const workspace = $('#editor-view');
  workspace.replaceChildren($('#editor-template').content.cloneNode(true));
  const form = $('#post-form');
  const authorSelect = form.elements.author_id;
  for (const user of state.users.filter(item => item.active)) {
    const option = document.createElement('option'); option.value = user.id; option.textContent = user.display_name; authorSelect.append(option);
  }
  if (state.user.role !== 'admin') form.querySelector('.admin-field').hidden = true;
  for (const name of ['title', 'slug', 'lang', 'translation_key', 'description', 'cover', 'body', 'author_id']) {
    if (post[name] !== undefined && post[name] !== null) form.elements[name].value = post[name];
  }
  form.elements.categories.value = (post.categories || []).join(', ');
  form.elements.tags.value = (post.tags || []).join(', ');
  form.elements.comments.checked = post.comments !== false;
  const publishButton = $('#publish-button');
  if (post.status === 'published') publishButton.textContent = '更新发布';
  if (!state.current) $('#delete-button').hidden = true;

  form.addEventListener('submit', async event => {
    event.preventDefault();
    try { await savePost(form); } catch (error) { window.alert(error.message); }
  });
  publishButton.addEventListener('click', async () => {
    publishButton.disabled = true; publishButton.textContent = '构建发布中…';
    try {
      await savePost(form);
      const result = await api(`/posts/${state.current.id}/publish`, { method: 'POST', body: '{}' });
      $('#save-state').textContent = `已发布 ${result.release}${result.git === 'failed' ? ' · Git 备份失败' : ''}`;
      await loadPosts();
    } catch (error) { window.alert(error.message); }
    finally { publishButton.disabled = false; publishButton.textContent = '更新发布'; }
  });
  $('#delete-button').addEventListener('click', async () => {
    if (!window.confirm('确认删除这篇文章？此操作会被记录。')) return;
    try { await api(`/posts/${state.current.id}`, { method: 'DELETE' }); state.current = null; await loadPosts(); workspace.innerHTML = '<div class="workspace-empty"><strong>文章已删除</strong></div>'; }
    catch (error) { window.alert(error.message); }
  });
  setupWriting(form);
}

async function savePost(form) {
  $('#save-state').textContent = '保存中…';
  const data = editorData(form);
  if (state.current) await api(`/posts/${state.current.id}`, { method: 'PUT', body: JSON.stringify(data) });
  else {
    const result = await api('/posts', { method: 'POST', body: JSON.stringify(data) });
    state.current = { id: result.id };
    $('#delete-button').hidden = false;
  }
  $('#save-state').textContent = '已保存';
  await loadPosts();
}

function setupWriting(form) {
  const editor = form.elements.body;
  const preview = $('#preview-panel');
  document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', async () => {
    document.querySelectorAll('.tab').forEach(item => item.classList.toggle('active', item === button));
    const showPreview = button.dataset.tab === 'preview';
    editor.hidden = showPreview; preview.hidden = !showPreview;
    if (showPreview) {
      preview.textContent = '生成预览中…';
      try { preview.innerHTML = (await api('/preview', { method: 'POST', body: JSON.stringify({ markdown: editor.value }) })).html; }
      catch (error) { preview.textContent = error.message; }
    }
  }));
  $('#image-upload').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    const body = new FormData(); body.append('file', file);
    try {
      const result = await api('/uploads', { method: 'POST', body });
      const insertion = `![${file.name}](${result.url})`;
      editor.setRangeText(insertion, editor.selectionStart, editor.selectionEnd, 'end');
    } catch (error) { window.alert(error.message); }
    event.target.value = '';
  });
}

bootstrap();

