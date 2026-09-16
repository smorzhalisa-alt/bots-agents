const contentEl = document.getElementById("content");
const statusEl = document.getElementById("status");
const rawEl = document.getElementById("raw");

function esc(s) {
  if (!s) return "";
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
}

// ── Render helpers ────────────────────────────────────────────

function renderHomework(store) {
  // Combine API captures + DOM scrapes
  const entries = [...(store.homework_api || []), ...(store.homework_dom || []), ...(store.diary || [])];
  if (!entries.length) return "";

  let html = '<div class="section"><div class="section-title">Домашние задания</div>';

  const seen = new Set();
  for (const entry of entries) {
    const items = entry.data?.payload || entry.data?.items || (Array.isArray(entry.data) ? entry.data : []);
    for (const h of items.slice(0, 30)) {
      const subj = h.subject_name || h.subject || "";
      const desc = h.description || h.raw_text || "";
      const key = subj + desc.slice(0, 50);
      if (seen.has(key) || (!subj && !desc)) continue;
      seen.add(key);

      const date = h.date || "";
      const done = h.is_done;

      html += `<div class="item ${done ? 'done' : ''}">
        <div class="item-subject">${esc(subj)}</div>
        ${desc ? `<div class="item-desc">${esc(desc.slice(0, 200))}</div>` : ""}
        ${date ? `<div class="item-date">${esc(String(date).slice(0, 10))}</div>` : ""}
      </div>`;
    }
  }

  return html + "</div>";
}

function renderMarks(store) {
  const entries = [...(store.marks_api || []), ...(store.marks_dom || [])];
  if (!entries.length) return "";

  let html = '<div class="section"><div class="section-title">Оценки</div>';

  const bySubject = {};
  const seen = new Set();

  for (const entry of entries) {
    const items = entry.data?.payload || entry.data?.items || (Array.isArray(entry.data) ? entry.data : []);
    for (const m of items) {
      const subj = m.subject_name || m.subject || "?";
      const val = m.value || m.grade;
      if (!val) continue;

      const key = subj + val + (m.date || m.point_date || "");
      if (seen.has(key)) continue;
      seen.add(key);

      if (!bySubject[subj]) bySubject[subj] = [];
      bySubject[subj].push({ value: val, weight: m.weight, type: m.type || m.control_form_name });
    }
  }

  for (const [subj, vals] of Object.entries(bySubject)) {
    const nums = vals.map(v => parseFloat(v.value)).filter(n => !isNaN(n));
    const avg = nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1) : "";

    html += `<div class="marks-row">
      <span class="subj">${esc(subj)}</span>
      <span class="vals">${vals.map(v =>
        `<span class="mark mark-${v.value}" title="${esc(v.type || '')}">${v.value}</span>`
      ).join("")}</span>
      ${avg ? `<span class="avg">${avg}</span>` : ""}
    </div>`;
  }

  return html + "</div>";
}

function renderSchedule(store) {
  const entries = [...(store.schedule_api || []), ...(store.schedule_dom || [])];
  if (!entries.length) return "";

  let html = '<div class="section"><div class="section-title">Расписание</div>';

  const seen = new Set();
  for (const entry of entries.slice(0, 3)) {
    const items = entry.data?.response || entry.data?.payload || entry.data?.items || (Array.isArray(entry.data) ? entry.data : []);
    for (const ev of items.slice(0, 15)) {
      const subj = ev.subject_name || ev.subject || ev.title || "";
      if (!subj) continue;
      const key = subj + (ev.start || ev.start_at || "");
      if (seen.has(key)) continue;
      seen.add(key);

      const start = ev.start || (ev.start_at ? String(ev.start_at).slice(11, 16) : "");
      const end = ev.end || (ev.finish_at ? String(ev.finish_at).slice(11, 16) : "");
      const room = ev.room_number || ev.room || "";

      html += `<div class="item">
        <div class="item-subject">${esc(subj)}</div>
        <div class="item-desc">${start && end ? start + "–" + end : ""} ${room ? "каб. " + esc(room) : ""}</div>
      </div>`;
    }
  }

  return html + "</div>";
}

function renderFeed(store) {
  const entries = store.feed_dom || [];
  if (!entries.length) return "";

  let html = '<div class="section"><div class="section-title">Лента</div>';
  for (const entry of entries.slice(0, 2)) {
    const feed = entry.data?.items || entry.data;
    if (!feed) continue;

    if (feed.dates) {
      html += `<div class="item-desc">${feed.dates.slice(0, 3).map(d => esc(d)).join(" · ")}</div>`;
    }
    if (feed.marks) {
      for (const m of feed.marks.slice(0, 10)) {
        html += `<div class="item"><span class="mark mark-${m.value}">${m.value}</span> ${esc(m.subject)}</div>`;
      }
    }
    if (feed.homework) {
      for (const h of feed.homework.slice(0, 5)) {
        html += `<div class="item"><div class="item-desc">${esc(h.raw_text)}</div></div>`;
      }
    }
  }

  return html + "</div>";
}

// ── Main render ───────────────────────────────────────────────

function render(store) {
  if (!store || !store._last_update) {
    contentEl.innerHTML = `<div class="empty">
      Открой <b>Моя Школа</b> и полистай дневник — данные появятся тут автоматически.
    </div>`;
    statusEl.textContent = "ждём";
    statusEl.className = "status";
    return;
  }

  const t = new Date(store._last_update);
  statusEl.textContent = t.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
  statusEl.className = "status active";

  let html = "";
  html += renderSchedule(store);
  html += renderHomework(store);
  html += renderMarks(store);
  html += renderFeed(store);

  if (!html) {
    const keys = Object.keys(store).filter(k => !k.startsWith("_"));
    html = `<div class="empty">
      Данные ловим (${keys.join(", ") || "пусто"}), но пока не нашли ДЗ/оценки/расписание.
      Полистай страницы Задания, Оценки, Расписание.
    </div>`;
  }

  contentEl.innerHTML = html;
  rawEl.textContent = JSON.stringify(store, null, 2);
}

// ── Init ──────────────────────────────────────────────────────

chrome.storage.local.get(["goose_data"], (result) => {
  render(result.goose_data);
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.goose_data) render(changes.goose_data.newValue);
});

document.getElementById("show-raw").addEventListener("click", () => {
  rawEl.style.display = rawEl.style.display === "none" ? "block" : "none";
});

document.getElementById("export-btn").addEventListener("click", () => {
  chrome.storage.local.get(["goose_data"], (result) => {
    const data = result.goose_data;
    if (!data) return;

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `goose_school_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
});

document.getElementById("clear-btn").addEventListener("click", () => {
  if (confirm("Очистить все данные?")) {
    chrome.storage.local.remove("goose_data", () => {
      render(null);
      rawEl.textContent = "";
    });
  }
});
