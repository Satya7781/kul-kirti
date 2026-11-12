/**
 * mera-pariwar.js
 * ----------------
 * Client logic for /mera-pariwar.html
 *  - Dynamic family member builder
 *  - POST /api/pariwar/create
 *  - Token display + copy
 *  - Token lookup (GET /api/pariwar/:token)
 */

(function () {
  "use strict";
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));

  /* ── Member builder ──────────────────────────────────────────────────── */
  const memberList = document.querySelector("#pariwar-member-list");
  const addBtn     = document.querySelector("#pariwar-add-member");
  const form       = document.querySelector("#pariwar-form");
  const msgEl      = document.querySelector("#pariwar-form-message");
  const successBox = document.querySelector("#pariwar-success");
  const tokenDisplay = document.querySelector("#pariwar-token-display");
  const copyBtn    = document.querySelector("#copy-token-btn");
  const viewLink   = document.querySelector("#view-tree-link");

  const members = [];

  function memberOptions(selected) {
    return `<option value="">— चुनें —</option>` +
      members.map(m =>
        `<option value="${m.clientId}" ${m.clientId === selected ? "selected" : ""}>
          ${escapeHtml(m.name || "नया सदस्य")}
        </option>`
      ).join("");
  }

  function renderMembers() {
    if (!memberList) return;
    memberList.innerHTML = members.map((m, i) => `
      <div class="member-row" data-mid="${m.clientId}">
        <div class="member-row-heading">
          <strong>सदस्य ${i + 1}</strong>
          <button class="remove-member" type="button" data-rm="${m.clientId}">हटाएं</button>
        </div>
        <div class="form-row">
          <label>पूरा नाम *
            <input data-f="name" value="${escapeHtml(m.name)}" required maxlength="120"
              placeholder="जैसे: मोहन सिंह">
          </label>
          <label>संबंध
            <input data-f="relation" value="${escapeHtml(m.relation)}" maxlength="80"
              placeholder="दादा, पिता, पुत्र...">
          </label>
        </div>
        <div class="form-row">
          <label>पिता
            <select data-f="fatherId">${memberOptions(m.fatherId)}</select>
          </label>
          <label>माता
            <select data-f="motherId">${memberOptions(m.motherId)}</select>
          </label>
        </div>
        <div class="form-row">
          <label>जन्म वर्ष
            <input data-f="birthYear" value="${escapeHtml(m.birthYear)}" maxlength="20"
              placeholder="उदा. 1945">
          </label>
          <label>लिंग
            <select data-f="gender">
              <option value="" ${!m.gender ? "selected" : ""}>अज्ञात</option>
              <option value="male" ${m.gender === "male" ? "selected" : ""}>पुरुष</option>
              <option value="female" ${m.gender === "female" ? "selected" : ""}>महिला</option>
              <option value="other" ${m.gender === "other" ? "selected" : ""}>अन्य</option>
            </select>
          </label>
        </div>
        <label>नोट्स
          <input data-f="notes" value="${m.notes || ""}" maxlength="300"
            placeholder="कोई विशेष जानकारी">
        </label>
      </div>`).join("");

    /* Wire inputs — update data only, no re-render on keystroke */
    memberList.querySelectorAll("[data-f]").forEach(el => {
      el.addEventListener("input", () => {
        const row = members.find(x => x.clientId === el.closest("[data-mid]")?.dataset.mid);
        if (row) row[el.dataset.f] = el.value;
      });
    });

    /* Remove buttons */
    memberList.querySelectorAll("[data-rm]").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = members.findIndex(x => x.clientId === btn.dataset.rm);
        if (idx !== -1) { members.splice(idx, 1); renderMembers(); }
      });
    });
  }

  addBtn?.addEventListener("click", () => {
    members.push({ clientId: crypto.randomUUID() });
    renderMembers();
    /* Scroll to new member */
    memberList?.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  /* Auto-add first member */
  addBtn?.click();

  /* ── Form submit ─────────────────────────────────────────────────────── */
  let submitting = false;
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submitting) return;
    submitting = true;

    const submitBtn = form.querySelector("[type=submit]");
    const origText  = submitBtn?.innerHTML;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = "भेज रहे हैं..."; }
    if (msgEl) { msgEl.textContent = ""; msgEl.classList.remove("error"); }

    const data = Object.fromEntries(new FormData(form));
    data.familyMembers = members;

    try {
      const res    = await fetch("/api/pariwar/create", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(data),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);

      /* Show success box */
      form.hidden = true;
      if (successBox) successBox.hidden = false;
      if (tokenDisplay) tokenDisplay.textContent = result.token;
      if (viewLink) viewLink.href = `/mera-pariwar.html?token=${result.token}`;

    } catch (err) {
      if (msgEl) {
        msgEl.textContent = err.message || "कुछ गड़बड़ हो गई। कृपया फिर कोशिश करें।";
        msgEl.classList.add("error");
      }
    } finally {
      submitting = false;
      if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = origText; }
    }
  });

  /* ── Copy token ──────────────────────────────────────────────────────── */
  copyBtn?.addEventListener("click", () => {
    const token = tokenDisplay?.textContent?.trim();
    if (!token) return;
    navigator.clipboard?.writeText(token).then(() => {
      copyBtn.textContent = "✅ कॉपी हो गया!";
      setTimeout(() => { copyBtn.textContent = "📋 Token कॉपी करें"; }, 2500);
    }).catch(() => {
      copyBtn.textContent = "❌ कॉपी नहीं हुआ";
    });
  });

  /* ── Auto-lookup if ?token= is in URL ───────────────────────────────── */
  const urlToken = new URLSearchParams(location.search).get("token");
  if (urlToken) {
    document.querySelector("#token-input") && (document.querySelector("#token-input").value = urlToken);
    lookupTree(urlToken);
  }

  /* ── Token lookup form ───────────────────────────────────────────────── */
  document.querySelector("#token-lookup-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const t = document.querySelector("#token-input")?.value?.trim();
    if (t) lookupTree(t);
  });

  async function lookupTree(token) {
    const resultEl = document.querySelector("#token-lookup-result");
    if (!resultEl) return;
    resultEl.hidden = false;
    resultEl.innerHTML = "<p>लोड हो रहा है...</p>";

    try {
      const res  = await fetch(`/api/pariwar/${encodeURIComponent(token)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Tree not found.");

      const t  = data.tree;
      const ms = Array.isArray(t.familyMembers) ? t.familyMembers : [];

      const statusLabel = { pending: "⏳ समीक्षा में", approved: "✅ स्वीकृत",
        linked: "🔗 जुड़ा हुआ", rejected: "❌ अस्वीकृत" };

      resultEl.innerHTML = `
        <div class="token-tree-card">
          <div class="ttc-header">
            <div>
              <h3>${escapeHtml(t.gotraName)} — ${escapeHtml(t.village)}</h3>
                  <p class="ttc-meta">भेजने वाले: ${escapeHtml(t.creatorName)} · ${new Date(t.submittedAt).toLocaleDateString("hi-IN")}</p>
            </div>
            <span class="ttc-status">${statusLabel[t.status] || t.status}</span>
          </div>
          ${t.reviewNotes ? `<p class="ttc-review-note">Admin नोट: ${escapeHtml(t.reviewNotes)}</p>` : ""}
          <h4 style="margin:16px 0 8px;color:var(--maroon)">परिवार के सदस्य (${ms.length})</h4>
          ${ms.length ? `<div class="ttc-members">${ms.map(m => `
            <div class="ttc-member">
              <strong>${escapeHtml(m.name)}</strong>
              ${m.relation ? `<span class="ttc-rel">${escapeHtml(m.relation)}</span>` : ""}
              ${m.birthYear ? `<span class="ttc-meta">${escapeHtml(m.birthYear)}</span>` : ""}
            </div>`).join("")}</div>` : "<p style='color:var(--muted)'>कोई सदस्य नहीं</p>"}
        </div>`;
    } catch (err) {
      resultEl.innerHTML = `<p style="color:#842d2d;font-size:14px">❌ ${err.message}</p>`;
    }
  }
}());
