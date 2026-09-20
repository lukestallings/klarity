chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "HIGHLIGHT_WORDS" && Array.isArray(request.words)) {
    const words = request.words;
    if (words.length === 0) {
      sendResponse({ status: "no_words" });
      return;
    }

    // Clean up previous highlights first so we don't duplicate tags
    document.querySelectorAll('.newsshield-highlight').forEach(el => {
      const parent = el.parentNode;
      parent.replaceChild(document.createTextNode(el.textContent), el);
      parent.normalize();
    });

    // Build regex to match whole words case-insensitively
    const escapedWords = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(`\\b(${escapedWords.join('|')})\\b`, 'gi');

    // Target visible paragraph and heading text inside the article body
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
          return `<mark class="newsshield-highlight" style="background-color: #fef08a; color: #854d0e; padding: 2px 4px; border-radius: 4px; font-weight: 600; border-bottom: 2px solid #ca8a04;">${match}</mark>`;
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

    // Smoothly scroll the page directly to the first flagged occurrence
    if (firstMatchElement) {
      firstMatchElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
      sendResponse({ status: "success", scrolled: true });
    } else {
      sendResponse({ status: "not_found" });
    }
  }
  return true;
});
