document.addEventListener('DOMContentLoaded', () => {
  const headlineEl = document.getElementById('headline');
  const riskBadge = document.getElementById('riskBadge');
  const scoreVal = document.getElementById('scoreVal');
  const scoreBar = document.getElementById('scoreBar');
  const domainList = document.getElementById('domainSignals');
  const contentList = document.getElementById('contentSignals');
  const corroborationContainer = document.getElementById('corroborationContainer');
  const articleLinksList = document.getElementById('articleLinksList');
  const highlightBtn = document.getElementById('highlightBtn');
  const reanalyzeBtn = document.getElementById('reanalyzeBtn');

  let activeTabId = null;
  let flaggedWords = [];

  const SENSATIONAL_WORDS = [
    "shocking", "unbelievable", "mind-blowing", "miracle", "secret",
    "exposed", "horrifying", "bombshell", "conspiracy", "scandal",
    "you won't believe", "they don't want you to know", "furious",
    "meltdown", "destroys", "slams", "outrage", "panic", "disaster",
    "urgent warning", "breaking alert", "censored"
  ];

  async function runScan() {
    if (scoreBar) {
      scoreBar.classList.add('is-loading');
    }
    if (scoreVal) scoreVal.innerText = "--/100";
    if (riskBadge) {
      riskBadge.innerText = "CROSS-REFERENCING";
      riskBadge.className = "status-badge badge-warn";
    }
    if (corroborationContainer) {
      corroborationContainer.style.display = "none";
      articleLinksList.innerHTML = "";
    }

    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || !tab.id) {
      if (headlineEl) headlineEl.innerText = "No active tab found";
      if (scoreBar) scoreBar.classList.remove('is-loading');
      return;
    }
    activeTabId = tab.id;

    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:'))) {
      if (headlineEl) headlineEl.innerText = "System Page";
      if (riskBadge) {
        riskBadge.innerText = "N/A";
        riskBadge.className = "status-badge badge-warn";
      }
      if (scoreBar) {
        scoreBar.classList.remove('is-loading');
        scoreBar.style.width = "0%";
      }
      if (domainList) domainList.innerHTML = `<li class="signal-item"><span class="signal-icon">ℹ️</span><span>Cannot evaluate browser internal tabs.</span></li>`;
      if (contentList) contentList.innerHTML = `<li class="signal-item"><span class="signal-icon">ℹ️</span><span>Open a live website or article.</span></li>`;
      return;
    }

    try {
      await new Promise(res => setTimeout(res, 250));

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrapePageData
      });

      if (!results || !results[0] || !results[0].result) {
        if (headlineEl) headlineEl.innerText = "Cannot Read Content";
        if (scoreBar) scoreBar.classList.remove('is-loading');
        return;
      }

      const data = results[0].result;
      data.isHttps = tab.url ? tab.url.toLowerCase().startsWith('https://') : false;

      // Run domain age check and news corroboration simultaneously
      const [domainAgeDays, crossRefData] = await Promise.all([
        getDomainAgeInDays(data.hostname),
        crossReferenceNews(data.headline, data.hostname)
      ]);

      data.domainAgeDays = domainAgeDays;
      data.crossRef = crossRefData;

      const evaluation = evaluateContent(data, SENSATIONAL_WORDS);
      flaggedWords = evaluation.matchedWords;

      if (headlineEl) {
        if (data.headline && data.headline.length > 0) {
          headlineEl.innerText = data.headline.length > 32 
            ? data.headline.substring(0, 32) + "..." 
            : data.headline;
        } else {
          headlineEl.innerText = "Page Analyzed";
        }
      }

      if (scoreBar) {
        scoreBar.classList.remove('is-loading');
        scoreBar.style.width = `${evaluation.finalScore}%`;
        if (evaluation.finalScore >= 75) {
          scoreBar.style.backgroundColor = "#16a34a";
        } else if (evaluation.finalScore >= 50) {
          scoreBar.style.backgroundColor = "#d97706";
        } else {
          scoreBar.style.backgroundColor = "#dc2626";
        }
      }

      if (scoreVal) scoreVal.innerText = `${evaluation.finalScore}/100`;

      if (riskBadge) {
        if (evaluation.finalScore >= 75) {
          riskBadge.innerText = "LOW RISK";
          riskBadge.className = "status-badge badge-good";
        } else if (evaluation.finalScore >= 50) {
          riskBadge.innerText = "MODERATE";
          riskBadge.className = "status-badge badge-warn";
        } else {
          riskBadge.innerText = "HIGH RISK";
          riskBadge.className = "status-badge badge-bad";
        }
      }

      if (domainList) {
        domainList.innerHTML = evaluation.domainSignals.map(s => `
          <li class="signal-item">
            <span class="signal-icon">${s.icon}</span>
            <span>${s.text}</span>
          </li>
        `).join('');
      }

      if (contentList) {
        contentList.innerHTML = evaluation.contentSignals.map(s => `
          <li class="signal-item">
            <span class="signal-icon">${s.icon}</span>
            <span>${s.text}</span>
          </li>
        `).join('');
      }

      // Populate and display the Related Coverage link cards
      if (crossRefData && crossRefData.articles && crossRefData.articles.length > 0) {
        corroborationContainer.style.display = "block";
        articleLinksList.innerHTML = "";

        crossRefData.articles.forEach(art => {
          const card = document.createElement('div');
          card.className = "article-card";
          card.innerHTML = `
            <div class="article-card-title">${art.title}</div>
            <div class="article-card-meta">
              <span>${art.source}</span>
              <span>Read Story ↗</span>
            </div>
          `;

          card.addEventListener('click', () => {
            if (art.url) {
              chrome.tabs.create({ url: art.url });
            }
          });

          articleLinksList.appendChild(card);
        });
      }

    } catch (err) {
      console.error(err);
      if (scoreBar) scoreBar.classList.remove('is-loading');
      if (headlineEl) headlineEl.innerText = "Scan Failed";
    }
  }

  async function crossReferenceNews(headline, currentHostname) {
    if (!headline || headline.trim().length < 10) {
      return { status: "no_headline", count: 0, sources: [], articles: [] };
    }

    try {
      const stopWords = new Set([
        "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "with",
        "of", "by", "from", "up", "about", "into", "over", "after", "is", "are", "was",
        "were", "be", "been", "being", "have", "has", "had", "it", "its", "that", "this",
        "says", "said", "new", "report", "breaking", "update"
      ]);

      const cleanTokens = headline
        .replace(/[^\w\s]/gi, '')
        .toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 2 && !stopWords.has(word));

      const queryWords = cleanTokens.slice(0, 4).join(' ');
      if (!queryWords) return { status: "no_query", count: 0, sources: [], articles: [] };

      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(queryWords)}&hl=en-US&gl=US&ceid=US:en`;
      const response = await fetch(url);
      if (!response.ok) return { status: "fetch_failed", count: 0, sources: [], articles: [] };

      const xmlText = await response.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, "text/xml");

      const items = Array.from(xmlDoc.querySelectorAll("item"));
      const uniqueSources = new Set();
      const articles = [];

      for (const item of items) {
        const sourceNode = item.querySelector("source");
        const sourceName = sourceNode ? sourceNode.textContent.trim() : "News Outlet";
        const titleNode = item.querySelector("title");
        const linkNode = item.querySelector("link");

        let rawTitle = titleNode ? titleNode.textContent.trim() : "Related Story";
        if (rawTitle.includes(" - ")) {
          rawTitle = rawTitle.split(" - ").slice(0, -1).join(" - ");
        }

        const linkUrl = linkNode ? linkNode.textContent.trim() : null;

        if (sourceName && !currentHostname.toLowerCase().includes(sourceName.toLowerCase())) {
          uniqueSources.add(sourceName);

          if (articles.length < 3 && linkUrl) {
            articles.push({
              title: rawTitle,
              source: sourceName,
              url: linkUrl
            });
          }
        }
      }

      return {
        status: "success",
        count: uniqueSources.size,
        sources: Array.from(uniqueSources).slice(0, 3),
        articles: articles
      };
    } catch (e) {
      console.warn("Cross-reference failed:", e);
      return { status: "error", count: 0, sources: [], articles: [] };
    }
  }

  async function getDomainAgeInDays(hostname) {
    try {
      const parts = hostname.split('.');
      const rootDomain = parts.length > 2 ? parts.slice(-2).join('.') : hostname;

      const response = await fetch(`https://rdap.org/domain/${rootDomain}`, { cache: "force-cache" });
      if (!response.ok) return null;

      const data = await response.json();
      
      const registrationEvent = data.events?.find(e => 
        e.eventAction === "registration" || e.eventAction === "last changed"
      );

      if (!registrationEvent || !registrationEvent.eventDate) return null;

      const regDate = new Date(registrationEvent.eventDate);
      const now = new Date();
      const diffTime = Math.abs(now - regDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      return diffDays;
    } catch (err) {
      console.warn("RDAP lookup failed:", err);
      return null;
    }
  }

  if (highlightBtn) {
    highlightBtn.addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab || !tab.id) return;

      if (!flaggedWords || flaggedWords.length === 0) {
        highlightBtn.innerText = "No Flags Found!";
        setTimeout(() => { highlightBtn.innerText = "Inspect Highlights"; }, 1500);
        return;
      }

      highlightBtn.innerText = "Highlighting...";

      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });

        chrome.tabs.sendMessage(tab.id, {
          action: "HIGHLIGHT_WORDS",
          words: flaggedWords
        }, () => {
          highlightBtn.innerText = "Highlights Applied!";
          setTimeout(() => { highlightBtn.innerText = "Inspect Highlights"; }, 1500);
        });
      } catch (e) {
        console.error("Highlight error:", e);
        highlightBtn.innerText = "Error Highlighting";
        setTimeout(() => { highlightBtn.innerText = "Inspect Highlights"; }, 1500);
      }
    });
  }

  if (reanalyzeBtn) {
    reanalyzeBtn.addEventListener('click', async () => {
      reanalyzeBtn.innerText = "Scanning...";
      reanalyzeBtn.disabled = true;
      await runScan();
      setTimeout(() => {
        reanalyzeBtn.innerText = "Re-Analyze";
        reanalyzeBtn.disabled = false;
      }, 400);
    });
  }

  runScan();
});

