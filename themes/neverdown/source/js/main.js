(() => {
  const root = document.documentElement;
  const toggle = document.querySelector('.theme-toggle');
  toggle?.addEventListener('click', () => {
    const current = root.dataset.theme;
    const next = current === 'dark' ? 'light' : current === 'light' ? 'auto' : 'dark';
    root.dataset.theme = next;
    localStorage.setItem('theme', next);
  });

  const nav = document.querySelector('.nav');
  const navToggle = document.querySelector('.nav-toggle');
  navToggle?.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(open));
  });

  document.querySelectorAll('figure.highlight, .post-content pre').forEach(block => {
    if (block.closest('figure.highlight') && block.tagName === 'PRE') return;
    const button = document.createElement('button');
    button.className = 'copy-code';
    button.textContent = document.documentElement.lang === 'en' ? 'Copy' : '复制';
    Object.assign(button.style, {float:'right',border:'0',background:'none',color:'var(--muted)',cursor:'pointer'});
    button.addEventListener('click', async () => {
      const code = block.querySelector('code') || block;
      await navigator.clipboard.writeText(code.innerText);
      button.textContent = document.documentElement.lang === 'en' ? 'Copied' : '已复制';
      setTimeout(() => button.textContent = document.documentElement.lang === 'en' ? 'Copy' : '复制', 1400);
    });
    block.prepend(button);
  });

  const modal = document.querySelector('.search-modal');
  const input = document.querySelector('#site-search');
  const results = document.querySelector('.search-results');
  let entries = [];
  const close = () => { modal.hidden = true; document.body.style.overflow = ''; };
  document.querySelector('.search-open')?.addEventListener('click', async () => {
    modal.hidden = false; document.body.style.overflow = 'hidden'; input.focus();
    if (!entries.length) {
      try {
        const xml = await fetch('/search.xml').then(r => r.text());
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        entries = [...doc.querySelectorAll('entry')].map(node => ({
          title: node.querySelector('title')?.textContent || '',
          url: node.querySelector('url')?.textContent || '',
          content: node.querySelector('content')?.textContent.replace(/<[^>]*>/g, ' ') || ''
        }));
      } catch (_) { results.textContent = 'Search index unavailable.'; }
    }
  });
  document.querySelector('.search-close')?.addEventListener('click', close);
  modal?.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal?.hidden) close(); });
  input?.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase();
    results.replaceChildren();
    if (!query) return;
    const found = entries.filter(item => `${item.title} ${item.content}`.toLowerCase().includes(query)).slice(0, 12);
    found.forEach(item => {
      const link = document.createElement('a'); link.className = 'search-item'; link.href = item.url;
      const title = document.createElement('strong'); title.textContent = item.title;
      const excerpt = document.createElement('small'); excerpt.textContent = item.content.trim().slice(0, 120);
      link.append(title, excerpt); results.append(link);
    });
    if (!found.length) results.textContent = document.documentElement.lang === 'en' ? 'No matching posts found' : '没有找到相关文章';
  });
})();

