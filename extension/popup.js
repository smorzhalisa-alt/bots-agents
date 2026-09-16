const contentEl = document.getElementById("content");
const statusEl = document.getElementById("status");
const rawEl = document.getElementById("raw");

function esc(s) {
  if (!s) return "";
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function renderHomework(entries) {
  if (!entries || !entries.length) return "";

  let html = '<div class="section"><div class="section-title">Homework</div>';

  for (const entry of entries.slice(0, 5)) {
    const data = entry.data;
    if (!data) continue;

    const items = data.payload || data.items || (Array.isArray(data) ? data : []);
    for (const h of items.slice(0, 20)) {
      const subj = h.subject_name || h.subject || "";
      const desc = h.description || h.text || "";
      const date = h.date || h.date_assigned_on || "";
      if (!subj && !desc) continue;

      html += `<div class="item">
        <div class="item-subject">${esc(subj)}</div>
        ${desc ? `<div class="item-desc">${esc(desc.slice(0, 200))}</div>` : ""}
        ${date ? `<div class="item-date">${esc(String(date).slice(0, 10))}</div>` : ""}
      </div>`;
    }
  }

  return html + "</div>";
}

function renderMarks(entries) {
  if (!entries || !entries.length) return "";

  let html = '<div class="section"><div class="section-title">Marks</div>';

  const bySubject = {};

  for (const entry of entries.slice(0, 5)) {
    const data = entry.data;
    if (!data) continue;

    const items = data.payload || data.items || (Array.isArray(data) ? data : []);
    for (const m of items) {
      const subj = m.subject_name || m.subject || "?";
      const val = m.value || m.grade;
      if (!val) continue;
      if (!bySubject[subj]) bySubject[subj] = [];
      bySubject[subj].push(val);
    }
  }

  for (const [subj, vals] of Object.entries(bySubject)) {
    html += `<div class="marks-row">
      <span class="subj">${esc(subj)}</span>
      <span class="vals">${vals.map(v => `<span class="mark mark-${v}">${v}</span>`).join("")}</span>
    </div>`;
  }

  return html + "</div>";
}

function renderSchedule(entries) {
  if (!entries || !entries.length) return "";

  let html = '<div class="section"><div class="section-title">Schedule</div>';

  for (const entry of entries.slice(0, 3)) {
    const data = entry.data;
    if (!data) continue;

    const items = data.response || data.payload || data.items || (Array.isArray(data) ? data : []);
    for (const ev of items.slice(0, 15)) {
      const subj = ev.subject_name || ev.title || "";
      const start = ev.start_at || ev.begin_date || "";
      const room = ev.room_number || ev.room || "";
      if (!subj) continue;

      html += `<div class="item">
        <div class="item-subject">${esc(subj)}</div>
        <div class="item-desc">${start ? esc(String(start).slice(11, 16)) : ""} ${room ? "каб. " + esc(room) : ""}</div>
      </div>`;
    }
  }

  return html + "</div>";
}

function render(store) {
  if (!store || !store._last_update) {
    contentEl.innerHTML = '<div class="empty">Open Моя Школа and browse your diary — data will appear here automatically.</div>';
    statusEl.textContent = "waiting";
    statusEl.className = "status";
    return;
  }

  statusEl.textContent = "last: " + new Date(store._last_update).toLocaleTimeString("ru");
  statusEl.className = "status active";

  let html = "";
  html += renderSchedule(store.schedule);
  html += renderHomework(store.homework || store.diary);
  html += renderMarks(store.marks);

  if (!html) {
    html = '<div class="empty">Data captured but no homework/marks/schedule found yet. Keep browsing.</div>';
  }

  contentEl.innerHTML = html;
  rawEl.textContent = JSON.stringify(store, null, 2);
}

chrome.storage.local.get(["goose_data"], (result) => {
  render(result.goose_data);
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.goose_data) {
    render(changes.goose_data.newValue);
  }
});

document.getElementById("show-raw").addEventListener("click", () => {
  rawEl.style.display = rawEl.style.display === "none" ? "block" : "none";
});

document.getElementById("clear-btn").addEventListener("click", () => {
  chrome.storage.local.remove("goose_data", () => {
    render(null);
    rawEl.textContent = "";
  });
});
