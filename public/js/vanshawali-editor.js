/**
 * vanshawali-editor.js
 * --------------------
 * Gotra-first, box-based family tree editor.
 * - one square box per person, recursive son branches, name-only daughters
 * - token-owned drafts (this project has no user accounts)
 * - SVG visual preview with zoom / fit / expand / collapse
 */
(function () {
  "use strict";

  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));

  const tr = (key, fallback) =>
    (window.I18n && typeof I18n.t === "function") ? I18n.t(key) : fallback;
  const $ = id => document.getElementById(id);
  const els = {
    gotraSearch: $("vsh-gotra-search"), gotraList: $("vsh-gotra-list"),
    selected: $("vsh-selected-gotra"), create: $("vsh-create-btn"),
    submitter: $("vsh-submitter"), village: $("vsh-village"),
    district: $("vsh-district"), state: $("vsh-state"),
    stepGotra: $("vsh-step-gotra"), stepEditor: $("vsh-step-editor"), stepPreview: $("vsh-step-preview"),
    tree: $("vsh-tree"), editorMeta: $("vsh-editor-meta"), token: $("vsh-token"),
    msg: $("vsh-editor-msg"), lookupToken: $("vsh-lookup-token"),
    lookupBtn: $("vsh-lookup-btn"), lookupResult: $("vsh-lookup-result"),
    canvas: $("vsh-preview-canvas"), inner: $("vsh-preview-inner"),
    consent: $("vsh-consent"), tokenControls: $("vsh-token-controls"),
    tokenNote: $("vsh-token-note"), revokeBtn: $("vsh-revoke-btn"), deleteBtn: $("vsh-delete-btn"),
  };
  if (!els.gotraList) return;

  const state = {
    token: null, tree: null, gotra: null,
    members: [], selectedGotra: null,
    expanded: new Set(), editing: new Set(), zoom: 1,
    readOnly: false,
  };

  async function api(url, options = {}) {
    const res = await fetch(url, { credentials: "include", ...options });
    let data = {};
    try { data = await res.json(); } catch (_) { /* no body */ }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  function postJSON(url, body, method = "POST") {
    return api(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  function message(text, isError = false) {
    if (!els.msg) return;
    els.msg.textContent = text;
    els.msg.classList.toggle("error", isError);
  }
  /* Privacy actions are only available on an editable, token-owned draft. */
  function setTokenControls(visible) {
    if (els.tokenControls) els.tokenControls.hidden = !visible;
    if (els.revokeBtn) els.revokeBtn.disabled = !visible;
    if (els.deleteBtn) els.deleteBtn.disabled = !visible;
  }
  const childrenOf = parentId => state.members
    .filter(m => m.parentId === parentId)
    .sort((a, b) => a.birthOrder - b.birthOrder);
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `m-${Date.now()}-${Math.random()}`);

  /* ── Step 1: Gotra picker ───────────────────────────────────────────── */
  async function loadGotras() {
    const q = els.gotraSearch.value.trim();
    try {
      const data = await api(`/api/vanshawali/gotras?q=${encodeURIComponent(q)}`);
      els.gotraList.innerHTML = data.gotras.length
        ? data.gotras.map(g => `
            <button type="button" class="vsh-gotra-option ${state.selectedGotra?.id === g.id ? "selected" : ""}"
                    data-gotra-id="${esc(g.id)}" role="listitem">
              <strong>${esc(g.name)}</strong>
              <small>${g.tree_count || 0} वृक्ष · ${g.member_count || 0} सदस्य${g.description ? ` · ${esc(g.description)}` : ""}</small>
            </button>`).join("")
        : `<p class="admin-empty">कोई सक्रिय गोत्र नहीं मिला। कृपया प्रशासक से संपर्क करें।</p>`;
      els.gotraList.querySelectorAll("[data-gotra-id]").forEach(btn =>
        btn.addEventListener("click", () => selectGotra(btn.dataset.gotraId, btn.querySelector("strong").textContent)));
    } catch (error) {
      els.gotraList.innerHTML = `<p class="admin-empty">${esc(error.message)}</p>`;
    }
  }
  function selectGotra(id, name) {
    state.selectedGotra = { id, name };
    els.selected.innerHTML = `<strong>चुना गया गोत्र:</strong> ${esc(name)}`;
    els.create.disabled = false;
    loadGotras();
  }

  /* ── Step 2: box editor ─────────────────────────────────────────────── */
  function openEditor(tree, members) {
    state.tree = tree;
    state.token = tree.edit_token || tree.token || els.lookupToken.value.trim();
    state.members = members.slice();
    state.readOnly = ["verified", "rejected", "pending", "under_review"].includes(tree.status);
    setTokenControls(!state.readOnly && !!state.token);
    if (els.tokenNote) els.tokenNote.hidden = true;
    state.expanded = new Set(state.members.map(m => m.clientId));
    state.editing = new Set();
    if (!state.members.length) {
      const root = { clientId: newId(), name: "", wifeName: "", village: "", memberType: "root", parentId: null, birthOrder: 0 };
      state.members.push(root);
      state.editing.add(root.clientId);
    }
    els.stepGotra.hidden = true;
    els.stepEditor.hidden = false;
    els.stepPreview.hidden = true;
    els.token.textContent = state.token;
    els.editorMeta.textContent = `${tree.gotraName || ""} · ${tree.treeReference || ""} · ${statusLabel(tree.status)}`;
    renderEditor();
  }

  function statusLabel(status) {
    return {
      draft: "ड्राफ्ट", pending: "सत्यापन लंबित", under_review: "समीक्षाधीन",
      correction_required: "सुधार आवश्यक", verified: "सत्यापित", rejected: "अस्वीकृत",
    }[status] || status;
  }

  function nodeForm(m) {
    const isDaughter = m.memberType === "daughter";
    const label = m.memberType === "root" ? "मूल पूर्वज" : m.memberType === "son" ? "पुत्र" : "पुत्री";
    return `
      <div class="vsh-node-kind">${label}</div>
      <label>नाम *<input data-f="name" maxlength="120" value="${esc(m.name)}" /></label>
      ${isDaughter ? "" : `
        <label>पत्नी का नाम *<input data-f="wifeName" maxlength="120" value="${esc(m.wifeName)}" /></label>
        <label>गांव *<input data-f="village" maxlength="120" value="${esc(m.village)}" /></label>`}
      <div class="vsh-node-actions">
        <button type="submit" class="button button-gold" data-act="save">सहेजें</button>
        <button type="button" class="button button-outline-dark" data-act="cancel">रद्द</button>
      </div>`;
  }

  function nodeView(m) {
    const isDaughter = m.memberType === "daughter";
    const canExpand = m.memberType !== "daughter";
    return `
      <strong>${esc(m.name || "नाम दर्ज करें")}</strong>
      ${isDaughter ? "" : `
        <span>पत्नी: ${esc(m.wifeName || "—")}</span>
        <span>गांव: ${esc(m.village || "—")}</span>`}
      <div class="vsh-node-actions">
        ${state.readOnly ? "" : `
          <button type="button" data-act="edit">संपादित</button>
          ${canExpand ? `<button type="button" data-act="add-son">+ पुत्र</button>
                         <button type="button" data-act="add-daughter">+ पुत्री</button>` : ""}
          <button type="button" data-act="delete" class="vsh-danger">हटाएँ</button>`}
      </div>`;
  }

  function renderNode(m) {
    const editing = state.editing.has(m.clientId);
    const cls = `vsh-node vsh-node--${m.memberType}`;
    const kids = childrenOf(m.clientId);
    const collapsed = kids.length && !state.expanded.has(m.clientId);
    return `
      <div class="${cls}" data-id="${esc(m.clientId)}">
        ${editing
          ? `<form class="vsh-node-form">${nodeForm(m)}</form>`
          : `<div class="vsh-node-view">${nodeView(m)}${collapsed ? `<small class="vsh-collapsed">${kids.length} शाखाएँ छुपीं</small>` : ""}</div>`}
        ${kids.length && !collapsed ? `<div class="vsh-children">${kids.map(renderNode).join("")}</div>` : ""}
      </div>`;
  }

  function renderEditor() {
    const roots = state.members.filter(m => !m.parentId);
    els.tree.innerHTML = roots.length
      ? roots.map(renderNode).join("")
      : `<p class="admin-empty">अभी कोई सदस्य नहीं है।</p>`;
    const editable = !state.readOnly;
    $("vsh-save-btn").disabled = !editable;
    $("vsh-submit-btn").disabled = !editable;
  }

  function descendantsOf(id) {
    const out = [];
    const queue = [id];
    while (queue.length) {
      const current = queue.shift();
      childrenOf(current).forEach(child => { out.push(child.clientId); queue.push(child.clientId); });
    }
    return out;
  }

  els.tree.addEventListener("click", event => {
    const btn = event.target.closest("button[data-act]");
    if (!btn || state.readOnly) return;
    const node = btn.closest(".vsh-node");
    const id = node.dataset.id;
    const member = state.members.find(m => m.clientId === id);
    if (!member) return;
    const act = btn.dataset.act;
    /* The save button is type=submit: let the form's submit handler run. */
    if (act === "save") return;

    if (act === "edit") {
      state.editing.add(id);
    } else if (act === "cancel") {
      state.editing.delete(id);
      if (!member.name) removeSubtree(id);
    } else if (act === "add-son" || act === "add-daughter") {
      if (member.memberType === "daughter") return;
      const child = {
        clientId: newId(), name: "", wifeName: "", village: "",
        memberType: act === "add-son" ? "son" : "daughter",
        parentId: id,
        birthOrder: Math.max(-1, ...state.members.map(m => m.birthOrder)) + 1,
      };
      state.members.push(child);
      state.expanded.add(id);
      state.editing.add(child.clientId);
    } else if (act === "delete") {
      const kids = descendantsOf(id);
      const prompt = kids.length
        ? `इस व्यक्ति और उसकी ${kids.length} शाखाओं को हटाएँ? यह कार्य वापस नहीं लिया जा सकता।`
        : "यह व्यक्ति हटाएँ?";
      if (!confirm(prompt)) return;
      removeSubtree(id);
    }
    renderEditor();
  });

  els.tree.addEventListener("submit", event => {
    const form = event.target.closest(".vsh-node-form");
    if (!form) return;
    event.preventDefault();
    const node = form.closest(".vsh-node");
    const member = state.members.find(m => m.clientId === node.dataset.id);
    if (!member) return;
    form.querySelectorAll("[data-f]").forEach(input => { member[input.dataset.f] = input.value.trim(); });
    if (!member.name) { message("नाम आवश्यक है।", true); return; }
    state.editing.delete(member.clientId);
    message("सदस्य सहेजा गया।");
    renderEditor();
  });

  function removeSubtree(id) {
    const doomed = new Set([id, ...descendantsOf(id)]);
    state.members = state.members.filter(m => !doomed.has(m.clientId));
    doomed.forEach(d => { state.editing.delete(d); state.expanded.delete(d); });
  }

  /* ── Save / submit / token lookup ───────────────────────────────────── */
  function payload() {
    return {
      members: state.members.map(m => ({
        clientId: m.clientId, name: m.name, wifeName: m.wifeName, village: m.village,
        memberType: m.memberType, parentId: m.parentId, birthOrder: m.birthOrder,
      })),
      village: els.village.value.trim(), district: els.district.value.trim(), state: els.state.value.trim(),
    };
  }

  $("vsh-create-btn").addEventListener("click", async () => {
    if (!state.selectedGotra) return;
    if (!els.submitter.value.trim()) { message("आपका नाम आवश्यक है।", true); return; }
    if (!els.consent || !els.consent.checked) {
      message("वृक्ष बनाने से पहले कृपया गोपनीयता नीति और डेटा प्रतिधारण जानकारी स्वीकार करें।", true);
      return;
    }
    const btn = $("vsh-create-btn");
    btn.disabled = true;
    try {
      const body = {
        gotraId: state.selectedGotra.id,
        submitterName: els.submitter.value.trim(),
        submitterContact: "",
        village: els.village.value.trim(), district: els.district.value.trim(), state: els.state.value.trim(),
      };
      if (els.consent.checked) body.consent = true;
      const data = await postJSON("/api/vanshawali/trees", body);
      openEditor({ ...data.tree, gotraName: state.selectedGotra.name }, []);
      message(data.message);
    } catch (error) {
      message(error.message, true);
      btn.disabled = false;
    }
  });

  $("vsh-save-btn").addEventListener("click", async () => {
    try {
      const data = await postJSON(`/api/vanshawali/trees/${encodeURIComponent(state.token)}`, payload(), "PUT");
      message(data.message);
    } catch (error) { message(error.message, true); }
  });

  $("vsh-submit-btn").addEventListener("click", async () => {
    if (state.editing.size) { message("पहले सभी खुले बॉक्स सहेजें।", true); return; }
    if (!confirm("पूरा वृक्ष सत्यापन के लिए भेजें? भेजने के बाद तब तक संपादन बंद रहेगा जब तक प्रशासक सुधार न मांगें।")) return;
    try {
      const data = await postJSON(`/api/vanshawali/trees/${encodeURIComponent(state.token)}/submit`, payload());
      /* Submission rotates the edit token — keep the visible lookup token in sync. */
      let rotated = false;
      if (data.token && data.token !== state.token) {
        state.token = data.token;
        rotated = true;
        if (els.token) els.token.textContent = data.token;
        els.lookupToken.value = data.token;
        if (els.tokenNote) els.tokenNote.hidden = false;
      }
      state.readOnly = true;
      setTokenControls(false);
      renderEditor();
      message(`${data.message} संदर्भ: ${data.treeReference}${rotated ? " · पुराना टोकन अब मान्य नहीं है।" : ""}`);
    } catch (error) { message(error.message, true); }
  });

  /* ── Privacy controls on the token-owned draft ─────────────────────── */
  els.revokeBtn?.addEventListener("click", async () => {
    if (!state.token) return;
    try {
      const data = await postJSON(`/api/vanshawali/trees/${encodeURIComponent(state.token)}/revoke`, {});
      state.readOnly = true;
      setTokenControls(false);
      renderEditor();
      message(data.message || "संपादन लिंक नष्ट कर दिया गया। अब यह वृक्ष संपादित नहीं किया जा सकता।");
    } catch (error) { message(error.message, true); }
  });

  els.deleteBtn?.addEventListener("click", async () => {
    if (!state.token) return;
    if (!confirm("क्या आप यह वृक्ष और उसका पूरा डेटा स्थायी रूप से हटाना चाहते हैं? यह कार्य वापस नहीं लिया जा सकता।")) return;
    try {
      const data = await api(`/api/vanshawali/trees/${encodeURIComponent(state.token)}`, { method: "DELETE" });
      state.readOnly = true;
      setTokenControls(false);
      renderEditor();
      message(data.message || "आपका डेटा हटा दिया गया।");
    } catch (error) { message(error.message, true); }
  });

  els.lookupBtn.addEventListener("click", async () => {
    const token = els.lookupToken.value.trim();
    if (!token) return;
    els.lookupResult.innerHTML = `<p>लोड हो रहा है...</p>`;
    try {
      const data = await api(`/api/vanshawali/trees/${encodeURIComponent(token)}`);
      const t = data.tree;
      els.lookupResult.innerHTML = `
        <div class="vsh-lookup-card">
          <strong>${esc(t.gotraName)}</strong> · ${esc(t.treeReference)}
          <span class="vsh-status vsh-status--${esc(t.status)}">${statusLabel(t.status)}</span>
          <p>${data.members.length} सदस्य${t.reviewNotes ? ` · प्रशासक नोट: ${esc(t.reviewNotes)}` : ""}</p>
          <button class="button button-outline-dark" type="button" id="vsh-lookup-open">खोलें</button>
        </div>`;
      $("vsh-lookup-open").addEventListener("click", () => {
        els.lookupToken.value = token;
        if (data.visual) {
          openVisual(data.visual);
        } else {
          openEditor({ ...t, edit_token: token }, data.members);
        }
      });
    } catch (error) {
      els.lookupResult.innerHTML = `<p class="admin-empty">${esc(error.message)}</p>`;
    }
  });

  /* ── Visual preview (shared SVG connectors + zoom/expand/collapse) ─── */
  let visualMembers = [];
  let visualTreeView = null;

  function visualLabels() {
    const t = (key, fallback, vars) =>
      window.I18n && typeof I18n.t === "function" ? I18n.t(key, vars) : fallback;
    return {
      connections: t("genealogy.treeConnections", "वंश वृक्ष की संबंध रेखाएँ"),
      wife: "पत्नी",
      village: "गांव",
      profile: t("genealogy.treeProfile", "प्रोफ़ाइल"),
      viewProfile: t("genealogy.treeViewProfile", "प्रोफ़ाइल देखें"),
      root: t("genealogy.treeRoot", "मूल व्यक्ति"),
      loading: t("genealogy.treeLoading", "लोड हो रहा है..."),
      children: n => t("genealogy.treeChildren", `${n} संतान`, { n }),
      generation: n => `${t("genealogy.generation", "पीढ़ी")} ${n}`,
      expand: t("genealogy.treeExpand", "विस्तार"),
      collapse: t("genealogy.treeCollapse", "संक्षिप्त"),
    };
  }

  function resetVisualExpanded(nodes) {
    const all = new Set();
    function walk(node) {
      if (!node || !node.children || !node.children.length) return;
      all.add(node.id);
      node.children.forEach(walk);
    }
    nodes.forEach(walk);
    state.expanded = all;
  }

  function renderVisual() {
    if (!window.FamilyTree || !els.inner) return;
    const nodes = FamilyTree.buildNodesFromParentMap(visualMembers);
    visualTreeView = FamilyTree.createView({
      inner: els.inner,
      nodes,
      expanded: state.expanded,
      zoom: state.zoom,
      labels: visualLabels(),
    });
    visualTreeView.render();
    if (els.canvas) els.canvas.dataset.treeWidth = String(visualTreeView.getSize().width);
  }

  function showVisual() {
    resetVisualExpanded(FamilyTree.buildNodesFromParentMap(visualMembers));
    state.zoom = 1;
    els.stepGotra.hidden = true;
    els.stepEditor.hidden = true;
    els.stepPreview.hidden = false;
    renderVisual();
  }

  function openVisual(visual) {
    visualMembers = (visual.people || []).map(p => ({
      clientId: p.id,
      name: p.full_name,
      wifeName: p.wife_name,
      village: p.village,
      memberType: p.member_type || "son",
      parentId: null,
      birthOrder: p.birth_order ?? null,
    }));
    const parentOf = new Map((visual.relationships || []).map(r => [r.child_id, r.parent_id]));
    visualMembers.forEach(m => { m.parentId = parentOf.get(m.clientId) || null; });
    state.readOnly = true;
    setTokenControls(false);
    showVisual();
  }

  $("vsh-preview-btn").addEventListener("click", () => {
    visualMembers = state.members.map(m => ({
      clientId: m.clientId, name: m.name, wifeName: m.wifeName, village: m.village,
      memberType: m.memberType, parentId: m.parentId, birthOrder: m.birthOrder,
    }));
    setTokenControls(false);
    showVisual();
  });

  $("vsh-preview-close").addEventListener("click", () => {
    els.stepPreview.hidden = true;
    els.stepEditor.hidden = false;
    setTokenControls(!state.readOnly && !!state.token);
  });

  $("vsh-zoom-in").addEventListener("click", () => {
    state.zoom = visualTreeView?.zoomBy(0.15) ?? Math.min(2, state.zoom + 0.15);
  });
  $("vsh-zoom-out").addEventListener("click", () => {
    state.zoom = visualTreeView?.zoomBy(-0.15) ?? Math.max(0.4, state.zoom - 0.15);
  });
  $("vsh-zoom-fit").addEventListener("click", () => {
    if (!els.canvas || !visualTreeView) return;
    state.zoom = visualTreeView.fit(els.canvas.clientWidth);
  });
  $("vsh-expand").addEventListener("click", () => visualTreeView?.expandAll());
  $("vsh-collapse").addEventListener("click", () => visualTreeView?.collapseAll(true));

  els.gotraSearch.addEventListener("input", () => { clearTimeout(window._vshGotraTimer); window._vshGotraTimer = setTimeout(loadGotras, 250); });
  loadGotras();
})();
