/**
 * admin-vanshawali.js
 * -------------------
 * Admin dashboard for Gotra-first Vanshawali: Gotra management, verification
 * queue, decisions, non-destructive master-tree linking and audit history.
 */
(function () {
  "use strict";
  const root = document.getElementById("admin-vanshawali");
  if (!root) return;

  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
  const $ = id => document.getElementById(id);
  const statusHi = {
    draft: "ड्राफ्ट", pending: "लंबित", under_review: "समीक्षाधीन",
    correction_required: "सुधार आवश्यक", verified: "सत्यापित", rejected: "अस्वीकृत",
  };

  async function api(url, options = {}) {
    const res = await fetch(url, { credentials: "include", ...options });
    let data = {};
    try { data = await res.json(); } catch (_) { /* no body */ }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  function send(url, body, method = "POST") {
    return api(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  function say(text, isError = false) {
    const el = $("vsh-message");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("error", isError);
  }
  function badge(status) {
    return `<span class="vsh-status vsh-status--${esc(status)}">${esc(statusHi[status] || status)}</span>`;
  }

  let treeOffset = 0;
  const TREE_LIMIT = 20;
  let currentTree = null;
  let sourcePeople = [];

  async function loadStats() {
    try {
      const s = await api("/api/admin/vanshawali/stats");
      const cards = [
        ["कुल गोत्र", s.gotras], ["कुल वृक्ष", s.trees], ["कुल व्यक्ति", s.persons],
        ["लंबित", s.pending], ["सत्यापित", s.verified], ["सुधार आवश्यक", s.corrections],
        ["अस्वीकृत", s.rejected], ["जुड़ी शाखाएँ", s.connections],
      ];
      $("vsh-stats").innerHTML = cards.map(([label, value]) =>
        `<div class="stat-card"><span>${esc(label)}</span><strong>${Number(value || 0)}</strong></div>`).join("");
    } catch (e) { say(e.message, true); }
  }

  async function loadGotras() {
    const q = $("vsh-gotra-search").value.trim();
    try {
      const data = await api(`/api/admin/vanshawali/gotras?q=${encodeURIComponent(q)}`);
      $("vsh-gotra-list").innerHTML = data.gotras.length ? data.gotras.map(g => `
        <div class="vsh-gotra-row" data-id="${esc(g.id)}">
          <div>
            <strong>${esc(g.name)}</strong>
            <small>${g.tree_count} वृक्ष · ${g.member_count} सदस्य · ${esc(g.status)}</small>
          </div>
          <label class="vsh-inline-check"><input type="checkbox" data-toggle-active ${g.is_active ? "checked" : ""} /> सक्रिय</label>
          <button class="button button-outline-dark" data-edit-gotra type="button">संपादित</button>
        </div>`).join("") : `<p class="admin-empty">कोई गोत्र नहीं मिला।</p>`;

      $("vsh-gotra-list").querySelectorAll("[data-toggle-active]").forEach(box =>
        box.addEventListener("change", async () => {
          try {
            const id = box.closest(".vsh-gotra-row").dataset.id;
            const res = await send(`/api/admin/vanshawali/gotras/${id}`, { isActive: box.checked }, "PATCH");
            $("vsh-gotra-msg").textContent = res.message;
            loadGotras();
          } catch (e) { $("vsh-gotra-msg").textContent = e.message; $("vsh-gotra-msg").classList.add("error"); }
        }));
      $("vsh-gotra-list").querySelectorAll("[data-edit-gotra]").forEach(btn =>
        btn.addEventListener("click", () => {
          const row = btn.closest(".vsh-gotra-row");
          const id = row.dataset.id;
          const name = row.querySelector("strong").textContent;
          const next = prompt("गोत्र का नया नाम", name);
          if (!next || next === name) return;
          send(`/api/admin/vanshawali/gotras/${id}`, { name: next }, "PATCH")
            .then(r => { $("vsh-gotra-msg").classList.remove("error"); $("vsh-gotra-msg").textContent = r.message; loadGotras(); loadTreeGotras(); })
            .catch(e => { $("vsh-gotra-msg").classList.add("error"); $("vsh-gotra-msg").textContent = e.message; });
        }));
    } catch (e) { $("vsh-gotra-list").innerHTML = `<p class="admin-empty">${esc(e.message)}</p>`; }
  }

  async function loadTreeGotras() {
    try {
      const data = await api("/api/admin/vanshawali/gotras?q=");
      const select = $("vsh-gotra-filter");
      const selected = select.value;
      select.innerHTML = `<option value="">सभी गोत्र</option>` +
        data.gotras.map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join("");
      select.value = selected;
    } catch (_) { /* silent */ }
  }

  async function loadTrees() {
    const params = new URLSearchParams({
      status: $("vsh-status-filter").value,
      gotraId: $("vsh-gotra-filter").value,
      q: $("vsh-tree-search").value.trim(),
      limit: String(TREE_LIMIT), offset: String(treeOffset),
    });
    try {
      const data = await api(`/api/admin/vanshawali/trees?${params}`);
      $("vsh-tree-list").innerHTML = data.trees.length ? data.trees.map(t => `
        <article class="vsh-tree-card" data-tree-id="${esc(t.id)}">
          <h3>${esc(t.root_name || "मूल व्यक्ति")} ${badge(t.status)}</h3>
          <p>${esc(t.gotra_name)} · ${esc(t.village || "—")} · ${esc(t.tree_reference)} · ${t.memberCount} सदस्य</p>
          ${t.review_notes ? `<p class="vsh-meta">नोट: ${esc(t.review_notes)}</p>` : ""}
          <button class="button button-gold" data-open-tree type="button">खोलें और समीक्षा करें</button>
        </article>`).join("") : `<p class="admin-empty">कोई वृक्ष नहीं मिला।</p>`;
      $("vsh-tree-list").querySelectorAll("[data-open-tree]").forEach(btn =>
        btn.addEventListener("click", () => openTree(btn.closest("[data-tree-id]").dataset.treeId)));
      const pages = Math.max(1, Math.ceil(data.total / TREE_LIMIT));
      const current = Math.floor(treeOffset / TREE_LIMIT) + 1;
      $("vsh-pager").innerHTML = pages > 1
        ? `<button type="button" data-page="${current - 1}" ${current === 1 ? "disabled" : ""}>← पिछला</button>
           <span>${current} / ${pages} · ${data.total} वृक्ष</span>
           <button type="button" data-page="${current + 1}" ${current === pages ? "disabled" : ""}>अगला →</button>`
        : `<span>${data.total} वृक्ष</span>`;
      $("vsh-pager").querySelectorAll("button[data-page]").forEach(btn =>
        btn.addEventListener("click", () => { treeOffset = (Number(btn.dataset.page) - 1) * TREE_LIMIT; loadTrees(); }));
    } catch (e) { $("vsh-tree-list").innerHTML = `<p class="admin-empty">${esc(e.message)}</p>`; }
  }

  async function openTree(id) {
    try {
      const data = await api(`/api/admin/vanshawali/trees/${id}`);
      currentTree = data;
      sourcePeople = (data.visual && data.visual.people) || [];
      const t = data.tree;
      $("vsh-review").hidden = false;
      $("vsh-review").scrollIntoView({ behavior: "smooth", block: "start" });
      $("vsh-review-title").textContent = `${t.tree_reference} — समीक्षा`;
      $("vsh-review-meta").innerHTML =
        `${esc(t.gotra_name)} · ${esc(t.submitter_name || "—")} · ${esc(t.village || "—")} · ` +
        `${badge(t.status)} · संस्करण ${t.revision_number}` +
        (t.review_notes ? ` · <em>पिछला नोट: ${esc(t.review_notes)}</em>` : "");
      $("vsh-review-members").innerHTML = data.members.map(m => `
        <div class="vsh-member-row">
          <strong>${esc(m.name)}</strong> <small>${esc(m.memberType)}</small>
          ${m.memberType === "daughter" ? "" : `<span>पत्नी: ${esc(m.wifeName || "—")} · गांव: ${esc(m.village || "—")}</span>`}
        </div>`).join("") || `<p class="admin-empty">कोई सदस्य नहीं।</p>`;
      $("vsh-review-notes").value = t.review_notes || "";
      $("vsh-review-visual").innerHTML = data.verificationRecords.map(r =>
        `<p>${badge(r.decision)} ${esc(r.remarks || "")} <small>${esc(r.admin_email || "")} · ${esc(r.created_at)}</small></p>`).join("");
      $("vsh-anchor").innerHTML = sourcePeople.map(p =>
        `<option value="${esc(p.id)}">${esc(p.full_name)} (${esc(p.member_type || "—")})</option>`).join("");
      await loadVerifiedTargets();
    } catch (e) { say(e.message, true); }
  }

  async function loadVerifiedTargets() {
    try {
      const data = await api(`/api/admin/vanshawali/trees?status=verified&limit=100&offset=0`);
      $("vsh-target-tree").innerHTML = data.trees
        .filter(t => !currentTree || t.id !== currentTree.tree.id)
        .map(t => `<option value="${esc(t.id)}">${esc(t.tree_reference)} — ${esc(t.root_name || "")} (${esc(t.gotra_name)})</option>`).join("");
    } catch (_) { /* silent */ }
  }

  document.querySelectorAll("[data-vsh-decision]").forEach(btn =>
    btn.addEventListener("click", async () => {
      if (!currentTree) return;
      const decision = btn.dataset.vshDecision;
      if (decision === "reject" && !confirm("इस वृक्ष को अस्वीकृत करें?")) return;
      if (decision === "approve" && !confirm("वृक्ष को सत्यापित करें? इससे वास्तविक व्यक्ति और संबंध बनेंगे।")) return;
      try {
        const res = await send(`/api/admin/vanshawali/trees/${currentTree.tree.id}/decision`, {
          decision, notes: $("vsh-review-notes").value.trim(),
        });
        say(`${res.message}${res.skipped?.length ? ` · छोड़े गए: ${res.skipped.length}` : ""}`);
        loadStats(); loadTrees(); openTree(currentTree.tree.id);
      } catch (e) { say(e.message, true); }
    }));

  $("vsh-person-search").addEventListener("input", () => {
    clearTimeout(window._vshPersonTimer);
    window._vshPersonTimer = setTimeout(async () => {
      const q = $("vsh-person-search").value.trim();
      if (q.length < 2) { $("vsh-person-results").innerHTML = ""; return; }
      try {
        const data = await api(`/api/admin/vanshawali/person-search?q=${encodeURIComponent(q)}`);
        $("vsh-person-results").innerHTML = data.people.length ? data.people.map(p => `
          <button type="button" class="vsh-person-option" data-person-id="${esc(p.id)}" data-tree-id="${esc(p.tree_id || "")}">
            <strong>${esc(p.full_name)}</strong>
            <small>${esc(p.wife_name || "—")} · ${esc(p.village || "—")} · ${esc(p.gotra_name || "—")} · ${esc(p.tree_reference || "—")}</small>
          </button>`).join("") : `<p class="admin-empty">कोई मिलान नहीं।</p>`;
        $("vsh-person-results").querySelectorAll("[data-person-id]").forEach(option =>
          option.addEventListener("click", () => {
            $("vsh-ancestor").innerHTML =
              `<option value="${esc(option.dataset.personId)}" selected>${esc(option.querySelector("strong").textContent)}</option>`;
            if (option.dataset.treeId) $("vsh-target-tree").value = option.dataset.treeId;
            say("साझा पूर्वज चुना गया। अब स्रोत वृक्ष का व्यक्ति चुनें।");
          }));
      } catch (e) { $("vsh-person-results").innerHTML = `<p class="admin-empty">${esc(e.message)}</p>`; }
    }, 300);
  });

  $("vsh-link-btn").addEventListener("click", async () => {
    if (!currentTree) return;
    if (!confirm("चुने गए पूर्वज से वृक्ष जोड़ें? यह कार्य ऑडिट में दर्ज होगा।")) return;
    try {
      const res = await send(`/api/admin/vanshawali/trees/${currentTree.tree.id}/link`, {
        targetTreeId: $("vsh-target-tree").value,
        commonAncestorPersonId: $("vsh-ancestor").value,
        sourceAnchorPersonId: $("vsh-anchor").value,
        notes: $("vsh-link-notes").value.trim(),
      });
      say(res.message);
      loadStats(); loadHistories(); openTree(currentTree.tree.id);
    } catch (e) { say(e.message, true); }
  });

  async function loadHistories() {
    try {
      const links = await api("/api/admin/vanshawali/tree-links");
      $("vsh-links").innerHTML = links.links.length ? links.links.map(l => `
        <div class="vsh-history-row">
          <strong>${esc(l.source_reference)} → ${esc(l.target_reference)}</strong>
          <span>${esc(l.status)} · ${esc(l.admin_email || "")} · ${esc(l.created_at)}</span>
          ${l.status === "active"
            ? `<button class="button button-outline-dark" data-reverse="${esc(l.id)}" type="button">लिंक हटाएँ</button>` : ""}
        </div>`).join("") : `<p class="admin-empty">कोई लिंक नहीं।</p>`;
      $("vsh-links").querySelectorAll("[data-reverse]").forEach(btn =>
        btn.addEventListener("click", async () => {
          if (!confirm("यह लिंक हटाएँ? मूल वृक्ष सुरक्षित रहेगा और अभिलेख बनेगा।")) return;
          try {
            const res = await send(`/api/admin/vanshawali/tree-links/${btn.dataset.reverse}/reverse`, { notes: "" });
            say(res.message); loadHistories(); loadStats();
          } catch (e) { say(e.message, true); }
        }));
    } catch (e) { say(e.message, true); }

    try {
      const records = await api("/api/admin/vanshawali/verifications");
      $("vsh-verifications").innerHTML = records.records.length ? records.records.map(r => `
        <div class="vsh-history-row"><strong>${esc(r.tree_reference)}</strong>
          <span>${badge(r.decision)} · ${esc(r.admin_email || "")} · ${esc(r.created_at)}</span>
          <span>${esc(r.remarks || "")}</span></div>`).join("") : `<p class="admin-empty">कोई रिकॉर्ड नहीं।</p>`;
    } catch (e) { say(e.message, true); }

    try {
      const logs = await api("/api/admin/vanshawali/audit?entityType=");
      $("vsh-audit").innerHTML = logs.logs.length ? logs.logs.map(l => `
        <div class="vsh-history-row"><strong>${esc(l.action)}</strong>
          <span>${esc(l.entity_type)} · ${esc(l.admin_email || "")} · ${esc(l.created_at)}</span></div>`).join("")
        : `<p class="admin-empty">कोई ऑडिट नहीं।</p>`;
    } catch (e) { $("vsh-audit").innerHTML = `<p class="admin-empty">ऑडिट देखने की अनुमति नहीं है।</p>`; }
  }

  /* ── Privacy requests (same admin view, no extra tab) ───────────────── */
  async function loadPrivacyRequests() {
    const box = $("vsh-privacy-requests");
    if (!box) return;
    try {
      const data = await api("/api/admin/vanshawali/privacy-requests");
      const requests = Array.isArray(data)
        ? data
        : (Array.isArray(data && data.requests) ? data.requests : []);
      box.innerHTML = requests.length
        ? requests.map(r => {
            const details = typeof r.details === "string"
              ? r.details
              : (r.details ? JSON.stringify(r.details) : (r.request_details || r.details_json || "—"));
            return `<div class="vsh-history-row" data-privacy-id="${esc(r.id)}">
              <strong>${esc(r.id)} · ${esc(r.type || r.request_type || "—")}</strong>
              <span>${esc(details)}</span>
              <span>${esc(r.created_at || r.createdAt || "—")}</span>
              <button class="button button-outline-dark" data-fulfil-privacy type="button">पूरी करें</button>
            </div>`;
          }).join("")
        : `<p class="admin-empty">कोई लंबित गोपनीयता अनुरोध नहीं।</p>`;
      box.querySelectorAll("[data-fulfil-privacy]").forEach(btn =>
        btn.addEventListener("click", async () => {
          const id = btn.closest("[data-privacy-id]")?.dataset.privacyId;
          if (!id) return;
          try {
            const res = await send(`/api/admin/vanshawali/privacy-requests/${encodeURIComponent(id)}/fulfil`, {});
            say(res.message || "गोपनीयता अनुरोध पूरी हो गया।");
            loadPrivacyRequests();
          } catch (e) { say(e.message, true); }
        }));
    } catch (_) {
      /* 404 / not permitted / empty API — keep the panel usable. */
      box.innerHTML = `<p class="admin-empty">कोई लंबित गोपनीयता अनुरोध नहीं।</p>`;
    }
  }

  $("vsh-gotra-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = {
      name: form.elements.name.value.trim(),
      description: form.elements.description.value.trim(),
      isActive: form.elements.isActive.checked,
    };
    try {
      const res = await send("/api/admin/vanshawali/gotras", body);
      $("vsh-gotra-msg").classList.remove("error");
      $("vsh-gotra-msg").textContent = res.message;
      form.reset();
      loadGotras(); loadTreeGotras(); loadStats();
    } catch (e) { $("vsh-gotra-msg").classList.add("error"); $("vsh-gotra-msg").textContent = e.message; }
  });

  $("vsh-gotra-search").addEventListener("input", () => { clearTimeout(window._vshGotraTimer); window._vshGotraTimer = setTimeout(loadGotras, 250); });
  $("vsh-tree-search-btn").addEventListener("click", () => { treeOffset = 0; loadTrees(); });
  $("vsh-gotra-filter").addEventListener("change", () => { treeOffset = 0; loadTrees(); });
  $("vsh-status-filter").addEventListener("change", () => { treeOffset = 0; loadTrees(); });

  function loadAll() { loadStats(); loadGotras(); loadTreeGotras(); loadTrees(); loadHistories(); loadPrivacyRequests(); }
  const tab = document.querySelector('.admin-tab[data-admin-view="vanshawali"]');
  if (tab) tab.addEventListener("click", () => setTimeout(loadAll, 0));
  document.addEventListener("kulkirti:admin-ready", loadAll);
  loadAll();
})();
