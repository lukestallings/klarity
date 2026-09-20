document.addEventListener('DOMContentLoaded', () => {
  const headlineEl = document.getElementById('headline');
  const riskBadge = document.getElementById('riskBadge');
  const scoreVal = document.getElementById('scoreVal');
  const scoreBar = document.getElementById('scoreBar');
  const domainList = document.getElementById('domainSignals');
  const contentList = document.getElementById('contentSignals');
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
      riskBadge.innerText = "SCANNING";
      riskBadge.className = "status-badge badge-warn";
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

      const domainAgeDays = await getDomainAgeInDays(data.hostname);
      data.domainAgeDays = domainAgeDays;

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

    } catch (err) {
      console.error(err);
      if (scoreBar) scoreBar.classList.remove('is-loading');
      if (headlineEl) headlineEl.innerText = "Scan Failed";
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
  const hasByline = !!(
    document.querySelector('[rel="author"]') ||
    document.querySelector('meta[name="author"]') ||
    document.querySelector('.byline, .author, [itemprop="author"]')
  );

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

// Priority sorting helper:
// 1 = High-risk warnings (🚨, ⚠️)
// 2 = Positives (✅, 🏛️, 🔒)
// 3 = Neutral informational notices (ℹ️)
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

  // 1. Domain Evaluation
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

  // About Us / Editorial Team Link Verification
  if (data.hasAboutOrTeamLink) {
    score += 5;
    domainSignals.push({ icon: "✅", text: "Public About Us / Editorial Team page present" });
  } else if (!isGov) {
    score -= 10;
    domainSignals.push({ icon: "⚠️", text: "No transparent About Us or Masthead link found" });
  }

  // Protocol Check
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

  // 2. Sensational Words
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

  // 3. Headline Caps
  const lettersOnly = data.headline.replace(/[^a-zA-Z]/g, '');
  if (lettersOnly.length > 0) {
    const caps = (data.headline.replace(/[^A-Z]/g, '').length / lettersOnly.length) * 100;
    if (caps > 35) {
      score -= 15;
      contentSignals.push({ icon: "⚠️", text: "Excessive capitalization in headline" });
    }
  }

  // 4. Bylines & Quotes
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
  
  // Sort signals so warnings are at the top and neutral info (ℹ️) is pushed to the bottom
  return { 
    finalScore, 
    domainSignals: prioritizeSignals(domainSignals), 
    contentSignals: prioritizeSignals(contentSignals), 
    matchedWords 
  };
}
