// Goose School — content script
// Two capture strategies:
// 1. Intercept fetch/XHR API calls (structured JSON — best quality)
// 2. DOM scraping as fallback (reads what's rendered on screen)
// Both run simultaneously. SPA navigation is watched via MutationObserver.

// ── Storage ───────────────────────────────────────────────────

function saveData(key, data, source) {
  const entry = {
    data,
    source,
    captured_at: new Date().toISOString(),
  };

  chrome.storage.local.get(["goose_data"], (result) => {
    const store = result.goose_data || {};
    if (!store[key]) store[key] = [];

    // Deduplicate by source, keep last 100
    store[key] = store[key].filter(e => e.source !== source);
    store[key].unshift(entry);
    store[key] = store[key].slice(0, 100);
    store._last_update = new Date().toISOString();
    store._page = document.title;

    chrome.storage.local.set({ goose_data: store });
    console.log("[Goose]", key, "captured:", typeof data === "object" ? JSON.stringify(data).slice(0, 120) + "..." : data);
  });
}

// ── Strategy 1: API Interception ──────────────────────────────

const API_PATTERNS = [
  { pattern: /\/family\/mobile\/v1\/homeworks/,         key: "homework_api" },
  { pattern: /\/family\/mobile\/v1\/marks/,             key: "marks_api" },
  { pattern: /\/api\/eventcalendar\/v1\/api\/events/,   key: "schedule_api" },
  { pattern: /\/family\/mobile\/v1\/visits/,            key: "visits_api" },
  { pattern: /\/family\/mobile\/v1\/profile/,           key: "profile_api" },
  { pattern: /\/family\/mobile\/v1\/subjects/,          key: "subjects_api" },
  { pattern: /\/acl\/api\/users/,                       key: "profile_api" },
  { pattern: /\/lms\/api\/sessions/,                    key: "session_api" },
  { pattern: /homework/i, key: "homework_api" },
  { pattern: /mark/i,     key: "marks_api" },
  { pattern: /event/i,    key: "schedule_api" },
  { pattern: /schedule/i, key: "schedule_api" },
  { pattern: /lesson/i,   key: "schedule_api" },
  { pattern: /rating/i,   key: "rating_api" },
];

function classifyUrl(url) {
  for (const { pattern, key } of API_PATTERNS) {
    if (pattern.test(url)) return key;
  }
  return null;
}

const injected = document.createElement("script");
injected.textContent = `
(function() {
  const EV = "__goose_api_capture__";

  const origFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
      if (url && /\\/api\\/|family|v1|lms|acl|eventcalendar|homework|mark|schedule|lesson/i.test(url)) {
        const clone = response.clone();
        clone.text().then(text => {
          try {
            const json = JSON.parse(text);
            window.dispatchEvent(new CustomEvent(EV, { detail: { url, data: json } }));
          } catch(e) {}
        }).catch(() => {});
      }
    } catch(e) {}
    return response;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__goose_url = url;
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener("load", function() {
      try {
        const url = this.__goose_url || "";
        if (url && /\\/api\\/|family|v1|lms|acl|eventcalendar|homework|mark|schedule|lesson/i.test(url)) {
          const json = JSON.parse(this.responseText);
          window.dispatchEvent(new CustomEvent(EV, { detail: { url, data: json } }));
        }
      } catch(e) {}
    });
    return origSend.apply(this, args);
  };
})();
`;
(document.head || document.documentElement).appendChild(injected);
injected.remove();

window.addEventListener("__goose_api_capture__", (e) => {
  const { url, data } = e.detail;
  const key = classifyUrl(url);
  if (key) saveData(key, data, url);
});

// ── Strategy 2: DOM Scraping ──────────────────────────────────
// Based on actual Моя Школа page structure (Sep 2026)

function detectPage() {
  const url = location.href;
  const title = document.title.toLowerCase();
  const h = document.querySelector("h1, [class*=title]");
  const heading = h ? h.textContent.trim() : "";

  if (/задани/i.test(heading) || /task/i.test(url))    return "homework";
  if (/расписани/i.test(heading) || /schedule/i.test(url)) return "schedule";
  if (/оценк/i.test(heading) || /mark/i.test(url))     return "marks";
  if (/лент/i.test(heading) || /feed/i.test(url))       return "feed";
  return null;
}

function scrapeHomework() {
  // Задания page: cards with subject name (bold) + description text + checkmark
  const items = [];
  const cards = document.querySelectorAll("[class*=card], [class*=task], [class*=homework], [class*=item]");

  cards.forEach(card => {
    const text = card.innerText.trim();
    if (!text || text.length < 5) return;

    // Look for subject-like patterns
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length < 1) return;

    const subjectMatch = lines[0].match(/^(Математик|Алгебр|Геометри|Русский|Литератур|Английск|Иностранн|Физик|Хими|Биолог|Истори|Обществ|Географ|Информатик|Труд|Физкультур|Музык|ОБЖ|Курс по выбору|Технолог).*/i);
    if (subjectMatch) {
      items.push({
        subject: lines[0],
        description: lines.slice(1).join(" ").slice(0, 500),
        raw_text: text.slice(0, 600),
      });
    }
  });

  // Fallback: just grab all visible text blocks that mention school subjects
  if (items.length === 0) {
    const allText = document.body.innerText;
    const subjectRegex = /(Математик|Алгебр|Геометри|Русский язык|Литератур|Иностранный язык|Физик|Хими|Биолог|Истори|Обществознани|Географ|Информатик)[^\n]*/gi;
    let match;
    while ((match = subjectRegex.exec(allText)) !== null) {
      items.push({ raw_text: match[0].slice(0, 300) });
    }
  }

  return items;
}

