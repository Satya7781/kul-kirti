/**
 * Kul-Kirti — vanshawali-explorer.js
 * =====================================
 * Public Genealogy Explorer + Interactive Family Tree Renderer
 *
 * Three URL-driven views on vanshawali.html:
 *   default         → Home: gotra directory + village directory
 *   ?gotra=ID       → Gotra detail with members and branches
 *   ?person=PUBID   → Person profile + expandable SVG family tree
 */

/* ═══════════════════════════════════════════════════════════════════════════
   PUBLIC GENEALOGY EXPLORER
   ═══════════════════════════════════════════════════════════════════════════ */

/* Shared by the explorer IIFE and the top-level family-tree renderer. */
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

/* Labels are resolved once per render so a language switch is picked up. */
function _treeLabels() {
  return {
    connections: I18n.t("genealogy.treeConnections"),
    wife: "पत्नी",
    village: "गांव",
    profile: I18n.t("genealogy.treeProfile"),
    viewProfile: I18n.t("genealogy.treeViewProfile"),
    root: I18n.t("genealogy.treeRoot"),
    loading: I18n.t("genealogy.treeLoading"),
    children: n => I18n.t("genealogy.treeChildren", { n }),
    generation: n => `${I18n.t("genealogy.generation")} ${n}`,
    expand: I18n.t("genealogy.treeExpand"),
    collapse: I18n.t("genealogy.treeCollapse"),
  };
}

