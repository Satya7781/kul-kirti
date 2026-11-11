/**
 * Kul-Kirti — app.js
 * -------------------
 * Shared application logic for all pages.
 * Depends on /public/js/i18n.js being loaded first (see HTML <head>).
 *
 * Changes vs. previous version:
 *  - Skip-to-main-content link added to header (Task 8)
 *  - Language-switcher lang attr wraps only the label text (Task 14)
 *  - Search/admin tab ARIA roles wired (Task 7)
 *  - Duplicate form-submit prevention on all 4 forms (Task 4)
 *  - loadSubmissions / loadGotras wrapped in try/catch (Task 5)
 *  - Name-field re-render replaced with in-place update (Task 6)
 *  - Approve/reject: confirmation dialog + error handling (Task 9)
 *  - Copyright year rendered dynamically (Task 10)
 *  - Dead English hint-link conditions removed (Task 17)
 */

/* ─────────────────────────────────────────────────────────────────────────────
   1. SHARED HEADER & FOOTER
   ─────────────────────────────────────────────────────────────────────────── */

const headerMarkup = `
<a class="skip-link" href="#main-content" data-i18n="nav.skipToMain">मुख्य सामग्री पर जाएं</a>
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
    <button class="language-switch" type="button">
      <span class="lang-char" aria-hidden="true">अ</span>
      <span class="lang-label">English</span>
      <i aria-hidden="true">⌄</i>
    </button>
  </div>
</header>`;

/* Dynamic copyright year — avoids hardcoding the year in locale JSON */
const currentYear = new Date().getFullYear();

const footerMarkup = `
<footer class="site-footer">
  <div class="shell footer-inner">
    <div class="brand footer-brand">
      <span class="brand-mark">कु</span>
      <span><strong>कुलकीर्ति</strong><small>GEHLOT RAJPUT ARCHIVE</small></span>
    </div>
    <p data-i18n-html="footer.tagline"></p>
    <div class="footer-meta">
      <span class="footer-copyright" data-year="${currentYear}"></span>
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
    const href   = link.getAttribute("href").split("?")[0];
    const isHome = href === "/" && (path === "/" || path === "/index.html");
    const isMatch = !isHome && path.endsWith(href.replace(/^\//, ""));
    if (isHome || isMatch) link.classList.add("active");
  });
}());

/* ── mobile menu toggle ─────────────────────────────────────────────────── */
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
  I18n.setLanguage(I18n.lang === "hi" ? "en" : "hi");
});

/* Override i18n.js _applyLangSwitcher so only the visible label gets the
   lang attribute — the Devanagari glyph sits in its own span without it. */
function _applyLangSwitcherLocal() {
  const isHi = I18n.lang === "hi";
  document.querySelectorAll(".language-switch").forEach(btn => {
    const charEl  = btn.querySelector(".lang-char");
    const labelEl = btn.querySelector(".lang-label");
    if (charEl)  charEl.textContent = isHi ? "अ" : "A";
    if (labelEl) {
      labelEl.textContent = I18n.t("langSwitch.label");
      /* Only the label text is in the other language */
      labelEl.setAttribute("lang", isHi ? "en" : "hi");
    }
    btn.setAttribute("aria-label", I18n.t("langSwitch.ariaSwitch"));
  });
}

/* Update copyright with live year after each language switch */
function _applyCopyright() {
  document.querySelectorAll(".footer-copyright").forEach(el => {
    const year  = el.dataset.year || new Date().getFullYear();
    const brand = I18n.lang === "hi" ? "कुलकीर्ति" : "Kul-Kirti";
    el.textContent = `© ${year} ${brand}`;
  });
}

document.addEventListener("languagechange", () => {
  _applyLangSwitcherLocal();
  _applyCopyright();
  /* re-translate search tabs */
  applySearchLang();
  /* re-translate admin tabs */
  const tabMap = {
    submissions:      "admin.tabSubmissions",
    gotras:           "admin.tabGotras",
    "family-builder": "admin.tabFamily",
  };
  document.querySelectorAll(".admin-tab").forEach(tab => {
    const key = tabMap[tab.dataset.adminView];
    if (key) tab.textContent = I18n.t(key);
    /* keep aria-selected in sync */
    _syncTabAria(tab);
  });
  if (gotraMembers.length)       renderGotraMembers();
  if (adminFamilyMembers.length) renderAdminFamilyMembers();
});

/* ─────────────────────────────────────────────────────────────────────────────
   3. BOOTSTRAP i18n
   ─────────────────────────────────────────────────────────────────────────── */

I18n.init().then(() => {
  _applyLangSwitcherLocal();
  _applyCopyright();
});

/* ─────────────────────────────────────────────────────────────────────────────
   3a. SCROLL-REVEAL ANIMATIONS  (IntersectionObserver)
   ─────────────────────────────────────────────────────────────────────────── */

(function initScrollReveal() {
  /* Tag every major section with .reveal so they animate in on scroll */
  const revealSelectors = [
    ".section",
    ".page-hero",
    ".empty-directory",
    ".notfound-section",
    ".admin-section",
  ];
  revealSelectors.forEach(sel =>
    document.querySelectorAll(sel).forEach(el => el.classList.add("reveal"))
  );

  /* Tag staggered children groups */
  document.querySelectorAll(".portal-grid, .heritage-grid, .chapter-list, .flow-list")
    .forEach(el => el.classList.add("reveal-stagger"));

  /* Skip if IntersectionObserver is unavailable or reduced-motion is set */
  if (!("IntersectionObserver" in window)) {
    document.querySelectorAll(".reveal, .reveal-stagger")
      .forEach(el => el.classList.add("revealed"));
    return;
  }

  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    document.querySelectorAll(".reveal, .reveal-stagger")
      .forEach(el => el.classList.add("revealed"));
    return;
  }

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("revealed");
        obs.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.12,
    rootMargin: "0px 0px -40px 0px",
  });

  document.querySelectorAll(".reveal, .reveal-stagger").forEach(el => observer.observe(el));
}());

/* ─────────────────────────────────────────────────────────────────────────────
   3b. STICKY HEADER SHADOW ON SCROLL
   ─────────────────────────────────────────────────────────────────────────── */

(function initHeaderScroll() {
  const header = document.querySelector(".site-header");
  if (!header) return;
  let ticking = false;
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      header.classList.toggle("scrolled", window.scrollY > 8);
      ticking = false;
    });
  }, { passive: true });
}());

/* ─────────────────────────────────────────────────────────────────────────────
   4. SEARCH PAGE
   ─────────────────────────────────────────────────────────────────────────── */

const searchInput   = document.querySelector("#search-input");
const searchResults = document.querySelector("#search-results");
const searchForm    = document.querySelector("#record-search");
const tabs          = document.querySelectorAll(".search-tab");

let searchType = new URLSearchParams(location.search).get("type") === "village"
  ? "village" : "gotra";

/** Sync tab ARIA attributes (search tabs + admin tabs share the same helper). */
function _syncTabAria(tab) {
  const isActive = tab.classList.contains("active");
  tab.setAttribute("aria-selected", String(isActive));
  /* aria-controls points to the panel this tab reveals */
  const panelId = tab.dataset.adminView
    ? `admin-${tab.dataset.adminView}`
    : (tab.dataset.searchType === "village" ? "search-results" : "search-results");
  if (!tab.getAttribute("aria-controls") && panelId) {
    tab.setAttribute("aria-controls", panelId);
  }
}

/** Wire search tab ARIA on first load */
tabs.forEach(tab => {
  tab.setAttribute("role", "tab");
  _syncTabAria(tab);
});

/** Re-translate dynamically rendered search UI strings after lang change. */
function applySearchLang() {
  if (!searchInput) return;
  const isVillage = searchType === "village";
  searchInput.placeholder = I18n.t(isVillage ? "search.phVillage" : "search.phGotra");
  tabs.forEach(tab => {
    tab.textContent = I18n.t(
      tab.dataset.searchType === "village" ? "search.tabVillage" : "search.tabGotra"
    );
  });
  if (searchResults && !searchResults.querySelector(".result-card")) {
    renderResults([], searchInput.value);
  }
}
document.addEventListener("languagechange", applySearchLang);

/* Add aria-label to the live region (task 15) */
if (searchResults) {
  searchResults.setAttribute("aria-label", "search results");
  /* update label on language change */
  document.addEventListener("languagechange", () => {
    searchResults.setAttribute(
      "aria-label",
      I18n.lang === "hi" ? "खोज परिणाम" : "search results"
    );
  });
}

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
    const isEmpty = !query;
    searchResults.innerHTML =
      `<div class="empty-state">
        <span class="empty-icon" aria-hidden="true">${isEmpty ? "⌖" : "⌕"}</span>
        <p>${I18n.t(isEmpty ? "search.emptyDefault" : "search.emptyQuery")}</p>
        <small>${I18n.t(isEmpty ? "search.emptyNote" : "search.emptyQueryNote")}</small>
      </div>`;
    return;
  }
  const summary = I18n.t("search.resultSummary", { count: records.length });
  searchResults.innerHTML =
    `<p class="result-summary">${summary}</p>` +
    records.map(record => {
      const loc = [record.village, record.district, record.state].filter(Boolean).join(" · ");
      const tag = record.familyDetails?.length
        ? I18n.t("search.viewTree") : I18n.t("search.verifiedRecord");
      return `<article class="result-card">
        <div><h3>${record.name}</h3><p>${loc}</p></div>
        <a class="result-tag" href="/vanshawali.html?id=${record.id}">${tag}</a>
      </article>`;
    }).join("");
}

async function search(query) {
  try {
    renderResults(await getRecords(query), query);
  } catch (err) {
    if (searchResults)
      searchResults.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`;
  }
}

