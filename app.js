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

/* loadGotras — enhanced with expandable per-gotra member management */
async function loadGotras() {
  const container = document.querySelector("#gotra-list");
  if (!container) return;
  _clearAdminError();
  try {
    const response = await fetch("/api/admin/gotras", { credentials: "include" });
    if (!response.ok) throw new Error(I18n.t("common.sessionExpired"));
    const gotras = (await response.json()).gotras;

    if (!gotras.length) {
      container.innerHTML = `<div class="admin-empty">${I18n.t("admin.noGotra")}</div>`;
      return;
    }

    container.innerHTML = gotras.map(gotra => `
      <div class="gotra-mgmt-card" data-gotra-id="${gotra.id}">
        <div class="gotra-mgmt-header">
          <div>
            <h4>${gotra.name}</h4>
            <div class="gmh-meta">
              ${gotra.originPlace ? gotra.originPlace + " · " : ""}${gotra.status}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="gmh-count">${gotra.memberCount} सदस्य</span>
            <span class="gmh-toggle">▼</span>
          </div>
        </div>
        <div class="gotra-mgmt-body">
          <div class="gotra-members-container">
            <p style="font-size:13px;color:var(--muted)">खोलें और सदस्य देखें...</p>
          </div>
        </div>
      </div>
    `).join("");

    container.querySelectorAll(".gotra-mgmt-header").forEach(header => {
      header.addEventListener("click", async () => {
        const card = header.closest(".gotra-mgmt-card");
        const gotraId = card.dataset.gotraId;
        const wasOpen = card.classList.contains("open");
        card.classList.toggle("open");
        if (!wasOpen) await _loadGotraMembersPanel(card, gotraId);
      });
    });
  } catch (err) {
    _showAdminError(err.message);
  }
}

async function _loadGotraMembersPanel(card, gotraId) {
  const bodyEl = card.querySelector(".gotra-mgmt-body");
  const membersContainer = card.querySelector(".gotra-members-container");
  try {
    const res = await fetch(`/api/admin/gotras/${gotraId}/members`, { credentials: "include" });
    if (!res.ok) throw new Error(I18n.t("common.error"));
    const { members } = await res.json();

    const tableRows = members.length
      ? members.map(m => `
          <tr>
            <td>${m.personName}${m.personId ? '<span class="linked-badge">✓</span>' : ""}</td>
            <td>${m.relationOrRole || "—"}</td>
            <td>${[m.village, m.district, m.state].filter(Boolean).join(", ") || "—"}</td>
            <td>${m.isLiving === false ? "स्वर्गी" : "जीवित"}</td>
            <td>${m.publicId ? `<a class="profile-link" href="/vanshawali.html?person=${m.publicId}" target="_blank">प्रोफ़ाइल ↗</a>` : "—"}</td>
          </tr>`)
        .join("")
      : `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:14px">अभी कोई सदस्य नहीं</td></tr>`;

    membersContainer.innerHTML = `
      <table class="gotra-member-table">
        <thead><tr><th>नाम</th><th>भूमिका</th><th>स्थान</th><th>स्थिति</th><th>प्रोफ़ाइल</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
      <div class="add-member-panel">
        <div class="add-member-panel-tabs">
          <button class="amp-tab active" data-amp-tab="new-member">+ नया सदस्य</button>
          <button class="amp-tab" data-amp-tab="link-existing">मौजूदा व्यक्ति जोड़ें</button>
        </div>
        <div class="amp-panel active" data-amp-panel="new-member">
          <form class="add-gotra-member-form">
            <div class="form-row">
              <label>पूरा नाम *<input name="personName" required maxlength="120" placeholder="जैसे: मोहन सिंह"></label>
              <label>भूमिका / संबंध<input name="relationOrRole" maxlength="120" placeholder="संस्थापक, सदस्य..."></label>
            </div>
            <div class="form-row">
              <label>गांव<input name="village" maxlength="120"></label>
              <label>जिला<input name="district" maxlength="120"></label>
            </div>
            <div class="form-row">
              <label>राज्य<input name="state" maxlength="120"></label>
              <label>जीवित?<select name="isLiving"><option value="true">हां</option><option value="false">नहीं</option></select></label>
            </div>
            <div class="form-row">
              <label style="position:relative">पिता (खोजें)
                <input class="gm-parent-search" type="text" autocomplete="off" placeholder="नाम लिखकर खोजें...">
                <input type="hidden" name="fatherId" class="gm-parent-id">
                <div class="autocomplete-suggestions"></div>
              </label>
              <label style="position:relative">माता (खोजें)
                <input class="gm-parent-search" type="text" autocomplete="off" placeholder="नाम लिखकर खोजें...">
                <input type="hidden" name="motherId" class="gm-parent-id">
                <div class="autocomplete-suggestions"></div>
              </label>
            </div>
            <label>नोट्स<input name="notes" maxlength="300"></label>
            <div style="margin-top:12px"><button class="button button-maroon" type="submit">सदस्य जोड़ें →</button></div>
            <p class="form-message" role="status"></p>
          </form>
        </div>
        <div class="amp-panel" data-amp-panel="link-existing">
          <form class="link-gotra-person-form">
            <label style="position:relative">मौजूदा व्यक्ति खोजें *
              <input class="gm-parent-search" type="text" autocomplete="off" placeholder="नाम लिखकर खोजें...">
              <input type="hidden" name="personId" class="gm-parent-id">
              <div class="autocomplete-suggestions"></div>
            </label>
            <label style="margin-top:12px">भूमिका / संबंध<input name="relationOrRole" maxlength="120"></label>
            <div style="margin-top:12px"><button class="button button-maroon" type="submit">जोड़ें →</button></div>
            <p class="form-message" role="status"></p>
          </form>
        </div>
      </div>
    `;

    /* Inner tab switching */
    bodyEl.querySelectorAll(".amp-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        bodyEl.querySelectorAll(".amp-tab").forEach(t => t.classList.remove("active"));
        bodyEl.querySelectorAll(".amp-panel").forEach(p => p.classList.remove("active"));
        tab.classList.add("active");
        bodyEl.querySelector(`[data-amp-panel="${tab.dataset.ampTab}"]`)?.classList.add("active");
      });
    });

    /* Autocomplete for all parent-search inputs inside this panel */
    bodyEl.querySelectorAll(".gm-parent-search").forEach(input => _wireGmAutocomplete(input));

    /* New member form */
    const addForm = bodyEl.querySelector(".add-gotra-member-form");
    _wireGmAddForm(addForm, gotraId, card);

    /* Link existing person form */
    const linkForm = bodyEl.querySelector(".link-gotra-person-form");
    _wireGmLinkForm(linkForm, gotraId, card);

  } catch (err) {
    if (membersContainer) membersContainer.innerHTML = `<p style="color:#842d2d;font-size:13px">${err.message}</p>`;
  }
}

