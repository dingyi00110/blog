'use strict';

hexo.extend.generator.register('authors', function (locals) {
  const authors = this.theme.config.authors || {};
  return {
    path: 'authors/index.html',
    layout: ['authors', 'page'],
    data: {
      title: '作者 / Authors',
      authors: Object.entries(authors).map(([id, profile]) => ({
        id,
        ...profile,
        posts: locals.posts.filter(post => post.author === id).sort('-date')
      }))
    }
  };
});