if (searchInput && searchResults && searchForm) {
  tabs.forEach(tab =>
    tab.addEventListener("click", () => {
      tabs.forEach(t => { t.classList.remove("active"); _syncTabAria(t); });
      tab.classList.add("active");
      _syncTabAria(tab);
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

  /* hint links — always Hindi data-query values, so only check those (task 17) */
  document.querySelectorAll(".hint-link").forEach(hint =>
    hint.addEventListener("click", () => {
      const query = hint.dataset.query;
      /* switch to the correct tab based on the hint type attribute */
      const targetType = hint.dataset.searchType || (query === "उदयपुर" ? "village" : "gotra");
      const targetTab  = document.querySelector(`[data-search-type="${targetType}"]`);
      if (targetTab && !targetTab.classList.contains("active")) targetTab.click();
      searchInput.value = query;
      search(query);
    })
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   5. SUBMIT FORM  (task 4: duplicate-submit prevention; task 6: focus fix)
   ─────────────────────────────────────────────────────────────────────────── */

const submissionForm = document.querySelector("#submission-form");
if (submissionForm) {
  const message    = document.querySelector("#submission-message");
  const memberList = document.querySelector("#member-list");
  const members    = [];

  function memberOptions(selected) {
    return `<option value="">${I18n.t("submit.unknown")}</option>` +
      members.map(m =>
        `<option value="${m.clientId}" ${m.clientId === selected ? "selected" : ""}>${
          m.name || I18n.t("submit.newMember")
        }</option>`
      ).join("");
  }

  /* Full DOM re-render — called only on add/remove/language-change, NOT on
     every keystroke. Field input events update the data array in-place. */
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

    /* Wire inputs — update data only, NO re-render on keystroke (task 6 fix) */
    memberList.querySelectorAll("[data-field]").forEach(input =>
      input.addEventListener("input", () => {
        const row = members.find(
          m => m.clientId === input.closest("[data-member]")?.dataset.member
        );
        if (row) row[input.dataset.field] = input.value;
        /* For select fields (father/mother) we must refresh the other selects
           so the name updates if the referenced member's name changed. We only
           need to do this for select elements — text inputs keep focus safely. */
        if (input.tagName === "SELECT") _refreshSelects();
      })
    );

    memberList.querySelectorAll("[data-remove]").forEach(btn =>
      btn.addEventListener("click", () => {
        const idx = members.findIndex(m => m.clientId === btn.dataset.remove);
        if (idx !== -1) { members.splice(idx, 1); renderMembers(); }
      })
    );
  }

  /* Refresh only the <select> option lists without replacing the full DOM,
     so text inputs keep focus while parent/sibling names update. */
  function _refreshSelects() {
    memberList.querySelectorAll("select[data-field='fatherId'], select[data-field='motherId']")
      .forEach(sel => {
        const row     = members.find(m => m.clientId === sel.closest("[data-member]")?.dataset.member);
        const current = sel.value;
        sel.innerHTML = memberOptions(current);
        if (row) row[sel.dataset.field] = sel.value; /* keep data in sync */
      });
  }

  document.querySelector("#add-member")?.addEventListener("click", () => {
    members.push({ clientId: crypto.randomUUID() });
    renderMembers();
  });
  document.querySelector("#add-member")?.click(); /* first member auto-added */

  document.addEventListener("languagechange", () => { if (members.length) renderMembers(); });

  /* Task 4: duplicate-submit prevention */
  let submitting = false;
  submissionForm.addEventListener("submit", async e => {
    e.preventDefault();
    if (submitting) return;
    submitting = true;
    const submitBtn = submissionForm.querySelector("[type=submit]");
    const origText  = submitBtn?.innerHTML;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span>${I18n.t("common.loading")}</span>`;
    }
    message.textContent = "";
    message.classList.remove("error");

    const formData = Object.fromEntries(new FormData(submissionForm));
    formData.familyDetails = members;
    try {
      const res    = await fetch("/api/submissions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      message.textContent = result.message;
      message.classList.remove("error");
      submissionForm.reset();
      members.splice(0);
      renderMembers();
    } catch (err) {
      message.textContent = err.message;
      message.classList.add("error");
    } finally {
      submitting = false;
      if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = origText; }
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
  if (!id) return;

  try {
    const res = await fetch(`/api/records/${id}/tree`);
    if (!res.ok) return;
    const { record } = await res.json();
    const people = Array.isArray(record.familyDetails) ? record.familyDetails : [];
    if (!people.length) {
      treeContainer.innerHTML = `<p class="form-note">${I18n.t("vanshawali.noMembers")}</p>`;
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
          <small>ID: ${person.id}</small>
        </div>`
      ).join("");
  } catch (_) { /* silent — default placeholder stays */ }
}());

/* ─────────────────────────────────────────────────────────────────────────────
   7. ADMIN PANEL
   ─────────────────────────────────────────────────────────────────────────── */

const adminLogin       = document.querySelector("#admin-login-form");
const adminLoginBox    = document.querySelector("#admin-login");
const adminPanel       = document.querySelector("#admin-panel");
const adminSubmissions = document.querySelector("#admin-submissions");
const adminErrorEl     = document.querySelector("#admin-panel-error");

/* Task 5: safe wrapper for admin error display */
function _showAdminError(msg) {
  if (adminErrorEl) {
    adminErrorEl.textContent = msg;
    adminErrorEl.hidden = false;
  } else {
    console.error("[admin]", msg);
  }
}
function _clearAdminError() {
  if (adminErrorEl) { adminErrorEl.textContent = ""; adminErrorEl.hidden = true; }
}

/* ── load submissions (task 5: try/catch with visible error) ─────────────── */
async function loadSubmissions() {
  if (!adminSubmissions) return;
  _clearAdminError();
  try {
    const response = await fetch("/api/admin/submissions", { credentials: "include" });
    if (!response.ok) throw new Error(I18n.t("common.sessionExpired"));
    const submissions = (await response.json()).submissions;

    if (!submissions.length) {
      adminSubmissions.innerHTML = `<div class="admin-empty">${I18n.t("admin.noSubmissions")}</div>`;
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
                    <small>${I18n.t("admin.idLabel")}: ${person.id}
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
           </div>` : "";
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

    /* Task 9: approve/reject with confirmation + error handling */
    adminSubmissions.querySelectorAll("[data-id]").forEach(btn =>
      btn.addEventListener("click", async () => {
        const isApprove = btn.dataset.status === "approved";
        const confirmMsg = isApprove
          ? I18n.t("admin.confirmApprove")
          : I18n.t("admin.confirmReject");
        if (!confirm(confirmMsg)) return;

        btn.disabled = true;
        const origText = btn.textContent;
        btn.textContent = I18n.t("common.loading");
        try {
          const res = await fetch(`/api/admin/submissions/${btn.dataset.id}`, {
            method: "PATCH", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: btn.dataset.status }),
          });
          if (!res.ok) throw new Error(I18n.t("common.error"));
          loadSubmissions();
        } catch (err) {
          btn.disabled  = false;
          btn.textContent = origText;
          _showAdminError(err.message);
        }
      })
    );
  } catch (err) {
    _showAdminError(err.message);
  }
}

/* ── admin login (task 4: prevent double-submit) ────────────────────────── */
if (adminLogin) {
  let loginBusy = false;
  adminLogin.addEventListener("submit", async e => {
    e.preventDefault();
    if (loginBusy) return;
    loginBusy = true;
    const btn      = adminLogin.querySelector("[type=submit]");
    const origText = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = `<span>${I18n.t("common.loading")}</span>`; }

    const msgEl = document.querySelector("#admin-login-message");
    if (msgEl) { msgEl.textContent = ""; msgEl.classList.remove("error"); }

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email:    document.querySelector("#admin-email").value,
          password: document.querySelector("#admin-password").value,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (msgEl) { msgEl.textContent = result.error; msgEl.classList.add("error"); }
        return;
      }
      adminLoginBox.hidden = true;
      adminPanel.hidden    = false;
      loadSubmissions();
    } catch (err) {
      if (msgEl) { msgEl.textContent = I18n.t("common.error"); msgEl.classList.add("error"); }
    } finally {
      loginBusy = false;
      if (btn) { btn.disabled = false; btn.innerHTML = origText; }
    }
  });

  document.querySelector("#admin-logout")?.addEventListener("click", async () => {
    await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
    adminPanel.hidden    = true;
    adminLoginBox.hidden = false;
  });
}

/* ── admin tabs (task 7: ARIA roles) ────────────────────────────────────── */
const adminTabs  = document.querySelectorAll(".admin-tab");
const adminViews = {
  submissions:      document.querySelector("#admin-submissions"),
  gotras:           document.querySelector("#admin-gotras"),
  "family-builder": document.querySelector("#admin-family-builder"),
};

adminTabs.forEach(tab => {
  tab.setAttribute("role", "tab");
  _syncTabAria(tab);
  /* point aria-controls to the right panel */
  const panelId = `admin-${tab.dataset.adminView}`;
  tab.setAttribute("aria-controls", panelId);
  const panel = adminViews[tab.dataset.adminView];
  if (panel) {
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `tab-${tab.dataset.adminView}`);
    tab.id = `tab-${tab.dataset.adminView}`;
  }
});

adminTabs.forEach(tab =>
  tab.addEventListener("click", () => {
    adminTabs.forEach(t => {
      t.classList.remove("active");
      _syncTabAria(t);
    });
    tab.classList.add("active");
    _syncTabAria(tab);
    Object.entries(adminViews).forEach(([name, view]) => {
      if (view) view.hidden = name !== tab.dataset.adminView;
    });
    if (tab.dataset.adminView === "gotras") loadGotras();
  })
);

/* ── gotra management (task 4: duplicate-submit; task 5: error handling) ── */
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
        m => m.clientId === input.closest("[data-gotra-member]")?.dataset.gotraMember
      );
      if (member) member[input.dataset.gotraField] = input.value;
    })
  );
  list.querySelectorAll("[data-remove-gotra-member]").forEach(btn =>
    btn.addEventListener("click", () => {
      const idx = gotraMembers.findIndex(m => m.clientId === btn.dataset.removeGotraMember);
      if (idx !== -1) { gotraMembers.splice(idx, 1); renderGotraMembers(); }
    })
  );
}

document.querySelector("#add-gotra-member")?.addEventListener("click", () => {
  gotraMembers.push({ clientId: crypto.randomUUID() });
  renderGotraMembers();
});

/* Task 5: loadGotras with error handling */
async function loadGotras() {
  const container = document.querySelector("#gotra-list");
  if (!container) return;
  _clearAdminError();
  try {
    const response = await fetch("/api/admin/gotras", { credentials: "include" });
    if (!response.ok) throw new Error(I18n.t("common.sessionExpired"));
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
  } catch (err) {
    _showAdminError(err.message);
  }
}

/* Task 4: gotra form duplicate-submit prevention */
let gotraSubmitting = false;
gotraForm?.addEventListener("submit", async e => {
  e.preventDefault();
  if (gotraSubmitting) return;
  gotraSubmitting = true;
  const btn      = gotraForm.querySelector("[type=submit]");
  const origText = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = `<span>${I18n.t("common.loading")}</span>`; }

  const payload   = Object.fromEntries(new FormData(gotraForm));
  payload.members = gotraMembers;
  const msgEl     = document.querySelector("#gotra-message");
  try {
    const response = await fetch("/api/admin/gotras", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (msgEl) { msgEl.textContent = response.ok ? result.message : result.error; msgEl.classList.toggle("error", !response.ok); }
    if (response.ok) {
      gotraForm.reset();
      gotraMembers.splice(0);
      renderGotraMembers();
      loadGotras();
    }
  } catch (err) {
    if (msgEl) { msgEl.textContent = I18n.t("common.error"); msgEl.classList.add("error"); }
  } finally {
    gotraSubmitting = false;
    if (btn) { btn.disabled = false; btn.innerHTML = origText; }
  }
});

/* ── admin family builder (task 4: duplicate-submit; task 6: focus fix) ── */
const adminFamilyForm    = document.querySelector("#admin-family-form");
const adminFamilyMembers = [];

function renderAdminFamilyMembers() {
  const list = document.querySelector("#admin-member-list");
  if (!list) return;

  const options = selected =>
    `<option value="">${I18n.t("admin.unknown")}</option>` +
    adminFamilyMembers.map(m =>
      `<option value="${m.clientId}" ${m.clientId === selected ? "selected" : ""}>${
        m.name || I18n.t("admin.newPerson")
      }</option>`
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

  /* task 6: update data only on input — no re-render on name change */
  list.querySelectorAll("[data-admin-field]").forEach(input =>
    input.addEventListener("input", () => {
      const member = adminFamilyMembers.find(
        m => m.clientId === input.closest("[data-admin-member]")?.dataset.adminMember
      );
      if (member) member[input.dataset.adminField] = input.value;
    })
  );
  list.querySelectorAll("[data-remove-admin-member]").forEach(btn =>
    btn.addEventListener("click", () => {
      const idx = adminFamilyMembers.findIndex(m => m.clientId === btn.dataset.removeAdminMember);
      if (idx !== -1) { adminFamilyMembers.splice(idx, 1); renderAdminFamilyMembers(); }
    })
  );
}

document.querySelector("#add-admin-member")?.addEventListener("click", () => {
  adminFamilyMembers.push({ clientId: crypto.randomUUID() });
  renderAdminFamilyMembers();
});

/* Task 4: family form duplicate-submit prevention */
let familySubmitting = false;
adminFamilyForm?.addEventListener("submit", async e => {
  e.preventDefault();
  if (familySubmitting) return;
  familySubmitting = true;
  const btn      = adminFamilyForm.querySelector("[type=submit]");
  const origText = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = `<span>${I18n.t("common.loading")}</span>`; }

  const payload         = Object.fromEntries(new FormData(adminFamilyForm));
  payload.familyDetails = adminFamilyMembers;
  const msgEl           = document.querySelector("#admin-family-message");
  try {
    const response = await fetch("/api/admin/family-records", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (msgEl) { msgEl.textContent = response.ok ? result.message : result.error; msgEl.classList.toggle("error", !response.ok); }
    if (response.ok) {
      adminFamilyForm.reset();
      adminFamilyMembers.splice(0);
      renderAdminFamilyMembers();
    }
  } catch (err) {
    if (msgEl) { msgEl.textContent = I18n.t("common.error"); msgEl.classList.add("error"); }
  } finally {
    familySubmitting = false;
    if (btn) { btn.disabled = false; btn.innerHTML = origText; }
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   8. PUBLIC GENEALOGY EXPLORER
   ───────────────────────────────────────────────────────────────────────────
   Renders on vanshawali.html. Supports three URL modes:
   - default:  loads gotra directory
   - ?gotra=ID:  loads gotra detail with branches and roots
   - ?person=PUBLICID: loads person profile with family
   ═══════════════════════════════════════════════════════════════════════════ */

(function initGenealogyExplorer() {
  const gotraDirectory = document.querySelector("#gotra-directory");
  const gotraDetailSection = document.querySelector("#gotra-detail-section");
  const gotraDetailContent = document.querySelector("#gotra-detail-content");
  const personProfileSection = document.querySelector("#person-profile-section");
  const personProfileContent = document.querySelector("#person-profile-content");
  const genealogySearchForm = document.querySelector("#genealogy-search-form");
  const genealogySearchInput = document.querySelector("#genealogy-search-input");
  const genealogySearchResults = document.querySelector("#genealogy-search-results");

  /* Don't run if not on vanshawali.html */
  if (!gotraDirectory && !gotraDetailSection && !personProfileSection) return;

  const params = new URLSearchParams(location.search);
  const gotraId = params.get("gotra");
  const personId = params.get("person");

  /* ── Person search ─────────────────────────────────────────────────────── */
  async function searchPeople(query) {
    if (!genealogySearchResults) return;
    if (!query || query.length < 2) {
      genealogySearchResults.innerHTML = "";
      return;
    }
    try {
      const res = await fetch(`/api/genealogy/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error(I18n.t("common.error"));
      const { people } = await res.json();
      if (!people.length) {
        genealogySearchResults.innerHTML =
          `<div class="empty-state"><p>${I18n.t("genealogy.searchNoResults")}</p></div>`;
        return;
      }
      const summary = I18n.t("genealogy.searchResults", { n: people.length });
      genealogySearchResults.innerHTML =
        `<p class="result-summary">${summary}</p>` +
        people.map(p => {
          const meta = [
            p.gender ? I18n.t(`admin.gender${p.gender.charAt(0).toUpperCase() + p.gender.slice(1)}`) : "",
            p.birthYear ? p.birthYear : "",
            p.village ? p.village : "",
          ].filter(Boolean).join(" · ");
          return `<div class="person-search-card">
            <div>
              <h4>${p.fullName}</h4>
              <div class="person-meta">${meta}</div>
            </div>
            <a class="result-tag" href="/vanshawali.html?person=${p.publicId}">${I18n.t("genealogy.viewProfile")}</a>
          </div>`;
        }).join("");
    } catch (err) {
      genealogySearchResults.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`;
    }
  }

  if (genealogySearchForm) {
    genealogySearchForm.addEventListener("submit", e => {
      e.preventDefault();
      searchPeople(genealogySearchInput?.value);
    });
  }

  /* ── Gotra directory (default view) ────────────────────────────────────── */
  async function loadGotraDirectory() {
    if (!gotraDirectory) return;
    try {
      const res = await fetch("/api/genealogy/gotras");
      if (!res.ok) throw new Error(I18n.t("common.error"));
      const { gotras } = await res.json();
      if (!gotras.length) {
        gotraDirectory.innerHTML = `<div class="empty-state"><p>${I18n.t("genealogy.noGotras")}</p></div>`;
        return;
      }
      gotraDirectory.innerHTML = gotras.map(g => `
        <a class="gotra-dir-card" href="/vanshawali.html?gotra=${g.id}">
          <h3>${g.name}</h3>
          <div class="gotra-meta">
            <span><b>${g.personCount || 0}</b> ${I18n.t("genealogy.gotraPersons")}</span>
            <span><b>${g.branchCount || 0}</b> ${I18n.t("genealogy.gotraBranches")}</span>
          </div>
          ${g.historicalDetails ? `<p class="gotra-desc">${g.historicalDetails.slice(0, 150)}${g.historicalDetails.length > 150 ? "…" : ""}</p>` : ""}
          <span class="gotra-link">${I18n.t("genealogy.viewDetail")} →</span>
        </a>
      `).join("");
    } catch (err) {
      gotraDirectory.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`;
    }
  }

  /* ── Gotra detail (?gotra=ID) ──────────────────────────────────────────── */
  async function loadGotraDetail(id) {
    if (!gotraDetailContent) return;
    gotraDetailSection.hidden = false;
    try {
      const res = await fetch(`/api/genealogy/gotras/${id}`);
      if (!res.ok) throw new Error(I18n.t("common.error"));
      const { gotra, branches, roots } = await res.json();

      gotraDetailContent.innerHTML = `
        <div class="gotra-detail-card">
          <h2>${gotra.name}</h2>
          ${gotra.originPlace ? `<p style="color:var(--muted);font-size:14px;margin-bottom:12px">${gotra.originPlace}${gotra.originPeriod ? " · " + gotra.originPeriod : ""}</p>` : ""}
          <div class="gotra-stats">
            <div class="gotra-stat"><b>${roots.length}</b><span>${I18n.t("genealogy.roots")}</span></div>
            <div class="gotra-stat"><b>${branches.length}</b><span>${I18n.t("genealogy.branches")}</span></div>
          </div>
          ${gotra.historicalDetails ? `<div class="gotra-detail-section"><h3>${I18n.t("genealogy.gotraDirH2")}</h3><p style="color:var(--muted);font-size:15px;line-height:1.8">${gotra.historicalDetails}</p></div>` : ""}
          ${gotra.founderName ? `<div class="gotra-detail-section"><h3>${I18n.t("genealogy.roots")}</h3><p style="color:var(--muted)">${gotra.founderName}${gotra.founderNotes ? " — " + gotra.founderNotes : ""}</p></div>` : ""}
          <div class="gotra-detail-section">
            <h3>${I18n.t("genealogy.roots")}</h3>
            ${roots.length ? roots.map(r => `
              <div class="rel-item">
                <a href="/vanshawali.html?person=${r.publicId}">${r.fullName}</a>
                <span class="rel-meta">${r.birthYear || ""}${r.deathYear ? " – " + r.deathYear : ""}</span>
              </div>
            `).join("") : `<p class="rel-empty">${I18n.t("genealogy.noRoots")}</p>`}
          </div>
          <div class="gotra-detail-section">
            <h3>${I18n.t("genealogy.branches")}</h3>
            ${branches.length ? branches.map(b => `<div class="rel-item">${b.name}${b.description ? ` <span class="rel-meta">${b.description}</span>` : ""}</div>`).join("") : `<p class="rel-empty">${I18n.t("genealogy.noBranches")}</p>`}
          </div>
        </div>
      `;
    } catch (err) {
      gotraDetailContent.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`;
    }
  }

  /* ── Person profile (?person=PUBLICID) ────────────────────────────────── */
  async function loadPersonProfile(publicId) {
    if (!personProfileContent) return;
    personProfileSection.hidden = false;
    try {
      const res = await fetch(`/api/genealogy/people/${publicId}`);
      if (!res.ok) {
        personProfileContent.innerHTML = `<div class="empty-state"><p>${I18n.t("genealogy.restrictedProfile")}</p></div>`;
        return;
      }
      const data = await res.json();

      if (data.restricted) {
        personProfileContent.innerHTML = `
          <div class="person-profile-card">
            <div class="person-profile-header">
              <div class="person-profile-avatar">${(data.person.fullName || "?").charAt(0)}</div>
              <div class="person-profile-info">
                <h2>${data.person.fullName}</h2>
                <p style="color:var(--muted)">${I18n.t("genealogy.restrictedProfile")}</p>
              </div>
            </div>
          </div>`;
        return;
      }

      const p = data.person;
      const avatar = (p.fullName || "?").charAt(0);
      const tags = [];
      if (p.generation) tags.push(`<span class="tag gen">${I18n.t("genealogy.generation")} ${p.generation}</span>`);
      tags.push(`<span class="tag ${p.isLiving ? "living" : "deceased"}">${p.isLiving ? I18n.t("genealogy.living") : I18n.t("genealogy.deceased")}</span>`);
      if (data.gotras && data.gotras.length) {
        data.gotras.forEach(g => tags.push(`<span class="tag gotra">${g.name}</span>`));
      }

      const meta = [
        p.birthYear ? p.birthYear : "",
        p.deathYear ? " – " + p.deathYear : "",
        p.village ? " · " + p.village : "",
      ].filter(Boolean).join("");

      function renderRelList(items, emptyKey) {
        if (!items || !items.length) return `<p class="rel-empty">${I18n.t("genealogy." + emptyKey)}</p>`;
        return `<div class="rel-list">${items.map(r => `
          <div class="rel-item">
            <a href="/vanshawali.html?person=${r.publicId}">${r.fullName || r.full_name || "?"}</a>
            <span class="rel-meta">${r.birthYear || ""}${r.deathYear ? " – " + r.deathYear : ""}${r.village ? " · " + r.village : ""}</span>
          </div>
        `).join("")}</div>`;
      }

      function renderAncestorPath(items) {
        if (!items || !items.length) return `<p class="rel-empty">${I18n.t("genealogy.noAncestors")}</p>`;
        return `<div class="ancestor-path">${items.map(a => `
          <div class="path-item">
            <span class="path-gen">${I18n.t("genealogy.generation")} ${p.generation - a.depth}</span>
            <a href="/vanshawali.html?person=${a.publicId}">${a.fullName}</a>
            <span class="path-meta">${a.birthYear || ""}${a.deathYear ? " – " + a.deathYear : ""}</span>
          </div>
        `).join("")}</div>`;
      }

      function renderDescendantPath(items) {
        if (!items || !items.length) return `<p class="rel-empty">${I18n.t("genealogy.noDescendants")}</p>`;
        return `<div class="descendant-path">${items.map(d => `
          <div class="path-item">
            <span class="path-gen">${I18n.t("genealogy.generation")} ${p.generation + d.depth}</span>
            <a href="/vanshawali.html?person=${d.publicId}">${d.fullName}</a>
            <span class="path-meta">${d.birthYear || ""}${d.deathYear ? " – " + d.deathYear : ""}</span>
          </div>
        `).join("")}</div>`;
      }

      personProfileContent.innerHTML = `
        <div class="person-profile-card">
          <div class="person-profile-header">
            <div class="person-profile-avatar">${avatar}</div>
            <div class="person-profile-info">
              <h2>${p.fullName}</h2>
              ${meta ? `<p style="color:var(--muted);font-size:14px">${meta}</p>` : ""}
              <div class="person-tags">${tags.join("")}</div>
            </div>
          </div>
          ${p.biography ? `<p style="color:var(--muted);font-size:15px;line-height:1.8;margin-bottom:24px">${p.biography}</p>` : ""}
          <div class="rel-section">
            <h3>${I18n.t("genealogy.parents")}</h3>
            ${renderRelList(data.parents, "noParents")}
          </div>
          <div class="rel-section">
            <h3>${I18n.t("genealogy.children")}</h3>
            ${renderRelList(data.children, "noChildren")}
          </div>
          <div class="rel-section">
            <h3>${I18n.t("genealogy.siblings")}</h3>
            ${renderRelList(data.siblings, "noSiblings")}
          </div>
          <div class="rel-section">
            <h3>${I18n.t("genealogy.ancestors")}</h3>
            ${renderAncestorPath(data.ancestors)}
          </div>
          <div class="rel-section">
            <h3>${I18n.t("genealogy.descendants")}</h3>
            ${renderDescendantPath(data.descendants)}
          </div>
        </div>
      `;
    } catch (err) {
      personProfileContent.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`;
    }
  }

  /* ── Route based on URL params ─────────────────────────────────────────── */
  if (personId) {
    loadPersonProfile(personId);
  } else if (gotraId) {
    loadGotraDetail(gotraId);
  } else {
    loadGotraDirectory();
  }
}());

/* ═══════════════════════════════════════════════════════════════════════════
   9. ADMIN PEOPLE MANAGEMENT
   ───────────────────────────────────────────────────────────────────────────
   Renders on admin.html when the "People" tab is active.
   ═══════════════════════════════════════════════════════════════════════════ */

(function initAdminPeople() {
  const peopleList = document.querySelector("#people-list");
  const peopleSearchInput = document.querySelector("#people-search-input");
  const peopleSearchBtn = document.querySelector("#people-search-btn");
  const peoplePagination = document.querySelector("#people-pagination");
  const personForm = document.querySelector("#person-form");
  const personMessage = document.querySelector("#person-message");
  const personGotraSelect = document.querySelector("#person-gotra-select");
  const fatherInput = document.querySelector("#person-father-input");
  const fatherHidden = document.querySelector("#person-father-hidden");
  const fatherSuggestions = document.querySelector("#father-suggestions");
  const motherInput = document.querySelector("#person-mother-input");
  const motherHidden = document.querySelector("#person-mother-hidden");
  const motherSuggestions = document.querySelector("#mother-suggestions");

  if (!peopleList && !personForm) return;

  let currentPage = 1;
  let totalPages = 1;

  /* ── Load people list with pagination ─────────────────────────────────── */
  async function loadPeople(page, query) {
    if (!peopleList) return;
    _clearAdminError();
    try {
      const params = new URLSearchParams({ page: page || 1, limit: 20 });
      if (query) params.set("q", query);
      const res = await fetch(`/api/admin/people?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(I18n.t("common.sessionExpired"));
      const data = await res.json();
      currentPage = data.page;
      totalPages = data.pages;

      if (!data.people.length) {
        peopleList.innerHTML = `<div class="admin-empty">${I18n.t("admin.noPeople")}</div>`;
        if (peoplePagination) peoplePagination.innerHTML = "";
        return;
      }

      peopleList.innerHTML = data.people.map(p => `
        <div class="admin-person-row">
          <div>
            <h4>${p.fullName}</h4>
            <div class="person-info">
              <span class="pubid">${p.publicId}</span>
              ${p.gender ? " · " + p.gender : ""}
              ${p.birthYear ? " · " + p.birthYear : ""}
              ${p.village ? " · " + p.village : ""}
              ${p.status === "verified" ? "" : " · " + p.status}
            </div>
          </div>
        </div>
      `).join("");

      if (peoplePagination && totalPages > 1) {
        peoplePagination.innerHTML = `
          <button ${currentPage <= 1 ? "disabled" : ""} data-page="${currentPage - 1}">${I18n.t("admin.peoplePrev")}</button>
          <span>${I18n.t("admin.peoplePage", { current: currentPage, total: totalPages })}</span>
          <button ${currentPage >= totalPages ? "disabled" : ""} data-page="${currentPage + 1}">${I18n.t("admin.peopleNext")}</button>
        `;
        peoplePagination.querySelectorAll("button[data-page]").forEach(btn =>
          btn.addEventListener("click", () => loadPeople(parseInt(btn.dataset.page), peopleSearchInput?.value))
        );
      } else if (peoplePagination) {
        peoplePagination.innerHTML = "";
      }
    } catch (err) {
      _showAdminError(err.message);
    }
  }

  /* ── Search button ─────────────────────────────────────────────────────── */
  peopleSearchBtn?.addEventListener("click", () => loadPeople(1, peopleSearchInput?.value));
  peopleSearchInput?.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); loadPeople(1, peopleSearchInput.value); }
  });

  /* ── Load gotras into person form dropdown ─────────────────────────────── */
  async function loadGotrasForForm() {
    if (!personGotraSelect) return;
    try {
      const res = await fetch("/api/admin/gotras", { credentials: "include" });
      if (!res.ok) return;
      const { gotras } = await res.json();
      personGotraSelect.innerHTML =
        `<option value="">—</option>` +
        gotras.map(g => `<option value="${g.id}">${g.name}</option>`).join("");
    } catch (_) { /* silent */ }
  }

  /* ── Parent autocomplete ───────────────────────────────────────────────── */
  function setupAutocomplete(input, hiddenField, suggestionsEl) {
    if (!input) return;
    let debounceTimer;
    input.addEventListener("input", () => {
      hiddenField.value = "";
      clearTimeout(debounceTimer);
      const query = input.value.trim();
      if (query.length < 2) {
        suggestionsEl.classList.remove("show");
        return;
      }
      debounceTimer = setTimeout(async () => {
        try {
          const res = await fetch(`/api/admin/people/search?q=${encodeURIComponent(query)}`, { credentials: "include" });
          if (!res.ok) return;
          const { people } = await res.json();
          if (!people.length) {
            suggestionsEl.classList.remove("show");
            return;
          }
          suggestionsEl.innerHTML = people.map(p => `
            <div class="suggestion-item" data-id="${p.id}" data-name="${p.fullName}">
              <div class="sug-name">${p.fullName}</div>
              <div class="sug-meta">${p.gender || ""} ${p.birthYear ? "· " + p.birthYear : ""} ${p.village ? "· " + p.village : ""}</div>
            </div>
          `).join("");
          suggestionsEl.classList.add("show");
          suggestionsEl.querySelectorAll(".suggestion-item").forEach(item =>
            item.addEventListener("click", () => {
              hiddenField.value = item.dataset.id;
              input.value = item.dataset.name;
              suggestionsEl.classList.remove("show");
            })
          );
        } catch (_) { /* silent */ }
      }, 300);
    });

    /* Hide suggestions on outside click */
    document.addEventListener("click", e => {
      if (!input.contains(e.target) && !suggestionsEl.contains(e.target)) {
        suggestionsEl.classList.remove("show");
      }
    });
  }

  setupAutocomplete(fatherInput, fatherHidden, fatherSuggestions);
  setupAutocomplete(motherInput, motherHidden, motherSuggestions);

  /* ── Person form submit ───────────────────────────────────────────────── */
  let personSubmitting = false;
  personForm?.addEventListener("submit", async e => {
    e.preventDefault();
    if (personSubmitting) return;
    personSubmitting = true;
    const btn = personForm.querySelector("[type=submit]");
    const origText = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = `<span>${I18n.t("common.loading")}</span>`; }

    const formData = Object.fromEntries(new FormData(personForm));
    /* Use hidden fields for actual parent IDs */
    if (fatherHidden?.value) formData.fatherId = fatherHidden.value;
    else delete formData.fatherId;
    if (motherHidden?.value) formData.motherId = motherHidden.value;
    else delete formData.motherId;
    /* Remove text inputs (they're for autocomplete display only) */
    delete formData.fatherId_input;
    delete formData.motherId_input;

    try {
      const res = await fetch("/api/admin/people", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const result = await res.json();
      if (personMessage) {
        personMessage.textContent = res.ok ? result.message : result.error;
        personMessage.classList.toggle("error", !res.ok);
      }
      if (res.ok) {
        personForm.reset();
        if (fatherHidden) fatherHidden.value = "";
        if (motherHidden) motherHidden.value = "";
        loadPeople(1, "");
      }
    } catch (err) {
      if (personMessage) { personMessage.textContent = I18n.t("common.error"); personMessage.classList.add("error"); }
    } finally {
      personSubmitting = false;
      if (btn) { btn.disabled = false; btn.innerHTML = origText; }
    }
  });

  /* ── Load people when tab is first activated ──────────────────────────── */
  /* Watch for the People tab being clicked */
  document.querySelectorAll(".admin-tab[data-admin-view='people']").forEach(tab => {
    tab.addEventListener("click", () => {
      loadPeople(1, "");
      loadGotrasForForm();
    });
  });
}());

/* ═══════════════════════════════════════════════════════════════════════════
   10. ADMIN GENEALOGY CONTRIBUTIONS
   ───────────────────────────────────────────────────────────────────────────
   ═══════════════════════════════════════════════════════════════════════════ */

(function initAdminGenealogyContributions() {
  const contribList = document.querySelector("#genealogy-contributions-list");
  if (!contribList) return;

  async function loadContributions() {
    _clearAdminError();
    try {
      const res = await fetch("/api/admin/contributions", { credentials: "include" });
      if (!res.ok) throw new Error(I18n.t("common.sessionExpired"));
      const { contributions } = await res.json();
      if (!contributions.length) {
        contribList.innerHTML = `<div class="admin-empty">${I18n.t("admin.noSubmissions")}</div>`;
        return;
      }
      contribList.innerHTML = contributions.map(c => {
        const typeLabels = {
          new_person: I18n.t("genealogy.contribNewPerson"),
          new_relationship: I18n.t("genealogy.contribNewRel"),
          correction: I18n.t("genealogy.contribCorrection"),
          gotra_info: I18n.t("genealogy.contribGotraInfo"),
          dispute: I18n.t("genealogy.contribDispute"),
        };
        const statusLabel = I18n.t(`common.${c.status}`) || c.status;
        const actions = c.status === "pending"
          ? `<div class="admin-actions">
               <button class="approve" data-id="${c.id}" data-status="approved">${I18n.t("admin.approveBtn")}</button>
               <button class="reject" data-id="${c.id}" data-status="rejected">${I18n.t("admin.rejectBtn")}</button>
             </div>` : "";
        return `<div class="contrib-card">
          <h4>${c.proposedName || c.description?.slice(0, 50) || "—"} <span class="contrib-type-badge">${typeLabels[c.contributionType] || c.contributionType}</span></h4>
          <p class="contrib-meta">${I18n.t("admin.contributor")}: ${c.contributorName}${c.contributorContact ? " · " + c.contributorContact : ""}</p>
          ${c.proposedBirthYear || c.proposedDeathYear ? `<p class="contrib-meta">${c.proposedBirthYear || ""} ${c.proposedDeathYear ? "– " + c.proposedDeathYear : ""} ${c.proposedVillage ? "· " + c.proposedVillage : ""}</p>` : ""}
          ${c.description ? `<p class="contrib-meta">${c.description}</p>` : ""}
          ${c.evidence ? `<p class="contrib-meta"><strong>${I18n.t("genealogy.contribEvidence")}:</strong> ${c.evidence}</p>` : ""}
          <p class="contrib-meta"><strong>${I18n.t("admin.statusLabel")}:</strong> ${statusLabel}</p>
          ${actions}
        </div>`;
      }).join("");

      contribList.querySelectorAll("[data-id]").forEach(btn =>
        btn.addEventListener("click", async () => {
          const isApprove = btn.dataset.status === "approved";
          const confirmMsg = isApprove ? I18n.t("admin.confirmApprove") : I18n.t("admin.confirmReject");
          if (!confirm(confirmMsg)) return;
          btn.disabled = true;
          const origText = btn.textContent;
          btn.textContent = I18n.t("common.loading");
          try {
            const res = await fetch(`/api/admin/contributions/${btn.dataset.id}`, {
              method: "PATCH", credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: btn.dataset.status }),
            });
            if (!res.ok) throw new Error(I18n.t("common.error"));
            loadContributions();
          } catch (err) {
            btn.disabled = false;
            btn.textContent = origText;
            _showAdminError(err.message);
          }
        })
      );
    } catch (err) {
      _showAdminError(err.message);
    }
  }

  /* Load when tab is clicked */
  document.querySelectorAll(".admin-tab[data-admin-view='genealogy-contributions']").forEach(tab => {
    tab.addEventListener("click", loadContributions);
  });
}());

/* ═══════════════════════════════════════════════════════════════════════════
   11. GENEALOGY CONTRIBUTION FORM (submit.html)
   ───────────────────────────────────────────────────────────────────────────
   ═══════════════════════════════════════════════════════════════════════════ */

(function initGenealogyContributionForm() {
  const form = document.querySelector("#genealogy-contribution-form");
  if (!form) return;
  const message = document.querySelector("#genealogy-contribution-message");

  let submitting = false;
  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (submitting) return;
    submitting = true;
    const btn = form.querySelector("[type=submit]");
    const origText = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = `<span>${I18n.t("common.loading")}</span>`; }

    const formData = Object.fromEntries(new FormData(form));
    try {
      const res = await fetch("/api/genealogy/contributions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const result = await res.json();
      if (message) {
        message.textContent = res.ok ? (result.message || I18n.t("genealogy.contribSuccess")) : result.error;
        message.classList.toggle("error", !res.ok);
      }
      if (res.ok) form.reset();
    } catch (err) {
      if (message) { message.textContent = I18n.t("common.error"); message.classList.add("error"); }
    } finally {
      submitting = false;
      if (btn) { btn.disabled = false; btn.innerHTML = origText; }
    }
  });
}());

/* ── Register the new admin tabs in the tab map ─────────────────────────── */
/* This updates the existing languagechange handler's tabMap to include
   the new People and Contributions tabs. We dispatch a custom event that
   the existing handler picks up via the tabMap object. */
(function extendTabMap() {
  const tabMap = {
    submissions:           "admin.tabSubmissions",
    gotras:                "admin.tabGotras",
    "family-builder":      "admin.tabFamily",
    people:                "admin.tabPeople",
    "genealogy-contributions": "admin.tabGenealogyContrib",
  };
  /* Re-wire tab ARIA and label translation for the new tabs */
  document.querySelectorAll(".admin-tab[data-admin-view='people'], .admin-tab[data-admin-view='genealogy-contributions']").forEach(tab => {
    tab.setAttribute("role", "tab");
    _syncTabAria(tab);
    const panelId = `admin-${tab.dataset.adminView}`;
    tab.setAttribute("aria-controls", panelId);
    const panel = document.querySelector(`#admin-${tab.dataset.adminView}`);
    if (panel) {
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", `tab-${tab.dataset.adminView}`);
      tab.id = `tab-${tab.dataset.adminView}`;
    }
  });
  /* Store the extended map globally so the languagechange handler can use it */
  window._adminTabMap = tabMap;
}());

/* ═══════════════════════════════════════════════════════════════════════════
   12. ADMIN DASHBOARD
   ═══════════════════════════════════════════════════════════════════════════ */

(function initAdminDashboard() {
  const statsContainer = document.querySelector("#dashboard-stats");
  const recentContainer = document.querySelector("#dashboard-recent-people");
  if (!statsContainer) return;

  async function loadDashboard() {
    try {
      const res = await fetch("/api/vanshawali/stats", { credentials: "include" });
      if (!res.ok) throw new Error(I18n.t("common.sessionExpired"));
      const data = await res.json();

      statsContainer.innerHTML = [
        { label: "statTotalPeople", value: data.totalPeople },
        { label: "statVillages", value: data.totalVillages },
        { label: "statBranches", value: data.totalBranches },
        { label: "statRelationships", value: data.totalRelationships },
        { label: "statPending", value: data.pendingSubmissions },
      ].map(s => `
        <div class="stat-card">
          <div class="stat-value">${s.value}</div>
          <div class="stat-label">${I18n.t("genealogy." + s.label)}</div>
        </div>
      `).join("");

      if (recentContainer && data.recentPeople?.length) {
        recentContainer.innerHTML = data.recentPeople.map(p => `
          <div class="admin-person-row">
            <div>
              <h4>${p.fullName}</h4>
              <div class="person-info">
                <span class="pubid">${p.publicId}</span>
                ${p.village ? " · " + p.village : ""}
              </div>
            </div>
          </div>
        `).join("");
      } else if (recentContainer) {
        recentContainer.innerHTML = `<div class="admin-empty">${I18n.t("admin.noPeople")}</div>`;
      }
    } catch (err) {
      _showAdminError(err.message);
    }
  }

  document.querySelectorAll(".admin-tab[data-admin-view='dashboard']").forEach(tab => {
    tab.addEventListener("click", loadDashboard);
  });
}());

/* ═══════════════════════════════════════════════════════════════════════════
   13. CSV IMPORT — file upload, preview, commit
   ═══════════════════════════════════════════════════════════════════════════ */

(function initCsvImport() {
  const fileInput = document.querySelector("#import-file-input");
  const previewBtn = document.querySelector("#import-preview-btn");
  const commitBtn = document.querySelector("#import-commit-btn");
  const cancelBtn = document.querySelector("#import-cancel-btn");
  const previewArea = document.querySelector("#import-preview-area");
  const previewTbody = document.querySelector("#import-preview-tbody");
  const summaryEl = document.querySelector("#import-summary");
  const messageEl = document.querySelector("#import-preview-message");
  if (!fileInput) return;

  let csvText = "";
  let currentJobId = null;

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) { previewBtn.disabled = true; return; }
    const reader = new FileReader();
    reader.onload = e => {
      csvText = e.target.result;
      previewBtn.disabled = false;
      if (messageEl) { messageEl.textContent = file.name; messageEl.classList.remove("error"); }
    };
    reader.readAsText(file);
  });

  previewBtn?.addEventListener("click", async () => {
    if (!csvText.trim()) {
      if (messageEl) { messageEl.textContent = I18n.t("genealogy.importNoFile"); messageEl.classList.add("error"); }
      return;
    }
    previewBtn.disabled = true;
    previewBtn.textContent = I18n.t("common.loading");
    try {
      const res = await fetch("/api/admin/vanshawali/import/preview", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvText, filename: fileInput.files[0]?.name || "upload.csv" }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);

      currentJobId = result.jobId;
      previewArea.hidden = false;

      summaryEl.innerHTML = I18n.t("genealogy.importSummary", {
        total: result.summary.total, valid: result.summary.valid, invalid: result.summary.invalid,
      }).replace(/\{valid\}/, `<span class="badge-valid">${result.summary.valid}</span>`)
        .replace(/\{invalid\}/, `<span class="badge-invalid">${result.summary.invalid}</span>`);

      const allRows = [
        ...result.validRows.map(r => ({ ...r, isValid: true })),
        ...result.invalidRows.map(r => ({ ...r, isValid: false })),
      ].sort((a, b) => a.row - b.row);

      previewTbody.innerHTML = allRows.map(r => `
        <tr class="${r.isValid ? "row-valid" : "row-invalid"}">
          <td>${r.row}</td>
          <td>${r.external_id || ""}</td>
          <td>${r.full_name || ""}</td>
          <td>${r.father_external_id || ""}</td>
          <td>${r.mother_external_id || ""}</td>
          <td>${r.village || ""}</td>
          <td>${r.isValid ? I18n.t("genealogy.importValid") : I18n.t("genealogy.importInvalid")}</td>
          <td class="cell-errors">${r.errors ? r.errors.join("; ") : ""}</td>
        </tr>
      `).join("");

      commitBtn.disabled = result.summary.valid === 0;
    } catch (err) {
      if (messageEl) { messageEl.textContent = err.message; messageEl.classList.add("error"); }
    } finally {
      previewBtn.disabled = false;
      previewBtn.textContent = I18n.t("genealogy.previewBtn");
    }
  });

  commitBtn?.addEventListener("click", async () => {
    if (!currentJobId) return;
    commitBtn.disabled = true;
    commitBtn.textContent = I18n.t("common.loading");
    try {
      const res = await fetch("/api/admin/vanshawali/import/commit", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: currentJobId }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      if (messageEl) { messageEl.textContent = result.message; messageEl.classList.remove("error"); }
      previewArea.hidden = true;
      currentJobId = null;
      fileInput.value = "";
      previewBtn.disabled = true;
    } catch (err) {
      if (messageEl) { messageEl.textContent = err.message; messageEl.classList.add("error"); }
    } finally {
      commitBtn.disabled = false;
      commitBtn.textContent = I18n.t("genealogy.commitImport");
    }
  });

  cancelBtn?.addEventListener("click", () => {
    previewArea.hidden = true;
    currentJobId = null;
    if (messageEl) messageEl.textContent = "";
  });
}());

