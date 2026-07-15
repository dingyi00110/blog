'use strict';

hexo.extend.helper.register('post_lang', function (post) {
  return post.lang === 'en' ? 'en' : 'zh';
});

hexo.extend.helper.register('ui_lang', function () {
  if (this.page && this.page.lang === 'en') return 'en';
  return 'zh-CN';
});

hexo.extend.helper.register('author_info', function (id) {
  const authors = this.theme.authors || {};
  return authors[id] || { name: id || 'Unknown', avatar: '/images/avatar-default.svg' };
});

hexo.extend.helper.register('reading_time', function (post) {
  const text = String(post.content || '').replace(/<[^>]+>/g, '');
  const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const words = (text.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9_]+/g) || []).length;
  const total = cjk + words;
  return { words: total, minutes: Math.max(1, Math.ceil(cjk / 350 + words / 220)) };
});

hexo.extend.helper.register('paired_post_url', function (post) {
  if (!post || !post.translation_key) return null;
  const target = post.lang === 'en' ? 'zh' : 'en';
  const match = this.site.posts.toArray().find(item =>
    item.translation_key === post.translation_key &&
    (item.lang === 'en' ? 'en' : 'zh') === target
  );
  return match ? this.url_for(match.path) : null;
});

hexo.extend.helper.register('localized_posts', function (lang) {
  const target = lang === 'en' ? 'en' : 'zh';
  return this.site.posts.filter(post => (post.lang === 'en' ? 'en' : 'zh') === target);
});

hexo.extend.helper.register('language_url', function (post) {
  const translated = this.paired_post_url(post);
  if (translated) return translated;
  return this.url_for(post && post.lang === 'en' ? '/zh/' : '/en/');
});
