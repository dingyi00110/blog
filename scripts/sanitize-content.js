'use strict';

const sanitizeHtml = require('sanitize-html');

const allowedTags = sanitizeHtml.defaults.allowedTags.concat([
  'article', 'section', 'figure', 'figcaption', 'picture', 'source',
  'img', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'h1', 'h2', 'mark', 'details', 'summary'
]);

hexo.extend.filter.register('after_post_render', data => {
  data.content = sanitizeHtml(data.content, {
    allowedTags,
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      '*': ['class', 'id', 'title', 'aria-hidden'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
      source: ['src', 'srcset', 'type', 'media'],
      code: ['class'],
      pre: ['class'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan', 'scope']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false
  });
  return data;
});