/* ═══════════════════════════════════════════════════════════════════════════
   14. BRANCH MANAGEMENT
   ═══════════════════════════════════════════════════════════════════════════ */

(function initBranchManagement() {
  const branchForm = document.querySelector("#branch-form");
  const branchList = document.querySelector("#branch-list");
  const branchGotraSelect = document.querySelector("#branch-gotra-select");
  const branchFormMessage = document.querySelector("#branch-form-message");
  if (!branchForm && !branchList) return;

  async function loadBranchesForMgmt() {
    if (!branchList) return;
    try {
      const res = await fetch("/api/vanshawali/branches", { credentials: "include" });
      if (!res.ok) return;
      const { branches } = await res.json();
      if (!branches.length) {
        branchList.innerHTML = `<div class="admin-empty">${I18n.t("genealogy.noBranchesMgmt")}</div>`;
        return;
      }
      branchList.innerHTML = branches.map(b => `
        <div class="branch-mgmt-card">
          <div>
            <h4>${b.name}</h4>
            <div class="branch-meta">
              ${b.gotraName || ""} · ${b.personCount || 0} ${I18n.t("genealogy.branchPersonCount")}
              ${b.description ? " · " + b.description : ""}
            </div>
          </div>
        </div>
      `).join("");
    } catch (_) { /* silent */ }
  }

  async function loadGotrasForBranchForm() {
    if (!branchGotraSelect) return;
    try {
      const res = await fetch("/api/admin/gotras", { credentials: "include" });
      if (!res.ok) return;
      const { gotras } = await res.json();
      branchGotraSelect.innerHTML = `<option value="">—</option>` +
        gotras.map(g => `<option value="${g.id}">${g.name}</option>`).join("");
    } catch (_) { /* silent */ }
  }

  let branchSubmitting = false;
  branchForm?.addEventListener("submit", async e => {
    e.preventDefault();
    if (branchSubmitting) return;
    branchSubmitting = true;
    const btn = branchForm.querySelector("[type=submit]");
    const origText = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = `<span>${I18n.t("common.loading")}</span>`; }

    const formData = Object.fromEntries(new FormData(branchForm));
    try {
      const res = await fetch("/api/admin/branches", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const result = await res.json();
      if (branchFormMessage) {
        branchFormMessage.textContent = res.ok ? result.message : result.error;
        branchFormMessage.classList.toggle("error", !res.ok);
      }
      if (res.ok) { branchForm.reset(); loadBranchesForMgmt(); }
    } catch (err) {
      if (branchFormMessage) { branchFormMessage.textContent = I18n.t("common.error"); branchFormMessage.classList.add("error"); }
    } finally {
      branchSubmitting = false;
      if (btn) { btn.disabled = false; btn.innerHTML = origText; }
    }
  });

  document.querySelectorAll(".admin-tab[data-admin-view='branch-mgmt']").forEach(tab => {
    tab.addEventListener("click", () => {
      loadBranchesForMgmt();
      loadGotrasForBranchForm();
    });
  });
}());