(function initGenealogyExplorer() {
  /* DOM handles */
  const homeView           = document.querySelector("#vw-home-view");
  const gotraDirectory     = document.querySelector("#gotra-directory");
  const villageGrid        = document.querySelector("#village-directory");
  const gotraDetailSection = document.querySelector("#gotra-detail-section");
  const gotraDetailContent = document.querySelector("#gotra-detail-content");
  const personSection      = document.querySelector("#person-profile-section");
  const personContent      = document.querySelector("#person-profile-content");
  const searchForm         = document.querySelector("#genealogy-search-form");
  const searchInput        = document.querySelector("#genealogy-search-input");
  const searchResults      = document.querySelector("#genealogy-search-results");
  const treeDetailSection = document.querySelector("#tree-detail-section");
  document.querySelector("#vw-back-btn")?.addEventListener("click", () => history.back());
  document.querySelector("#vw-tree-back-btn")?.addEventListener("click", () => history.back());

  /* Not on vanshawali.html */
  if (!homeView && !gotraDetailSection && !personSection && !treeDetailSection) return;

  const params  = new URLSearchParams(location.search);
  const gotraId = params.get("gotra");
  const personId = params.get("person");
  const treeId = params.get("tree");
  const recordId = params.get("id") || params.get("record");
  const quickQuery = params.get("q");

  /* ── Route ─────────────────────────────────────────────────────────────── */
  if (treeId) {
    if (homeView) homeView.hidden = true;
    _loadTreeDetail(treeId, personId);
  } else if (recordId) {
    /* Previously the search page linked here with ?id= but nothing handled
       it.  Render the published record instead of showing a blank page. */
    if (homeView) homeView.hidden = true;
    _loadPublishedRecord(recordId);
  } else if (personId) {
    if (homeView) homeView.hidden = true;
    _loadPersonProfile(personId);
  } else if (gotraId) {
    if (homeView) homeView.hidden = true;
    _loadGotraDetail(gotraId);
  } else {
    _loadGotraDirectory();
    _loadVillageDirectory();
    if (quickQuery) {
      searchInput.value = quickQuery;
      _searchPeople(quickQuery);
    }
  }

  /* ── Search ─────────────────────────────────────────────────────────────── */
  searchForm?.addEventListener("submit", e => {
    e.preventDefault();
    _searchPeople(searchInput?.value?.trim() || "");
  });

  async function _searchPeople(query) {
    if (!searchResults) return;
    if (!query || query.length < 2) { searchResults.innerHTML = ""; return; }
    searchResults.innerHTML = `<div class="empty-state"><p>${I18n.t("common.loading")}</p></div>`;
    try {
      const res = await fetch(`/api/vanshawali/search?type=person&q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error(I18n.t("common.error"));
      const { results } = await res.json();
      if (!results.length) {
        searchResults.innerHTML = `<div class="empty-state"><p>${I18n.t("genealogy.searchNoResults")}</p></div>`;
        return;
      }
      searchResults.innerHTML =
        `<p class="result-summary">${I18n.t("genealogy.searchResults", { n: results.length })}</p>` +
        results.map(p => {
          const meta = [p.wifeName ? `पत्नी: ${p.wifeName}` : "", p.village, p.gotraName, p.treeReference]
            .filter(Boolean).join(" · ");
          const ancestry = p.path?.length ? ` <small class="vsh-search-path">${escapeHtml(p.path.map(a => a.full_name).join(" → "))}</small>` : "";
          return `<div class="person-search-card">
            <div><h4>${escapeHtml(p.name)}</h4><div class="person-meta">${escapeHtml(meta)}</div>
              ${ancestry}
              <small class="person-meta">${I18n.t("genealogy.descendants")}: ${p.descendantCount}</small>
            </div>
            <a class="result-tag" href="${escapeHtml(p.deepLink)}">${I18n.t("search.viewTree")}</a>
          </div>`;
        }).join("");
    } catch (err) {
      searchResults.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
    }
  }

  /* ── Gotra directory ──────────────────────────────────────────────────── */
  async function _loadGotraDirectory() {
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
        <a class="gotra-dir-card" href="/vanshawali.html?gotra=${encodeURIComponent(g.id)}">
          <h3>${escapeHtml(g.name)}</h3>
          <div class="gotra-meta">
            <span><b>${g.personCount || 0}</b> ${I18n.t("genealogy.gotraPersons")}</span>
            <span><b>${g.branchCount || 0}</b> ${I18n.t("genealogy.gotraBranches")}</span>
          </div>
          ${g.historicalDetails
            ? `<p class="gotra-desc">${escapeHtml(g.historicalDetails.slice(0, 150))}${g.historicalDetails.length > 150 ? "…" : ""}</p>`
            : ""}
          <span class="gotra-link">${I18n.t("genealogy.viewDetail")} →</span>
        </a>`).join("");
    } catch (err) {
      gotraDirectory.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
    }
  }

  /* ── Village directory ────────────────────────────────────────────────── */
  async function _loadVillageDirectory() {
    if (!villageGrid) return;
    try {
      const res = await fetch("/api/vanshawali/villages");
      if (!res.ok) throw new Error(I18n.t("common.error"));
      const { villages } = await res.json();
      if (!villages.length) {
        villageGrid.innerHTML = `<div class="empty-state"><p>${I18n.t("genealogy.noVillages")}</p></div>`;
        return;
      }
      villageGrid.innerHTML = villages.map(v => `
        <div class="village-card">
          <h4>${escapeHtml(v.village)}</h4>
          <div class="village-meta">${escapeHtml([v.district, v.state].filter(Boolean).join(" · "))}</div>
          <div class="village-count">${v.personCount}</div>
          <div class="village-meta">${I18n.t("genealogy.villagePeople")}</div>
        </div>`).join("");
    } catch (err) {
      villageGrid.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
    }
  }

  /* ── Gotra detail ─────────────────────────────────────────────────────── */
  async function _loadGotraDetail(id) {
    if (!gotraDetailContent) return;
    gotraDetailSection.hidden = false;
    gotraDetailContent.innerHTML = `<div class="empty-state"><p>${I18n.t("common.loading")}</p></div>`;
    try {
      const res = await fetch(`/api/genealogy/gotras/${id}`);
      if (!res.ok) throw new Error(I18n.t("common.error"));
      const { gotra, branches, roots, members } = await res.json();

      /* The public gotra endpoint already returns the safe member subset —
         no need to call the auth-protected admin endpoint (401 + round-trip). */
      const membersList = Array.isArray(members) ? members : [];

      const rootCards = roots.length
        ? roots.map(r => `
            <div class="gotra-member-card">
              <a href="/vanshawali.html?person=${encodeURIComponent(r.publicId)}">${escapeHtml(r.fullName)}</a>
              <div class="gmc-meta">${escapeHtml(`${r.birthYear || ""}${r.deathYear ? " – " + r.deathYear : ""}${r.village ? " · " + r.village : ""}`)}</div>
            </div>`).join("")
        : `<p class="rel-empty">${I18n.t("genealogy.noRoots")}</p>`;

      const memberCards = membersList
        .filter(m => m.publicId)   /* only show linked members publicly */
        .map(m => `
          <div class="gotra-member-card">
            <a href="/vanshawali.html?person=${encodeURIComponent(m.publicId)}">${escapeHtml(m.personName)}</a>
            <div class="gmc-meta">${escapeHtml(`${m.relationOrRole ? m.relationOrRole + " · " : ""}${[m.village, m.district, m.state].filter(Boolean).join(", ")}`)}</div>
          </div>`)
        .join("");

      gotraDetailContent.innerHTML = `
        <div class="gotra-detail-card">
          <h2>${escapeHtml(gotra.name)}</h2>
          ${gotra.originPlace
            ? `<p style="color:var(--muted);font-size:14px;margin-bottom:12px">${escapeHtml(`${gotra.originPlace}${gotra.originPeriod ? " · " + gotra.originPeriod : ""}`)}</p>`
            : ""}
          <div class="gotra-stats">
            <div class="gotra-stat"><b>${membersList.length || roots.length}</b><span>सदस्य</span></div>
            <div class="gotra-stat"><b>${branches.length}</b><span>${I18n.t("genealogy.branches")}</span></div>
          </div>
          ${gotra.historicalDetails
            ? `<div class="gotra-detail-section"><h3>इतिहास</h3><p style="color:var(--muted);font-size:15px;line-height:1.8">${escapeHtml(gotra.historicalDetails)}</p></div>`
            : ""}
          <div class="gotra-detail-section">
            <h3>${I18n.t("genealogy.roots")}</h3>
            <div class="gotra-member-grid">${rootCards}</div>
          </div>
          ${memberCards
            ? `<div class="gotra-detail-section"><h3>सभी सदस्य</h3><div class="gotra-member-grid">${memberCards}</div></div>`
            : ""}
          <div class="gotra-detail-section">
            <h3>${I18n.t("genealogy.branches")}</h3>
            ${branches.length
              ? `<div class="rel-list">${branches.map(b => `<div class="rel-item">${escapeHtml(b.name)}${b.description ? ` <span class="rel-meta">${escapeHtml(b.description)}</span>` : ""}</div>`).join("")}</div>`
              : `<p class="rel-empty">${I18n.t("genealogy.noBranches")}</p>`}
          </div>
        </div>`;
    } catch (err) {
      gotraDetailContent.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
    }
  }

  /* ── Verified tree detail (?tree=ID) ─────────────────────────────────── */
  let detailVisual = null;
  let detailExpanded = new Set();
  let detailZoom = 1;

  async function _loadTreeDetail(id, focusPersonId) {
    const content = document.querySelector("#tree-detail-content");
    const canvas = document.querySelector("#tree-detail-canvas");
    const inner = document.querySelector("#tree-detail-inner");
    const controls = document.querySelector("#tree-detail-controls");
    if (!content || !canvas || !inner) return;
    treeDetailSection.hidden = false;
    content.innerHTML = `<div class="empty-state"><p>${I18n.t("common.loading")}</p></div>`;
    try {
      const res = await fetch(`/api/vanshawali/trees/${encodeURIComponent(id)}/visual`);
      if (!res.ok) throw new Error(I18n.t("genealogy.restrictedProfile"));
      const visual = await res.json();
      detailVisual = visual;
      const people = visual.people || [];
      detailExpanded = new Set(people.map(p => p.id));
      detailZoom = 1;
      content.innerHTML = `
        <div class="gotra-detail-card">
          <h2>${escapeHtml(visual.gotraName || "")} · ${escapeHtml(visual.treeReference || "")}</h2>
          <p class="vsh-meta">${people.length} सदस्य · ${(visual.links || []).length} जुड़ी शाखाएँ</p>
          ${(visual.links || []).map(l => `<p class="vsh-meta">↳ ${escapeHtml(l.source_reference)} ↔ ${escapeHtml(l.target_reference)}${l.notes ? ` — ${escapeHtml(l.notes)}` : ""}</p>`).join("")}
          <div class="gotra-member-grid">${people.slice(0, 200).map(p => `
            <div class="gotra-member-card">
              <strong>${escapeHtml(p.full_name)}</strong>
              <div class="gmc-meta">${escapeHtml([p.wife_name && `पत्नी: ${p.wife_name}`, p.village, p.member_type].filter(Boolean).join(" · "))}</div>
            </div>`).join("")}</div>
        </div>`;
      canvas.hidden = false;
      controls.hidden = false;
      _renderDetailTree(inner, canvas, visual, focusPersonId);
    } catch (err) {
      content.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
    }
  }

  let detailTreeView = null;

  function _collectExpandable(node, out) {
    if (!node || !node.children || !node.children.length) return;
    out.add(node.id);
    node.children.forEach(child => _collectExpandable(child, out));
  }

  function _renderDetailTree(inner, canvas, visual, focusPersonId) {
    if (!detailVisual || !window.FamilyTree) return;
    const nodes = FamilyTree.buildNodesFromVisual(
      visual.people || [],
      visual.relationships || [],
      {
        rootId: visual.rootPersonId,
        profileUrl: person => person.public_id
          ? `/vanshawali.html?person=${encodeURIComponent(person.public_id)}`
          : null,
      }
    );

    if (!detailExpanded.size) {
      const all = new Set();
      nodes.forEach(node => _collectExpandable(node, all));
      detailExpanded = all;
    }

    detailTreeView = FamilyTree.createView({
      inner,
      nodes,
      expanded: detailExpanded,
      zoom: detailZoom,
      labels: _treeLabels(),
    });
    detailTreeView.render(focusPersonId);
    canvas.dataset.treeWidth = String(detailTreeView.getSize().width);
  }

  /* Zoom / expand controls are bound once, never per render. */
  document.querySelector("#tree-zoom-in")?.addEventListener("click", () => {
    detailZoom = detailTreeView?.zoomBy(0.15) ?? Math.min(2, detailZoom + 0.15);
  });
  document.querySelector("#tree-zoom-out")?.addEventListener("click", () => {
    detailZoom = detailTreeView?.zoomBy(-0.15) ?? Math.max(0.4, detailZoom - 0.15);
  });
  document.querySelector("#tree-zoom-fit")?.addEventListener("click", () => {
    const canvas = document.querySelector("#tree-detail-canvas");
    if (!canvas || !detailTreeView) return;
    detailZoom = detailTreeView.fit(canvas.clientWidth);
  });
  document.querySelector("#tree-expand")?.addEventListener("click", () => {
    detailTreeView?.expandAll();
  });
  document.querySelector("#tree-collapse")?.addEventListener("click", () => {
    detailTreeView?.collapseAll(true);
  });

  /* ── Published-record deep link (?id= / ?record=) ─────────────────────── */
  async function _loadPublishedRecord(id) {
    const content = document.querySelector("#tree-detail-content");
    if (!content) return;
    treeDetailSection.hidden = false;
    const canvas = document.querySelector("#tree-detail-canvas");
    const controls = document.querySelector("#tree-detail-controls");
    if (canvas) canvas.hidden = true;
    if (controls) controls.hidden = true;
    content.innerHTML = `<div class="empty-state"><p>${I18n.t("common.loading")}</p></div>`;
    try {
      const res = await fetch(`/api/records/${encodeURIComponent(id)}/tree`);
      if (!res.ok) throw new Error(I18n.t("search.emptyQuery"));
      const { record } = await res.json();
      const family = Array.isArray(record.familyDetails) ? record.familyDetails : [];
      content.innerHTML = `
        <div class="gotra-detail-card">
          <h2>${escapeHtml(record.name || "परिवार रिकॉर्ड")}</h2>
          <p class="vsh-meta">${escapeHtml([record.village, record.district, record.state, record.familyBranch].filter(Boolean).join(" · "))}</p>
          <h3>${I18n.t("genealogy.members") || "सदस्य"}</h3>
          <div class="gotra-member-grid">${family.map(m => `
            <div class="gotra-member-card">
              <strong>${escapeHtml(m.name || m.fullName || "—")}</strong>
              <div class="gmc-meta">${escapeHtml(m.relation || m.relationOrRole || "")}</div>
            </div>`).join("")}</div>
          <p class="vsh-meta"><a href="/search.html">← ${I18n.t("search.tabGotra")} / ${I18n.t("search.tabVillage")}</a></p>
        </div>`;
    } catch (err) {
      content.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
    }
  }

  /* ── Person profile ───────────────────────────────────────────────────── */
  async function _loadPersonProfile(pubId) {
    if (!personContent) return;
    personSection.hidden = false;
    personContent.innerHTML = `<div class="empty-state"><p>${I18n.t("common.loading")}</p></div>`;
    try {
      const res = await fetch(`/api/genealogy/people/${pubId}`);
      if (!res.ok) {
        personContent.innerHTML = `<div class="empty-state"><p>${I18n.t("genealogy.restrictedProfile")}</p></div>`;
        return;
      }
      const data = await res.json();

      if (data.restricted) {
        personContent.innerHTML = `
          <div class="person-profile-card">
            <div class="person-profile-header">
              <div class="person-profile-avatar">${escapeHtml((data.person.fullName || "?").charAt(0))}</div>
              <div class="person-profile-info">
                <h2>${escapeHtml(data.person.fullName)}</h2>
                <p style="color:var(--muted)">${I18n.t("genealogy.restrictedProfile")}</p>
              </div>
            </div>
          </div>`;
        return;
      }

      const p = data.person;
      const tags = [];
      if (p.generation) tags.push(`<span class="tag gen">${I18n.t("genealogy.generation")} ${p.generation}</span>`);
      tags.push(`<span class="tag ${p.isLiving ? "living" : "deceased"}">${p.isLiving ? I18n.t("genealogy.living") : I18n.t("genealogy.deceased")}</span>`);
      (data.gotras || []).forEach(g => tags.push(`<span class="tag gotra">${escapeHtml(g.name)}</span>`));

      const shareUrl = `${location.origin}/vanshawali.html?person=${encodeURIComponent(p.publicId)}`;

      function relList(items, emptyKey) {
        if (!items?.length) return `<p class="rel-empty">${I18n.t("genealogy." + emptyKey)}</p>`;
        return `<div class="rel-list">${items.map(r => {
          const pid = r.publicId || r.public_id;
          const name = r.fullName || r.full_name || "?";
          const meta = [r.birthYear, r.deathYear ? "– " + r.deathYear : "", r.village].filter(Boolean).join(" ");
          return `<div class="rel-item">
            ${pid ? `<a href="/vanshawali.html?person=${encodeURIComponent(pid)}">${escapeHtml(name)}</a>` : `<span>${escapeHtml(name)}</span>`}
            <span class="rel-meta">${escapeHtml(meta)}</span>
          </div>`;
        }).join("")}</div>`;
      }

      function ancestorPath(items) {
        if (!items?.length) return `<p class="rel-empty">${I18n.t("genealogy.noAncestors")}</p>`;
        return `<div class="ancestor-path">${items.map(a => {
          const pid = a.publicId || a.public_id;
          return `<div class="path-item">
            <span class="path-gen">${I18n.t("genealogy.generation")} ${(p.generation || 1) - (a.depth || 1)}</span>
            ${pid ? `<a href="/vanshawali.html?person=${encodeURIComponent(pid)}">${escapeHtml(a.fullName)}</a>` : `<span>${escapeHtml(a.fullName)}</span>`}
            <span class="path-meta">${escapeHtml(`${a.birthYear || ""}${a.deathYear ? " – " + a.deathYear : ""}`)}</span>
          </div>`;
        }).join("")}</div>`;
      }

      function descendantPath(items) {
        if (!items?.length) return `<p class="rel-empty">${I18n.t("genealogy.noDescendants")}</p>`;
        return `<div class="descendant-path">${items.map(d => {
          const pid = d.publicId || d.public_id;
          return `<div class="path-item">
            <span class="path-gen">${I18n.t("genealogy.generation")} ${(p.generation || 1) + (d.depth || 1)}</span>
            ${pid ? `<a href="/vanshawali.html?person=${encodeURIComponent(pid)}">${escapeHtml(d.fullName)}</a>` : `<span>${escapeHtml(d.fullName)}</span>`}
            <span class="path-meta">${escapeHtml(`${d.birthYear || ""}${d.deathYear ? " – " + d.deathYear : ""}`)}</span>
          </div>`;
        }).join("")}</div>`;
      }

      personContent.innerHTML = `
        <div class="person-profile-card">
          <div class="person-profile-header">
            <div class="person-profile-avatar">${escapeHtml((p.fullName || "?").charAt(0))}</div>
            <div class="person-profile-info">
              <h2>${escapeHtml(p.fullName)}</h2>
              <p style="color:var(--muted);font-size:14px">
                ${escapeHtml([p.birthYear, p.deathYear ? "– " + p.deathYear : "", p.village].filter(Boolean).join(" · "))}
              </p>
              <div class="person-tags">${tags.join("")}</div>
              <button class="profile-share-btn" style="margin-top:10px" type="button" data-share-url="${escapeHtml(shareUrl)}">
                🔗 प्रोफ़ाइल शेयर करें
              </button>
            </div>
          </div>
          ${p.biography ? `<p style="color:var(--muted);font-size:15px;line-height:1.8;margin-bottom:24px">${escapeHtml(p.biography)}</p>` : ""}
          <div class="rel-section"><h3>${I18n.t("genealogy.parents")}</h3>${relList(data.parents, "noParents")}</div>
          <div class="rel-section"><h3>${I18n.t("genealogy.children")}</h3>${relList(data.children, "noChildren")}</div>
          <div class="rel-section"><h3>${I18n.t("genealogy.siblings")}</h3>${relList(data.siblings, "noSiblings")}</div>
          <div class="rel-section">
            <h3>${I18n.t("genealogy.ancestors")}${data.ancestors?.length ? ` <span style="font-size:12px;font-weight:400;color:var(--muted)">(${data.ancestors.length})</span>` : ""}</h3>
            ${ancestorPath(data.ancestors)}
          </div>
          <div class="rel-section">
            <h3>${I18n.t("genealogy.descendants")}${data.descendants?.length ? ` <span style="font-size:12px;font-weight:400;color:var(--muted)">(${data.descendants.length})</span>` : ""}</h3>
            ${descendantPath(data.descendants)}
          </div>
        </div>`;

      /* Share button — external listener instead of inline onclick (CSP-safe). */
      const shareBtn = personContent.querySelector(".profile-share-btn");
      shareBtn?.addEventListener("click", async () => {
        const copiedLabel = I18n.t("genealogy.shareCopied") || "✓ कॉपी हो गया";
        const idleLabel   = shareBtn.textContent;
        try {
          await navigator.clipboard?.writeText(shareBtn.dataset.shareUrl);
          shareBtn.textContent = copiedLabel;
          setTimeout(() => { shareBtn.textContent = idleLabel; }, 2000);
        } catch (_) { /* clipboard unavailable — leave label unchanged */ }
      });

      /* Kick off the SVG tree renderer */
      _initFamilyTree(pubId, p.fullName, p.village);

    } catch (err) {
      personContent.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
    }
  }

}());

