chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "HIGHLIGHT_WORDS" && Array.isArray(request.words)) {
    const words = request.words;
    if (words.length === 0) {
      sendResponse({ status: "no_words" });
      return;
    }

    // 1. Inject fade-out style rule if it doesn't already exist on the page
    if (!document.getElementById('newsshield-highlight-style')) {
      const style = document.createElement('style');
      style.id = 'newsshield-highlight-style';
      style.textContent = `
        @keyframes newsshieldFade {
          0% {
            background-color: #fef08a;
            color: #854d0e;
            border-bottom-color: #ca8a04;
          }
          70% {
            background-color: #fef08a;
            color: #854d0e;
            border-bottom-color: #ca8a04;
          }
          100% {
            background-color: transparent;
            color: inherit;
            border-bottom-color: transparent;
          }
        }
        .newsshield-highlight {
          display: inline;
          background-color: #fef08a;
          color: #854d0e;
          padding: 2px 4px;
          border-radius: 4px;
          font-weight: 600;
          border-bottom: 2px solid #ca8a04;
          animation: newsshieldFade 5s ease-in-out forwards;
        }
      `;
      document.head.appendChild(style);
    }

    // 2. Clean up any previous highlights before applying new ones
    document.querySelectorAll('.newsshield-highlight').forEach(el => {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent), el);
        parent.normalize();
      }
    });

    // 3. Build regex to target whole words case-insensitively
    const escapedWords = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(`\\b(${escapedWords.join('|')})\\b`, 'gi');

    // Collect visible text nodes from articles, main containers, and headings
    const textNodes = [];
    const elements = document.querySelectorAll('article p, main p, h1, h2, h3, p');

    elements.forEach(el => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
      let node;
      while ((node = walker.nextNode())) {
        if (node.nodeValue.trim().length > 0) {
          textNodes.push(node);
        }
      }
    });

    let firstMatchElement = null;

    textNodes.forEach(node => {
      if (pattern.test(node.nodeValue)) {
        const span = document.createElement('span');
        span.innerHTML = node.nodeValue.replace(pattern, (match) => {
          return `<mark class="newsshield-highlight">${match}</mark>`;
        });

        const parent = node.parentNode;
        if (parent) {
          parent.replaceChild(span, node);
          if (!firstMatchElement) {
            firstMatchElement = span.querySelector('.newsshield-highlight');
          }
        }
      }
    });

    // 4. Smooth scroll to the first flagged word
    if (firstMatchElement) {
      firstMatchElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
      sendResponse({ status: "success", scrolled: true });
    } else {
      sendResponse({ status: "not_found" });
    }

    // 5. Fully unwrap the tags from the DOM once the 5s animation completes
    setTimeout(() => {
      document.querySelectorAll('.newsshield-highlight').forEach(el => {
        const parent = el.parentNode;
        if (parent) {
          parent.replaceChild(document.createTextNode(el.textContent), el);
          parent.normalize();
        }
      });
    }, 5000);
  }
  return true;
});
