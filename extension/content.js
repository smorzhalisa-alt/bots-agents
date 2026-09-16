// Goose School — content script
// Intercepts API responses from Моя Школа / МЭШ / dnevnik to capture
// homework, schedule, and marks data automatically.

const API_PATTERNS = [
  { pattern: /\/family\/mobile\/v1\/homeworks/, key: "homework" },
  { pattern: /\/family\/mobile\/v1\/marks/,     key: "marks" },
  { pattern: /\/api\/eventcalendar\/v1\/api\/events/, key: "schedule" },
  { pattern: /\/family\/mobile\/v1\/visits/,    key: "visits" },
  { pattern: /\/family\/mobile\/v1\/profile/,   key: "profile" },
  { pattern: /homeworks/i, key: "homework" },
  { pattern: /marks/i,     key: "marks" },
  { pattern: /events/i,    key: "schedule" },
  { pattern: /schedule/i,  key: "schedule" },
  { pattern: /diary/i,     key: "diary" },
];

function classifyUrl(url) {
  for (const { pattern, key } of API_PATTERNS) {
    if (pattern.test(url)) return key;
  }
  return null;
}

function saveData(key, data, url) {
  const entry = {
    data,
    url,
    captured_at: new Date().toISOString(),
  };

  chrome.storage.local.get(["goose_data"], (result) => {
    const store = result.goose_data || {};
    if (!store[key]) store[key] = [];

    // Keep last 50 captures per key, deduplicate by URL
    store[key] = store[key].filter(e => e.url !== url);
    store[key].unshift(entry);
    store[key] = store[key].slice(0, 50);

    store._last_update = new Date().toISOString();

    chrome.storage.local.set({ goose_data: store });
  });
}

// Inject a script into the page context to intercept fetch and XHR.
// Content scripts can't see page-initiated network responses directly.
const injected = document.createElement("script");
injected.textContent = `
(function() {
  const GOOSE_EVENT = "__goose_api_capture__";

  // Wrap fetch
  const origFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
      if (url && (url.includes("/api/") || url.includes("/family/") || url.includes("/v1/"))) {
        const clone = response.clone();
        clone.json().then(json => {
          window.dispatchEvent(new CustomEvent(GOOSE_EVENT, {
            detail: { url, data: json }
          }));
        }).catch(() => {});
      }
    } catch(e) {}
    return response;
  };

  // Wrap XMLHttpRequest
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
        if (url && (url.includes("/api/") || url.includes("/family/") || url.includes("/v1/"))) {
          const json = JSON.parse(this.responseText);
          window.dispatchEvent(new CustomEvent(GOOSE_EVENT, {
            detail: { url, data: json }
          }));
        }
      } catch(e) {}
    });
    return origSend.apply(this, args);
  };
})();
`;
(document.head || document.documentElement).appendChild(injected);
injected.remove();

// Listen for captured API responses from the page context
window.addEventListener("__goose_api_capture__", (e) => {
  const { url, data } = e.detail;
  const key = classifyUrl(url);
  if (key) {
    saveData(key, data, url);
    console.log("[Goose]", key, "captured from", url);
  }
});

// Also do a DOM scrape when the page finishes loading,
// as a fallback for data that doesn't come through API calls.
window.addEventListener("load", () => {
  setTimeout(scrapePage, 3000);
});

function scrapePage() {
  const body = document.body;
  if (!body) return;

  // Look for homework-like content in the DOM
  const textContent = body.innerText;

  // Simple heuristic: if the page has subject-like words + dates, capture it
  const hasSubjects = /математик|русск|англ|физик|хими|биолог|истори|географ|литератур|информатик|обществ/i.test(textContent);
  const hasDates = /\d{1,2}\.\d{1,2}\.\d{4}|\d{1,2}\s+(январ|феврал|март|апрел|ма[яй]|июн|июл|август|сентябр|октябр|ноябр|декабр)/i.test(textContent);

  if (hasSubjects || hasDates) {
    // Capture structured snippets from the page
    const items = [];

    // Try common diary/homework DOM patterns
    document.querySelectorAll("[class*=homework], [class*=lesson], [class*=diary], [class*=task], [class*=schedule], [class*=mark], [class*=grade]").forEach(el => {
      items.push({
        tag: el.tagName,
        classes: el.className,
        text: el.innerText.slice(0, 500),
      });
    });

    if (items.length > 0) {
      saveData("dom_scrape", {
        url: window.location.href,
        title: document.title,
        items,
      }, window.location.href);
      console.log("[Goose] DOM scrape captured", items.length, "elements");
    }
  }
}