/* ═══════════════════════════════════════════════════════════════════════════
   INTERACTIVE FAMILY TREE RENDERER
   ───────────────────────────────────────────────────────────────────────────
   Renders an SVG-connected card tree for a given person.
   Called by _loadPersonProfile above.
   ═══════════════════════════════════════════════════════════════════════════ */

function _initFamilyTree(rootPubId, rootName, rootVillage) {
  const treeSection    = document.querySelector("#person-tree-section");
  const nodesLayer     = document.querySelector("#tree-nodes-layer");
  const expandAllBtn   = document.querySelector("#tree-expand-all");
  const collapseAllBtn = document.querySelector("#tree-collapse-all");
  const printBtn       = document.querySelector("#tree-print");
  if (!treeSection || !nodesLayer || !window.FamilyTree) return;

  function mapChild(child) {
    const id = child.public_id || child.publicId;
    return {
      id,
      publicId: id,
      name: child.full_name || child.fullName || "?",
      wifeName: child.wife_name || child.wifeName || "",
      village: child.village || "",
      memberType: child.member_type || child.memberType || "son",
      birthOrder: child.birth_order ?? child.birthOrder ?? null,
      childCount: Number(child.child_count ?? child.childCount ?? 0),
      children: [],
      childrenLoaded: false,
      profileUrl: id ? `/vanshawali.html?person=${encodeURIComponent(id)}` : null,
    };
  }

  async function fetchTree(pubId) {
    try {
      const response = await fetch(`/api/genealogy/people/${encodeURIComponent(pubId)}/tree`);
      return response.ok ? (await response.json()).tree : null;
    } catch (_) {
      return null;
    }
  }

  async function loadChildren(node) {
    const tree = await fetchTree(node.publicId || node.id);
    return (tree?.children || []).map(mapChild);
  }

  function makeRoot(tree) {
    const person = tree?.person || {};
    const children = (tree?.children || []).map(mapChild);
    return {
      id: rootPubId,
      publicId: rootPubId,
      name: person.full_name || person.fullName || rootName || "?",
      wifeName: person.wife_name || person.wifeName || "",
      village: person.village || rootVillage || "",
      memberType: person.member_type || "son",
      birthOrder: person.birth_order ?? null,
      childCount: children.length,
      children,
      childrenLoaded: true,
      profileUrl: `/vanshawali.html?person=${encodeURIComponent(rootPubId)}`,
    };
  }

  let treeView = null;

  (async function boot() {
    treeSection.hidden = false;
    nodesLayer.innerHTML =
      `<div style="padding:20px;color:var(--muted);font-size:13px">${I18n.t("genealogy.treeLoading")}</div>`;

    const root = makeRoot(await fetchTree(rootPubId));
    treeView = FamilyTree.createView({
      inner: nodesLayer,
      nodes: [root],
      expanded: new Set(root.children.length ? [rootPubId] : []),
      labels: _treeLabels(),
      loadChildren,
      onOpen: node => {
        if (node?.profileUrl) window.location.href = node.profileUrl;
      },
    });
    treeView.render();
  }());

  expandAllBtn?.addEventListener("click", async () => {
    if (!treeView) return;
    expandAllBtn.disabled = true;
    try {
      await treeView.expandAll();
    } finally {
      expandAllBtn.disabled = false;
    }
  });
  collapseAllBtn?.addEventListener("click", () => treeView?.collapseAll(true));
  printBtn?.addEventListener("click", () => window.print());
}