/* ═══════════════════════════════════════════════════════════════════════════
   15. INTERACTIVE FAMILY TREE RENDERER
   ═══════════════════════════════════════════════════════════════════════════
   SVG-based tree with expand/collapse and lazy loading.
   Renders on vanshawali.html when ?person=PUBLICID is present.
   ═══════════════════════════════════════════════════════════════════════════ */

(function initFamilyTree() {
  const treeSection = document.querySelector("#person-tree-section");
  const canvas = document.querySelector("#family-tree-canvas");
  const svg = document.querySelector("#tree-svg");
  const nodesLayer = document.querySelector("#tree-nodes-layer");
  const expandAllBtn = document.querySelector("#tree-expand-all");
  const collapseAllBtn = document.querySelector("#tree-collapse-all");
  const printBtn = document.querySelector("#tree-print");
  if (!treeSection || !canvas) return;

  const NODE_W = 160;
  const NODE_H = 60;
  const GAP_Y = 80;
  const GAP_X = 20;
  const expandedNodes = new Set();
  let treeData = null;
  let layoutNodes = [];

  async function loadChildren(personId) {
    try {
      const res = await fetch(`/api/genealogy/people/${personId}/tree`);
      if (!res.ok) return [];
      const { tree } = await res.json();
      return tree?.children || [];
    } catch (_) { return []; }
  }

  function buildLayout(node, depth, leftStart) {
    const children = expandedNodes.has(node.publicId || node.id)
      ? (node.children || [])
      : [];
    const childWidths = children.length
      ? children.map(c => buildLayout(c, depth + 1, leftStart))
      : [NODE_W + GAP_X];

    const totalWidth = childWidths.reduce((a, b) => a + b, 0) || NODE_W + GAP_X;
    const nodeLeft = leftStart + (totalWidth - NODE_W - GAP_X) / 2;

    layoutNodes.push({
      ...node,
      _depth: depth,
      _left: nodeLeft,
      _top: depth * (NODE_H + GAP_Y) + 20,
      _width: totalWidth,
      _hasChildren: (node.children && node.children.length > 0) ||
                    (node._loadedChildren && node._loadedChildren.length > 0),
      _expanded: expandedNodes.has(node.publicId || node.id),
    });

    let childLeft = leftStart;
    children.forEach((child, i) => {
      buildLayout(child, depth + 1, childLeft);
      childLeft += childWidths[i];
    });

    return totalWidth;
  }

  function renderTree(rootPerson) {
    layoutNodes = [];
    buildLayout(rootPerson, 0, 0);

    const totalWidth = layoutNodes.reduce((max, n) => Math.max(max, n._left + NODE_W + GAP_X), 0);
    const totalHeight = layoutNodes.reduce((max, n) => Math.max(max, n._top + NODE_H + 20), 0);

    canvas.style.width = Math.max(totalWidth, canvas.clientWidth) + "px";
    canvas.style.height = totalHeight + "px";
    svg.setAttribute("width", totalWidth);
    svg.setAttribute("height", totalHeight);
    svg.innerHTML = "";

    /* Draw connector lines parent → child */
    layoutNodes.forEach(node => {
      if (!expandedNodes.has(node.publicId || node.id)) return;
      const children = layoutNodes.filter(n =>
        n._depth === node._depth + 1 &&
        n._left >= node._left - 50 && n._left <= node._left + node._width
      );
      children.forEach(child => {
        const x1 = node._left + NODE_W / 2;
        const y1 = node._top + NODE_H;
        const x2 = child._left + NODE_W / 2;
        const y2 = child._top;
        const midY = (y1 + y2) / 2;
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", `M${x1},${y1} L${x1},${midY} L${x2},${midY} L${x2},${y2}`);
        path.setAttribute("stroke", "#c49a45");
        path.setAttribute("stroke-width", "1.5");
        path.setAttribute("fill", "none");
        path.setAttribute("opacity", "0.5");
        svg.appendChild(path);
      });
    });

    /* Render node cards */
    nodesLayer.innerHTML = "";
    nodesLayer.style.position = "relative";
    nodesLayer.style.width = totalWidth + "px";
    nodesLayer.style.height = totalHeight + "px";

    layoutNodes.forEach(node => {
      const card = document.createElement("div");
      card.className = "tree-node-card";
      card.style.left = node._left + "px";
      card.style.top = node._top + "px";
      card.style.width = NODE_W + "px";
      if (node._depth === 0) card.classList.add("selected");

      const genLabel = node._depth === 0
        ? I18n.t("genealogy.treeRoot")
        : `${I18n.t("genealogy.generation")} ${node._depth + 1}`;

      card.innerHTML = `
        <div class="node-name">${node.fullName || "?"}</div>
        <div class="node-meta">${node.village || ""}</div>
        <span class="node-gen">${genLabel}</span>
        ${node._hasChildren ? `<button class="node-expand-btn">${node._expanded ? "−" : "+"}</button>` : ""}
      `;

      card.addEventListener("click", async () => {
        if (node.publicId) {
          window.location.href = `/vanshawali.html?person=${node.publicId}`;
        }
      });

      const expandBtn = card.querySelector(".node-expand-btn");
      if (expandBtn) {
        expandBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const nodeId = node.publicId || node.id;
          if (expandedNodes.has(nodeId)) {
            expandedNodes.delete(nodeId);
          } else {
            expandedNodes.add(nodeId);
            if (!node.children || node.children.length === 0) {
              node.children = await loadChildren(node.publicId);
              if (!node.children.length) {
                expandedNodes.delete(nodeId);
                return;
              }
            }
          }
          renderTree(treeData);
        });
      }

      nodesLayer.appendChild(card);
    });
  }

  /* Init: fetch the root person tree and render */
  const personId = new URLSearchParams(location.search).get("person");
  if (personId) {
    treeSection.hidden = false;
    fetch(`/api/genealogy/people/${personId}/tree`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!data || !data.tree) return;
        treeData = data.tree.person;
        treeData.publicId = treeData.public_id || personId;
        /* Pre-populate children from tree response */
        treeData.children = (data.tree.children || []).map(c => ({
          ...c,
          publicId: c.public_id || c.publicId,
          children: [],
        }));
        renderTree(treeData);
      })
      .catch(() => { /* silent */ });
  }

  expandAllBtn?.addEventListener("click", () => {
    layoutNodes.forEach(n => { if (n._hasChildren) expandedNodes.add(n.publicId || n.id); });
    renderTree(treeData);
  });
  collapseAllBtn?.addEventListener("click", () => {
    expandedNodes.clear();
    renderTree(treeData);
  });
  printBtn?.addEventListener("click", () => window.print());
}());

