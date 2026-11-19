/**
 * admin-workflow.js
 * -----------------
 * Wires the admin panels that verify, arrange and link user-entered data:
 * genealogy contributions, people, CSV import, branches and dashboard.
 * Loaded on admin.html only.  All calls are authenticated via cookies.
 */
(function () {
  "use strict";

  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));

  async function api(url, options = {}) {
    const res = await fetch(url, { credentials: "include", ...options });
    let data = {};
    try { data = await res.json(); } catch (_) { /* no body */ }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function postJSON(url, body) {
    return api(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
  }

  function patchJSON(url, body) {
    return api(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
  }

  function pager(container, total, limit, offset, onPage) {
    if (!container) return;
    const pages = Math.max(1, Math.ceil(total / limit));
    const current = Math.floor(offset / limit) + 1;
    if (pages <= 1) { container.innerHTML = ""; return; }
    container.innerHTML = `
      <button type="button" data-page="${current - 1}" ${current === 1 ? "disabled" : ""}>← पिछला</button>
      <span>${current} / ${pages} · ${total} रिकॉर्ड</span>
      <button type="button" data-page="${current + 1}" ${current === pages ? "disabled" : ""}>अगला →</button>`;
    container.querySelectorAll("button[data-page]").forEach(btn =>
      btn.addEventListener("click", () => onPage((Number(btn.dataset.page) - 1) * limit))
    );
  }

  function onTab(view, handler) {
    document.querySelector(`.admin-tab[data-admin-view="${view}"]`)
      ?.addEventListener("click", handler, { passive: true });
  }

  /* ── Genealogy contributions ─────────────────────────────────────────── */
  (function contributions() {
    const list = document.querySelector("#genealogy-contributions-list");
    if (!list) return;
    const limit = 50;
    let offset = 0;

    async function load() {
      list.innerHTML = `<div class="admin-empty">लोड हो रहा है...</div>`;
      try {
        const data = await api(`/api/admin/contributions?limit=${limit}&offset=${offset}`);
        const items = data.contributions || [];
        if (!items.length) {
          list.innerHTML = `<div class="admin-empty">कोई योगदान नहीं मिला।</div>`;
          return;
        }
        list.innerHTML = `<div class="admin-submissions">${items.map(c => `
          <article class="admin-submission" data-contrib="${esc(c.id)}">
            <h3>${esc(c.proposedName || c.contributionType)}
              <span class="result-tag">${esc(c.contributionType)}</span></h3>
            <p>${esc([c.proposedVillage, c.proposedBirthYear, c.proposedDeathYear].filter(Boolean).join(" · "))}</p>
            <p>${esc(c.description || "")}</p>
            <p><strong>प्रमाण:</strong> ${esc(c.evidence || "—")}</p>
            <p><strong>योगदानकर्ता:</strong> ${esc(c.contributorName)}
              ${c.contributorContact ? ` · ${esc(c.contributorContact)}` : ""}</p>
            <p><strong>स्थिति:</strong> ${esc(c.status)}
              ${c.reviewNotes ? ` · ${esc(c.reviewNotes)}` : ""}</p>
            <label>समीक्षा नोट
              <input class="contrib-note" type="text" maxlength="500" value="${esc(c.reviewNotes || "")}">
            </label>
            <div class="admin-actions">
              <button type="button" data-status="approved">स्वीकृत</button>
              <button type="button" data-status="under_review">समीक्षाधीन</button>
              <button type="button" data-status="needs_info">जानकारी चाहिए</button>
              <button type="button" class="reject" data-status="rejected">अस्वीकृत</button>
            </div>
          </article>`).join("")}</div><div class="genealogy-pagination" id="contrib-pager"></div>`;

        list.querySelectorAll("[data-status]").forEach(btn =>
          btn.addEventListener("click", async () => {
            const card = btn.closest("[data-contrib]");
            const note = card.querySelector(".contrib-note")?.value || "";
            btn.disabled = true;
            try {
              await patchJSON(`/api/admin/contributions/${card.dataset.contrib}`, {
                status: btn.dataset.status, reviewNotes: note,
              });
              await load();
            } catch (err) {
              btn.disabled = false;
              alert(err.message);
            }
          })
        );
        pager(list.querySelector("#contrib-pager"), data.total || 0, limit, offset, next => {
          offset = next; load();
        });
      } catch (err) {
        list.innerHTML = `<div class="admin-empty" style="color:#842d2d">${esc(err.message)}</div>`;
      }
    }

    onTab("genealogy-contributions", load);
    load();
  }());

  /* ── People: searchable, paginated list + add/edit ───────────────────── */
  (function people() {
    const list = document.querySelector("#people-list");
    const pagerEl = document.querySelector("#people-pagination");
    const searchInput = document.querySelector("#people-search-input");
    const searchBtn = document.querySelector("#people-search-btn");
    const form = document.querySelector("#person-form");
    const message = document.querySelector("#person-message");
    if (!list) return;

    let page = 1;
    const limit = 20;
    let gotras = [];

    async function loadGotras() {
      try { gotras = (await api("/api/admin/gotras/all")).gotras || []; } catch (_) { gotras = []; }
      const select = document.querySelector("#person-gotra-select");
      if (select && !select.options.length) {
        select.innerHTML = `<option value="">— चुनें —</option>` +
          gotras.map(g => `<option value="${esc(g.id)}">${esc(g.name)} (${esc(g.status)})</option>`).join("");
      }
    }

    function suggest(inputId, hiddenId, suggestionsId) {
      const input = document.querySelector(inputId);
      const hidden = document.querySelector(hiddenId);
      const box = document.querySelector(suggestionsId);
      if (!input || !hidden || !box) return;
      let timer;
      input.addEventListener("input", () => {
        hidden.value = "";
        clearTimeout(timer);
        const q = input.value.trim();
        if (q.length < 2) { box.classList.remove("show"); return; }
        timer = setTimeout(async () => {
          try {
            const res = await api(`/api/admin/people/search?q=${encodeURIComponent(q)}`);
            box.innerHTML = (res.people || []).map(p =>
              `<div class="suggestion-item" data-id="${esc(p.id)}" data-name="${esc(p.fullName)}">
                 <div class="sug-name">${esc(p.fullName)}</div>
                 <div class="sug-meta">${esc(p.birthYear || "")} ${esc(p.village || "")}</div>
               </div>`).join("");
            box.classList.add("show");
            box.querySelectorAll(".suggestion-item").forEach(item =>
              item.addEventListener("click", () => {
                hidden.value = item.dataset.id;
                input.value = item.dataset.name;
                box.classList.remove("show");
              })
            );
          } catch (_) { /* silent */ }
        }, 300);
      });
      document.addEventListener("click", e => {
        if (!input.contains(e.target) && !box.contains(e.target)) box.classList.remove("show");
      }, { passive: true });
    }

    async function load() {
      const q = searchInput?.value?.trim() || "";
      list.innerHTML = `<div class="admin-empty">लोड हो रहा है...</div>`;
      try {
        const data = await api(`/api/admin/people?page=${page}&limit=${limit}&q=${encodeURIComponent(q)}`);
        const people = data.people || [];
        list.innerHTML = people.length ? people.map(p => `
          <article class="admin-submission" data-person="${esc(p.id)}">
            <h3><a href="/vanshawali.html?person=${encodeURIComponent(p.publicId)}" target="_blank" rel="noopener">
              ${esc(p.fullName)} ↗</a></h3>
            <p>${esc([p.gender, p.birthYear, p.deathYear, p.village, p.state].filter(Boolean).join(" · "))}</p>
            <p><strong>स्थिति:</strong> ${esc(p.status)} · ${esc(p.visibility)}
              ${p.isLiving === false ? " · स्वर्गी" : ""}</p>
            <div class="admin-actions">
              <button type="button" class="person-edit" data-id="${esc(p.id)}">संपादित करें</button>
              <button type="button" class="person-link" data-id="${esc(p.id)}">शाखा जोड़ें</button>
            </div>
            <div class="person-edit-panel" hidden></div>
          </article>`).join("") : `<div class="admin-empty">कोई व्यक्ति नहीं मिला।</div>`;

        list.querySelectorAll(".person-edit").forEach(btn =>
          btn.addEventListener("click", () => openEdit(btn.dataset.id, btn.closest("[data-person]")))
        );
        list.querySelectorAll(".person-link").forEach(btn =>
          btn.addEventListener("click", () => openBranchLink(btn.dataset.id, btn.closest("[data-person]")))
        );
        pager(pagerEl, data.total || 0, limit, (page - 1) * limit, next => {
          page = next / limit + 1; load();
        });
      } catch (err) {
        list.innerHTML = `<div class="admin-empty" style="color:#842d2d">${esc(err.message)}</div>`;
      }
    }

    async function openEdit(id, card) {
      const panel = card.querySelector(".person-edit-panel");
      panel.hidden = false;
      panel.innerHTML = `<p>लोड हो रहा है...</p>`;
      try {
        const p = (await api(`/api/admin/people/${id}`)).person || {};
        panel.innerHTML = `
          <div class="form-row">
            <label>नाम<input data-p="fullName" value="${esc(p.fullName || "")}"></label>
            <label>लिंग<select data-p="gender">
              ${[["", "अज्ञात"], ["male", "पुरुष"], ["female", "महिला"], ["other", "अन्य"]].map(([v, l]) =>
                `<option value="${v}" ${p.gender === v ? "selected" : ""}>${l}</option>`).join("")}
            </select></label>
          </div>
          <div class="form-row">
            <label>जन्म वर्ष<input data-p="birthYear" value="${esc(p.birthYear || "")}"></label>
            <label>मृत्यु वर्ष<input data-p="deathYear" value="${esc(p.deathYear || "")}"></label>
          </div>
          <div class="form-row">
            <label>गांव<input data-p="village" value="${esc(p.village || "")}"></label>
            <label>दृश्यता<select data-p="visibility">
              ${["public", "members", "private"].map(v =>
                `<option value="${v}" ${p.visibility === v ? "selected" : ""}>${v}</option>`).join("")}
            </select></label>
          </div>
          <button type="button" class="button button-maroon person-save">सहेजें</button>
          <p class="form-message" role="status"></p>`;
        panel.querySelector(".person-save").addEventListener("click", async () => {
          const body = {};
          panel.querySelectorAll("[data-p]").forEach(el => { body[el.dataset.p] = el.value; });
          try {
            await patchJSON(`/api/admin/people/${id}`, body);
            panel.querySelector(".form-message").textContent = "सहेजा गया।";
            load();
          } catch (err) { panel.querySelector(".form-message").textContent = err.message; }
        });
      } catch (err) { panel.innerHTML = `<p style="color:#842d2d">${esc(err.message)}</p>`; }
    }

    async function openBranchLink(id, card) {
      const panel = card.querySelector(".person-edit-panel");
      panel.hidden = false;
      panel.innerHTML = `<p>लोड हो रहा है...</p>`;
      try {
        const branches = (await api("/api/admin/branches")).branches || [];
        panel.innerHTML = `
          <label>शाखा चुनें
            <select data-branch>${branches.map(b =>
              `<option value="${esc(b.id)}">${esc(b.gotraName)} — ${esc(b.name)}</option>`).join("")}</select>
          </label>
          <button type="button" class="button button-gold branch-save">जोड़ें</button>
          <p class="form-message" role="status"></p>`;
        panel.querySelector(".branch-save").addEventListener("click", async () => {
          const branchId = panel.querySelector("[data-branch]")?.value;
          const branch = branches.find(b => b.id === branchId);
          if (!branch) return;
          try {
            const result = await postJSON(`/api/admin/vanshawali/assign-branch`, {
              personId: id, branchId,
            });
            panel.querySelector(".form-message").textContent = result.message || "जोड़ा गया।";
          } catch (err) { panel.querySelector(".form-message").textContent = err.message; }
        });
      } catch (err) { panel.innerHTML = `<p style="color:#842d2d">${esc(err.message)}</p>`; }
    }

    searchBtn?.addEventListener("click", () => { page = 1; load(); });
    searchInput?.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); page = 1; load(); }
    });
    onTab("people", () => { loadGotras(); load(); });
    loadGotras();
    suggest("#person-father-input", "#person-father-hidden", "#father-suggestions");
    suggest("#person-mother-input", "#person-mother-hidden", "#mother-suggestions");

    form?.addEventListener("submit", async e => {
      e.preventDefault();
      const btn = form.querySelector("[type=submit]");
      btn.disabled = true;
      const fd = Object.fromEntries(new FormData(form));
      const body = {
        fullName: fd.fullName, gender: fd.gender, birthYear: fd.birthYear,
        deathYear: fd.deathYear, village: fd.village, state: fd.state,
        gotraId: fd.gotraId, branchId: fd.branchId || null,
        fatherId: document.querySelector("#person-father-hidden")?.value || null,
        motherId: document.querySelector("#person-mother-hidden")?.value || null,
        biography: fd.biography, visibility: fd.visibility,
        isLiving: fd.isLiving === "true",
      };
      try {
        const result = await postJSON("/api/admin/people", body);
        if (message) { message.textContent = result.message || "सहेजा गया।"; message.classList.remove("error"); }
        form.reset();
        document.querySelector("#person-father-hidden").value = "";
        document.querySelector("#person-mother-hidden").value = "";
        load();
      } catch (err) {
        if (message) { message.textContent = err.message; message.classList.add("error"); }
      } finally { btn.disabled = false; }
    });
  }());

  /* ── CSV import: preview → review → commit ───────────────────────────── */
  (function importPanel() {
    const fileInput = document.querySelector("#import-file-input");
    const previewBtn = document.querySelector("#import-preview-btn");
    const commitBtn = document.querySelector("#import-commit-btn");
    const cancelBtn = document.querySelector("#import-cancel-btn");
    const msg = document.querySelector("#import-preview-message");
    const area = document.querySelector("#import-preview-area");
    const summary = document.querySelector("#import-summary");
    const tbody = document.querySelector("#import-preview-tbody");
    if (!fileInput || !previewBtn) return;

    let csvText = "";
    let jobId = null;

    fileInput.addEventListener("change", () => {
      csvText = "";
      jobId = null;
      previewBtn.disabled = !fileInput.files?.length;
      commitBtn.disabled = true;
      if (area) area.hidden = true;
      if (msg) { msg.textContent = ""; msg.classList.remove("error"); }
    });

    previewBtn.addEventListener("click", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      previewBtn.disabled = true;
      if (msg) msg.textContent = "पढ़ रहे हैं...";
      try {
        csvText = await file.text();
        const result = await postJSON("/api/admin/vanshawali/import/preview", {
          csv: csvText, filename: file.name,
        });
        jobId = result.jobId;
        const s = result.summary || {};
        if (summary) summary.innerHTML =
          `<strong>कुल:</strong> ${esc(s.total)} &nbsp; <strong>मान्य:</strong> ${esc(s.valid)} &nbsp; <strong>अमान्य:</strong> ${esc(s.invalid)}`;
        const rows = [
          ...(result.validRows || []).map(r => ({ ...r, status: "मान्य" })),
          ...(result.invalidRows || []).map(r => ({ ...r, status: "अमान्य" })),
        ];
        if (tbody) tbody.innerHTML = rows.map(r => `
          <tr>
            <td>${esc(r.row)}</td><td>${esc(r.external_id)}</td><td>${esc(r.full_name)}</td>
            <td>${esc(r.father_external_id || "")}</td><td>${esc(r.mother_external_id || "")}</td>
            <td>${esc(r.village || "")}</td><td>${esc(r.status)}</td>
            <td>${esc((r.errors || []).join("; "))}</td>
          </tr>`).join("");
        if (area) area.hidden = false;
        commitBtn.disabled = !jobId || !s.valid;
        if (msg) { msg.textContent = "Preview तैयार है। जांच करें फिर Import करें।"; msg.classList.remove("error"); }
      } catch (err) {
        if (msg) { msg.textContent = err.message; msg.classList.add("error"); }
      } finally { previewBtn.disabled = false; }
    });

    commitBtn?.addEventListener("click", async () => {
      if (!jobId) return;
      commitBtn.disabled = true;
      try {
        const result = await postJSON("/api/admin/vanshawali/import/commit", { jobId });
        if (msg) { msg.textContent = result.message || "Import हो गया।"; msg.classList.remove("error"); }
        area.hidden = true;
        jobId = null;
      } catch (err) {
        if (msg) { msg.textContent = err.message; msg.classList.add("error"); }
        commitBtn.disabled = false;
      }
    });

    cancelBtn?.addEventListener("click", () => {
      jobId = null;
      csvText = "";
      if (fileInput) fileInput.value = "";
      if (area) area.hidden = true;
      if (tbody) tbody.innerHTML = "";
      if (commitBtn) commitBtn.disabled = true;
      if (msg) { msg.textContent = ""; msg.classList.remove("error"); }
    });
  }());

  /* ── Branch management ───────────────────────────────────────────────── */
  (function branches() {
    const form = document.querySelector("#branch-form");
    const list = document.querySelector("#branch-list");
    const msg = document.querySelector("#branch-form-message");
    const select = document.querySelector("#branch-gotra-select");
    if (!form || !list) return;

    async function loadGotras() {
      try {
        const gotras = (await api("/api/admin/gotras/all")).gotras || [];
        if (select) select.innerHTML = gotras.map(g =>
          `<option value="${esc(g.id)}">${esc(g.name)} (${esc(g.status)})</option>`).join("");
      } catch (_) { /* silent */ }
    }

    async function load() {
      list.innerHTML = `<div class="admin-empty">लोड हो रहा है...</div>`;
      try {
        const branches = (await api("/api/admin/branches")).branches || [];
        list.innerHTML = branches.length ? branches.map(b => `
          <div class="admin-submission">
            <h3>${esc(b.name)}</h3>
            <p>${esc(b.gotraName)} · ${esc(b.status)} · ${esc(b.slug || "")}</p>
            <p>${esc(b.description || "")}</p>
          </div>`).join("") : `<div class="admin-empty">कोई शाखा नहीं है।</div>`;
      } catch (err) { list.innerHTML = `<div class="admin-empty">${esc(err.message)}</div>`; }
    }

    form.addEventListener("submit", async e => {
      e.preventDefault();
      const btn = form.querySelector("[type=submit]");
      btn.disabled = true;
      const fd = Object.fromEntries(new FormData(form));
      try {
        const result = await postJSON("/api/admin/branches", fd);
        if (msg) { msg.textContent = result.message || "सहेजा गया।"; msg.classList.remove("error"); }
        form.reset();
        load();
      } catch (err) {
        if (msg) { msg.textContent = err.message; msg.classList.add("error"); }
      } finally { btn.disabled = false; }
    });

    onTab("branch-mgmt", () => { loadGotras(); load(); });
    loadGotras();
  }());

  /* ── Dashboard ───────────────────────────────────────────────────────── */
  (function dashboard() {
    const stats = document.querySelector("#dashboard-stats");
    const recent = document.querySelector("#dashboard-recent-people");
    if (!stats) return;
    onTab("dashboard", load);

    async function load() {
      if (recent) recent.innerHTML = `<div class="admin-empty">लोड हो रहा है...</div>`;
      try {
        const s = await api("/api/vanshawali/stats");
        stats.innerHTML = [
          ["लोग", s.totalPeople], ["गांव", s.totalVillages], ["शाखाएं", s.totalBranches],
          ["संबंध", s.totalRelationships], ["लंबित योगदान", s.pendingSubmissions],
        ].map(([label, value]) =>
          `<div class="stat-card"><h3>${esc(value)}</h3><p>${esc(label)}</p></div>`).join("");
        if (recent) recent.innerHTML = (s.recentPeople || []).map(p => `
          <article class="admin-submission">
            <h3><a href="/vanshawali.html?person=${encodeURIComponent(p.publicId)}" target="_blank" rel="noopener">
              ${esc(p.fullName)} ↗</a></h3>
            <p>${esc(p.village || "")}</p>
          </article>`).join("") || `<div class="admin-empty">अभी कोई व्यक्ति नहीं।</div>`;
      } catch (err) {
        stats.innerHTML = `<div class="admin-empty">${esc(err.message)}</div>`;
      }
    }
  }());
}());
