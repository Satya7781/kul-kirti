/**
 * admin-pariwar.js
 * -----------------
 * Admin panel logic for the "परिवार वृक्ष" tab.
 * Loads public_family_trees, lets the admin verify/correct every member,
 * anchor parents to existing people, choose gotra/branch placement, then
 * link or reject the tree.  Pagination keeps large queues manageable.
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

  const listEl = document.querySelector("#pariwar-trees-list");
  const filterBtns = document.querySelectorAll(".pft");
  if (!listEl) return;

  let currentStatus = "pending";
  let offset = 0;
  const LIMIT = 50;

  filterBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      filterBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentStatus = btn.dataset.pftStatus;
      offset = 0;
      loadTrees();
    });
  });

  async function loadTrees() {
    listEl.innerHTML = `<div class="admin-empty">लोड हो रहा है...</div>`;
    try {
      const { trees, total } = await api(`/api/admin/pariwar?status=${encodeURIComponent(currentStatus)}&limit=${LIMIT}&offset=${offset}`);

      if (!trees || !trees.length) {
        listEl.innerHTML = `<div class="admin-empty">कोई ${esc(currentStatus)} tree नहीं है।</div>`;
        return;
      }

      let allGotras = [];
      let allBranches = [];
      try { allGotras = (await api("/api/admin/gotras/all")).gotras || []; } catch (_) { /* silent */ }
      try { allBranches = (await api("/api/admin/branches")).branches || []; } catch (_) { /* silent */ }
      const gotraOptions = `<option value="">— नया गोत्र बनाएं / नाम से पहचानें —</option>` +
        allGotras.map(g => `<option value="${esc(g.id)}">${esc(g.name)} (${esc(g.status)})</option>`).join("");
      const branchOptions = `<option value="">— कोई नहीं —</option>` +
        allBranches.map(b => `<option value="${esc(b.id)}">${esc(b.gotraName)} — ${esc(b.name)}</option>`).join("");

      listEl.innerHTML = trees.map(tree => {
        const members = Array.isArray(tree.familyMembers) ? tree.familyMembers : [];
        const nameOf = new Map(members.map(m => [esc(m.clientId || ""), m.name]));
        const memberRows = members.map(m => {
          const father = m.fatherId && nameOf.get(m.fatherId);
          const mother = m.motherId && nameOf.get(m.motherId);
          return `
            <div class="ptc-member" data-member="${esc(m.clientId || "")}">
              <strong>${esc(m.name)}</strong>
              ${m.relation ? `<span>${esc(m.relation)}</span>` : ""}
              ${m.birthYear ? `<span>${esc(m.birthYear)}</span>` : ""}
              ${m.gender && m.gender !== "unknown" ? `<span>${m.gender === "male" ? "पुरुष" : m.gender === "female" ? "महिला" : "अन्य"}</span>` : ""}
              ${father || mother ? `<small>पिता: ${esc(father || "—")} · माता: ${esc(mother || "—")}</small>` : ""}
            </div>`;
        }).join("");

        const reviewRows = members.map(m => `
          <div class="member-row" data-review-member="${esc(m.clientId || "")}">
            <strong>${esc(m.name)}</strong>
            <div class="form-row">
              <label>नाम<input data-mf="name" value="${esc(m.name || "")}"></label>
              <label>संबंध<input data-mf="relation" value="${esc(m.relation || "")}"></label>
            </div>
            <div class="form-row">
              <label>जन्म वर्ष<input data-mf="birthYear" value="${esc(m.birthYear || "")}"></label>
              <label>मृत्यु वर्ष<input data-mf="deathYear" value="${esc(m.deathYear || "")}"></label>
            </div>
            <div class="form-row">
              <label>पिता (इस सूची से)<select data-mf="fatherId">
                <option value="">— कोई नहीं —</option>
                ${members.filter(x => x.clientId !== m.clientId).map(x =>
                  `<option value="${esc(x.clientId)}" ${m.fatherId === x.clientId ? "selected" : ""}>${esc(x.name)}</option>`).join("")}
              </select></label>
              <label>माता (इस सूची से)<select data-mf="motherId">
                <option value="">— कोई नहीं —</option>
                ${members.filter(x => x.clientId !== m.clientId).map(x =>
                  `<option value="${esc(x.clientId)}" ${m.motherId === x.clientId ? "selected" : ""}>${esc(x.name)}</option>`).join("")}
              </select></label>
            </div>
            <label>मौजूदा व्यक्ति ID (डुप्लिकेट रोकने के लिए)<input data-mf="existingPersonId" placeholder="वैकल्पिक"></label>
            <label>मौजूदा पिता ID<input data-mf="fatherPersonId" placeholder="अन्य वृक्ष से जोड़ें"></label>
            <label>मौजूदा माता ID<input data-mf="motherPersonId" placeholder="अन्य वृक्ष से जोड़ें"></label>
          </div>`).join("");

        return `
          <div class="pariwar-tree-card" data-tree-id="${esc(tree.id)}">
            <div class="ptc-header">
              <div>
                <h4>${esc(tree.gotraName)}</h4>
                <div class="ptc-meta">
                  <span>📛 ${esc(tree.creatorName)}</span>
                  ${tree.creatorContact ? `<span>📞 ${esc(tree.creatorContact)}</span>` : ""}
                  ${tree.village ? `<span>🏘️ ${esc(`${tree.village}${tree.district ? ", " + tree.district : ""}${tree.state ? ", " + tree.state : ""}`)}</span>` : ""}
                  <span>👨‍👩‍👦 ${members.length} सदस्य</span>
                  <span>📅 ${new Date(tree.submittedAt).toLocaleDateString("hi-IN")}</span>
                </div>
              </div>
              <span class="ptc-status-badge ptc-${esc(tree.status)}">${esc(tree.status)}</span>
            </div>

            ${memberRows ? `
              <details class="ptc-members-details">
                <summary>${members.length} परिवार सदस्य देखें</summary>
                <div class="ptc-members-grid">${memberRows}</div>
              </details>` : ""}

            ${tree.notes ? `<p class="ptc-notes">${esc(tree.notes)}</p>` : ""}

            ${tree.status === "pending" ? `
              <details class="ptc-review-details">
                <summary>सत्यापन और placement तय करें</summary>
                <div class="ptc-review-panel">
                  <div class="form-row">
                    <label class="ptc-label">गोत्र से जोड़ें (या नया बनाएं):
                      <select class="ptc-gotra-select">${gotraOptions}</select>
                    </label>
                    <label class="ptc-label">शाखा (वैकल्पिक):
                      <select class="ptc-branch-select">${branchOptions}</select>
                    </label>
                  </div>
                  <p class="form-note">प्रत्येक सदस्य की जांच करें। डुप्लिकेट व्यक्ति का ID भरें; पिता/माता दूसरे वृक्ष से भी जोड़े जा सकते हैं।</p>
                  <div class="ptc-review-members">${reviewRows}</div>
                  <label class="ptc-label">समीक्षा नोट (वैकल्पिक):
                    <input class="ptc-review-note" type="text" maxlength="500" placeholder="Admin का नोट..." />
                  </label>
                  <div class="ptc-actions">
                    <button class="button button-gold ptc-link-btn" type="button">🔗 Link करें (${members.length} सदस्य)</button>
                    <button class="button ptc-reject-btn" type="button" style="background:#f3d9d9;color:#842d2d">❌ अस्वीकृत करें</button>
                  </div>
                  <p class="form-message ptc-message" role="status"></p>
                </div>
              </details>` : ""}

            ${tree.status === "linked" ? `
              <p class="ptc-linked-note">
                ✅ ${members.length} सदस्य वंशावली में जोड़े गए।
                ${tree.reviewNotes ? " · " + esc(tree.reviewNotes) : ""}
                ${tree.linkedGotraId ? `<button type="button" class="ptc-publish-gotra" data-gotra="${esc(tree.linkedGotraId)}">गोत्र सत्यापित करें</button>` : ""}
              </p>` : ""}
          </div>`;
      }).join("");

      const totalCount = total || trees.length;
      const pages = Math.max(1, Math.ceil(totalCount / LIMIT));
      const current = Math.floor(offset / LIMIT) + 1;
      const pager = document.createElement("div");
      pager.className = "genealogy-pagination";
      pager.innerHTML = pages > 1
        ? `<button type="button" data-page="${current - 1}" ${current === 1 ? "disabled" : ""}>← पिछला</button>
           <span>${current} / ${pages} · ${totalCount} वृक्ष</span>
           <button type="button" data-page="${current + 1}" ${current === pages ? "disabled" : ""}>अगला →</button>`
        : `<span>${totalCount} वृक्ष</span>`;
      pager.querySelectorAll("button[data-page]").forEach(btn =>
        btn.addEventListener("click", () => {
          offset = (Number(btn.dataset.page) - 1) * LIMIT;
          loadTrees();
        })
      );
      listEl.appendChild(pager);

      listEl.querySelectorAll(".ptc-link-btn").forEach(btn =>
        btn.addEventListener("click", async () => {
          const card = btn.closest(".pariwar-tree-card");
          const gotraId = card.querySelector(".ptc-gotra-select")?.value || "";
          const note = card.querySelector(".ptc-review-note")?.value || "";
          const branchId = card.querySelector(".ptc-branch-select")?.value || "";
          const members = Array.from(card.querySelectorAll("[data-review-member]")).map(row => {
            const out = { clientId: row.dataset.reviewMember };
            row.querySelectorAll("[data-mf]").forEach(el => {
              const value = el.value.trim();
              if (value) out[el.dataset.mf] = value;
            });
            return out;
          });

          if (!confirm("क्या आप इस परिवार वृक्ष को जांच के बाद वंशावली से जोड़ना चाहते हैं?")) return;
          btn.disabled = true;
          btn.textContent = "जोड़ रहे हैं...";
          const msgEl = card.querySelector(".ptc-message");
          try {
            const result = await api(`/api/admin/pariwar/${card.dataset.treeId}/link`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ gotraId: gotraId || undefined, branchId, reviewNotes: note, members }),
            });
            if (msgEl) msgEl.textContent = result.message || "जोड़ा गया।";
            loadTrees();
          } catch (err) {
            if (msgEl) { msgEl.textContent = err.message; msgEl.classList.add("error"); }
            btn.disabled = false;
            btn.textContent = `🔗 Link करें`;
          }
        })
      );

      listEl.querySelectorAll(".ptc-reject-btn").forEach(btn =>
        btn.addEventListener("click", async () => {
          const card = btn.closest(".pariwar-tree-card");
          const note = card.querySelector(".ptc-review-note")?.value || "";
          if (!confirm("क्या आप इसे अस्वीकृत करना चाहते हैं?")) return;
          btn.disabled = true;
          btn.textContent = "...";
          try {
            await api(`/api/admin/pariwar/${card.dataset.treeId}/reject`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reviewNotes: note }),
            });
            loadTrees();
          } catch (err) {
            alert("Error: " + err.message);
            btn.disabled = false;
            btn.textContent = "❌ अस्वीकृत करें";
          }
        })
      );

      listEl.querySelectorAll(".ptc-publish-gotra").forEach(btn =>
        btn.addEventListener("click", async () => {
          try {
            const result = await api(`/api/admin/gotras/${btn.dataset.gotra}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: "verified" }),
            });
            alert(result.message || "गोत्र सत्यापित हो गया।");
            loadTrees();
          } catch (err) { alert(err.message); }
        })
      );
    } catch (err) {
      listEl.innerHTML = `<div class="admin-empty" style="color:#842d2d">${esc(err.message)}</div>`;
    }
  }

  document.querySelectorAll(".admin-tab[data-admin-view='pariwar-trees']").forEach(tab => {
    tab.addEventListener("click", () => { offset = 0; loadTrees(); });
  });
}());
