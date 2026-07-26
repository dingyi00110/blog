(() => {
  'use strict';

  const THEME_KEY = 'neverdown_theme';
  const AI_HISTORY_KEY = 'neverdown_ai_conversations';
  const MAX_CONVERSATIONS = 10;
  const COPY_RESET_MILLISECONDS = 1400;
  const root = document.documentElement;
  const isEnglish = root.lang === 'en';

  /**
   * 切换站点主题。
   * @returns {void}
   */
  function cycleTheme() {
    const current = root.dataset.theme;
    const next = current === 'dark' ? 'light' : current === 'light' ? 'auto' : 'dark';
    root.dataset.theme = next;
    localStorage.setItem(THEME_KEY, next);
  }

  /**
   * 初始化移动端导航。
   * @returns {void}
   */
  function initializeNavigation() {
    const nav = document.querySelector('.nav');
    const toggle = document.querySelector('.nav-toggle');
    toggle?.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  /**
   * 初始化阅读进度条。
   * @returns {void}
   */
  function initializeReadingProgress() {
    const bar = document.querySelector('.reading-progress span');
    if (!bar) return;

    const update = () => {
      const height = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = `${height > 0 ? Math.min(100, window.scrollY / height * 100) : 0}%`;
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
  }

  /**
   * 初始化文章目录。
   * @returns {void}
   */
  function initializeTableOfContents() {
    const container = document.querySelector('.toc-links');
    const headings = [...document.querySelectorAll('.post-content h2, .post-content h3')];
    if (!container || !headings.length) return;

    headings.forEach((heading, index) => {
      if (!heading.id) heading.id = `section-${index + 1}`;
      const link = document.createElement('a');
      link.href = `#${heading.id}`;
      link.textContent = heading.textContent;
      if (heading.tagName === 'H3') link.style.paddingLeft = '24px';
      container.append(link);
    });

    const links = [...container.querySelectorAll('a')];
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        links.forEach(link => link.classList.toggle('active', link.hash === `#${entry.target.id}`));
      });
    }, { rootMargin: '-15% 0px -70%' });
    headings.forEach(heading => observer.observe(heading));
  }

  /**
   * 初始化代码复制按钮。
   * @returns {void}
   */
  function initializeCodeCopy() {
    document.querySelectorAll('figure.highlight, .post-content pre').forEach(block => {
      if (block.closest('figure.highlight') && block.tagName === 'PRE') return;
      const button = document.createElement('button');
      button.className = 'copy-code';
      button.textContent = isEnglish ? 'Copy' : '复制';
      Object.assign(button.style, {
        float: 'right', border: '0', background: 'none', color: 'var(--muted)', cursor: 'pointer'
      });
      button.addEventListener('click', async () => {
        const code = block.querySelector('code') || block;
        await navigator.clipboard.writeText(code.innerText);
        button.textContent = isEnglish ? 'Copied' : '已复制';
        setTimeout(() => { button.textContent = isEnglish ? 'Copy' : '复制'; }, COPY_RESET_MILLISECONDS);
      });
      block.prepend(button);
    });
  }

  /**
   * 初始化全文搜索弹窗。
   * @returns {void}
   */
  function initializeSearch() {
    const modal = document.querySelector('.search-modal');
    const input = document.querySelector('#site-search');
    const results = document.querySelector('.search-results');
    let entries = [];

    const close = () => {
      modal.hidden = true;
      document.body.style.overflow = '';
    };
    const open = async () => {
      modal.hidden = false;
      document.body.style.overflow = 'hidden';
      input.focus();
      if (entries.length) return;

      try {
        const xml = await fetch('/search.xml').then(response => response.text());
        const documentXml = new DOMParser().parseFromString(xml, 'text/xml');
        entries = [...documentXml.querySelectorAll('entry')].map(node => ({
          title: node.querySelector('title')?.textContent || '',
          url: node.querySelector('url')?.textContent || '',
          content: node.querySelector('content')?.textContent.replace(/<[^>]*>/g, ' ') || ''
        }));
      } catch (error) {
        results.textContent = isEnglish ? 'Search index unavailable.' : '搜索索引暂不可用。';
      }
    };

    document.querySelector('.search-open')?.addEventListener('click', open);
    document.querySelector('.search-close')?.addEventListener('click', close);
    modal?.addEventListener('click', event => { if (event.target === modal) close(); });
    document.addEventListener('keydown', event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        open();
      }
      if (event.key === 'Escape' && !modal?.hidden) close();
    });
    input?.addEventListener('input', () => {
      const query = input.value.trim().toLowerCase();
      results.replaceChildren();
      if (!query) return;
      const found = entries.filter(item => `${item.title} ${item.content}`.toLowerCase().includes(query)).slice(0, 12);
      found.forEach(item => {
        const link = document.createElement('a');
        const title = document.createElement('strong');
        const excerpt = document.createElement('small');
        link.className = 'search-item';
        link.href = item.url;
        title.textContent = item.title;
        excerpt.textContent = item.content.trim().slice(0, 140);
        link.append(title, excerpt);
        results.append(link);
      });
      if (!found.length) results.textContent = isEnglish ? 'No matching posts found' : '没有找到相关文章';
    });
  }

  /**
   * 读取本地 AI 对话。
   * @returns {Array<object>} 本地对话列表。
   */
  function readConversations() {
    try {
      const conversations = JSON.parse(localStorage.getItem(AI_HISTORY_KEY) || '[]');
      return Array.isArray(conversations) ? conversations.slice(0, MAX_CONVERSATIONS) : [];
    } catch (error) {
      return [];
    }
  }

  /**
   * 保存当前 AI 对话。
   * @param {object} conversation 当前对话。
   * @returns {void}
   */
  function saveConversation(conversation) {
    const conversations = readConversations().filter(item => item.id !== conversation.id);
    conversations.unshift(conversation);
    localStorage.setItem(AI_HISTORY_KEY, JSON.stringify(conversations.slice(0, MAX_CONVERSATIONS)));
  }

  /**
   * 创建一条 AI 消息。
   * @param {string} role 消息角色。
   * @param {string} content 消息内容。
   * @returns {HTMLElement} 消息节点。
   */
  function createMessage(role, content) {
    const element = document.createElement('div');
    const paragraph = document.createElement('p');
    element.className = `ai-message ai-message-${role}`;
    paragraph.textContent = content;
    element.append(paragraph);
    return element;
  }

  /**
   * 初始化 AI 知识助手。
   * @returns {void}
   */
  function initializeAiAssistant() {
    const drawer = document.querySelector('.ai-drawer');
    const backdrop = document.querySelector('.ai-backdrop');
    const messages = document.querySelector('.ai-messages');
    const form = document.querySelector('.ai-form');
    const input = document.querySelector('#ai-question');
    if (!drawer || !form || !input) return;

    const stored = readConversations()[0];
    const conversation = stored || { id: crypto.randomUUID(), messages: [], updated_at: Date.now() };
    let controller = null;
    let lastQuestion = '';

    const renderStoredMessages = () => {
      if (!conversation.messages.length) return;
      messages.replaceChildren();
      conversation.messages.forEach(item => messages.append(createMessage(item.role, item.content)));
      messages.scrollTop = messages.scrollHeight;
    };
    const close = () => {
      drawer.classList.remove('open');
      drawer.setAttribute('aria-hidden', 'true');
      backdrop.hidden = true;
      document.body.style.overflow = '';
    };
    const open = question => {
      drawer.classList.add('open');
      drawer.setAttribute('aria-hidden', 'false');
      backdrop.hidden = false;
      document.body.style.overflow = 'hidden';
      if (question) input.value = question;
      setTimeout(() => input.focus(), 50);
    };
    const addSources = (element, sources) => {
      if (!sources?.length) return;
      const list = document.createElement('div');
      list.className = 'ai-sources';
      sources.forEach((source, index) => {
        const link = document.createElement('a');
        link.href = source.url;
        link.textContent = `[${index + 1}] ${source.title}${source.section_title ? ` · ${source.section_title}` : ''}`;
        list.append(link);
      });
      element.append(list);
    };
    const addActions = (element, answer) => {
      const actions = document.createElement('div');
      const copy = document.createElement('button');
      const retry = document.createElement('button');
      actions.className = 'ai-actions';
      copy.type = 'button';
      retry.type = 'button';
      copy.textContent = isEnglish ? 'Copy answer' : '复制回答';
      retry.textContent = isEnglish ? 'Retry' : '重试';
      copy.addEventListener('click', () => navigator.clipboard.writeText(answer));
      retry.addEventListener('click', () => submitQuestion(lastQuestion));
      actions.append(copy, retry);
      element.append(actions);
    };
    const submitQuestion = async question => {
      const normalized = question.trim();
      if (!normalized || controller) return;
      lastQuestion = normalized;
      input.value = '';
      messages.querySelector('.ai-welcome')?.remove();
      messages.append(createMessage('user', normalized));
      const searchingMessage = isEnglish ? 'Searching the archive…' : '正在检索文章档案…';
      const assistant = createMessage('assistant', searchingMessage);
      const answerNode = assistant.querySelector('p');
      messages.append(assistant);
      messages.scrollTop = messages.scrollHeight;
      controller = new AbortController();
      const submitButton = form.querySelector('button[type="submit"]');
      submitButton.textContent = '■';
      let answer = '';
      let sources = [];

      try {
        const history = conversation.messages.slice(-12);
        const response = await fetch('/cms-api/ai/chat', {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: normalized,
            lang: isEnglish ? 'en' : 'zh',
            conversation_id: conversation.id,
            history
          })
        });
        if (!response.ok || !response.body) throw new Error('AI unavailable');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const result = await reader.read();
          if (result.done) break;
          buffer += decoder.decode(result.value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() || '';
          events.forEach(event => {
            const line = event.split('\n').find(item => item.startsWith('data:'));
            if (!line) return;
            const payload = JSON.parse(line.slice(5));
            if (payload.sources) sources = payload.sources;
            if (payload.delta) {
              answer += payload.delta;
              answerNode.textContent = answer;
            }
            if (payload.error) throw new Error(payload.error);
          });
          messages.scrollTop = messages.scrollHeight;
        }

        if (!answer) throw new Error('Empty AI answer');
        addSources(assistant, sources);
        addActions(assistant, answer);
        conversation.messages.push({ role: 'user', content: normalized }, { role: 'assistant', content: answer });
        conversation.updated_at = Date.now();
        saveConversation(conversation);
      } catch (error) {
        if (error.name === 'AbortError') {
          answerNode.textContent = answer || (isEnglish ? 'Generation stopped.' : '已停止生成。');
        } else {
          answerNode.textContent = isEnglish
            ? 'AI is temporarily unavailable. Full-text search still works.'
            : 'AI 暂时不可用，你仍可使用全文搜索。';
          const search = document.createElement('button');
          search.type = 'button';
          search.textContent = isEnglish ? 'Open search' : '打开搜索';
          search.addEventListener('click', () => {
            close();
            document.querySelector('.search-open')?.click();
          });
          assistant.append(search);
        }
      } finally {
        controller = null;
        submitButton.textContent = '↑';
      }
    };

    renderStoredMessages();
    document.querySelectorAll('.ai-open').forEach(button => {
      button.addEventListener('click', () => open(button.dataset.question || ''));
    });
    document.querySelector('.ai-close')?.addEventListener('click', close);
    backdrop?.addEventListener('click', close);
    document.querySelectorAll('.ai-suggestions button').forEach(button => {
      button.addEventListener('click', () => submitQuestion(button.textContent));
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (controller) {
        controller.abort();
        return;
      }
      submitQuestion(input.value);
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && drawer.classList.contains('open')) close();
    });
  }

  document.querySelector('.theme-toggle')?.addEventListener('click', cycleTheme);
  initializeNavigation();
  initializeReadingProgress();
  initializeTableOfContents();
  initializeCodeCopy();
  initializeSearch();
  initializeAiAssistant();
})();
