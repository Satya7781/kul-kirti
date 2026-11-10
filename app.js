/**
 * Kul-Kirti — app.js
 * -------------------
 * Shared application logic for all pages.
 * Depends on /public/js/i18n.js being loaded first (see HTML <head>).
 *
 * Responsibilities:
 *  1. Inject shared header + footer markup (with data-i18n attributes).
 *  2. Wire the language-switcher toggle.
 *  3. Run I18n.init() so the page renders in the saved language.
 *  4. Drive page-specific features: search, submit form, admin panel,
 *     vanshawali tree viewer.
 */

/* ─────────────────────────────────────────────────────────────────────────────
   1. SHARED HEADER & FOOTER
   ─────────────────────────────────────────────────────────────────────────── */

const headerMarkup = `
<div class="topline">
  <div class="shell topline-inner">
    <span data-i18n="topline.0"></span>
    <span class="topline-rule"></span>
    <span data-i18n="topline.1"></span>
    <span class="topline-rule"></span>
    <span data-i18n="topline.2"></span>
  </div>
</div>
<header class="site-header">
  <div class="shell header-inner">
    <a class="brand" href="/" data-i18n-aria-label="nav.ariaLabel">
      <span class="brand-mark">कु</span>
      <span><strong>कुलकीर्ति</strong><small>GEHLOT RAJPUT ARCHIVE</small></span>
    </a>
    <button class="menu-toggle" data-i18n-aria-label="nav.menuOpen" aria-expanded="false">☰</button>
    <nav class="main-nav" data-i18n-aria-label="nav.mainNav">
      <a href="/"              data-i18n="nav.home"></a>
      <a href="/history.html"  data-i18n="nav.history"></a>
      <a href="/search.html"   data-i18n="nav.gotraSearch"></a>
      <a href="/search.html?type=village" data-i18n="nav.villageSearch"></a>
      <a href="/vanshawali.html" data-i18n="nav.vanshawali"></a>
      <a href="/samiti.html"   data-i18n="nav.samiti"></a>
      <a href="/submit.html"   data-i18n="nav.submit"></a>
    </nav>
    <a class="admin-link" href="/admin.html" data-i18n="nav.admin"></a>
    <button class="language-switch" type="button" aria-label="Switch to English">
      <span>अ</span> English <i>⌄</i>
    </button>
  </div>
</header>`;

const footerMarkup = `
<footer class="site-footer">
  <div class="shell footer-inner">
    <div class="brand footer-brand">
      <span class="brand-mark">कु</span>
      <span><strong>कुलकीर्ति</strong><small>GEHLOT RAJPUT ARCHIVE</small></span>
    </div>
    <p data-i18n-html="footer.tagline"></p>
    <div class="footer-meta">
      <span data-i18n="footer.copyright"></span>
      <a href="/" data-i18n="footer.top"></a>
    </div>
  </div>
</footer>`;

/* inject into shared placeholders */
document.querySelector("#shared-header")?.insertAdjacentHTML("afterbegin", headerMarkup);
document.querySelector("#shared-footer")?.insertAdjacentHTML("afterbegin", footerMarkup);