function scrapeSchedule() {
  // Расписание page: list of lessons with subject + time range
  const items = [];
  const cards = document.querySelectorAll("[class*=card], [class*=lesson], [class*=schedule], [class*=item]");

  cards.forEach(card => {
    const text = card.innerText.trim();
    // Match "Subject\nHH:MM—HH:MM" or "HH:MM—HH:MM\nSubject"
    const timeMatch = text.match(/(\d{1,2}:\d{2})\s*[—–-]\s*(\d{1,2}:\d{2})/);
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

    if (timeMatch && lines.length >= 1) {
      const subjectLine = lines.find(l => !/^\d{1,2}:\d{2}/.test(l) && l.length > 2);
      items.push({
        subject: subjectLine || lines[0],
        start: timeMatch[1],
        end: timeMatch[2],
        raw_text: text.slice(0, 200),
      });
    }
  });

  return items;
}

function scrapeMarks() {
  // Оценки page: mark value in circle + subject + type + date
  const items = [];
  const body = document.body.innerText;

  // Match patterns like "5\nИнформатика\nОтвет на уроке\n15:25" or "4\n1.2\nРусский язык"
  const markRegex = /\b([2-5])\s*\n\s*(?:\d\.\d\s*\n\s*)?(Математик|Алгебр|Геометри|Русский|Литератур|Английск|Иностранн|Физик|Хими|Биолог|Истори|Обществ|Географ|Информатик|Труд|Физкультур|Музык|Курс[^\n]*)[^\n]*(?:\n([^\n]{3,50}))?/gi;

  let match;
  while ((match = markRegex.exec(body)) !== null) {
    items.push({
      value: match[1],
      subject: match[2].trim(),
      type: match[3] ? match[3].trim() : null,
    });
  }

  // Also try card-based approach
  document.querySelectorAll("[class*=card], [class*=mark], [class*=grade], [class*=item]").forEach(card => {
    const text = card.innerText.trim();
    const valMatch = text.match(/^([2-5])\b/);
    if (valMatch) {
      const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 2);
      items.push({
        value: valMatch[1],
        subject: lines.find(l => !/^[2-5]$/.test(l) && !/^\d\.\d$/.test(l) && !/^\d{2}:\d{2}$/.test(l)) || "",
        raw_text: text.slice(0, 200),
      });
    }
  });

  return items;
}

function scrapeFeed() {
  // Лента page: mixed feed of marks + homework grouped by date
  const sections = [];
  const body = document.body.innerText;

  // Extract date headers
  const dateHeaders = body.match(/(Сегодня|Вчера|Завтра|\d{1,2}\s+(январ|феврал|март|апрел|ма[яй]|июн|июл|август|сентябр|октябр|ноябр|декабр)\w*)[^\n]*/gi) || [];

  // Grab marks from feed
  const marks = scrapeMarks();

  // Grab homework mentions
  const hwMatches = body.match(/Домашн[^\n]*\n[^\n]+/gi) || [];
  const homework = hwMatches.map(m => ({ raw_text: m.slice(0, 300) }));

  return { dates: dateHeaders, marks, homework };
}

function runScrape() {
  const page = detectPage();
  if (!page) return;

  let data;
  switch (page) {
    case "homework": data = scrapeHomework(); break;
    case "schedule": data = scrapeSchedule(); break;
    case "marks":    data = scrapeMarks(); break;
    case "feed":     data = scrapeFeed(); break;
    default: return;
  }

  if (!data || (Array.isArray(data) && data.length === 0)) return;

  saveData(page + "_dom", {
    page,
    url: location.href,
    title: document.title,
    date: new Date().toISOString().slice(0, 10),
    items: data,
  }, location.href + "#dom_" + page);
}

// ── SPA Navigation Watch ──────────────────────────────────────
// Моя Школа is an SPA — URL changes without page reload.

let lastUrl = location.href;

function onNavigate() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    // Wait for new content to render
    setTimeout(runScrape, 2000);
    setTimeout(runScrape, 5000);
  }
}

// Watch for URL changes
new MutationObserver(onNavigate).observe(document.documentElement, {
  childList: true,
  subtree: true,
});

// Also listen for popstate (back/forward)
window.addEventListener("popstate", () => setTimeout(onNavigate, 500));

// Initial scrape after page load
window.addEventListener("load", () => {
  setTimeout(runScrape, 3000);
  setTimeout(runScrape, 8000);
});

// Periodic re-scrape (catches dynamic content loading)
setInterval(runScrape, 30000);
