/**
 * admin-pariwar.js
 * -----------------
 * Admin panel logic for the "परिवार वृक्ष" tab.
 * Loads public_family_trees, renders each with a link/reject action.
 * Linked via admin.html <script> tag.
 */

(function () {
  "use strict";

  const listEl = document.querySelector("#pariwar-trees-list");
  const filterBtns = document.querySelectorAll(".pft");
  if (!listEl) return;

  let currentStatus = "pending";

  /* ── Filter tabs ─────────────────────────────────────────────────────── */
  filterBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      filterBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentStatus = btn.dataset.pftStatus;
      loadTrees();
    });
  });

  /* ── Load trees ──────────────────────────────────────────────────────── */
  async function loadTrees() {
    if (!listEl) return;
    listEl.innerHTML = `<div class="admin-empty">लोड हो रहा है...</div>`;
    try {
      const res = await fetch(`/api/admin/pariwar?status=${currentStatus}`, { credentials: "include" });
      if (!res.ok) throw new Error("Session expired.");
      const { trees } = await res.json();

      if (!trees.length) {
        listEl.innerHTML = `<div class="admin-empty">कोई ${currentStatus} tree नहीं है।</div>`;
        return;
      }

      /* Also fetch all gotras for the link dropdown */
      let allGotras = [];
      try {
        const gr = await fetch("/api/admin/gotras/all", { credentials: "include" });
        if (gr.ok) allGotras = (await gr.json()).gotras;
      } catch (_) { /* silent */ }

      const gotraOptions = `<option value="">— नया गोत्र बनाएं —</option>` +
        allGotras.map(g => `<option value="${g.id}">${g.name} (${g.status})</option>`).join("");

      listEl.innerHTML = trees.map(tree => {
        const members = Array.isArray(tree.familyMembers) ? tree.familyMembers : [];
        const memberCount = members.length;
        return `
          <div class="pariwar-tree-card" data-tree-id="${tree.id}">
            <div class="ptc-header">
              <div>
                <h4>${tree.gotraName}</h4>
                <div class="ptc-meta">
                  <span>📛 ${tree.creatorName}</span>
                  ${tree.creatorContact ? `<span>📞 ${tree.creatorContact}</span>` : ""}
                  ${tree.village ? `<span>🏘️ ${tree.village}${tree.district ? ", " + tree.district : ""}${tree.state ? ", " + tree.state : ""}</span>` : ""}
                  <span>👨‍👩‍👦 ${memberCount} सदस्य</span>
                  <span>📅 ${new Date(tree.submittedAt).toLocaleDateString("hi-IN")}</span>
                </div>
              </div>
              <span class="ptc-status-badge ptc-${tree.status}">${tree.status}</span>
            </div>

            ${members.length ? `
              <details class="ptc-members-details">
                <summary>${memberCount} परिवार सदस्य देखें</summary>
                <div class="ptc-members-grid">
                  ${members.map(m => `
                    <div class="ptc-member">
                      <strong>${m.name}</strong>
                      ${m.relation ? `<span>${m.relation}</span>` : ""}
                      ${m.birthYear ? `<span>${m.birthYear}</span>` : ""}
                      ${m.gender && m.gender !== "unknown" ? `<span>${m.gender === "male" ? "पुरुष" : m.gender === "female" ? "महिला" : "अन्य"}</span>` : ""}
                    </div>`).join("")}
                </div>
              </details>` : ""}

            ${tree.notes ? `<p class="ptc-notes">${tree.notes}</p>` : ""}

            ${tree.status === "pending" ? `
              <div class="ptc-actions">
                <div class="ptc-link-form">
                  <label class="ptc-label">गोत्र से जोड़ें (या नया बनाएं):
                    <select class="ptc-gotra-select">
                      ${gotraOptions}
                    </select>
                  </label>
                  <label class="ptc-label">समीक्षा नोट (वैकल्पिक):
                    <input class="ptc-review-note" type="text" maxlength="500"
                      placeholder="Admin का नोट..." />
                  </label>
                  <button class="button button-gold ptc-link-btn" type="button">
                    🔗 Link करें (${memberCount} सदस्य)
                  </button>
                  <button class="button ptc-reject-btn" type="button"
                    style="background:#f3d9d9;color:#842d2d">
                    ❌ अस्वीकृत करें
                  </button>
                </div>
              </div>` : ""}

            ${tree.status === "linked" ? `
              <p class="ptc-linked-note">
                ✅ ${memberCount} सदस्य वंशावली में जोड़े गए।
                ${tree.reviewNotes ? " · " + tree.reviewNotes : ""}
              </p>` : ""}
          </div>`;
      }).join("");

      /* Wire Link buttons */
      listEl.querySelectorAll(".ptc-link-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
          const card     = btn.closest(".pariwar-tree-card");
          const treeId   = card.dataset.treeId;
          const gotraId  = card.querySelector(".ptc-gotra-select")?.value || "";
          const note     = card.querySelector(".ptc-review-note")?.value || "";

          if (!confirm(`क्या आप इस परिवार वृक्ष को वंशावली से जोड़ना चाहते हैं?`)) return;

          btn.disabled    = true;
          btn.textContent = "जोड़ रहे हैं...";
          try {
            const res = await fetch(`/api/admin/pariwar/${treeId}/link`, {
              method:      "POST",
              credentials: "include",
              headers:     { "Content-Type": "application/json" },
              body:        JSON.stringify({ gotraId: gotraId || undefined, reviewNotes: note }),
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error);
            alert(result.message);
            loadTrees();
          } catch (err) {
            alert("Error: " + err.message);
            btn.disabled    = false;
            btn.textContent = `🔗 Link करें`;
          }
        });
      });

      /* Wire Reject buttons */
      listEl.querySelectorAll(".ptc-reject-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
          const card   = btn.closest(".pariwar-tree-card");
          const treeId = card.dataset.treeId;
          const note   = card.querySelector(".ptc-review-note")?.value || "";

          if (!confirm("क्या आप इसे अस्वीकृत करना चाहते हैं?")) return;

          btn.disabled    = true;
          btn.textContent = "...";
          try {
            const res = await fetch(`/api/admin/pariwar/${treeId}/reject`, {
              method:      "POST",
              credentials: "include",
              headers:     { "Content-Type": "application/json" },
              body:        JSON.stringify({ reviewNotes: note }),
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error);
            loadTrees();
          } catch (err) {
            alert("Error: " + err.message);
            btn.disabled    = false;
            btn.textContent = "❌ अस्वीकृत करें";
          }
        });
      });

    } catch (err) {
      listEl.innerHTML = `<div class="admin-empty" style="color:#842d2d">${err.message}</div>`;
    }
  }

  /* ── Wire admin tab click ────────────────────────────────────────────── */
  document.querySelectorAll(".admin-tab[data-admin-view='pariwar-trees']").forEach(tab => {
    tab.addEventListener("click", loadTrees);
  });

}());