/* ── mark active nav link ───────────────────────────────────────────────── */
(function markActiveNav() {
  const path = window.location.pathname;
  document.querySelectorAll(".main-nav a").forEach(link => {
    const href = link.getAttribute("href").split("?")[0];
    const isHome = href === "/" && (path === "/" || path === "/index.html");
    const isMatch = !isHome && path.endsWith(href.replace(/^\//, ""));
    if (isHome || isMatch) link.classList.add("active");
  });
}());

/* ── mobile menu toggle ────────────────────────────────────────────────── */
const menuToggle = document.querySelector(".menu-toggle");
const mainNav    = document.querySelector(".main-nav");
menuToggle?.addEventListener("click", () => {
  const open = mainNav.classList.toggle("open");
  menuToggle.setAttribute("aria-expanded", String(open));
});
mainNav?.querySelectorAll("a").forEach(link =>
  link.addEventListener("click", () => mainNav.classList.remove("open"))
);

/* ─────────────────────────────────────────────────────────────────────────────
   2. LANGUAGE SWITCHER
   ─────────────────────────────────────────────────────────────────────────── */

document.addEventListener("click", e => {
  if (!e.target.closest(".language-switch")) return;
  const next = I18n.lang === "hi" ? "en" : "hi";
  I18n.setLanguage(next);
});

/* ─────────────────────────────────────────────────────────────────────────────
   3. BOOTSTRAP i18n  (loads dicts, applies translations, updates meta)
   ─────────────────────────────────────────────────────────────────────────── */

I18n.init();   /* defined in /public/js/i18n.js — always loaded before app.js */

/* ─────────────────────────────────────────────────────────────────────────────
   4. SEARCH PAGE
   ─────────────────────────────────────────────────────────────────────────── */

const searchInput   = document.querySelector("#search-input");
const searchResults = document.querySelector("#search-results");
const searchForm    = document.querySelector("#record-search");
const tabs          = document.querySelectorAll(".search-tab");

let searchType = new URLSearchParams(location.search).get("type") === "village"
  ? "village"
  : "gotra";

/** Re-translate dynamically rendered search UI strings after lang change. */
function applySearchLang() {
  if (!searchInput) return;
  const isVillage = searchType === "village";
  searchInput.placeholder = I18n.t(isVillage ? "search.phVillage" : "search.phGotra");
  document.querySelectorAll(".search-tab").forEach(tab => {
    tab.textContent = I18n.t(
      tab.dataset.searchType === "village" ? "search.tabVillage" : "search.tabGotra"
    );
  });
  /* re-render current empty state with new language */
  if (searchResults && !searchResults.querySelector(".result-card")) {
    renderResults([], searchInput.value);
  }
}
document.addEventListener("languagechange", applySearchLang);

async function getRecords(query) {
  const response = await fetch(
    `/api/records?type=${encodeURIComponent(searchType)}&q=${encodeURIComponent(query)}`
  );
  if (!response.ok) throw new Error(I18n.t("search.errorLoad"));
  return (await response.json()).records;
}

function renderResults(records, query) {
  if (!searchResults) return;
  if (!records.length) {
    const isEmpty  = !query;
    const icon     = isEmpty ? "⌖" : "⌕";
    const msg      = I18n.t(isEmpty ? "search.emptyDefault" : "search.emptyQuery");
    const note     = I18n.t(isEmpty ? "search.emptyNote"    : "search.emptyQueryNote");
    searchResults.innerHTML =
      `<div class="empty-state">
        <span class="empty-icon">${icon}</span>
        <p>${msg}</p>
        <small>${note}</small>
      </div>`;
    return;
  }
  const summary = I18n.t("search.resultSummary", { count: records.length });
  searchResults.innerHTML =
    `<p class="result-summary">${summary}</p>` +
    records.map(record => {
      const loc  = [record.village, record.district, record.state].filter(Boolean).join(" · ");
      const tag  = record.familyDetails?.length
        ? I18n.t("search.viewTree")
        : I18n.t("search.verifiedRecord");
      return `<article class="result-card">
        <div>
          <h3>${record.name}</h3>
          <p>${loc}</p>
        </div>
        <a class="result-tag" href="/vanshawali.html?id=${record.id}">${tag}</a>
      </article>`;
    }).join("");
}

async function search(query) {
  try {
    renderResults(await getRecords(query), query);
  } catch (error) {
    if (searchResults)
      searchResults.innerHTML = `<div class="empty-state"><p>${error.message}</p></div>`;
  }
}

if (searchInput && searchResults && searchForm) {
  tabs.forEach(tab =>
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      searchType = tab.dataset.searchType;
      searchInput.placeholder = I18n.t(
        searchType === "village" ? "search.phVillage" : "search.phGotra"
      );
      searchInput.value = "";
      search("");
    })
  );
  if (searchType === "village") document.querySelector('[data-search-type="village"]')?.click();

  searchForm.addEventListener("submit", e => { e.preventDefault(); search(searchInput.value); });

  document.querySelectorAll(".hint-link").forEach(hint =>
    hint.addEventListener("click", () => {
      const query = hint.dataset.query;
      if (query === "उदयपुर" || query === "Udaipur")
        document.querySelector('[data-search-type="village"]')?.click();
      if (query === "सिसोदिया" || query === "Sisodia")
        document.querySelector('[data-search-type="gotra"]')?.click();
      searchInput.value = query;
      search(query);
    })
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   5. SUBMIT FORM
   ─────────────────────────────────────────────────────────────────────────── */

const submissionForm = document.querySelector("#submission-form");
if (submissionForm) {
  const message    = document.querySelector("#submission-message");
  const memberList = document.querySelector("#member-list");
  const members    = [];

  function memberOptions(selected) {
    return `<option value="">${I18n.t("submit.unknown")}</option>` +
      members.map(m =>
        `<option value="${m.clientId}" ${m.clientId === selected ? "selected" : ""}>
          ${m.name || I18n.t("submit.newMember")}
        </option>`
      ).join("");
  }

  function renderMembers() {
    memberList.innerHTML = members.map((member, index) =>
      `<div class="member-row" data-member="${member.clientId}">
        <div class="member-row-heading">
          <strong>${I18n.t("submit.memberLabel", { n: index + 1 })}</strong>
          <button class="remove-member" type="button" data-remove="${member.clientId}">
            ${I18n.t("submit.remove")}
          </button>
        </div>
        <div class="form-row">
          <label>${I18n.t("submit.fullName")}
            <input data-field="name" value="${member.name || ""}" required maxlength="120"
              placeholder="${I18n.t("submit.fullNamePh")}">
          </label>
          <label>${I18n.t("submit.relation")}
            <input data-field="relation" value="${member.relation || ""}" maxlength="80"
              placeholder="${I18n.t("submit.relationPh")}">
          </label>
        </div>
        <div class="form-row">
          <label>${I18n.t("submit.father")}
            <select data-field="fatherId">${memberOptions(member.fatherId)}</select>
          </label>
          <label>${I18n.t("submit.mother")}
            <select data-field="motherId">${memberOptions(member.motherId)}</select>
          </label>
        </div>
        <div class="form-row">
          <label>${I18n.t("submit.birthYear")}
            <input data-field="birthYear" value="${member.birthYear || ""}" maxlength="20"
              placeholder="${I18n.t("submit.birthYearPh")}">
          </label>
          <label>${I18n.t("submit.gender")}
            <input data-field="gender" value="${member.gender || ""}" maxlength="30">
          </label>
        </div>
        <label>${I18n.t("submit.notes")}
          <input data-field="notes" value="${member.notes || ""}" maxlength="300"
            placeholder="${I18n.t("submit.notesPerson")}">
        </label>
      </div>`
    ).join("");

    /* wire field inputs */
    memberList.querySelectorAll("[data-field]").forEach(input =>
      input.addEventListener("input", () => {
        const row = members.find(m => m.clientId === input.closest("[data-member]").dataset.member);
        if (row) {
          row[input.dataset.field] = input.value;
          if (input.dataset.field === "name") renderMembers();
        }
      })
    );
    /* wire remove buttons */
    memberList.querySelectorAll("[data-remove]").forEach(btn =>
      btn.addEventListener("click", () => {
        const idx = members.findIndex(m => m.clientId === btn.dataset.remove);
        if (idx !== -1) { members.splice(idx, 1); renderMembers(); }
      })
    );
  }

  document.querySelector("#add-member")?.addEventListener("click", () => {
    members.push({ clientId: crypto.randomUUID() });
    renderMembers();
  });
  /* add first member automatically */
  document.querySelector("#add-member")?.click();

  /* re-render when language changes so labels update */
  document.addEventListener("languagechange", () => { if (members.length) renderMembers(); });

  submissionForm.addEventListener("submit", async e => {
    e.preventDefault();
    const formData = Object.fromEntries(new FormData(submissionForm));
    formData.familyDetails = members;
    try {
      const res    = await fetch("/api/submissions", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(formData),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      message.textContent = result.message;
      message.classList.remove("error");
      submissionForm.reset();
      members.splice(0);
      renderMembers();
    } catch (error) {
      message.textContent = error.message;
      message.classList.add("error");
    }
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
   6. VANSHAWALI / TREE VIEWER
   ─────────────────────────────────────────────────────────────────────────── */

(async function initTree() {
  const treeContainer = document.querySelector("#published-tree");
  if (!treeContainer) return;

  const id = new URLSearchParams(location.search).get("id");
  if (!id) return; /* default placeholder content already in HTML */

  try {
    const res    = await fetch(`/api/records/${id}/tree`);
    if (!res.ok)  return;
    const { record } = await res.json();

    const people = Array.isArray(record.familyDetails) ? record.familyDetails : [];
    if (!people.length) {
      treeContainer.innerHTML =
        `<p class="form-note">${I18n.t("vanshawali.noMembers")}</p>`;
      return;
    }

    treeContainer.innerHTML =
      `<h2 class="tree-record-heading">${record.name}</h2>
       <p>${[record.village, record.district, record.state].filter(Boolean).join(" · ")}</p>` +
      people.map(person =>
        `<div class="published-person">
          <strong>${person.name}</strong>
          <span>${person.relation || ""}</span>
          ${person.birthYear ? `<span> · ${person.birthYear}</span>` : ""}
          ${person.deathYear ? `<span> – ${person.deathYear}</span>` : ""}
          <small>ID: ${person.id}${person.fatherId ? ` · ${I18n.t("vanshawali.flow1").split("→")[0].trim()}: ${person.fatherId}` : ""}</small>
        </div>`
      ).join("");
  } catch (_) { /* silent – default placeholder stays */ }
}());

/* ─────────────────────────────────────────────────────────────────────────────
   7. ADMIN PANEL
   ─────────────────────────────────────────────────────────────────────────── */

const adminLogin      = document.querySelector("#admin-login-form");
const adminLoginBox   = document.querySelector("#admin-login");
const adminPanel      = document.querySelector("#admin-panel");
const adminSubmissions= document.querySelector("#admin-submissions");

/* ── render submissions list ─────────────────────────────────────────────── */
async function loadSubmissions() {
  if (!adminSubmissions) return;
  const response = await fetch("/api/admin/submissions", { credentials: "include" });
  if (!response.ok) throw new Error(I18n.t("common.sessionExpired"));
  const submissions = (await response.json()).submissions;

  if (!submissions.length) {
    adminSubmissions.innerHTML =
      `<div class="admin-empty">${I18n.t("admin.noSubmissions")}</div>`;
    return;
  }

  adminSubmissions.innerHTML = submissions.map(item => {
    const loc = [item.village, item.district, item.state].filter(Boolean).join(" · ");
    const membersSummary = item.familyDetails?.length
      ? `<details>
           <summary>${I18n.t("admin.memberCount", { n: item.familyDetails.length })}</summary>
           <div class="admin-family-list">
             ${item.familyDetails.map(person =>
               `<div>
                  <strong>${person.name}</strong> · ${person.relation || I18n.t("common.family")}
                  <small>
                    ${I18n.t("admin.idLabel")}: ${person.id}
                    ${person.fatherId ? ` · ${I18n.t("admin.fatherLabel")}: ${person.fatherId}` : ""}
                    ${person.motherId ? ` · ${I18n.t("admin.motherLabel")}: ${person.motherId}` : ""}
                  </small>
                </div>`
             ).join("")}
           </div>
         </details>`
      : "";
    const statusLabel = I18n.t(`common.${item.status}`) || item.status;
    const actions = item.status === "pending"
      ? `<div class="admin-actions">
           <button class="approve" data-id="${item.id}" data-status="approved">
             ${I18n.t("admin.approveBtn")}
           </button>
           <button class="reject" data-id="${item.id}" data-status="rejected">
             ${I18n.t("admin.rejectBtn")}
           </button>
         </div>`
      : "";
    return `<article class="admin-submission">
      <h3>${item.name} <span class="result-tag">${item.type}</span></h3>
      <p>${loc}</p>
      <p>${I18n.t("admin.contributor")}: ${item.contributorName}${item.contributorContact ? ` · ${item.contributorContact}` : ""}</p>
      <p>${item.notes || I18n.t("admin.noNotes")}</p>
      ${membersSummary}
      <p><strong>${I18n.t("admin.statusLabel")}:</strong> ${statusLabel}</p>
      ${actions}
    </article>`;
  }).join("");

  /* wire approve/reject buttons */
  adminSubmissions.querySelectorAll("[data-id]").forEach(btn =>
    btn.addEventListener("click", async () => {
      await fetch(`/api/admin/submissions/${btn.dataset.id}`, {
        method:      "PATCH",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({ status: btn.dataset.status }),
      });
      loadSubmissions();
    })
  );
}

/* ── admin login ─────────────────────────────────────────────────────────── */
if (adminLogin) {
  adminLogin.addEventListener("submit", async e => {
    e.preventDefault();
    const response = await fetch("/api/admin/login", {
      method:      "POST",
      credentials: "include",
      headers:     { "Content-Type": "application/json" },
      body:        JSON.stringify({
        email:    document.querySelector("#admin-email").value,
        password: document.querySelector("#admin-password").value,
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      document.querySelector("#admin-login-message").textContent = result.error;
      return;
    }
    adminLoginBox.hidden = true;
    adminPanel.hidden    = false;
    loadSubmissions();
  });

  document.querySelector("#admin-logout")?.addEventListener("click", async () => {
    await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
    adminPanel.hidden    = true;
    adminLoginBox.hidden = false;
  });
}

/* ── admin tabs ──────────────────────────────────────────────────────────── */
const adminTabs  = document.querySelectorAll(".admin-tab");
const adminViews = {
  submissions:    document.querySelector("#admin-submissions"),
  gotras:         document.querySelector("#admin-gotras"),
  "family-builder": document.querySelector("#admin-family-builder"),
};
adminTabs.forEach(tab =>
  tab.addEventListener("click", () => {
    adminTabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    Object.entries(adminViews).forEach(([name, view]) => {
      if (view) view.hidden = name !== tab.dataset.adminView;
    });
    if (tab.dataset.adminView === "gotras") loadGotras();
  })
);

/* ── gotra management ────────────────────────────────────────────────────── */
const gotraForm    = document.querySelector("#gotra-form");
const gotraMembers = [];

function renderGotraMembers() {
  const list = document.querySelector("#gotra-member-list");
  if (!list) return;
  list.innerHTML = gotraMembers.map((member, index) =>
    `<div class="member-row" data-gotra-member="${member.clientId}">
      <div class="member-row-heading">
        <strong>${I18n.t("admin.memberLabel", { n: index + 1 })}</strong>
        <button class="remove-member" type="button" data-remove-gotra-member="${member.clientId}">
          ${I18n.t("admin.remove")}
        </button>
      </div>
      <div class="form-row">
        <label>${I18n.t("admin.fullName")}
          <input data-gotra-field="personName" value="${member.personName || ""}" required>
        </label>
        <label>${I18n.t("admin.roleRelation")}
          <input data-gotra-field="relationOrRole" value="${member.relationOrRole || ""}"
            placeholder="${I18n.t("admin.roleRelationPh")}">
        </label>
      </div>
      <div class="form-row">
        <label>${I18n.t("admin.village")}
          <input data-gotra-field="village" value="${member.village || ""}">
        </label>
        <label>${I18n.t("admin.district")}
          <input data-gotra-field="district" value="${member.district || ""}">
        </label>
      </div>
      <label>${I18n.t("admin.state")}
        <input data-gotra-field="state" value="${member.state || ""}">
      </label>
      <label>${I18n.t("admin.notes")}
        <input data-gotra-field="notes" value="${member.notes || ""}">
      </label>
    </div>`
  ).join("");

  list.querySelectorAll("[data-gotra-field]").forEach(input =>
    input.addEventListener("input", () => {
      const member = gotraMembers.find(
        m => m.clientId === input.closest("[data-gotra-member]").dataset.gotraMember
      );
      if (member) member[input.dataset.gotraField] = input.value;
    })
  );
  list.querySelectorAll("[data-remove-gotra-member]").forEach(btn =>
    btn.addEventListener("click", () => {
      const idx = gotraMembers.findIndex(
        m => m.clientId === btn.dataset.removeGotraMember
      );
      if (idx !== -1) { gotraMembers.splice(idx, 1); renderGotraMembers(); }
    })
  );
}

document.querySelector("#add-gotra-member")?.addEventListener("click", () => {
  gotraMembers.push({ clientId: crypto.randomUUID() });
  renderGotraMembers();
});

async function loadGotras() {
  const container = document.querySelector("#gotra-list");
  if (!container) return;
  const response = await fetch("/api/admin/gotras", { credentials: "include" });
  if (!response.ok) return;
  const gotras = (await response.json()).gotras;
  container.innerHTML = gotras.length
    ? gotras.map(gotra =>
        `<article class="admin-submission">
          <h3>${gotra.name}</h3>
          <p>${I18n.t("admin.gotraOrigin")}: ${gotra.originPlace || I18n.t("admin.unknownPlace")}
             · ${I18n.t("admin.gotraFounder")}: ${gotra.founderName || I18n.t("admin.unknownPlace")}</p>
          <p>${gotra.memberCount} ${I18n.t("admin.memberStatus")}: ${gotra.status}</p>
          <p>${gotra.sourceReferences || I18n.t("admin.noSourceRef")}</p>
        </article>`
      ).join("")
    : `<div class="admin-empty">${I18n.t("admin.noGotra")}</div>`;
}

gotraForm?.addEventListener("submit", async e => {
  e.preventDefault();
  const payload    = Object.fromEntries(new FormData(gotraForm));
  payload.members  = gotraMembers;
  const response   = await fetch("/api/admin/gotras", {
    method:      "POST",
    credentials: "include",
    headers:     { "Content-Type": "application/json" },
    body:        JSON.stringify(payload),
  });
  const result  = await response.json();
  const msgEl   = document.querySelector("#gotra-message");
  msgEl.textContent = response.ok ? result.message : result.error;
  msgEl.classList.toggle("error", !response.ok);
  if (response.ok) {
    gotraForm.reset();
    gotraMembers.splice(0);
    renderGotraMembers();
    loadGotras();
  }
});

/* ── admin family builder ────────────────────────────────────────────────── */
const adminFamilyForm    = document.querySelector("#admin-family-form");
const adminFamilyMembers = [];

function renderAdminFamilyMembers() {
  const list = document.querySelector("#admin-member-list");
  if (!list) return;

  const options = selected =>
    `<option value="">${I18n.t("admin.unknown")}</option>` +
    adminFamilyMembers.map(m =>
      `<option value="${m.clientId}" ${m.clientId === selected ? "selected" : ""}>
        ${m.name || I18n.t("admin.newPerson")}
      </option>`
    ).join("");

  list.innerHTML = adminFamilyMembers.map((member, index) =>
    `<div class="member-row admin-member-box" data-admin-member="${member.clientId}">
      <div class="member-row-heading">
        <strong>${I18n.t("admin.personLabel", { n: index + 1 })}</strong>
        <button class="remove-member" type="button" data-remove-admin-member="${member.clientId}">
          ${I18n.t("admin.remove")}
        </button>
      </div>
      <div class="form-row">
        <label>${I18n.t("admin.fullName")}
          <input data-admin-field="name" value="${member.name || ""}" required maxlength="120"
            placeholder="${I18n.t("submit.fullNamePh")}">
        </label>
        <label>${I18n.t("admin.relationField")}
          <input data-admin-field="relation" value="${member.relation || ""}" maxlength="80"
            placeholder="${I18n.t("admin.relationPh")}">
        </label>
      </div>
      <div class="form-row">
        <label>${I18n.t("admin.father")}
          <select data-admin-field="fatherId">${options(member.fatherId)}</select>
        </label>
        <label>${I18n.t("admin.mother")}
          <select data-admin-field="motherId">${options(member.motherId)}</select>
        </label>
      </div>
      <div class="form-row">
        <label>${I18n.t("admin.birthYear")}
          <input data-admin-field="birthYear" value="${member.birthYear || ""}" maxlength="20"
            placeholder="${I18n.t("admin.birthYearPh")}">
        </label>
        <label>${I18n.t("admin.deathYear")}
          <input data-admin-field="deathYear" value="${member.deathYear || ""}" maxlength="20"
            placeholder="${I18n.t("admin.deathYearPh")}">
        </label>
      </div>
      <div class="form-row">
        <label>${I18n.t("admin.gender")}
          <input data-admin-field="gender" value="${member.gender || ""}" maxlength="30">
        </label>
        <label>${I18n.t("admin.notes")}
          <input data-admin-field="notes" value="${member.notes || ""}" maxlength="300"
            placeholder="${I18n.t("admin.notesPh")}">
        </label>
      </div>
    </div>`
  ).join("");

  list.querySelectorAll("[data-admin-field]").forEach(input =>
    input.addEventListener("input", () => {
      const member = adminFamilyMembers.find(
        m => m.clientId === input.closest("[data-admin-member]").dataset.adminMember
      );
      if (member) {
        member[input.dataset.adminField] = input.value;
        if (input.dataset.adminField === "name") renderAdminFamilyMembers();
      }
    })
  );
  list.querySelectorAll("[data-remove-admin-member]").forEach(btn =>
    btn.addEventListener("click", () => {
      const idx = adminFamilyMembers.findIndex(
        m => m.clientId === btn.dataset.removeAdminMember
      );
      if (idx !== -1) { adminFamilyMembers.splice(idx, 1); renderAdminFamilyMembers(); }
    })
  );
}

document.querySelector("#add-admin-member")?.addEventListener("click", () => {
  adminFamilyMembers.push({ clientId: crypto.randomUUID() });
  renderAdminFamilyMembers();
});

/* re-render member lists when language changes */
document.addEventListener("languagechange", () => {
  if (gotraMembers.length)       renderGotraMembers();
  if (adminFamilyMembers.length) renderAdminFamilyMembers();
  /* re-translate static admin tab labels */
  const tabMap = {
    submissions:      "admin.tabSubmissions",
    gotras:           "admin.tabGotras",
    "family-builder": "admin.tabFamily",
  };
  document.querySelectorAll(".admin-tab").forEach(tab => {
    const key = tabMap[tab.dataset.adminView];
    if (key) tab.textContent = I18n.t(key);
  });
});

adminFamilyForm?.addEventListener("submit", async e => {
  e.preventDefault();
  const payload          = Object.fromEntries(new FormData(adminFamilyForm));
  payload.familyDetails  = adminFamilyMembers;
  const response = await fetch("/api/admin/family-records", {
    method:      "POST",
    credentials: "include",
    headers:     { "Content-Type": "application/json" },
    body:        JSON.stringify(payload),
  });
  const result = await response.json();
  const msgEl  = document.querySelector("#admin-family-message");
  msgEl.textContent = response.ok ? result.message : result.error;
  msgEl.classList.toggle("error", !response.ok);
  if (response.ok) {
    adminFamilyForm.reset();
    adminFamilyMembers.splice(0);
    renderAdminFamilyMembers();
  }
});