function scrapePageData() {
  const headline = document.querySelector('h1')?.innerText?.trim() || document.title || "";
  const paragraphs = Array.from(document.querySelectorAll('article p, main p, p'))
    .map(p => p.innerText.trim())
    .filter(text => text.length > 25 && !text.includes("cookie") && !text.includes("©"));
  const bodyText = paragraphs.join(' ');

  const currentHost = window.location.hostname.toLowerCase();
  const allLinks = Array.from(document.querySelectorAll('a'));

  const externalLinks = Array.from(document.querySelectorAll('article p a, main p a'))
    .map(a => a.href)
    .filter(href => {
      try {
        const parsed = new URL(href);
        return parsed.protocol.startsWith('http') && parsed.hostname !== currentHost;
      } catch (e) {
        return false;
      }
    });

  const aboutKeywords = ["about us", "about", "our team", "editorial team", "staff", "masthead", "leadership", "who we are"];
  const hasAboutOrTeamLink = allLinks.some(link => {
    const text = (link.innerText || "").toLowerCase().trim();
    const href = (link.getAttribute("href") || "").toLowerCase().trim();
    return aboutKeywords.some(kw => text === kw || href.includes(kw.replace(/\s+/g, '-')) || href.includes(kw.replace(/\s+/g, '')));
  });

  const adSelectors = [
    'iframe[src*="doubleclick"]',
    'iframe[src*="googlesyndication"]',
    'div[id*="google_ads"]',
    'div[class*="ad-slot"]',
    'div[class*="ad-banner"]',
    'div[class*="adsbygoogle"]',
    'div[id*="taboola"]',
    'div[id*="outbrain"]',
    '.trc_rbox_container'
  ];
  const detectedAds = document.querySelectorAll(adSelectors.join(','));
  const adCount = detectedAds.length;

  const hasAutoplayVideo = !!document.querySelector('video[autoplay], video[data-autoplay]');
  const quotesCount = (bodyText.match(/"([^"]{10,})"/g) || []).length;
  
  // 1. Selector check (standard classes, schema tags, AP/CNN/NYT custom components)
  const bylineSelectors = [
    '[rel="author"]',
    'meta[name="author"]',
    'meta[property="article:author"]',
    '.byline',
    '.author',
    '[itemprop="author"]',
    '[class*="byline" i]',
    '[class*="author" i]',
    '[data-testid*="author" i]',
    'span[class*="Component-author"]',
    'div[class*="Page-authors"]'
  ];

  let hasByline = !!document.querySelector(bylineSelectors.join(','));

  // 2. Text-pattern fallback (catches "By  JOCELYN NOVECK", "By John Doe", etc.)
  if (!hasByline) {
    const sampleText = Array.from(document.querySelectorAll('header, [class*="header"], h1, h2, p, span'))
      .slice(0, 15)
      .map(el => el.innerText)
      .join(' ')
      .replace(/\u00a0/g, ' '); // Normalize non-breaking spaces

    // Matches "By [Name]" in Title Case OR ALL-CAPS (e.g., By JOCELYN NOVECK)
    const bylinePattern = /\b(?:by|reporting by|written by)\s+([A-Z][a-zA-Z\.'-]+(?:\s+[A-Z][a-zA-Z\.'-]+){1,3})\b/;
    hasByline = bylinePattern.test(sampleText);
  }

  // 3. Structured Data / JSON-LD fallback (AP News, NYT, and Reuters embed this on every story)
  if (!hasByline) {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const json = JSON.parse(script.textContent);
        const authors = json.author || (json['@graph'] && json['@graph'].find(item => item.author)?.author);
        if (authors && (typeof authors === 'string' || authors.name || (Array.isArray(authors) && authors.length > 0))) {
          hasByline = true;
          break;
        }
      } catch (e) {
        // Skip malformed JSON
      }
    }
  }

  return {
    hostname: currentHost,
    headline: headline,
    bodyText: bodyText,
    paragraphCount: paragraphs.length,
    externalLinksCount: externalLinks.length,
    quotesCount: quotesCount,
    hasByline: hasByline,
    hasAboutOrTeamLink: hasAboutOrTeamLink,
    adCount: adCount,
    hasAutoplayVideo: hasAutoplayVideo
  };
}

function levenshteinDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[a.length][b.length];
}

function checkTyposquatting(currentDomain, trustedList) {
  const parts = currentDomain.split('.');
  const root = parts.length > 2 ? parts.slice(-2).join('.') : currentDomain;
  const rootName = root.split('.')[0];

  for (const trusted of trustedList) {
    if (root === trusted || currentDomain.endsWith('.' + trusted)) {
      return null;
    }

    const trustedName = trusted.split('.')[0];

    if (trustedName.length >= 4) {
      const dist = levenshteinDistance(rootName, trustedName);
      if (dist >= 1 && dist <= 2) {
        return { type: "misspelling", target: trusted };
      }
    }

    if (rootName.includes(trustedName) && rootName !== trustedName) {
      return { type: "deceptive_name", target: trusted };
    }
  }

  return null;
}

function prioritizeSignals(signals) {
  const order = { '🚨': 1, '⚠️': 1, '✅': 2, '🏛️': 2, '🔒': 2, 'ℹ️': 3 };
  return [...signals].sort((a, b) => (order[a.icon] || 2) - (order[b.icon] || 2));
}

function evaluateContent(data, sensationalWords) {
  let score = 70;
  const domainSignals = [];
  const contentSignals = [];

  const TRUSTED_DOMAINS = [
    "reuters.com", "apnews.com", "bbc.com", "bbc.co.uk", "npr.org", 
    "wsj.com", "nytimes.com", "theguardian.com", "wikipedia.org", "nature.com"
  ];
  const SUSPICIOUS_TLDS = [".xyz", ".top", ".info", ".buzz", ".click", ".news"];

  const isGov = data.hostname.endsWith('.gov') || data.hostname.includes('.gov.');
  const isTrusted = TRUSTED_DOMAINS.some(domain => data.hostname === domain || data.hostname.endsWith('.' + domain));
  const hasSuspiciousTLD = SUSPICIOUS_TLDS.some(tld => data.hostname.endsWith(tld));
  const typosquatMatch = checkTyposquatting(data.hostname, TRUSTED_DOMAINS);

  // 1. Domain Credibility
  if (isGov) {
    score += 25;
    domainSignals.push({ icon: "🏛️", text: "Verified official government domain (.gov)" });
  } else if (typosquatMatch) {
    score -= 40;
    domainSignals.push({ 
      icon: "🚨", 
      text: `Potential typosquatting impersonating ${typosquatMatch.target}` 
    });
  } else if (isTrusted) {
    score += 15;
    domainSignals.push({ icon: "✅", text: "Recognized legitimate news outlet" });
  } else if (hasSuspiciousTLD) {
    score -= 20;
    domainSignals.push({ icon: "⚠️", text: "Domain uses high-risk suspicious TLD" });
  } else {
    domainSignals.push({ icon: "ℹ️", text: `Unverified domain: ${data.hostname}` });
  }

  // Domain Age Check
  if (data.domainAgeDays !== null && data.domainAgeDays !== undefined) {
    const ageInYears = (data.domainAgeDays / 365).toFixed(1);

    if (data.domainAgeDays < 180) {
      score -= 25;
      domainSignals.push({
        icon: "⚠️",
        text: `Extremely new domain (${data.domainAgeDays} days old — high risk)`
      });
    } else if (data.domainAgeDays < 365) {
      score -= 10;
      domainSignals.push({
        icon: "⚠️",
        text: `Domain is under 1 year old (${data.domainAgeDays} days)`
      });
    } else {
      score += 5;
      domainSignals.push({
        icon: "✅",
        text: `Established domain (${ageInYears} years active)`
      });
    }
  } else if (!isGov) {
    domainSignals.push({
      icon: "ℹ️",
      text: "Domain age private or unavailable via RDAP"
    });
  }

  // Masthead / Transparency Check
  if (data.hasAboutOrTeamLink) {
    score += 5;
    domainSignals.push({ icon: "✅", text: "Public About Us / Editorial Team page present" });
  } else if (!isGov) {
    score -= 10;
    domainSignals.push({ icon: "⚠️", text: "No transparent About Us or Masthead link found" });
  }

  // HTTPS Security
  if (data.isHttps) {
    domainSignals.push({ icon: "🔒", text: "Secure encrypted protocol (HTTPS)" });
  } else {
    score -= 25;
    domainSignals.push({ icon: "⚠️", text: "Insecure protocol connection (HTTP)" });
  }

  // Ad Density & Farm Signals
  if (data.adCount >= 6 || (data.paragraphCount > 0 && data.adCount / data.paragraphCount > 1.2)) {
    score -= 20;
    domainSignals.push({ 
      icon: "⚠️", 
      text: `Aggressive ad density detected (${data.adCount} ad units/widgets)` 
    });
  } else if (data.adCount >= 3) {
    score -= 5;
    domainSignals.push({ icon: "ℹ️", text: `Moderate advertising density (${data.adCount} units)` });
  } else {
    domainSignals.push({ icon: "✅", text: "Clean reading layout (low ad intrusion)" });
  }

  if (data.hasAutoplayVideo) {
    score -= 10;
    domainSignals.push({ icon: "⚠️", text: "Intrusive autoplay video player present" });
  }

  // 2. Cross-Referencing Signals
  if (data.crossRef && data.crossRef.status === "success") {
    if (data.crossRef.count >= 3) {
      score += 15;
      const sample = data.crossRef.sources.join(", ");
      contentSignals.push({ 
        icon: "✅", 
        text: `Corroborated by multiple outlets (${data.crossRef.count}+ reporting: ${sample})` 
      });
    } else if (data.crossRef.count === 1 || data.crossRef.count === 2) {
      score += 5;
      contentSignals.push({ 
        icon: "ℹ️", 
        text: `Limited secondary coverage (${data.crossRef.sources.join(", ")})` 
      });
    } else {
      score -= 20;
      contentSignals.push({ 
        icon: "⚠️", 
        text: "Isolated report: zero corroboration found from other news outlets" 
      });
    }
  }

  // 3. Bot Amplification / Burner Domain Pattern
  const isBurnerDomain = data.domainAgeDays !== null && data.domainAgeDays < 90;
  const lacksIdentity = !data.hasByline && !data.hasAboutOrTeamLink;
  const isUncorroborated = data.crossRef && data.crossRef.count === 0;

  if (isBurnerDomain && lacksIdentity && isUncorroborated) {
    score -= 25;
    contentSignals.push({
      icon: "🚨",
      text: "Bot amplification pattern: Fresh burner domain with uncorroborated viral claim"
    });
  }

  // 4. Sensational Words
  const fullText = (data.headline + " " + data.bodyText);
  const matchedWords = [];
  sensationalWords.forEach(word => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(fullText)) {
      matchedWords.push(word);
    }
  });

  if (matchedWords.length > 0) {
    const penalty = Math.min(matchedWords.length * 8, 35);
    score -= penalty;
    contentSignals.push({ icon: "⚠️", text: `Loaded language detected (${matchedWords.length} terms, e.g. "${matchedWords[0]}")` });
  } else {
    score += 5;
    contentSignals.push({ icon: "✅", text: "No sensationalist buzzwords found" });
  }

  // 5. Headline Caps
  const lettersOnly = data.headline.replace(/[^a-zA-Z]/g, '');
  if (lettersOnly.length > 0) {
    const caps = (data.headline.replace(/[^A-Z]/g, '').length / lettersOnly.length) * 100;
    if (caps > 35) {
      score -= 15;
      contentSignals.push({ icon: "⚠️", text: "Excessive capitalization in headline" });
    }
  }

  // 6. Bylines & Quotes
  if (data.hasByline) {
    score += 10;
    contentSignals.push({ icon: "✅", text: "Verified author/reporter byline present" });
  } else if (isGov) {
    score += 5;
    contentSignals.push({ icon: "🏛️", text: "Official public sector agency report (no individual byline needed)" });
  } else {
    score -= 10;
    contentSignals.push({ icon: "⚠️", text: "Anonymous or missing reporter byline" });
  }

  if (data.quotesCount >= 2) {
    score += 10;
    contentSignals.push({ icon: "✅", text: `Direct quotes and statements found (${data.quotesCount})` });
  } else if (data.quotesCount === 0 && !isGov) {
    score -= 10;
    contentSignals.push({ icon: "⚠️", text: "No direct quotes or primary witnesses" });
  }

  const finalScore = Math.max(5, Math.min(99, score));
  
  return { 
    finalScore, 
    domainSignals: prioritizeSignals(domainSignals), 
    contentSignals: prioritizeSignals(contentSignals), 
    matchedWords 
  };
}
