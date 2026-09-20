chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "HIGHLIGHT_WORDS") {
    const count = highlightTerms(request.words);
    sendResponse({ status: "done", count: count });
  }
  return true;
});
function extractPublishDate() {
  // Check common schema/meta tags
  const selectors = [
    'meta[property="article:published_time"]',
    'meta[name="pubdate"]',
    'meta[name="date"]',
    'time[datetime]',
    'meta[property="og:published_time"]'
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    const dateStr = el?.getAttribute('content') || el?.getAttribute('datetime');
    if (dateStr && !isNaN(Date.parse(dateStr))) {
      return new Date(dateStr);
    }
  }

  return new Date(); // Fallback to now if no explicit metadata exists
}
function highlightTerms(words) {
  if (!words || words.length === 0) return 0;

  const escapedWords = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`\\b(${escapedWords.join('|')})\\b`, 'gi');

  const targets = document.querySelectorAll('h1, h2, h3, h4, p, li, blockquote');
  let matchCount = 0;

  targets.forEach(el => {
    // Avoid re-scanning scripts, styles, or already highlighted areas
    if (el.dataset.klarityDone || el.closest('mark')) return;

    if (regex.test(el.innerText)) {
      matchCount++;
      el.innerHTML = el.innerHTML.replace(regex, (match) => {
        return `<mark style="background-color: #fef08a !important; color: #854d0e !important; font-weight: bold !important; padding: 2px 4px !important; border-radius: 3px !important; border: 1px solid #facc15 !important; display: inline !important;" title="Flagged by Klarity">${match}</mark>`;
      });
      el.dataset.klarityDone = "true";
    }
  });

  // Small toast on top of the web page confirming highlights
  let banner = document.getElementById('klarity-toast');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'klarity-toast';
    banner.style.cssText = "position: fixed; bottom: 20px; right: 20px; background: #0f172a; color: #ffffff; padding: 10px 16px; border-radius: 8px; font-family: sans-serif; font-size: 13px; font-weight: 600; z-index: 999999; box-shadow: 0 4px 12px rgba(0,0,0,0.25);";
    document.body.appendChild(banner);
  }
  banner.innerText = matchCount > 0 ? `Klarity: Highlighted ${matchCount} flagged section(s)` : `Klarity: No matching words on visible page`;
  setTimeout(() => banner.remove(), 3500);

  return matchCount;
}
