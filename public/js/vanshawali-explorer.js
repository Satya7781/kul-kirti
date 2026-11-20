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

  function _renderDetailTree(inner, canvas, visual, focusPersonId) {
    if (!detailVisual) return;
    const NODE_W = 180, NODE_H = 86, H_GAP = 24, V_GAP = 110;
    const people = visual.people || [];
    const peopleById = new Map(people.map(p => [p.id, p]));
    const parentOf = new Map((visual.relationships || []).map(r => [r.child_id, r.parent_id]));
    const kidsOf = id => people.filter(p => parentOf.get(p.id) === id);
    const roots = people.filter(p => !parentOf.get(p.id) || !peopleById.has(parentOf.get(p.id)));

    const positions = new Map();
    let cursor = 0, maxDepth = 0;
    function place(person, depth, seen) {
      maxDepth = Math.max(maxDepth, depth);
      const kids = detailExpanded.has(person.id)
        ? kidsOf(person.id).filter(k => !seen.has(k.id)) : [];
      let x;
      if (!kids.length) {
        x = cursor;
        cursor += NODE_W + H_GAP;
      } else {
        const nextSeen = new Set(seen); nextSeen.add(person.id);
        const xs = kids.map(k => place(k, depth + 1, nextSeen));
        x = (xs[0] + xs[xs.length - 1]) / 2;
      }
      positions.set(person.id, { x, y: depth * (NODE_H + V_GAP), hasKids: kidsOf(person.id).length > 0 });
      return x;
    }
    roots.forEach(r => place(r, 0, new Set()));

    const width = Math.max(cursor, 400);
    const height = (maxDepth + 1) * (NODE_H + V_GAP);
    const paths = [];
    positions.forEach((pos, id) => {
      const parentPos = positions.get(parentOf.get(id));
      if (!parentPos) return;
      const x1 = parentPos.x + NODE_W / 2, y1 = parentPos.y + NODE_H;
      const x2 = pos.x + NODE_W / 2, y2 = pos.y;
      const mid = (y1 + y2) / 2;
      paths.push(`<path d="M ${x1},${y1} C ${x1},${mid} ${x2},${mid} ${x2},${y2}" />`);
    });

    inner.style.width = `${width}px`;
    inner.style.height = `${height}px`;
    inner.style.transform = `scale(${detailZoom})`;
    inner.innerHTML =
      /* The connector SVG is decorative — this text is its accessible equivalent. */
      `<span class="visually-hidden">${I18n.t("genealogy.treeConnections")}</span>
      <svg class="vsh-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">
        <g fill="none" stroke="currentColor" stroke-width="2">${paths.join("")}</g>
      </svg>` + people.map(p => {
      const pos = positions.get(p.id);
      if (!pos) return "";
      const daughter = p.member_type === "daughter";
      const action = pos.hasKids
        ? (detailExpanded.has(p.id) ? "शाखाएँ संक्ष립्त करें" : "शाखाएँ फैलाएँ")
        : "व्यक्ति";
      const nodeLabel = `${p.full_name || "व्यक्ति"} — ${action}`;
      return `<button type="button" class="vsh-vnode vsh-vnode--${daughter ? "daughter" : (p.member_type || "son")}"
                   style="left:${pos.x}px;top:${pos.y}px" data-detail-person="${escapeHtml(p.id)}"
                   aria-label="${escapeHtml(nodeLabel)}">
               <strong>${escapeHtml(p.full_name)}</strong>
               ${daughter ? "" : `<span>पत्नी: ${escapeHtml(p.wife_name || "—")}</span><span>गांव: ${escapeHtml(p.village || "—")}</span>`}
               <small>${pos.hasKids ? (detailExpanded.has(p.id) ? "− संक्षिप्त" : "+ फैलाएँ") : ""}</small>
             </button>`;
    }).join("");

    inner.querySelectorAll("[data-detail-person]").forEach(node =>
      node.addEventListener("click", () => {
        const id = node.dataset.detailPerson;
        if (detailExpanded.has(id)) detailExpanded.delete(id); else detailExpanded.add(id);
        _renderDetailTree(inner, canvas, visual, focusPersonId);
      }));
    if (focusPersonId) {
      const focusNode = inner.querySelector(`[data-detail-person="${CSS.escape(focusPersonId)}"]`);
      focusNode?.scrollIntoView({ block: "center", inline: "center" });
    }
    canvas.dataset.treeWidth = String(width);
  }

  /* Zoom / expand controls are bound once, never per render. */
  document.querySelector("#tree-zoom-in")?.addEventListener("click", () => {
    const inner = document.querySelector("#tree-detail-inner");
    detailZoom = Math.min(2, detailZoom + 0.15);
    if (inner) inner.style.transform = `scale(${detailZoom})`;
  });
  document.querySelector("#tree-zoom-out")?.addEventListener("click", () => {
    const inner = document.querySelector("#tree-detail-inner");
    detailZoom = Math.max(0.4, detailZoom - 0.15);
    if (inner) inner.style.transform = `scale(${detailZoom})`;
  });
  document.querySelector("#tree-zoom-fit")?.addEventListener("click", () => {
    const inner = document.querySelector("#tree-detail-inner");
    const canvas = document.querySelector("#tree-detail-canvas");
    if (!inner || !canvas) return;
    detailZoom = Math.min(1, (canvas.clientWidth - 20) / Number(canvas.dataset.treeWidth || 1000));
    inner.style.transform = `scale(${detailZoom})`;
  });
  document.querySelector("#tree-expand")?.addEventListener("click", () => {
    if (!detailVisual) return;
    detailExpanded = new Set((detailVisual.people || []).map(p => p.id));
    _renderDetailTree(document.querySelector("#tree-detail-inner"),
      document.querySelector("#tree-detail-canvas"), detailVisual);
  });
  document.querySelector("#tree-collapse")?.addEventListener("click", () => {
    if (!detailVisual) return;
    const people = detailVisual.people || [];
    const parentOf = new Map((detailVisual.relationships || []).map(r => [r.child_id, r.parent_id]));
    detailExpanded = new Set(people.filter(p => !parentOf.get(p.id)).map(p => p.id));
    _renderDetailTree(document.querySelector("#tree-detail-inner"),
      document.querySelector("#tree-detail-canvas"), detailVisual);
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
  const canvas         = document.querySelector("#family-tree-canvas");
  const svgEl          = document.querySelector("#tree-svg");
  const nodesLayer     = document.querySelector("#tree-nodes-layer");
  const expandAllBtn   = document.querySelector("#tree-expand-all");
  const collapseAllBtn = document.querySelector("#tree-collapse-all");
  const printBtn       = document.querySelector("#tree-print");
  if (!treeSection || !canvas || !nodesLayer) return;

  const NODE_W = 170;
  const NODE_H = 68;
  const H_GAP  = 24;
  const V_GAP  = 80;

  const expanded = new Set();
  let rootNode   = null;

  /* Fetch tree data for a person */
  async function _fetch(pubId) {
    try {
      const r = await fetch(`/api/genealogy/people/${pubId}/tree`);
      return r.ok ? (await r.json()).tree : null;
    } catch (_) { return null; }
  }

  /* Calculate total pixel width a subtree needs */
  function _width(node) {
    const kids = expanded.has(node._pid) ? (node.children || []) : [];
    if (!kids.length) return NODE_W + H_GAP;
    return kids.reduce((s, c) => s + _width(c), 0);
  }

  /* Assign x,y positions to every node recursively */
  const laid = [];
  function _layout(node, depth, leftPx) {
    const kids   = expanded.has(node._pid) ? (node.children || []) : [];
    const totalW = _width(node);
    const nodeX  = leftPx + (totalW - NODE_W - H_GAP) / 2;

    laid.push({ ...node, _depth: depth, _x: Math.max(0, nodeX), _y: depth * (NODE_H + V_GAP) + 20 });

    let cl = leftPx;
    for (const c of kids) { _layout(c, depth + 1, cl); cl += _width(c); }
  }

  /* Full render pass */
  function render() {
    laid.length = 0;
    _layout(rootNode, 0, 0);

    const totalW = laid.reduce((m, n) => Math.max(m, n._x + NODE_W + H_GAP), NODE_W + H_GAP);
    const totalH = laid.reduce((m, n) => Math.max(m, n._y + NODE_H + 20), NODE_H + 40);

    canvas.style.minWidth  = totalW + "px";
    canvas.style.minHeight = totalH + "px";
    svgEl.setAttribute("width",  totalW);
    svgEl.setAttribute("height", totalH);
    svgEl.setAttribute("role", "img");
    svgEl.setAttribute("aria-label", I18n.t("genealogy.treeConnections"));
    svgEl.innerHTML     = "";
    const svgTitle = document.createElementNS("http://www.w3.org/2000/svg", "title");
    svgTitle.textContent = I18n.t("genealogy.treeConnections");
    svgEl.appendChild(svgTitle);
    nodesLayer.innerHTML = "";
    nodesLayer.style.width  = totalW + "px";
    nodesLayer.style.height = totalH + "px";

    /* SVG connector lines (curved bezier parent→child) */
    const laidMap = new Map(laid.map(n => [n._pid, n]));
    laid.forEach(parent => {
      if (!expanded.has(parent._pid)) return;
      (parent.children || []).forEach(child => {
        const cn = laidMap.get(child._pid);
        if (!cn) return;
        const x1 = parent._x + NODE_W / 2, y1 = parent._y + NODE_H;
        const x2 = cn._x + NODE_W / 2,     y2 = cn._y;
        const my = (y1 + y2) / 2;
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`);
        path.setAttribute("stroke", "#c49a45");
        path.setAttribute("stroke-width", "1.5");
        path.setAttribute("fill", "none");
        path.setAttribute("opacity", "0.65");
        svgEl.appendChild(path);
      });
    });

    /* Node cards */
    laid.forEach(node => {
      /* This card contains a real expand <button>, so it cannot itself be a
         <button> (nested interactive content). Keyboard support is added
         explicitly with role/tabindex instead. */
      const card = document.createElement("div");
      card.className = "tree-node-card" + (node._depth === 0 ? " selected" : "");
      card.style.cssText = `left:${node._x}px;top:${node._y}px;width:${NODE_W}px`;
      card.setAttribute("role", "button");
      card.tabIndex = 0;

      const hasKids = (node.children || []).length > 0;
      const isOpen  = expanded.has(node._pid);
      const gen     = node._depth === 0
        ? I18n.t("genealogy.treeRoot")
        : `${I18n.t("genealogy.generation")} ${node._depth + 1}`;
      card.setAttribute("aria-label", `${node._name || "व्यक्ति"}${node._village ? " · " + node._village : ""} — ${gen}`);

      card.innerHTML = `
        <div class="node-name">${escapeHtml(node._name || "?")}</div>
        <div class="node-meta">${escapeHtml(node._village || "")}</div>
        <span class="node-gen">${gen}</span>
        ${hasKids ? `<button type="button" class="node-expand-btn" aria-label="${isOpen ? "शाखाएँ संक्षिप्त करें" : "शाखाएँ फैलाएँ"}">${isOpen ? "−" : "+"}</button>` : ""}
      `;

      /* Click / Enter / Space → navigate (except root) */
      const navigate = () => {
        if (node._pid && node._pid !== rootPubId) {
          window.location.href = `/vanshawali.html?person=${encodeURIComponent(node._pid)}`;
        }
      };
      card.addEventListener("click", e => {
        if (e.target.classList.contains("node-expand-btn")) return;
        navigate();
      });
      card.addEventListener("keydown", e => {
        if (e.target !== card) return; /* expand button handles its own keys */
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
          e.preventDefault();
          navigate();
        }
      });

      /* Expand/collapse button */
      const btn = card.querySelector(".node-expand-btn");
      if (btn) {
        btn.addEventListener("click", async e => {
          e.stopPropagation();
          if (expanded.has(node._pid)) {
            expanded.delete(node._pid);
            render();
          } else {
            expanded.add(node._pid);
            /* Lazy load children if not fetched yet */
            if (!(node.children || []).length) {
              btn.textContent = "…";
              btn.disabled    = true;
              const tree = await _fetch(node._pid);
              node.children = (tree?.children || []).map(c => ({
                _pid:     c.publicId || c.public_id,
                _name:    c.fullName || c.full_name,
                _village: c.village || "",
                children: [],
              }));
              btn.disabled = false;
              if (!node.children.length) { expanded.delete(node._pid); render(); return; }
            }
            render();
          }
        });
      }

      nodesLayer.appendChild(card);
    });
  }

  /* Bootstrap */
  (async function boot() {
    treeSection.hidden = false;
    nodesLayer.innerHTML = `<div style="padding:20px;color:var(--muted);font-size:13px">${I18n.t("genealogy.treeLoading")}</div>`;

    const tree = await _fetch(rootPubId);
    rootNode = {
      _pid:     rootPubId,
      _name:    tree?.person?.fullName || tree?.person?.full_name || rootName || "?",
      _village: tree?.person?.village  || rootVillage || "",
      children: (tree?.children || []).map(c => ({
        _pid:     c.publicId || c.public_id,
        _name:    c.fullName || c.full_name,
        _village: c.village || "",
        children: [],
      })),
    };
    render();
  }());

  /* Control buttons */
  expandAllBtn?.addEventListener("click", () => {
    laid.forEach(n => { if ((n.children || []).length) expanded.add(n._pid); });
    render();
  });
  collapseAllBtn?.addEventListener("click", () => { expanded.clear(); render(); });
  printBtn?.addEventListener("click", () => window.print());
}
