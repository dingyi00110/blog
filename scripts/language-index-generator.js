'use strict';

hexo.extend.generator.register('language-indexes', function (locals) {
  return ['zh', 'en'].map(lang => ({
    path: `${lang}/index.html`,
    layout: 'index',
    data: {
      title: lang === 'en' ? 'NeverDown' : '永不宕机',
      lang,
      posts: locals.posts.filter(post => (post.lang === 'en' ? 'en' : 'zh') === lang),
      total: 1,
      current: 1
    }
  }));
});

