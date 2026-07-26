'use strict';

const crypto = require('node:crypto');
const { stripHTML } = require('hexo-util');

const DEFAULT_CHUNK_SIZE = 1200;
const DEFAULT_CHUNK_OVERLAP = 160;
const MAX_EXCERPT_SIZE = 220;
const EMBEDDING_BATCH_SIZE = 64;
const OPENAI_EMBEDDING_URL = 'https://api.openai.com/v1/embeddings';
const QWEN_EMBEDDING_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings';

/**
 * 将文章正文拆分为适合检索的段落。
 * @param {string} content 文章纯文本内容。
 * @returns {string[]} 文章分块。
 */
function splitContent(content) {
  const paragraphs = String(content || '').split(/\n{2,}/).map(item => item.trim()).filter(Boolean);
  const chunks = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length > DEFAULT_CHUNK_SIZE) {
      chunks.push(current);
      current = `${current.slice(-DEFAULT_CHUNK_OVERLAP)}\n${paragraph}`;
      continue;
    }

    current = current ? `${current}\n${paragraph}` : paragraph;
  }

  if (current) chunks.push(current);
  return chunks;
}

/**
 * 提取文章章节并保留标题层级。
 * @param {string} html 渲染后的文章 HTML。
 * @returns {Array<object>} 章节列表。
 */
function extractSections(html) {
  const normalized = String(html || '')
    .replace(/<pre[\s\S]*?<\/pre>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ');
  const headingPattern = /<h([2-3])([^>]*)>([\s\S]*?)<\/h\1>/gi;
  const headings = [...normalized.matchAll(headingPattern)];
  const sections = [];

  if (!headings.length) {
    return [{ title: '', anchor: '', content: stripHTML(normalized).trim() }];
  }

  const introduction = stripHTML(normalized.slice(0, headings[0].index)).trim();
  if (introduction) sections.push({ title: '', anchor: '', content: introduction });

  headings.forEach((heading, index) => {
    const end = headings[index + 1]?.index || normalized.length;
    sections.push({
      title: stripHTML(heading[3]).trim(),
      anchor: heading[2].match(/\sid="([^"]+)"/)?.[1] || '',
      content: stripHTML(normalized.slice(heading.index + heading[0].length, end)).trim()
    });
  });

  return sections;
}

/**
 * 获取嵌入服务配置。
 * @returns {object|null} 嵌入服务配置。
 */
function embeddingConfig() {
  const provider = String(process.env.AI_EMBEDDING_PROVIDER || '').toLowerCase();
  if (!provider) return null;

  if (provider === 'openai') {
    return {
      provider,
      model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
      apiKey: process.env.OPENAI_API_KEY,
      url: process.env.OPENAI_EMBEDDING_URL || OPENAI_EMBEDDING_URL
    };
  }

  if (provider === 'qwen') {
    return {
      provider,
      model: process.env.QWEN_EMBEDDING_MODEL || 'text-embedding-v3',
      apiKey: process.env.DASHSCOPE_API_KEY,
      url: process.env.QWEN_EMBEDDING_URL || QWEN_EMBEDDING_URL
    };
  }

  throw new Error(`Unsupported AI_EMBEDDING_PROVIDER: ${provider}`);
}

/**
 * 批量生成文本向量。
 * @param {string[]} input 输入文本。
 * @param {object} config 嵌入服务配置。
 * @returns {Promise<Array<number[]>>} 向量列表。
 */
async function createEmbeddings(input, config) {
  if (!config.apiKey) throw new Error(`Missing API key for ${config.provider} embeddings`);
  const embeddings = [];

  for (let index = 0; index < input.length; index += EMBEDDING_BATCH_SIZE) {
    const batch = input.slice(index, index + EMBEDDING_BATCH_SIZE);
    const response = await fetch(config.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, input: batch })
    });

    if (!response.ok) throw new Error(`Embedding request failed with status ${response.status}`);
    const payload = await response.json();
    const vectors = payload.data.sort((left, right) => left.index - right.index).map(item => item.embedding);
    embeddings.push(...vectors);
  }

  return embeddings;
}

/**
 * 生成公开文章的 AI 检索索引。
 * @returns {Promise<object>} Hexo 路由内容。
 */
async function generateAiIndex() {
  const chunks = [];
  const posts = hexo.locals.get('posts').filter(post => post.published !== false);

  posts.forEach(post => {
    extractSections(post.content).forEach(section => {
      splitContent(section.content).forEach((content, index) => {
        const url = hexo.config.url.replace(/\/$/, '') + hexo.config.root + post.path;
        const anchor = section.anchor ? `#${section.anchor}` : '';
        chunks.push({
          id: crypto.createHash('sha256').update(`${post.path}:${section.title}:${index}`).digest('hex').slice(0, 20),
          title: post.title,
          url: `${url}${anchor}`,
          section_title: section.title,
          excerpt: content.slice(0, MAX_EXCERPT_SIZE),
          content,
          lang: post.lang === 'en' ? 'en' : 'zh'
        });
      });
    });
  });

  const config = embeddingConfig();
  if (config && chunks.length) {
    const embeddings = await createEmbeddings(chunks.map(chunk => chunk.content), config);
    chunks.forEach((chunk, index) => { chunk.embedding = embeddings[index]; });
  }

  const index = {
    version: 1,
    generated_at: new Date().toISOString(),
    embedding_provider: config?.provider || null,
    embedding_model: config?.model || null,
    embedding_dimensions: chunks[0]?.embedding?.length || null,
    chunks
  };

  return { path: 'ai-index.json', data: JSON.stringify(index) };
}

hexo.extend.generator.register('ai-index', generateAiIndex);