/* ═══════════════════════════════════════════════════════════════════════════
   16. VILLAGE DIRECTORY (public)
   ═══════════════════════════════════════════════════════════════════════════ */

(function initVillageDirectory() {
  const villageGrid = document.querySelector("#village-directory");
  if (!villageGrid) return;

  fetch("/api/vanshawali/villages")
    .then(res => res.ok ? res.json() : { villages: [] })
    .then(({ villages }) => {
      if (!villages.length) {
        villageGrid.innerHTML = `<div class="empty-state"><p>${I18n.t("genealogy.noVillages")}</p></div>`;
        return;
      }
      villageGrid.innerHTML = villages.map(v => `
        <div class="village-card">
          <h4>${v.village}</h4>
          <div class="village-meta">${v.district || ""} ${v.state ? "· " + v.state : ""}</div>
          <div class="village-count">${v.personCount}</div>
          <div class="village-meta">${I18n.t("genealogy.villagePeople")}</div>
        </div>
      `).join("");
    })
    .catch(() => { villageGrid.innerHTML = `<div class="empty-state"><p>${I18n.t("common.error")}</p></div>`; });
}());

/* ── Extend the tab map for new admin tabs ───────────────────────────────── */
(function extendTabMap2() {
  if (window._adminTabMap) {
    window._adminTabMap.dashboard = "genealogy.tabDashboard";
    window._adminTabMap.import = "genealogy.tabImport";
    window._adminTabMap["branch-mgmt"] = "genealogy.tabBranchMgmt";
  }
  /* Wire ARIA for new tabs */
  document.querySelectorAll(
    ".admin-tab[data-admin-view='dashboard'], .admin-tab[data-admin-view='import'], .admin-tab[data-admin-view='branch-mgmt']"
  ).forEach(tab => {
    tab.setAttribute("role", "tab");
    _syncTabAria(tab);
    const panelId = `admin-${tab.dataset.adminView}`;
    tab.setAttribute("aria-controls", panelId);
    const panel = document.querySelector(`#admin-${tab.dataset.adminView}`);
    if (panel) {
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", `tab-${tab.dataset.adminView}`);
      tab.id = `tab-${tab.dataset.adminView}`;
    }
  });
}());