function _wireGmAutocomplete(input) {
  const label = input.closest("label");
  const suggestionsEl = label?.querySelector(".autocomplete-suggestions");
  const hiddenId = label?.querySelector(".gm-parent-id");
  if (!suggestionsEl) return;
  let timer;
  input.addEventListener("input", () => {
    if (hiddenId) hiddenId.value = "";
    clearTimeout(timer);
    const query = input.value.trim();
    if (query.length < 2) { suggestionsEl.classList.remove("show"); return; }
    timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/people/search?q=${encodeURIComponent(query)}`, { credentials: "include" });
        if (!res.ok) return;
        const { people } = await res.json();
        if (!people.length) { suggestionsEl.classList.remove("show"); return; }
        suggestionsEl.innerHTML = people.map(p =>
          `<div class="suggestion-item" data-id="${p.id}" data-name="${p.fullName}">
            <div class="sug-name">${p.fullName}</div>
            <div class="sug-meta">${p.birthYear || ""} ${p.village ? "· " + p.village : ""}</div>
          </div>`
        ).join("");
        suggestionsEl.classList.add("show");
        suggestionsEl.querySelectorAll(".suggestion-item").forEach(item =>
          item.addEventListener("click", () => {
            if (hiddenId) hiddenId.value = item.dataset.id;
            input.value = item.dataset.name;
            suggestionsEl.classList.remove("show");
          })
        );
      } catch (_) { /* silent */ }
    }, 300);
  });
  document.addEventListener("click", e => {
    if (!input.contains(e.target)) suggestionsEl.classList.remove("show");
  }, { passive: true });
}

function _wireGmAddForm(form, gotraId, card) {
  if (!form) return;
  let busy = false;
  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    const btn = form.querySelector("[type=submit]");
    const orig = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = `<span>${I18n.t("common.loading")}</span>`; }
    const msgEl = form.querySelector(".form-message");
    const data = Object.fromEntries(new FormData(form));
    try {
      const res = await fetch(`/api/admin/gotras/${gotraId}/members`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (msgEl) { msgEl.textContent = res.ok ? result.message : result.error; msgEl.classList.toggle("error", !res.ok); }
      if (res.ok) { form.reset(); await _loadGotraMembersPanel(card, gotraId); loadGotras(); }
    } catch (err) {
      if (msgEl) { msgEl.textContent = I18n.t("common.error"); msgEl.classList.add("error"); }
    } finally {
      busy = false;
      if (btn) { btn.disabled = false; btn.innerHTML = orig; }
    }
  });
}

function _wireGmLinkForm(form, gotraId, card) {
  if (!form) return;
  let busy = false;
  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    const btn = form.querySelector("[type=submit]");
    const orig = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = `<span>${I18n.t("common.loading")}</span>`; }
    const msgEl = form.querySelector(".form-message");
    const data = Object.fromEntries(new FormData(form));
    try {
      const res = await fetch(`/api/admin/gotras/${gotraId}/link-person`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (msgEl) { msgEl.textContent = res.ok ? result.message : result.error; msgEl.classList.toggle("error", !res.ok); }
      if (res.ok) { form.reset(); await _loadGotraMembersPanel(card, gotraId); loadGotras(); }
    } catch (err) {
      if (msgEl) { msgEl.textContent = I18n.t("common.error"); msgEl.classList.add("error"); }
    } finally {
      busy = false;
      if (btn) { btn.disabled = false; btn.innerHTML = orig; }
    }
  });
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

/* ═══════════════════════════════════════════════════════════════════════
   8 / 15 / 16.  PUBLIC GENEALOGY EXPLORER, FAMILY TREE & VILLAGE DIR
   Moved to /public/js/vanshawali-explorer.js — loaded only on vanshawali.html
   ═══════════════════════════════════════════════════════════════════════ */


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
