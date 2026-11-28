/**
 * admin-console.js — responsive shell and module panels for the 16 admin tools.
 * Additive: the original Vanshawali verification UI is preserved as a module.
 */
(function () {
  "use strict";

  const root = document.getElementById("admin-console-root");
  const panel = document.getElementById("admin-panel");
  if (!root || !panel) return;

  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
  const $ = selector => document.querySelector(selector);
  const lang = () => (window.I18n && I18n.lang) || "hi";
  const t = (hi, en) => lang() === "hi" ? hi : en;
  const LIMIT = 20;

  function can(module, action) {
    const found = (state.meta?.modules || []).find(item => item.id === module);
    return Boolean(found?.permissions?.[action]);
  }
  function isSuperAdmin() { return state.meta?.admin?.role === "super_admin"; }
  function rowStatus(id) {
    return (state.cache.trees?.trees || []).find(item => item.id === id)?.status;
  }
  function allow(module, action, needsSuper = false) {
    return can(module, action) && (!needsSuper || isSuperAdmin());
  }

  const state = {
    meta: null,
    active: "overview",
    initializing: false,
    shellBuilt: false,
    pages: {},
    filters: {},
    cache: {},
    loadToken: 0,
    dialogConfirm: null,
    lastTrigger: null,
    treePreviewView: null,
    treeDraft: [],
    treePreviewMeta: null,
    treeSelectedId: null,
    treePreviewExpanded: null,
  };

  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: "include", ...options });
    let data = {};
    try { data = await response.json(); } catch (_) { /* no JSON body */ }
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  function send(url, body, method = "POST") {
    return api(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function message(text, isError = false) {
    const el = $("#admin-console-message");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("error", Boolean(isError));
  }

  function clearMessage() { message("", false); }

  function fmtDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? esc(value) : esc(date.toLocaleString(lang() === "hi" ? "hi-IN" : "en-GB"));
  }

  function fmt(value) {
    if (value === undefined || value === null || value === "") return "—";
    if (typeof value === "boolean") return value ? t("हाँ", "Yes") : t("नहीं", "No");
    return esc(value);
  }

  const STATUS_LABELS = {
    draft: ["ड्राफ्ट", "Draft"], pending: ["लंबित", "Pending"],
    under_review: ["समीक्षाधीन", "Under review"], correction_required: ["सुधार आवश्यक", "Correction required"],
    verified: ["सत्यापित", "Verified"], rejected: ["अस्वीकृत", "Rejected"],
    active: ["सक्रिय", "Active"], unlinked: ["लिंक हटाया", "Unlinked"],
    open: ["खुला", "Open"], confirmed: ["पुष्ट", "Confirmed"], dismissed: ["खारिज", "Dismissed"],
    merged: ["विलय", "Merged"], resolved: ["हल", "Resolved"],
    complete: ["पूर्ण", "Complete"], completed: ["पूर्ण", "Completed"],
    failed: ["विफल", "Failed"], running: ["चल रहा", "Running"], creating: ["बन रहा", "Creating"],
    restored: ["रिस्टोर", "Restored"], info: ["सूचना", "Info"], success: ["सफल", "Success"],
    warning: ["चेतावनी", "Warning"], danger: ["गंभीर", "Danger"],
    approve: ["स्वीकारें", "Approve"], reject: ["अस्वीकृत करें", "Reject"],
  };

  function badge(value) {
    const key = String(value || "");
    const pair = STATUS_LABELS[key];
    const label = pair ? (lang() === "hi" ? pair[0] : pair[1]) : key.replace(/_/g, " ");
    return `<span class="admin-badge ${/verified|approved|active|complete|completed|success|confirmed|resolved|restored/.test(key) ? "admin-badge--green" : /pending|under_review|correction_required|draft|warning|open|running|creating|info/.test(key) ? "admin-badge--amber" : /rejected|failed|danger|inactive|dismissed/.test(key) ? "admin-badge--red" : "admin-badge--blue"}">${esc(label)}</span>`;
  }

  function kpis(items) {
    return `<div class="admin-overview-grid">${items.map(item => `
      <div class="admin-metric"><span>${esc(item.label)}</span><strong>${fmt(item.value)}</strong>${item.note ? `<small class="${item.negative ? "negative" : ""}">${esc(item.note)}</small>` : ""}</div>
    `).join("")}</div>`;
  }

  function chart(rows, labelKey = "label", valueKey = "count") {
    if (!rows || !rows.length) return `<p class="admin-empty">${t("कोई डेटा नहीं।", "No data yet.")}</p>`;
    const max = Math.max(1, ...rows.map(row => Number(row[valueKey]) || 0));
    return `<div class="admin-chart">${rows.slice(0, 12).map(row => {
      const label = row[labelKey] ?? row.status ?? "—";
      const value = Number(row[valueKey]) || 0;
      return `<div class="admin-chart-row"><span title="${esc(label)}">${esc(label)}</span><div class="admin-chart-track"><div class="admin-chart-bar" style="width:${Math.round(value / max * 100)}%"></div></div><span>${value}</span></div>`;
    }).join("")}</div>`;
  }

  function timeline(items, titleKey = "action", timeKey = "createdAt") {
    if (!items || !items.length) return `<p class="admin-empty">${t("अभी कुछ नहीं हुआ।", "Nothing recorded yet.")}</p>`;
    return `<div class="admin-timeline">${items.map(item => `
      <div class="admin-timeline-item"><span class="admin-timeline-dot"></span><div><strong>${esc(item[titleKey] || item.title || "—")}</strong><br><small>${fmtDate(item[timeKey])} ${item.admin ? "· " + esc(item.admin) : ""}</small></div></div>
    `).join("")}</div>`;
  }

  function table(columns, rows, actions, emptyText) {
    if (!rows || !rows.length) return `<div class="admin-empty">${esc(emptyText || t("कोई रिकॉर्ड नहीं मिला।", "No records found."))}</div>`;
    return `<div class="admin-table-wrap"><table class="admin-table">
      <thead><tr>${columns.map(column => `<th scope="col">${esc(column.label)}</th>`).join("")}${actions ? `<th scope="col">${t("कार्रवाई", "Actions")}</th>` : ""}</tr></thead>
      <tbody>${rows.map((row, index) => `<tr>${columns.map(column => `<td>${column.render ? column.render(row, index) : fmt(row[column.key])}</td>`).join("")}${actions ? `<td><div class="admin-row-actions">${actions(row)}</div></td>` : ""}</tr>`).join("")}</tbody>
    </table></div>`;
  }

  function actionButton(label, action, id, extra = {}) {
    if (!hasAccess(action)) return "";
    return `<button type="button" class="${extra.danger ? "danger" : ""}" data-admin-action="${esc(action)}" data-id="${esc(id || "")}" ${extra.data ? Object.entries(extra.data).map(([key, value]) => `data-${key}="${esc(value)}"`).join(" ") : ""}>${esc(label)}</button>`;
  }

  function pagination(moduleId, total) {
    const p = state.pages[moduleId] || { limit: LIMIT, offset: 0 };
    const from = total ? p.offset + 1 : 0;
    const to = Math.min(total, p.offset + p.limit);
    return `<div class="admin-pagination">
      <span>${from}–${to} / ${total}</span>
      <button type="button" class="admin-mini-btn" data-admin-action="page-prev" ${p.offset === 0 ? "disabled" : ""}>${t("पिछला", "Previous")}</button>
      <button type="button" class="admin-mini-btn" data-admin-action="page-next" ${to >= total ? "disabled" : ""}>${t("अगला", "Next")}</button>
    </div>`;
  }

  function filterMarkup(moduleId, filters) {
    const values = state.filters[moduleId] || {};
    return `<form class="admin-toolbar" data-admin-form="filter-apply">
      ${filters.map(filter => {
        const value = values[filter.name] ?? filter.value ?? "";
        let control;
        if (filter.type === "select") {
          control = `<select name="${filter.name}" data-filter="${filter.name}" aria-label="${esc(filter.label)}">${(filter.options || [{ value: "", label: filter.allLabel || t("सभी", "All") }]).map(option => `<option value="${esc(option.value)}" ${String(value) === String(option.value) ? "selected" : ""}>${esc(option.label)}</option>`).join("")}</select>`;
        } else {
          control = `<input name="${filter.name}" data-filter="${filter.name}" value="${esc(value)}" placeholder="${esc(filter.placeholder || "")}" aria-label="${esc(filter.label)}" maxlength="${filter.max || 120}" />`;
        }
        return `<label>${esc(filter.label)}${control}</label>`;
      }).join("")}
      <button class="button button-outline-dark" type="submit">${t("फ़िल्टर", "Filter")}</button>
    </form>`;
  }

  function readFilters(moduleId) {
    const values = {};
    document.querySelectorAll(`[data-admin-form="filter-apply"] [data-filter]`).forEach(control => {
      values[control.dataset.filter] = control.value.trim();
    });
    state.filters[moduleId] = values;
    state.pages[moduleId] = { limit: LIMIT, offset: 0 };
    return values;
  }

  function filterQuery(moduleId, extra = {}) {
    return new URLSearchParams({ ...(state.filters[moduleId] || {}), ...extra, limit: String(LIMIT), offset: String((state.pages[moduleId] || {}).offset || 0) });
  }

  /* Mirrors the server-side guards so the UI does not advertise operations the
     signed-in admin cannot perform. The server remains the final authority. */
  const ACTION_ACCESS = {
    "gotra-create": ["gotras", "edit"], "gotra-edit": ["gotras", "edit"],
    "gotra-toggle": ["gotras", "edit"], "gotra-delete": ["gotras", "edit"],
    "tree-edit": ["trees", "edit"], "tree-archive": ["trees", "edit"], "tree-delete": ["trees", "edit"],
    "tree-box-edit": ["trees", "edit"],
    "member-edit": ["members", "edit"], "member-branch": ["members", "edit"], "member-archive": ["members", "edit"],
    "verification-preview": ["verification", "view"],
    "verification-assign": ["verification", "approve"], "verification-decision": ["verification", "approve"],
    "master-reverse": ["master", "approve", true],
    "branch-create": ["branches", "edit"], "branch-link": ["branches", "approve"], "branch-unlink": ["branches", "approve"],
    "duplicate-scan": ["duplicates", "edit"], "duplicate-review": ["duplicates", "approve"],
    "village-rename": ["villages", "edit"], "village-merge": ["villages", "edit"],
    "samiti-create": ["samiti", "edit"], "samiti-edit": ["samiti", "edit"],
    "samiti-toggle": ["samiti", "edit"], "samiti-delete": ["samiti", "edit"],
    "samiti-member-create": ["samiti", "edit"], "samiti-member-edit": ["samiti", "edit"],
    "samiti-member-toggle": ["samiti", "edit"], "samiti-member-delete": ["samiti", "edit"],
    "account-create": ["accounts", "edit", true], "account-edit": ["accounts", "edit", true],
    "account-password": ["accounts", "edit", true], "account-deactivate": ["accounts", "edit", true],
    "notification-create": ["notifications", "edit"], "notification-read": ["notifications", "edit"],
    "notification-read-all": ["notifications", "edit"], "notification-delete": ["notifications", "edit"],
    "backup-create": ["backups", "edit", true], "backup-download": ["backups", "view", true],
    "backup-restore": ["backups", "approve", true], "backup-delete": ["backups", "approve", true],
    "role-save": ["roles", "approve", true], "role-override": ["roles", "approve", true],
    "role-override-remove": ["roles", "approve", true],
  };

  function hasAccess(action) {
    const rule = ACTION_ACCESS[action];
    return !rule || allow(rule[0], rule[1], Boolean(rule[2]));
  }

  function inlineForm(action, fields, submitLabel) {
    if (!hasAccess(action)) return "";
    return `<form class="admin-form admin-form-grid" data-admin-form="${esc(action)}">
      ${fields.map(field => fieldHtml(field)).join("")}
      <div class="admin-form-actions"><button class="button button-maroon" type="submit">${esc(submitLabel)}</button></div>
    </form>`;
  }

  function fieldHtml(field, value) {
    const name = esc(field.name);
    const label = esc(field.label);
    const required = field.required ? "required" : "";
    const max = field.max || 160;
    const current = value === undefined ? (field.value ?? "") : value;
    const hint = field.hint ? `<small class="admin-field-hint">${esc(field.hint)}</small>` : "";
    let control;
    if (field.type === "textarea") {
      control = `<textarea name="${name}" rows="${field.rows || 3}" maxlength="${max}" ${required}>${esc(current)}</textarea>`;
    } else if (field.type === "select") {
      control = `<select name="${name}" ${required}>${(field.options || []).map(option => `<option value="${esc(option.value)}" ${String(current) === String(option.value) ? "selected" : ""}>${esc(option.label)}</option>`).join("")}</select>`;
    } else if (field.type === "checkbox") {
      control = `<input type="hidden" name="${name}" value="false" /><input type="checkbox" name="${name}" value="true" ${current ? "checked" : ""} />`;
    } else if (field.type === "file") {
      control = `<input type="file" name="${name}" accept="${esc(field.accept || "image/png,image/jpeg,image/webp,image/gif")}" ${required} />`;
    } else {
      control = `<input type="${field.type || "text"}" name="${name}" value="${esc(current)}" maxlength="${max}" ${required} autocomplete="${field.autocomplete || "off"}" />`;
    }
    return `<label>${label}${control}${hint}</label>`;
  }

  /* File inputs cannot be JSON.stringify'd. Convert them to the same data URL
     format the server validates, for both inline forms and dialog forms. */
  async function readImageFile(file) {
    if (!file || !file.size) return "";
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
      throw new Error(t(" फ़ोटो PNG, JPEG, WebP या GIF होनी चाहिए।", "Photo must be a PNG, JPEG, WebP or GIF image."));
    }
    if (file.size > 2 * 1024 * 1024) {
      throw new Error(t(" फ़ोटो 2 MB से छोटी होनी चाहिए।", "Photo must be smaller than 2 MB."));
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error(t(" फ़ोटो पढ़ी नहीं जा सकी।", "The photo could not be read.")));
      reader.readAsDataURL(file);
    });
  }

  async function formObject(form) {
    const object = {};
    for (const [key, value] of new FormData(form).entries()) {
      object[key] = (typeof File !== "undefined" && value instanceof File)
        ? await readImageFile(value)
        : value;
    }
    return object;
  }

  function openDialog({ title, body, confirmLabel = t("सहेजें", "Save"), danger = false, onConfirm }) {
    state.dialogConfirm = onConfirm || null;
    $("#admin-dialog-title").textContent = title;
    $("#admin-dialog-body").innerHTML = body;
    const confirm = $("#admin-dialog-confirm");
    confirm.textContent = confirmLabel;
    confirm.classList.toggle("danger", danger);
    $("#admin-dialog").hidden = false;
    requestAnimationFrame(() => ($("#admin-dialog-body input, #admin-dialog-body select, #admin-dialog-body textarea") || confirm)?.focus());
  }

  function closeDialog() {
    $("#admin-dialog").hidden = true;
    $("#admin-dialog-body").innerHTML = "";
    state.dialogConfirm = null;
    state.lastTrigger?.focus?.();
  }

  function openForm({ title, fields, values = {}, confirmLabel, onSubmit, danger = false }) {
    const body = `<form class="admin-form admin-form-grid" id="admin-dialog-form">${fields.map(field => fieldHtml(field, values[field.name])).join("")}</form>`;
    openDialog({
      title, body, confirmLabel, danger,
      onConfirm: async () => {
        const form = $("#admin-dialog-form");
        const object = form ? await formObject(form) : {};
        await onSubmit(object);
        closeDialog();
      },
    });
  }

  function openConfirm(title, text, confirmLabel, onConfirm) {
    openDialog({
      title,
      body: `<p>${esc(text)}</p>`,
      confirmLabel,
      danger: true,
      onConfirm: async () => { await onConfirm(); closeDialog(); },
    });
  }

  function openDetail(title, html, trigger) {
    state.lastTrigger = trigger || state.lastTrigger;
    $("#admin-detail-title").textContent = title;
    $("#admin-detail-body").innerHTML = html;
    $("#admin-detail").hidden = false;
    $("#admin-detail-close").focus();
  }

  function closeDetail() {
    $("#admin-detail").hidden = true;
    state.lastTrigger?.focus?.();
  }

  function treePreviewLabels() {
    return {
      connections: t("वंश वृक्ष की संबंध रेखाएँ", "Family tree relationships"),
      wife: t("पत्नी", "Spouse"),
      village: t("गांव", "Village"),
      profile: t("प्रोफ़ाइल", "Profile"),
      viewProfile: t("प्रोफ़ाइल देखें", "View profile"),
      root: t("मूल व्यक्ति", "Root person"),
      loading: t("लोड हो रहा है...", "Loading..."),
      children: n => t(`${n} संतान`, `${n} children`),
      generation: n => t(`पीढ़ी ${n}`, `Generation ${n}`),
      expand: t("शाखाएँ फैलाएँ", "Expand branches"),
      collapse: t("शाखाएँ संक्षिप्त करें", "Collapse branches"),
    };
  }

  function collectExpandable(node, out) {
    if (!node || !Array.isArray(node.children) || !node.children.length) return;
    out.add(node.id);
    node.children.forEach(child => collectExpandable(child, out));
  }

  function draftMember(id) {
    return (state.treeDraft || []).find(item => (item.clientId || item.id) === id);
  }

  function childIds(id) {
    return (state.treeDraft || [])
      .filter(item => item.parentId === id)
      .map(item => item.clientId || item.id);
  }

  function descendantIds(id) {
    const found = new Set();
    const queue = [id];
    while (queue.length) {
      const current = queue.shift();
      childIds(current).forEach(child => {
        if (!found.has(child)) { found.add(child); queue.push(child); }
      });
    }
    return found;
  }

  function refreshTreePreview(focusId) {
    const view = state.treePreviewView;
    if (!view || !window.FamilyTree) return;
    const nodes = FamilyTree.buildNodesFromParentMap(state.treeDraft);
    const expanded = new Set();
    nodes.forEach(node => collectExpandable(node, expanded));
    state.treePreviewExpanded = expanded;
    view.setNodes(nodes, expanded);
    if (focusId) view.render(focusId);
    const canvas = $("#admin-tree-preview-canvas");
    if (canvas) view.fit(canvas.clientWidth);
  }

  function openTreePreview(title, members, options = {}) {
    const modal = $("#admin-tree-preview");
    if (!modal) return;
    $("#admin-tree-preview-title").textContent = title;
    modal.hidden = false;

    /* Editable previews work on a copy of the revision so a reviewer can make
       several box changes and persist them with one authorised save. */
    const editable = Boolean(options.editable && hasAccess("tree-box-edit"));
    state.treeDraft = (Array.isArray(members) ? members : []).map(item => ({ ...item }));
    state.treePreviewMeta = {
      treeId: options.treeId || null,
      status: options.status || rowStatus(options.treeId) || "",
      editable,
    };
    state.treeSelectedId = null;
    state.treePreviewExpanded = null;
    modal.classList.toggle("is-editable", editable);

    const inner = $("#admin-tree-preview-inner");
    const nodes = window.FamilyTree
      ? FamilyTree.buildNodesFromParentMap(state.treeDraft)
      : [];
    const expanded = new Set();
    nodes.forEach(node => collectExpandable(node, expanded));
    state.treePreviewExpanded = expanded;

    state.treePreviewView = window.FamilyTree
      ? FamilyTree.createView({
        inner,
        nodes,
        expanded,
        labels: treePreviewLabels(),
        editable,
        onEdit: node => openTreeMemberEditor(node.id),
        ...(editable ? { nodeWidth: 210, nodeHeight: 108 } : {}),
      })
      : null;

    if (state.treePreviewView) {
      state.treePreviewView.render();
      const canvas = $("#admin-tree-preview-canvas");
      if (canvas) state.treePreviewView.fit(canvas.clientWidth);
    } else {
      inner.innerHTML = `<p class="admin-empty">${esc(t("वृक्ष रेंडरर उपलब्ध नहीं है।", "Tree renderer is unavailable."))}</p>`;
    }

    const editor = $("#admin-tree-editor");
    if (editor) editor.hidden = !editable;
    const saveBar = $("#admin-tree-preview-save");
    if (saveBar) saveBar.hidden = !editable;
    const note = $("#admin-tree-change-note");
    if (note) note.value = "";
    const verifyNote = $("#admin-tree-reverify-note");
    if (verifyNote) verifyNote.hidden = state.treePreviewMeta.status !== "verified";
    if (editable && nodes.length) openTreeMemberEditor(nodes[0].id);
    $("#admin-tree-preview-close")?.focus();
  }

  function closeTreePreview() {
    const modal = $("#admin-tree-preview");
    if (!modal) return;
    modal.hidden = true;
    modal.classList.remove("is-editable");
    state.treePreviewView = null;
    state.treeDraft = [];
    state.treePreviewMeta = null;
    state.treeSelectedId = null;
    const inner = $("#admin-tree-preview-inner");
    if (inner) inner.innerHTML = "";
    state.lastTrigger?.focus?.();
  }

  function openTreeMemberEditor(id) {
    if (!state.treePreviewMeta?.editable) return;
    const member = draftMember(id);
    if (!member) return;
    state.treeSelectedId = id;
    const panel = $("#admin-tree-editor");
    if (panel) panel.hidden = false;
    const heading = $("#admin-tree-editor-title");
    if (heading) heading.textContent = member.name || t("नया सदस्य", "New member");

    const set = (selector, value) => {
      const element = $(selector);
      if (element) element.value = value ?? "";
    };
    set("#admin-tree-edit-name", member.name);
    set("#admin-tree-edit-wife-name", member.wifeName);
    set("#admin-tree-edit-wife-gotra", member.wifeGotra);
    set("#admin-tree-edit-married-gotra", member.marriedGotra);
    set("#admin-tree-edit-village", member.village);
    set("#admin-tree-edit-birth-order", member.birthOrder ?? 0);

    const isRoot = member.memberType === "root";
    const isDaughter = member.memberType === "daughter";
    const type = $("#admin-tree-edit-type");
    if (type) type.value = member.memberType;

    const parent = $("#admin-tree-edit-parent");
    if (parent) {
      const banned = descendantIds(id);
      banned.add(id);
      const choices = state.treeDraft
        .filter(item => {
          const key = item.clientId || item.id;
          return !banned.has(key) && item.memberType !== "daughter";
        })
        .map(item => `<option value="${esc(item.clientId || item.id)}">${esc(item.name || "?")}</option>`)
        .join("");
      parent.innerHTML = `<option value="">${esc(t("कोई नहीं", "None"))}</option>${choices}`;
      parent.value = member.parentId || "";
      parent.disabled = isRoot;
    }
    for (const selector of ["#admin-tree-edit-wife-block", "#admin-tree-edit-wife-gotra-block"]) {
      const block = $(selector);
      if (block) block.hidden = isDaughter;
    }
    const marriedBlock = $("#admin-tree-edit-married-block");
    if (marriedBlock) marriedBlock.hidden = !isDaughter;
    const villageBlock = $("#admin-tree-edit-village-block");
    if (villageBlock) villageBlock.hidden = isDaughter;
    const addButtons = $("#admin-tree-edit-add");
    if (addButtons) addButtons.hidden = isDaughter;
    const remove = $("#admin-tree-edit-remove");
    if (remove) remove.disabled = isRoot || childIds(id).length > 0;
    $("#admin-tree-edit-name")?.focus();
  }

  function applyTreeMemberEdit() {
    const key = state.treeSelectedId;
    const member = draftMember(key);
    if (!member) return;
    const value = selector => ($(selector)?.value || "").trim();
    const name = value("#admin-tree-edit-name");
    if (!name) { message(t("नाम आवश्यक है।", "Name is required."), true); return; }

    const memberType = value("#admin-tree-edit-type");
    if (member.memberType === "root" && memberType !== "root") {
      message(t("मूल पूर्वज का प्रकार बदला नहीं जा सकता।", "The root member's role cannot be changed."), true);
      return;
    }
    if (member.memberType !== "root" && memberType === "root") {
      message(t("एक वृक्ष में केवल एक मूल पूर्वज हो सकता है।", "A tree can have only one root."), true);
      return;
    }
    if (memberType === "daughter" && childIds(key).length) {
      message(t("पुत्री की शाखाएँ नहीं हो सकतीं; पहले उन्हें हटाएँ।", "A daughter cannot have descendants; remove them first."), true);
      return;
    }

    const parentId = memberType === "root" ? null : (value("#admin-tree-edit-parent") || null);
    if (memberType !== "root" && !parentId) {
      message(t("मूल पूर्वज को छोड़कर हर सदस्य के माता-पिता आवश्यक हैं।", "Every member except the root needs a parent."), true);
      return;
    }
    if (parentId && descendantIds(key).has(parentId)) {
      message(t("माता-पिता चयन से चक्र बन जाएगा।", "That parent choice would create a cycle."), true);
      return;
    }
    const parent = parentId ? draftMember(parentId) : null;
    if (parentId && !parent) {
      message(t("चुना हुआ माता-पिता वृक्ष में नहीं मिला।", "The selected parent is not in this tree."), true);
      return;
    }
    if (parent && parent.memberType === "daughter") {
      message(t("पुत्री के बच्चे दर्ज नहीं किए जा सकते।", "Children cannot be recorded under a daughter."), true);
      return;
    }

    const village = memberType === "daughter" ? "" : value("#admin-tree-edit-village");
    if (memberType !== "daughter" && !village) {
      message(t("गांव आवश्यक है।", "Village is required."), true);
      return;
    }

    Object.assign(member, {
      name,
      memberType,
      parentId,
      village,
      wifeName: memberType === "daughter" ? "" : value("#admin-tree-edit-wife-name"),
      wifeGotra: memberType === "daughter" ? "" : value("#admin-tree-edit-wife-gotra"),
      marriedGotra: memberType === "daughter" ? value("#admin-tree-edit-married-gotra") : "",
      birthOrder: Number(value("#admin-tree-edit-birth-order")) || 0,
    });
    refreshTreePreview(key);
    openTreeMemberEditor(key);
    message(t("बॉक्स अद्यतन हुआ; परिवर्तन सहेजने के लिए वृक्ष सहेजें दबाएँ।", "Box updated; save the tree to persist changes."));
  }

  function addTreeMember(memberType) {
    const parent = draftMember(state.treeSelectedId);
    if (!parent || parent.memberType === "daughter") return;
    const key = `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const siblings = childIds(state.treeSelectedId).map(draftMember).filter(Boolean);
    const birthOrder = siblings.reduce((max, item) => Math.max(max, Number(item.birthOrder) || 0), -1) + 1;
    state.treeDraft.push({
      clientId: key,
      name: memberType === "daughter" ? t("नई पुत्री", "New daughter") : t("नया पुत्र", "New son"),
      wifeName: "", wifeGotra: "", marriedGotra: "",
      village: memberType === "daughter" ? "" : (parent.village || ""),
      memberType, parentId: state.treeSelectedId, birthOrder,
    });
    refreshTreePreview(key);
    openTreeMemberEditor(key);
    $("#admin-tree-edit-name")?.select();
    message(t("नया बॉक्स जोड़ा गया; विवरण भरें और वृक्ष सहेजें।", "New box added; fill in its details and save the tree."));
  }

  function removeTreeMember() {
    const key = state.treeSelectedId;
    const member = draftMember(key);
    if (!member || member.memberType === "root") return;
    if (childIds(key).length) {
      message(t("पहले इस बॉक्स की शाखाएँ हटाएँ।", "Remove this box's branches first."), true);
      return;
    }
    state.treeDraft = state.treeDraft.filter(item => (item.clientId || item.id) !== key);
    state.treeSelectedId = null;
    const editor = $("#admin-tree-editor");
    if (editor) editor.hidden = true;
    refreshTreePreview();
    message(t("बॉक्स हटाया गया; परिवर्तन सहेजने के लिए वृक्ष सहेजें दबाएँ।", "Box removed; save the tree to persist changes."));
  }

  async function saveTreeFromPreview() {
    const meta = state.treePreviewMeta;
    if (!meta?.editable || !meta.treeId || !hasAccess("tree-box-edit")) return;
    const button = $("#admin-tree-save");
    if (button) button.disabled = true;
    try {
      const result = await send(`/api/admin/console/trees/${encodeURIComponent(meta.treeId)}`, {
        currentRevision: state.treeDraft,
        revisionIntent: meta.status === "verified",
        note: ($("#admin-tree-change-note")?.value || "").trim(),
      }, "PATCH");
      closeTreePreview();
      message(result?.message || t("वृक्ष सहेजा गया।", "Tree saved."));
      await reload();
    } catch (error) {
      message(error.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function definitionList(pairs) {
    return `<dl>${pairs.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${value}</dd>`).join("")}</dl>`;
  }

  function jsonBlock(value) {
    return `<pre>${esc(JSON.stringify(value, null, 2) || "—")}</pre>`;
  }

  function showClassic() {
    state.loadToken += 1;
    state.active = "classic";
    document.querySelectorAll("[data-admin-module]").forEach(button =>
      button.classList.toggle("active", button.dataset.adminModule === "classic")
    );
    $("#admin-module-title").textContent = t("मूल सत्यापन प्रवाह", "Original Verification Flow");
    $("#admin-module-desc").textContent = t("पहले से कार्यरत गोत्र-प्रथम सत्यापन और लिंकिंग प्रवाह सुरक्षित है।", "The existing, verified Gotra-first review and linking flow is preserved.");
    $("#admin-module-host").hidden = true;
    state.classicHost.hidden = false;
    clearMessage();
  }

  async function loadModule(moduleId) {
    if (moduleId === "classic") return showClassic();
    const config = moduleConfigs[moduleId];
    if (!config) return;
    const token = ++state.loadToken;
    state.active = moduleId;
    state.classicHost.hidden = true;
    $("#admin-module-host").hidden = false;
    document.querySelectorAll("[data-admin-module]").forEach(button =>
      button.classList.toggle("active", button.dataset.adminModule === moduleId)
    );
    const moduleMeta = (state.meta?.modules || []).find(item => item.id === moduleId) || {};
    $("#admin-module-title").textContent = lang() === "hi" ? (moduleMeta.hi || moduleId) : (moduleMeta.en || moduleId);
    $("#admin-module-desc").textContent = lang() === "hi" ? (moduleMeta.descHi || "") : (moduleMeta.descEn || "");
    $("#admin-module-host").innerHTML = `<div class="admin-card"><p class="admin-empty">${t("लोड हो रहा है…", "Loading…")}</p></div>`;
    try {
      const data = await config.load();
      if (token !== state.loadToken) return;
      state.cache[moduleId] = data;
      $("#admin-module-host").innerHTML = data.html;
      clearMessage();
    } catch (error) {
      if (token !== state.loadToken) return;
      $("#admin-module-host").innerHTML = `<div class="admin-card"><p class="admin-console-message error">${esc(error.message)}</p></div>`;
    }
  }

  async function reload() { await loadModule(state.active); }

  async function gotraOptions() {
    const data = await api("/api/admin/console/gotras?limit=200");
    return data.gotras.map(row => ({ value: row.id, label: row.name }));
  }

  async function treeOptions() {
    const data = await api("/api/admin/console/trees?limit=200");
    return data.trees.map(row => ({ value: row.id, label: `${row.treeReference} — ${row.rootName || "—"}` }));
  }

  async function accountOptions() {
    const data = await api("/api/admin/console/accounts");
    return data.accounts.map(row => ({ value: row.id, label: `${row.email} (${row.role})` }));
  }

  async function branchOptions() {
    const data = await api("/api/admin/console/branches?limit=200");
    return data.branches.map(row => ({ value: row.id, label: `${row.name} — ${row.gotra}` }));
  }

  const moduleConfigs = {
    overview: {
      load: async () => {
        const data = await api("/api/admin/console/overview");
        const c = data.counters || {};
        return { ...(typeof data === "undefined" ? {} : data), html: kpis([
          { label: t("सक्रिय गोत्र", "Active Gotras"), value: c.activeGotras },
          { label: t("कुल वृक्ष", "Family Trees"), value: c.trees },
          { label: t("कुल सदस्य", "People"), value: c.people },
          { label: t("लंबित सत्यापन", "Pending verification"), value: c.pending, note: t("सबसे पुराने पहले", "oldest first") },
          { label: t("सुधार आवश्यक", "Corrections"), value: c.corrections, negative: true },
          { label: t("सत्यापित", "Verified"), value: c.verified },
          { label: t("सक्रिय लिंक", "Active links"), value: c.links },
          { label: t("अपठित सूचनाएँ", "Unread notifications"), value: c.unread },
          { label: t("खुले डुप्लिकेट", "Open duplicates"), value: c.duplicates },
          { label: t("औसत सत्यापन", "Avg. verification"), value: c.avgVerificationHours, note: t("घंटे", "hours") },
        ]) + `
          <div class="admin-two-col">
            <div class="admin-card"><h3>${t("वृक्ष स्थिति", "Tree status")}</h3>${chart((data.statuses || []).map(row => ({ label: row.status, count: row.count })))}</div>
            <div class="admin-card"><h3>${t("शीर्ष गोत्र", "Top Gotras")}</h3>${chart(data.gotras || [], "name")}</div>
          </div>
          <div class="admin-card"><h3>${t("हाल के वृक्ष", "Recent trees")}</h3>${table([
            { key: "treeReference", label: t("संदर्भ", "Reference") },
            { key: "gotra", label: t("गोत्र", "Gotra") },
            { key: "status", label: t("स्थिति", "Status"), render: row => badge(row.status) },
            { key: "submittedAt", label: t("जमा", "Submitted"), render: row => fmtDate(row.submittedAt) },
          ], data.recentTrees || [], null)}</div>
          <div class="admin-card"><h3>${t("हाल की गतिविधि", "Recent activity")}</h3>${timeline(data.recentAudit || [])}</div>` };
      },
    },

    gotras: {
      load: async () => {
        const q = filterQuery("gotras");
        const data = await api(`/api/admin/console/gotras?${q}`);
        return { ...(typeof data === "undefined" ? {} : data), html: `
          <div class="admin-card"><h3>${t("नया गोत्र जोड़ें", "Add a Gotra")}</h3>${inlineForm("gotra-create", [
            { name: "name", label: t("नाम *", "Name *"), required: true },
            { name: "description", label: t("विवरण", "Description"), type: "textarea" },
            { name: "isActive", label: t("सक्रिय", "Active"), type: "checkbox", value: true },
          ], t("गोत्र जोड़ें", "Add Gotra"))}</div>
          <div class="admin-card"><h3>${t("गोत्र सूची", "Gotra directory")}</h3>
            ${filterMarkup("gotras", [
              { name: "q", label: t("खोजें", "Search"), placeholder: t("नाम या विवरण", "Name or description") },
              { name: "status", label: t("स्थिति", "Status"), type: "select", options: [{ value: "", label: t("सभी", "All") }, { value: "verified", label: t("सत्यापित", "Verified") }, { value: "draft", label: t("ड्राफ्ट", "Draft") }] },
              { name: "active", label: t("सक्रियता", "Active"), type: "select", options: [{ value: "", label: t("सभी", "All") }, { value: "true", label: t("हाँ", "Yes") }, { value: "false", label: t("नहीं", "No") }] },
            ])}
            ${table([
              { key: "name", label: t("गोत्र", "Gotra"), render: row => `<strong>${esc(row.name)}</strong><small>${esc(row.description || "")}</small>` },
              { key: "status", label: t("स्थिति", "Status"), render: row => badge(row.status) },
              { key: "isActive", label: t("सक्रिय", "Active"), render: row => fmt(row.isActive) },
              { key: "treeCount", label: t("वृक्ष", "Trees") },
              { key: "memberCount", label: t("सदस्य", "Members") },
              { key: "createdAt", label: t("बना", "Created"), render: row => fmtDate(row.createdAt) },
            ], data.gotras, row => `
              ${actionButton(t("संपादित", "Edit"), "gotra-edit", row.id)}
              ${actionButton(row.isActive ? t("निष्क्रिय", "Deactivate") : t("सक्रिय", "Activate"), "gotra-toggle", row.id)}
              ${actionButton(t("हटाएँ", "Delete"), "gotra-delete", row.id, { danger: true })}`)}
            ${pagination("gotras", data.total)}
          </div>` };
      },
    },

    trees: {
      load: async () => {
        const data = await api(`/api/admin/console/trees?${filterQuery("trees")}`);
        const options = await gotraOptions();
        return { ...(typeof data === "undefined" ? {} : data), html: `
          <div class="admin-card"><h3>${t("वृक्ष खोजें", "Find a family tree")}</h3>
            ${filterMarkup("trees", [
              { name: "q", label: t("खोजें", "Search"), placeholder: t("नाम / संदर्भ / गांव", "Name / ref / village") },
              { name: "status", label: t("स्थिति", "Status"), type: "select", options: [{ value: "", label: t("सभी", "All") }, ...["draft", "pending", "under_review", "correction_required", "verified", "rejected"].map(value => ({ value, label: STATUS_LABELS[value][lang() === "hi" ? 0 : 1] }))] },
              { name: "gotraId", label: t("गोत्र", "Gotra"), type: "select", options: [{ value: "", label: t("सभी", "All") }, ...options] },
              { name: "village", label: t("गांव", "Village") },
            ])}
            ${table([
              { key: "treeReference", label: t("संदर्भ", "Reference"), render: row => `<strong>${esc(row.treeReference)}</strong><small>${esc(row.rootName || "")}</small>` },
              { key: "gotra", label: t("गोत्र", "Gotra") },
              { key: "village", label: t("गांव", "Village") },
              { key: "status", label: t("स्थिति", "Status"), render: row => badge(row.status) },
              { key: "revisionNumber", label: t("संस्करण", "Rev") },
              { key: "memberCount", label: t("सदस्य", "Members") },
              { key: "submittedAt", label: t("जमा", "Submitted"), render: row => fmtDate(row.submittedAt) },
            ], data.trees, row => `
              ${actionButton(t("विवरण", "Details"), "tree-detail", row.id)}
              ${actionButton(t("बॉक्स संपादन", "Edit boxes"), "tree-box-edit", row.id)}
              ${actionButton(row.status === "verified" ? t("संशोधित", "Revise") : t("संपादित", "Edit"), "tree-edit", row.id, { data: row.status === "verified" ? { revision: "true" } : {} })}
              ${row.status === "verified" ? actionButton(t("संग्रहीत", "Archive"), "tree-archive", row.id, { danger: true }) : ""}
              ${actionButton(t("हटाएँ", "Delete"), "tree-delete", row.id, { danger: true })}`)}
            ${pagination("trees", data.total)}
          </div>` };
      },
    },

    members: {
      load: async () => {
        const data = await api(`/api/admin/console/members?${filterQuery("members")}`);
        const options = await gotraOptions();
        return { ...(typeof data === "undefined" ? {} : data), html: `
          <div class="admin-card"><h3>${t("सदस्य खोजें", "Find a member")}</h3>
            ${filterMarkup("members", [
              { name: "q", label: t("खोजें", "Search"), placeholder: t("नाम / पब्लिक आईडी / गांव", "Name / public ID / village") },
              { name: "memberType", label: t("भूमिका", "Role"), type: "select", options: [{ value: "", label: t("सभी", "All") }, { value: "root", label: t("मूल", "Root") }, { value: "son", label: t("पुत्र", "Son") }, { value: "daughter", label: t("पुत्री", "Daughter") }] },
              { name: "gotraId", label: t("गोत्र", "Gotra"), type: "select", options: [{ value: "", label: t("सभी", "All") }, ...options] },
            ])}
            ${table([
              { key: "name", label: t("नाम", "Name"), render: row => `<strong>${esc(row.name)}</strong><small>${esc(row.publicId)}</small>` },
              { key: "memberType", label: t("भूमिका", "Role") },
              { key: "wifeGotra", label: t("जीवनसाथी गोत्र", "Spouse gotra") },
              { key: "marriedGotra", label: t("विवाहित गोत्र", "Married gotra") },
              { key: "gotra", label: t("गोत्र", "Gotra") },
              { key: "treeReference", label: t("वृक्ष", "Tree") },
              { key: "village", label: t("गांव", "Village") },
              { key: "children", label: t("संतान", "Children") },
              { key: "status", label: t("स्थिति", "Status"), render: row => badge(row.status) },
            ], data.members, row => `
              ${actionButton(t("विवरण", "Details"), "member-detail", row.id)}
              ${actionButton(row.treeStatus === "verified" ? t("संशोधित", "Revise") : t("संपादित", "Edit"), "member-edit", row.id, { data: row.treeStatus === "verified" ? { revision: "true" } : {} })}
              ${actionButton(t("शाखा", "Branch"), "member-branch", row.id)}
              ${actionButton(t("आर्काइव", "Archive"), "member-archive", row.id, { danger: true })}`)}
            ${pagination("members", data.total)}
          </div>` };
      },
    },

    verification: {
      load: async () => {
        const [data, options, admins] = await Promise.all([
          api(`/api/admin/console/verification/queue?${filterQuery("verification")}`),
          gotraOptions(), accountOptions(),
        ]);
        return { ...(typeof data === "undefined" ? {} : data), html: `
          <div class="admin-card">
            <h3>${t("सत्यापन कतार", "Verification queue")}</h3>
            <p class="form-note">${t("किसी भी वृक्ष को केवल नाम/गोत्र/गांव के आधार पर स्वीकार न करें; साझा पूर्वज का प्रमाण आवश्यक है।", "Never approve a tree on name, Gotra or village alone; evidence of a shared ancestor is required.")}</p>
            ${filterMarkup("verification", [
              { name: "status", label: t("स्थिति", "Status"), type: "select", options: [{ value: "pending", label: t("लंबित", "Pending") }, { value: "under_review", label: t("समीक्षाधीन", "Under review") }, { value: "correction_required", label: t("सुधार आव्यश्यक", "Correction required") }, { value: "verified", label: t("सत्यापित", "Verified") }, { value: "rejected", label: t("अस्वीकृत", "Rejected") }] },
              { name: "gotraId", label: t("गोत्र", "Gotra"), type: "select", options: [{ value: "", label: t("सभी", "All") }, ...options] },
              { name: "adminId", label: t("समीक्षक", "Reviewer"), type: "select", options: [{ value: "", label: t("सभी", "All") }, ...admins] },
            ])}
            ${table([
              { key: "treeReference", label: t("संदर्भ", "Reference"), render: row => `<strong>${esc(row.treeReference)}</strong><small>${esc(row.rootName || "")}</small>` },
              { key: "gotra", label: t("गोत्र", "Gotra") },
              { key: "village", label: t("गांव", "Village") },
              { key: "submittedAt", label: t("जमा", "Submitted"), render: row => fmtDate(row.submittedAt) },
              { key: "assignedTo", label: t("समीक्षक", "Reviewer") },
              { key: "status", label: t("स्थिति", "Status"), render: row => badge(row.status) },
            ], data.queue, row => `
              ${actionButton(t("समीक्षा", "Review"), "verification-review", row.id)}
              ${actionButton(t("बॉक्स वृक्ष", "Box tree"), "verification-preview", row.id)}
              ${actionButton(t("असाइन", "Assign"), "verification-assign", row.id)}
              ${actionButton(t("मूल प्रवाह", "Original flow"), "verification-classic", row.id)}`)}
            ${pagination("verification", data.total)}
          </div>` };
      },
    },

    master: {
      load: async () => {
        const [index, links] = await Promise.all([
          api("/api/admin/console/master/tree-index"),
          api("/api/admin/console/master/links"),
        ]);
        const options = index.trees.map(row => ({ value: row.id, label: row.treeReference }));
        return { ...(typeof data === "undefined" ? {} : data), html: `
          <div class="admin-card"><h3>${t("मास्टर वंशावली सूचकांक", "Master Vanshawali index")}</h3>
            ${table([
              { key: "treeReference", label: t("वृक्ष", "Tree"), render: row => `<strong>${esc(row.treeReference)}</strong><small>${esc(row.rootName || "")}</small>` },
              { key: "gotra", label: t("गोत्र", "Gotra") },
              { key: "village", label: t("गांव", "Village") },
              { key: "memberCount", label: t("सदस्य", "Members") },
              { key: "linkCount", label: t("लिंक", "Links") },
            ], index.trees, row => row.rootPersonId ? actionButton(t("पूर्वज देखें", "Ancestors"), "master-ancestors", row.rootPersonId) : "")}
          </div>
          <div class="admin-card"><h3>${t("वृक्षों की तुलना", "Compare trees")}</h3>
            ${inlineForm("master-compare", [
              { name: "sourceTreeId", label: t("स्रोत वृक्ष", "Source tree"), type: "select", required: true, options: [{ value: "", label: t("चुनें", "Select") }, ...options] },
              { name: "targetTreeId", label: t("लक्ष्य वृक्ष", "Target tree"), type: "select", required: true, options: [{ value: "", label: t("चुनें", "Select") }, ...options] },
            ], t("तुलना करें", "Compare"))}
          </div>
          <div class="admin-card"><h3>${t("सक्रिय लिंक और इतिहास", "Active links and history")}</h3>
            ${table([
              { key: "source", label: t("स्रोत", "Source") },
              { key: "target", label: t("लक्ष्य", "Target") },
              { key: "ancestor", label: t("साझा पूर्वज", "Common ancestor") },
              { key: "status", label: t("स्थिति", "Status"), render: row => badge(row.status) },
              { key: "createdAt", label: t("बना", "Created"), render: row => fmtDate(row.createdAt) },
            ], links.links, row => row.status === "active" ? actionButton(t("उल्टा करें", "Reverse"), "master-reverse", row.id, { danger: true }) : "")}
          </div>` };
      },
    },

    branches: {
      load: async () => {
        const [data, options] = await Promise.all([
          api(`/api/admin/console/branches?${filterQuery("branches")}`),
          gotraOptions(),
        ]);
        return { ...(typeof data === "undefined" ? {} : data), html: `
          <div class="admin-card"><h3>${t("नई शाखा", "New branch")}</h3>${inlineForm("branch-create", [
            { name: "name", label: t("नाम *", "Name *"), required: true },
            { name: "gotraId", label: t("गोत्र *", "Gotra *"), type: "select", required: true, options: [{ value: "", label: t("चुनें", "Select") }, ...options] },
            { name: "description", label: t("विवरण", "Description"), type: "textarea" },
          ], t("शाखा जोड़ें", "Add branch"))}</div>
          <div class="admin-card"><h3>${t("शाखाएँ", "Branches")}</h3>
            ${filterMarkup("branches", [{ name: "q", label: t("खोजें", "Search"), placeholder: t("शाखा या गोत्र", "Branch or Gotra") }])}
            ${table([
              { key: "name", label: t("शाखा", "Branch"), render: row => `<strong>${esc(row.name)}</strong><small>${esc(row.gotra || "")}</small>` },
              { key: "parent", label: t("मूल शाखा", "Parent") },
              { key: "memberCount", label: t("सदस्य", "Members") },
              { key: "status", label: t("स्थिति", "Status"), render: row => badge(row.status) },
            ], data.branches, row => actionButton(t("जोड़ें", "Link"), "branch-link", row.id))}
            ${pagination("branches", data.total)}
          </div>
          <div class="admin-card"><h3>${t("शाखा लिंक इतिहास", "Branch link history")}</h3>
            ${table([
              { key: "source", label: t("स्रोत", "Source") }, { key: "target", label: t("लक्ष्य", "Target") },
              { key: "gotra", label: t("गोत्र", "Gotra") }, { key: "status", label: t("स्थिति", "Status"), render: row => badge(row.status) },
              { key: "createdAt", label: t("बना", "Created"), render: row => fmtDate(row.createdAt) },
            ], data.links, row => row.status === "active" ? actionButton(t("हटाएँ", "Unlink"), "branch-unlink", row.id, { danger: true }) : "")}
          </div>` };
      },
    },

    duplicates: {
      load: async () => {
        const data = await api(`/api/admin/console/duplicates?${filterQuery("duplicates")}`);
        return { ...(typeof data === "undefined" ? {} : data), html: `
          <div class="admin-card"><h3>${t("डुप्लिकेट स्कैन", "Duplicate scan")}</h3>
            <p class="form-note">${t("स्कैन केवल संभावित मेल खोजता है। कोई स्वतः विलय नहीं होता; हर निर्णय मैन्युअल है।", "The scan only suggests matches. Nothing is merged automatically; every decision is manual.")}</p>
            ${hasAccess("duplicate-scan") ? `<button class="button button-maroon" type="button" data-admin-action="duplicate-scan">${t("अभी स्कैन करें", "Run scan")}</button>` : ""}
          </div>
          <div class="admin-card"><h3>${t("संभावित डुप्लिकेट", "Duplicate candidates")}</h3>
            ${filterMarkup("duplicates", [
              { name: "status", label: t("स्थिति", "Status"), type: "select", options: ["open", "confirmed", "dismissed", "merged", "resolved"].map(value => ({ value, label: STATUS_LABELS[value][lang() === "hi" ? 0 : 1] })) },
              { name: "minScore", label: t("न्यूनतम स्कोर", "Min score"), type: "select", options: [60, 70, 80, 90].map(value => ({ value, label: String(value) })) },
            ])}
            ${table([
              { key: "nameA", label: t("रिकॉर्ड A", "Record A"), render: row => `<strong>${esc(row.nameA || row.gotraA || "—")}</strong><small>${esc(row.treeA || "")}</small>` },
              { key: "nameB", label: t("रिकॉर्ड B", "Record B"), render: row => `<strong>${esc(row.nameB || row.gotraB || "—")}</strong><small>${esc(row.treeB || "")}</small>` },
              { key: "score", label: t("स्कोर", "Score") },
              { key: "reasons", label: t("कारण", "Reasons"), render: row => esc(Array.isArray(row.reasons) ? row.reasons.join(", ") : row.reasons) },
              { key: "status", label: t("स्थिति", "Status"), render: row => badge(row.status) },
            ], data.candidates, row => actionButton(t("समीक्षा", "Review"), "duplicate-review", row.id))}
            ${pagination("duplicates", data.total)}
          </div>` };
      },
    },

    villages: {
      load: async () => {
        const data = await api(`/api/admin/console/villages?q=${encodeURIComponent((state.filters.villages || {}).q || "")}`);
        return { ...(typeof data === "undefined" ? {} : data), html: `
          <div class="admin-card"><h3>${t("गांव परिवर्तन", "Village changes")}</h3>
            <div class="admin-split-compare">
              <div><h4>${t("नाम बदलें", "Rename")}</h4>${inlineForm("village-rename", [
                { name: "from", label: t("पुराना नाम", "Old name"), required: true },
                { name: "to", label: t("नया नाम", "New name"), required: true },
                { name: "revisionIntent", label: t("सत्यापित वृक्ष भी बदलें (पुनः सत्यापन)", "Change verified trees too (re-verification)"), type: "checkbox", value: false },
              ], t("नाम बदलें", "Rename"))}</div>
              <div><h4>${t("दो नाम मिलाएँ", "Merge two names")}</h4>${inlineForm("village-merge", [
                { name: "from", label: t("मूल नाम", "Source name"), required: true },
                { name: "to", label: t("लक्ष्य नाम", "Target name"), required: true },
                { name: "revisionIntent", label: t("सत्यापित वृक्ष भी बदलें (पुनः सत्यापन)", "Change verified trees too (re-verification)"), type: "checkbox", value: false },
              ], t("मिलाएँ", "Merge"))}</div>
            </div>
          </div>
          <div class="admin-card"><h3>${t("गांव निर्देशिका", "Village directory")}</h3>
            ${filterMarkup("villages", [{ name: "q", label: t("खोजें", "Search"), placeholder: t("गांव", "Village") }])}
            ${table([
              { key: "village", label: t("गांव", "Village"), render: row => `<strong>${esc(row.village)}</strong><small>${esc(row.key)}</small>` },
              { key: "peopleCount", label: t("व्यक्ति", "People") },
              { key: "treeCount", label: t("वृक्ष", "Trees") },
              { key: "gotraCount", label: t("गोत्र", "Gotras") },
            ], data.villages, null)}
          </div>` };
      },
    },

    samiti: {
      load: async () => {
        const data = await api("/api/admin/console/samiti");
        const samitis = Array.isArray(data.samitis) ? data.samitis : [];
        const members = Array.isArray(data.members) ? data.members : [];
        const nameOf = id => samitis.find(item => item.id === id)?.name || "—";
        const samitiOptions = samitis.map(item => ({ value: item.id, label: item.name }));
        const photoCell = row => row.photoUrl
          ? `<img class="admin-samiti-photo" src="${esc(row.photoUrl)}" alt="" />`
          : `<span class="admin-samiti-no-photo">—</span>`;
        return { ...data, html: `
          <div class="admin-card"><h3>${t("समिति जोड़ें", "Add samiti")}</h3>
            ${inlineForm("samiti-create", [
              { name: "name", label: t("समिति का नाम *", "Samiti name *"), required: true, max: 160 },
              { name: "description", label: t("विवरण", "Description"), type: "textarea", max: 500 },
              { name: "sortOrder", label: t("क्रमांक", "Sort order"), type: "number", value: 100 },
              { name: "isActive", label: t("प्रकाशित", "Published"), type: "checkbox", value: true },
            ], t("समिति जोड़ें", "Add samiti"))}
          </div>
          <div class="admin-card"><h3>${t("समितियाँ", "Samitis")}</h3>
            ${table([
              { key: "name", label: t("नाम", "Name"), render: row => `<strong>${esc(row.name)}</strong>` },
              { key: "description", label: t("विवरण", "Description") },
              { key: "memberCount", label: t("सदस्य", "Members"), render: row => members.filter(member => member.samitiId === row.id).length },
              { key: "sortOrder", label: t("क्रमांक", "Order") },
              { key: "isActive", label: t("प्रकाशित", "Published"), render: row => fmt(row.isActive) },
            ], samitis, row => `
              ${actionButton(t("संपादित", "Edit"), "samiti-edit", row.id)}
              ${actionButton(row.isActive ? t("अप्रकाशित", "Unpublish") : t("प्रकाशित", "Publish"), "samiti-toggle", row.id)}
              ${actionButton(t("हटाएँ", "Delete"), "samiti-delete", row.id, { danger: true })}`)}
          </div>
          ${samitis.length ? `<div class="admin-card"><h3>${t("समिति सदस्य जोड़ें", "Add samiti member")}</h3>
            ${inlineForm("samiti-member-create", [
              { name: "samitiId", label: t("समिति *", "Samiti *"), type: "select", options: samitiOptions, value: samitis[0].id, required: true },
              { name: "name", label: t("नाम *", "Name *"), required: true },
              { name: "position", label: t("पद", "Position"), value: "Member", max: 120 },
              { name: "isPresident", label: t("अध्यक्ष", "President"), type: "checkbox", value: false },
              { name: "photo", label: t("फ़ोटो", "Photo"), type: "file", hint: t("PNG, JPEG, WebP या GIF · अधिकतम 2 MB", "PNG, JPEG, WebP or GIF · max 2 MB") },
              { name: "sortOrder", label: t("क्रमांक", "Sort order"), type: "number", value: 100 },
              { name: "isActive", label: t("प्रकाशित", "Published"), type: "checkbox", value: true },
            ], t("सदस्य जोड़ें", "Add member"))}
          </div>` : ""}
          <div class="admin-card"><h3>${t("समिति निर्देशिका", "Samiti directory")}</h3>
            <p class="form-note">${t("हर समिति का अपना अध्यक्ष और सदस्य हो सकते हैं; प्रकाशित सब /samiti.html पर दिखते हैं।", "Each samiti can have its own president and members; published entries appear on /samiti.html.")}</p>
            ${table([
              { key: "photoUrl", label: t("फ़ोटो", "Photo"), render: photoCell },
              { key: "samitiId", label: t("समिति", "Samiti"), render: row => esc(nameOf(row.samitiId)) },
              { key: "name", label: t("नाम", "Name"), render: row => `<strong>${esc(row.name)}</strong>` },
              { key: "position", label: t("पद", "Position") },
              { key: "isPresident", label: t("अध्यक्ष", "President"), render: row => row.isPresident ? `<span class="admin-badge admin-badge--green">${t("हाँ", "Yes")}</span>` : "—" },
              { key: "sortOrder", label: t("क्रमांक", "Order") },
              { key: "isActive", label: t("प्रकाशित", "Published"), render: row => fmt(row.isActive) },
            ], members, row => `
              ${actionButton(t("संपादित", "Edit"), "samiti-member-edit", row.id)}
              ${actionButton(row.isActive ? t("अप्रकाशित", "Unpublish") : t("प्रकाशित", "Publish"), "samiti-member-toggle", row.id)}
              ${actionButton(t("हटाएँ", "Delete"), "samiti-member-delete", row.id, { danger: true })}`)}
          </div>` };
      },
    },

    accounts: {
      load: async () => {
        const [data, contributors] = await Promise.all([
          api("/api/admin/console/accounts"), api("/api/admin/console/contributors"),
        ]);
        return { ...(typeof data === "undefined" ? {} : data), html: `
          <div class="admin-card"><h3>${t("नया एडमिन खाता", "New admin account")}</h3>${inlineForm("account-create", [
            { name: "email", label: t("ईमेल *", "Email *"), type: "email", required: true },
            { name: "password", label: t("पासवर्ड (कम से कम 12)", "Password (12+ chars)"), type: "password", required: true, max: 200 },
            { name: "displayName", label: t("प्रदर्शित नाम", "Display name") },
            { name: "role", label: t("भूमिका", "Role"), type: "select", options: [{ value: "admin", label: "Admin" }, { value: "super_admin", label: "Super Admin" }] },
          ], t("खाता बनाएँ", "Create account"))}</div>
          <div class="admin-card"><h3>${t("एडमिन खाते", "Admin accounts")}</h3>
            ${table([
              { key: "email", label: t("ईमेल", "Email"), render: row => `<strong>${esc(row.email)}</strong><small>${esc(row.displayName || "")}</small>` },
              { key: "role", label: t("भूमिका", "Role"), render: row => esc(row.role === "super_admin" ? t("सुपर एडमिन", "Super Admin") : "Admin") },
              { key: "isActive", label: t("सक्रिय", "Active"), render: row => fmt(row.isActive) },
              { key: "lastLoginAt", label: t("अंतिम लॉगिन", "Last login"), render: row => fmtDate(row.lastLoginAt) },
              { key: "actions", label: t("सत्र", "Sessions"), render: row => (data.sessions.find(s => s.adminId === row.id) || {}).count || 0 },
            ], data.accounts, row => `
              ${actionButton(t("संपादित", "Edit"), "account-edit", row.id)}
              ${actionButton(t("पासवर्ड", "Password"), "account-password", row.id)}
              ${actionButton(t("निष्क्रिय", "Deactivate"), "account-deactivate", row.id, { danger: true })}`)}
          </div>
          <div class="admin-card"><h3>${t("योगदानकर्ता", "Contributors")}</h3>${table([
            { key: "name", label: t("नाम", "Name") }, { key: "contact", label: t("संपर्क", "Contact") },
            { key: "trees", label: t("वृक्ष", "Trees") }, { key: "verified", label: t("सत्यापित", "Verified") },
          ], contributors.contributors, null)}</div>` };
      },
    },

    notifications: {
      load: async () => {
        const q = filterQuery("notifications");
        const data = await api(`/api/admin/console/notifications?${q}`);
        const accounts = await accountOptions();
        return { ...(typeof data === "undefined" ? {} : data), html: `
          <div class="admin-card"><h3>${t("सूचना भेजें", "Send a notification")}</h3>${inlineForm("notification-create", [
            { name: "title", label: t("शीर्षक *", "Title *"), required: true },
            { name: "body", label: t("संदेश", "Message"), type: "textarea" },
            { name: "type", label: t("प्रकार", "Type"), type: "select", options: ["info", "success", "warning", "danger"].map(value => ({ value, label: STATUS_LABELS[value][lang() === "hi" ? 0 : 1] })) },
            { name: "adminId", label: t("प्राप्तकर्ता", "Recipient"), type: "select", options: [{ value: "", label: t("सभी एडमिन", "All admins") }, ...accounts] },
            { name: "linkUrl", label: t("लिंक", "Link") },
          ], t("भेजें", "Send"))}</div>
          <div class="admin-card"><h3>${t("सूचनाएँ", "Notifications")} <span class="admin-badge admin-badge--amber">${data.unread} ${t("अपठित", "unread")}</span></h3>
            ${filterMarkup("notifications", [
              { name: "scope", label: t("दायरा", "Scope"), type: "select", options: [{ value: "mine", label: t("मेरी", "Mine") }, { value: "all", label: t("सभी", "All") }] },
              { name: "unread", label: t("केवल अपठित", "Unread only"), type: "select", options: [{ value: "false", label: t("नहीं", "No") }, { value: "true", label: t("हाँ", "Yes") }] },
            ])}
            ${hasAccess("notification-read-all") ? `<button class="button button-outline-dark" type="button" data-admin-action="notification-read-all">${t("सभी पढ़ें", "Mark all read")}</button>` : ""}
            ${table([
              { key: "title", label: t("शीर्षक", "Title"), render: row => `<strong>${esc(row.title)}</strong><small>${esc(row.body || "")}</small>` },
              { key: "type", label: t("प्रकार", "Type"), render: row => badge(row.type) },
              { key: "recipient", label: t("प्राप्तकर्ता", "Recipient") },
              { key: "readAt", label: t("स्थिति", "Status"), render: row => row.readAt ? badge("verified") : badge("pending") },
              { key: "createdAt", label: t("बनी", "Created"), render: row => fmtDate(row.createdAt) },
            ], data.notifications, row => `
              ${!row.readAt ? actionButton(t("पढ़ा हुआ", "Mark read"), "notification-read", row.id) : ""}
              ${actionButton(t("हटाएँ", "Delete"), "notification-delete", row.id, { danger: true })}`)}
            ${pagination("notifications", data.total)}
          </div>` };
      },
    },

    reports: {
      load: async () => {
        const query = new URLSearchParams(state.filters.reports || {});
        const data = await api(`/api/admin/console/reports/summary?${query}`);
        const s = data.summary || {};
        return { ...(typeof data === "undefined" ? {} : data), html: `
          <div class="admin-card"><h3>${t("रिपोर्ट अवधि", "Report period")}</h3>
            ${filterMarkup("reports", [
              { name: "from", label: t("से", "From"), placeholder: "YYYY-MM-DD", max: 10 },
              { name: "to", label: t("तक", "To"), placeholder: "YYYY-MM-DD", max: 10 },
            ])}
          </div>
          ${kpis([
            { label: t("कुल वृक्ष", "Trees"), value: s.trees },
            { label: t("सत्यापित", "Verified"), value: s.verified },
            { label: t("लंबित", "Pending"), value: s.pending },
            { label: t("औसत सत्यापन दिन", "Avg. verification days"), value: s.avgVerificationDays },
            { label: t("सक्रिय लिंक", "Active links"), value: s.links },
            { label: t("योगदान", "Contributions"), value: s.contributions },
            { label: t("गतिविधि", "Audit events"), value: s.auditEvents },
          ])}
          <div class="admin-two-col">
            <div class="admin-card"><h3>${t("मासिक वृक्ष", "Trees by month")}</h3>${chart(data.byMonth || [], "month")}</div>
            <div class="admin-card"><h3>${t("गोत्रानुसार", "By Gotra")}</h3>${chart(data.byGotra || [])}</div>
            <div class="admin-card"><h3>${t("गांवानुसार", "By village")}</h3>${chart(data.byVillage || [])}</div>
            <div class="admin-card"><h3>${t("सत्यापन निर्णय", "Verification decisions")}</h3>${chart(data.turnaround || [], "decision")}</div>
          </div>` };
      },
    },

    exports: {
      load: async () => {
        const datasets = [
          ["gotras", t("गोत्र", "Gotras")], ["trees", t("वृक्ष", "Trees")],
          ["members", t("सदस्य", "Members")], ["verifications", t("सत्यापन", "Verifications")],
          ["branches", t("शाखाएँ", "Branches")], ["villages", t("गांव", "Villages")],
          ["duplicates", t("डुप्लिकेट", "Duplicates")], ["accounts", t("खाते", "Accounts")],
          ["links", t("वृक्ष लिंक", "Tree links")], ["contributions", t("योगदान", "Contributions")],
          ["notifications", t("सूचनाएँ", "Notifications")], ["audit", t("गतिविधि", "Activity")],
        ];
        return { ...(typeof data === "undefined" ? {} : data), html: `
          <div class="admin-card"><h3>${t("डेटा निर्यात", "Data exports")}</h3>
            <p class="form-note">${t("CSV, Excel (XLSX) और PDF बाहरी पुस्तकालयों के बिना उत्पन्न होते हैं। PDF में देवनागरी को रोमन लिप्यंतरण दिखाया जाता है।", "CSV, Excel (XLSX) and PDF are generated without external libraries. PDF romanises Devanagari text.")}</p>
            ${inlineForm("export-download", [
              { name: "dataset", label: t("डेटासेट", "Dataset"), type: "select", options: datasets.map(([value, label]) => ({ value, label })) },
              { name: "format", label: t("फ़ॉर्मैट", "Format"), type: "select", options: [{ value: "csv", label: "CSV" }, { value: "xlsx", label: "Excel (XLSX)" }, { value: "pdf", label: "PDF" }] },
            ], t("डाउनलोड", "Download"))}
          </div>
          <div class="admin-card"><h3>${t("उपलब्ध डेटासेट", "Available datasets")}</h3>
            <div class="admin-permission-grid">${datasets.map(([id, label]) => `<div class="admin-permission-row"><strong>${esc(label)}</strong><code>${esc(id)}</code></div>`).join("")}</div>
          </div>` };
      },
    },

    backups: {
      load: async () => {
        const data = await api("/api/admin/console/backups");
        return { ...(typeof data === "undefined" ? {} : data), html: `
          <div class="admin-card"><h3>${t("लॉजिकल बैकअप", "Logical backup")}</h3>
            <p class="form-note">${t("बैकअप Genealogy डेटा का JSON स्नैपशॉट है; इसमें उपयोगकर्ता पासवर्ड हाश या JWT सीक्रेट शामिल नहीं हैं।", "A backup is a JSON snapshot of genealogy data; it excludes admin password hashes and JWT secrets.")}</p>
            ${inlineForm("backup-create", [{ name: "label", label: t("लेबल", "Label"), placeholder: t("वैकल्पिक", "Optional") }], t("बैकअप बनाएँ", "Create backup"))}
          </div>
          <div class="admin-card"><h3>${t("बैकअप इतिहास", "Backup history")}</h3>
            ${table([
              { key: "label", label: t("लेबल", "Label"), render: row => `<strong>${esc(row.label)}</strong><small>${esc(row.creator || "")}</small>` },
              { key: "status", label: t("स्थिति", "Status"), render: row => badge(row.status) },
              { key: "byteSize", label: t("आकार", "Size"), render: row => `${Number(row.byteSize || 0).toLocaleString()} B` },
              { key: "checksum", label: "SHA-256", render: row => `<small>${esc(String(row.checksum || "").slice(0, 16))}…</small>` },
              { key: "createdAt", label: t("बना", "Created"), render: row => fmtDate(row.createdAt) },
            ], data.backups, row => `
              ${actionButton(t("डाउनलोड", "Download"), "backup-download", row.id)}
              ${row.status === "complete" ? actionButton(t("रिस्टोर", "Restore"), "backup-restore", row.id, { danger: true }) : ""}
              ${actionButton(t("हटाएँ", "Delete"), "backup-delete", row.id, { danger: true })}`)}
          </div>
          <div class="admin-card"><h3>${t("रिस्टोर कार्य", "Restore jobs")}</h3>${table([
            { key: "backupId", label: t("बैकअप", "Backup") }, { key: "mode", label: t("मोड", "Mode") },
            { key: "status", label: t("स्थिति", "Status"), render: row => badge(row.status) },
            { key: "startedAt", label: t("शुरू", "Started"), render: row => fmtDate(row.startedAt) },
          ], data.jobs, null)}</div>` };
      },
    },

    activity: {
      load: async () => {
        const data = await api(`/api/admin/console/activity?${filterQuery("activity")}`);
        const filters = await api("/api/admin/console/activity/filters");
        state.cache.activityFilters = filters;
        return { ...(typeof data === "undefined" ? {} : data), html: `
          <div class="admin-card"><h3>${t("गतिविधि लॉग", "Activity log")}</h3>
            ${filterMarkup("activity", [
              { name: "action", label: t("क्रिया", "Action"), placeholder: "create_gotra" },
              { name: "entityType", label: t("entity_type", "Entity type"), type: "select", options: [{ value: "", label: t("सभी", "All") }, ...filters.entities.map(value => ({ value, label: value }))] },
              { name: "category", label: t("श्रेणी", "Category"), type: "select", options: [{ value: "", label: t("सभी", "All") }, ...filters.categories.map(value => ({ value, label: value }))] },
              { name: "adminId", label: t("एडमिन", "Admin"), type: "select", options: [{ value: "", label: t("सभी", "All") }, ...filters.admins.map(row => ({ value: row.value, label: row.label }))] },
              { name: "from", label: t("से", "From"), placeholder: "YYYY-MM-DD", max: 10 },
              { name: "to", label: t("तक", "To"), placeholder: "YYYY-MM-DD", max: 10 },
            ])}
            ${table([
              { key: "createdAt", label: t("समय", "When"), render: row => fmtDate(row.createdAt) },
              { key: "admin", label: t("एडमिन", "Admin") },
              { key: "action", label: t("क्रिया", "Action"), render: row => `<strong>${esc(row.action)}</strong><small>${esc(row.entityType || "")}</small>` },
              { key: "category", label: t("श्रेणी", "Category") },
              { key: "severity", label: t("गंभीरता", "Severity"), render: row => badge(row.severity || "info") },
            ], data.logs, row => actionButton(t("विवरण", "Details"), "activity-detail", row.id))}
            ${pagination("activity", data.total)}
          </div>` };
      },
    },

    roles: {
      load: async () => {
        const [data, accounts] = await Promise.all([
          api("/api/admin/console/roles"), accountOptions(),
        ]);
        data.accountsOptions = accounts;
        const grants = new Map(data.grants.map(row => [`${row.role}:${row.permissionKey}`, row.allowed]));
        const selected = state.cache.roleSelection || "super_admin";
        const actionLabels = {
          view: t("देखें", "View"), edit: t("संपादित", "Edit"), approve: t("स्वीकृत", "Approve"),
        };
        const rows = data.permissions.map(permission => {
          return `<div class="admin-permission-row"><strong>${esc(permission.label)}</strong>
            ${["view", "edit", "approve"].map(action => {
              const key = `${permission.module}:${action}`;
              const current = grants.get(`${selected}:${key}`);
              return `<label>${actionLabels[action]}<input type="checkbox" data-grant="${esc(key)}" ${current ? "checked" : ""} /></label>`;
            }).join("")}
          </div>`;
        }).join("");
        return { ...(typeof data === "undefined" ? {} : data), html: `
          <div class="admin-card"><h3>${t("भूमिका अनुमतियाँ", "Role permissions")}</h3>
            <div class="admin-toolbar"><label>${t("भूमिका", "Role")}<select id="admin-role-select">${data.roles.map(role => `<option value="${esc(role.name)}" ${selected === role.name ? "selected" : ""}>${esc(role.name)}</option>`).join("")}</select></label></div>
            <div class="admin-permission-grid">${rows}</div>
            <div class="admin-form-actions">${hasAccess("role-save") ? `<button class="button button-maroon" type="button" data-admin-action="role-save">${t("अनुमतियाँ सहेजें", "Save permissions")}</button>` : ""}</div>
          </div>
          <div class="admin-card"><h3>${t("वैयक्तिक ओवरराइड", "Individual overrides")}</h3>
            ${inlineForm("role-override", [
              { name: "adminId", label: t("एडमिन", "Admin"), type: "select", required: true, options: [{ value: "", label: t("चुनें", "Select") }, ...data.accountsOptions || []] },
              { name: "permissionKey", label: t("अनुमति", "Permission"), type: "select", required: true, options: data.permissions.map(row => ({ value: row.key, label: row.label })) },
              { name: "allowed", label: t("अनुमति दें", "Allow"), type: "checkbox", value: true },
            ], t("ओवरराइड सहेजें", "Save override"))}
            ${table([
              { key: "email", label: t("एडमिन", "Admin") }, { key: "permissionKey", label: t("अनुमति", "Permission") },
              { key: "allowed", label: t("स्थिति", "Status"), render: row => fmt(row.allowed) },
            ], data.overrides, row => actionButton(t("हटाएँ", "Remove"), "role-override-remove", row.adminId, { danger: true, data: { key: row.permissionKey } }))}
          </div>` };
      },
    },
  };

  async function handleForm(action, form) {
    try {
      const object = await formObject(form);
      if (!hasAccess(action)) throw new Error(t("इस ऑपरेशन की अनुमति नहीं है।", "You are not permitted to perform this operation."));
      switch (action) {
        case "filter-apply":
          readFilters(state.active);
          await reload();
          break;
        case "gotra-create":
          await send("/api/admin/console/gotras", object);
          message(t("गोत्र जोड़ा गया।", "Gotra created."));
          await reload();
          break;
        case "samiti-create":
          await send("/api/admin/console/samiti", object);
          message(t("समिति जोड़ी गई।", "Samiti created."));
          await reload();
          break;
        case "samiti-member-create":
          await send(`/api/admin/console/samiti/${encodeURIComponent(object.samitiId)}/members`, object);
          message(t("समिति सदस्य जोड़ा गया।", "Samiti member created."));
          await reload();
          break;
        case "branch-create":
          await send("/api/admin/console/branches", object);
          message(t("शाखा जोड़ी गई।", "Branch created."));
          await reload();
          break;
        case "village-rename": {
          const result = await send("/api/admin/console/villages/rename", object);
          message(result.revisions
            ? t(`गांव का नाम बदला गया; ${result.revisions} वृक्ष पुनः सत्यापन में भेजे गए।`, `Village renamed; ${result.revisions} trees sent for re-verification.`)
            : t("गांव का नाम बदला गया।", "Village renamed."));
          await reload();
          break;
        }
        case "village-merge": {
          const result = await send("/api/admin/console/villages/merge", object);
          message(result.revisions
            ? t(`गांव मिलाए गए; ${result.revisions} वृक्ष पुनः सत्यापन में भेजे गए।`, `Villages merged; ${result.revisions} trees sent for re-verification.`)
            : t("गांव मिलाए गए।", "Villages merged."));
          await reload();
          break;
        }
        case "account-create":
          await send("/api/admin/console/accounts", object);
          message(t("खाता बनाया गया।", "Account created."));
          await reload();
          break;
        case "notification-create":
          await send("/api/admin/console/notifications", object);
          message(t("सूचना भेजी गई।", "Notification sent."));
          await reload();
          break;
        case "master-compare": {
          const query = new URLSearchParams(object);
          const result = await api(`/api/admin/console/master/compare?${query}`);
          openDetail(t("वृक्ष तुलना", "Tree comparison"), `
            <p class="form-note">${esc(result.warning)}</p>
            ${table([
              { key: "sourceName", label: t("स्रोत", "Source") },
              { key: "targetName", label: t("लक्ष्य", "Target") },
              { key: "village", label: t("गांव", "Village") },
            ], result.matches, null)}
            ${definitionList([
              [t("स्रोत वृक्ष", "Source tree"), esc(result.source.treeReference)],
              [t("लक्ष्य वृक्ष", "Target tree"), esc(result.target.treeReference)],
            ])}`);
          break;
        }
        case "backup-create":
          await send("/api/admin/console/backups", object);
          message(t("बैकअप तैयार है।", "Backup created."));
          await reload();
          break;
        case "export-download":
          await downloadExport(object.dataset, object.format);
          break;
        case "role-override": {
          const accounts = await api("/api/admin/console/accounts");
          await send(`/api/admin/console/roles/overrides/${object.adminId}`, {
            permissionKey: object.permissionKey, allowed: object.allowed === "true",
          }, "PUT");
          message(t("ओवरराइड सहेजा गया।", "Override saved."));
          await reload();
          void accounts;
          break;
        }
        default:
          break;
      }
    } catch (error) {
      message(error.message, true);
    }
  }

  async function downloadExport(dataset, format) {
    const response = await fetch(`/api/admin/console/exports/${encodeURIComponent(dataset)}?format=${encodeURIComponent(format)}`, { credentials: "include" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Export failed (${response.status})`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const disposition = response.headers.get("content-disposition") || "";
    link.download = /filename="?([^";]+)"?/i.exec(disposition)?.[1] || `kulkirti-${dataset}.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    message(t("फ़ाइल डाउनलोड हो गई।", "Download started."));
  }

  async function handleAction(action, id, trigger) {
    try {
      if (!hasAccess(action)) throw new Error(t("इस ऑपरेशन की अनुमति नहीं है।", "You are not permitted to perform this operation."));
      switch (action) {
        case "page-prev": {
          const p = state.pages[state.active];
          if (p.offset > 0) p.offset = Math.max(0, p.offset - p.limit);
          await reload(); break;
        }
        case "page-next": {
          const p = state.pages[state.active];
          p.offset += p.limit;
          await reload(); break;
        }
        case "gotra-toggle": {
          const row = (state.cache.gotras?.gotras || []).find(item => item.id === id);
          await send(`/api/admin/console/gotras/${id}`, { isActive: !row?.isActive }, "PATCH");
          await reload(); break;
        }
        case "gotra-edit": {
          const row = (state.cache.gotras?.gotras || []).find(item => item.id === id) || {};
          openForm({
            title: t("गोत्र संपादित करें", "Edit Gotra"),
            values: { name: row.name, description: row.description, status: row.status, isActive: row.isActive },
            fields: [
              { name: "name", label: t("नाम", "Name"), required: true },
              { name: "description", label: t("विवरण", "Description"), type: "textarea" },
              { name: "status", label: t("स्थिति", "Status"), type: "select", options: [{ value: "verified", label: t("सत्यापित", "Verified") }, { value: "draft", label: t("ड्राफ्ट", "Draft") }] },
              { name: "isActive", label: t("सक्रिय", "Active"), type: "checkbox" },
            ],
            onSubmit: async body => { await send(`/api/admin/console/gotras/${id}`, body, "PATCH"); message(t("गोत्र अद्यतन हुआ।", "Gotra updated.")); await reload(); },
          });
          break;
        }
        case "gotra-delete":
          openConfirm(t("गोत्र हटाएँ", "Delete Gotra"), t("यह गोत्र हटाया जाएगा। इसमें वृक्ष होने पर ऑपरेशन रोक दिया जाएगा।", "This Gotra will be deleted. The operation is blocked if it has trees."), t("हटाएँ", "Delete"), async () => {
            await api(`/api/admin/console/gotras/${id}`, { method: "DELETE" });
            await reload();
          });
          break;
        case "samiti-toggle": {
          const row = (state.cache.samiti?.samitis || []).find(item => item.id === id);
          await send(`/api/admin/console/samiti/${id}`, { isActive: !row?.isActive }, "PATCH");
          await reload();
          break;
        }
        case "samiti-edit": {
          const row = (state.cache.samiti?.samitis || []).find(item => item.id === id) || {};
          openForm({
            title: t("समिति संपादित करें", "Edit samiti"),
            values: {
              name: row.name, description: row.description,
              sortOrder: row.sortOrder, isActive: row.isActive,
            },
            fields: [
              { name: "name", label: t("समिति का नाम", "Samiti name"), required: true, max: 160 },
              { name: "description", label: t("विवरण", "Description"), type: "textarea", max: 500 },
              { name: "sortOrder", label: t("क्रमांक", "Sort order"), type: "number" },
              { name: "isActive", label: t("प्रकाशित", "Published"), type: "checkbox" },
            ],
            onSubmit: async body => {
              await send(`/api/admin/console/samiti/${id}`, body, "PATCH");
              message(t("समिति अद्यतन हुई।", "Samiti updated."));
              await reload();
            },
          });
          break;
        }
        case "samiti-delete":
          openConfirm(t("समिति हटाएँ", "Delete samiti"), t("यह समिति और उसके सभी सदस्य स्थायी रूप से हटा दिए जाएँगे।", "This samiti and all its members will be permanently removed."), t("हटाएँ", "Delete"), async () => {
            await api(`/api/admin/console/samiti/${id}`, { method: "DELETE" });
            await reload();
          });
          break;
        case "samiti-member-toggle": {
          const row = (state.cache.samiti?.members || []).find(item => item.id === id);
          await send(`/api/admin/console/samiti/${row?.samitiId}/members/${id}`, { isActive: !row?.isActive }, "PATCH");
          await reload();
          break;
        }
        case "samiti-member-edit": {
          const row = (state.cache.samiti?.members || []).find(item => item.id === id) || {};
          const options = (state.cache.samiti?.samitis || []).map(item => ({ value: item.id, label: item.name }));
          openForm({
            title: t("समिति सदस्य संपादित करें", "Edit samiti member"),
            values: {
              samitiId: row.samitiId, name: row.name, position: row.position,
              isPresident: row.isPresident, sortOrder: row.sortOrder, isActive: row.isActive,
            },
            fields: [
              { name: "samitiId", label: t("समिति", "Samiti"), type: "select", options, required: true },
              { name: "name", label: t("नाम", "Name"), required: true },
              { name: "position", label: t("पद", "Position"), max: 120 },
              { name: "isPresident", label: t("अध्यक्ष", "President"), type: "checkbox" },
              { name: "photo", label: t("नई फ़ोटो", "New photo"), type: "file", hint: t("खाली छोड़ें तो पुरानी फ़ोटो रहेगी।", "Leave empty to keep the current photo.") },
              { name: "removePhoto", label: t("फ़ोटो हटाएँ", "Remove photo"), type: "checkbox", value: false },
              { name: "sortOrder", label: t("क्रमांक", "Sort order"), type: "number" },
              { name: "isActive", label: t("प्रकाशित", "Published"), type: "checkbox" },
            ],
            onSubmit: async body => {
              await send(`/api/admin/console/samiti/${row.samitiId}/members/${id}`, body, "PATCH");
              message(t("समिति सदस्य अद्यतन हुआ।", "Samiti member updated."));
              await reload();
            },
          });
          break;
        }
        case "samiti-member-delete":
          openConfirm(t("समिति सदस्य हटाएँ", "Delete samiti member"), t("यह सदस्य समिति निर्देशिका से पूरी तर हटा दिया जाएगा।", "This member will be permanently removed from the samiti directory."), t("हटाएँ", "Delete"), async () => {
            const row = (state.cache.samiti?.members || []).find(item => item.id === id) || {};
            await api(`/api/admin/console/samiti/${row.samitiId}/members/${id}`, { method: "DELETE" });
            await reload();
          });
          break;
        case "tree-detail": {
          const data = await api(`/api/admin/console/trees/${id}`);
          openDetail(t("वृक्ष विवरण", "Tree details"), `
            ${definitionList([
              [t("संदर्भ", "Reference"), esc(data.tree.treeReference)],
              [t("गोत्र", "Gotra"), esc(data.tree.gotra || "—")],
              [t("मूल", "Root"), esc(data.tree.rootName || "—")],
              [t("स्थिति", "Status"), badge(data.tree.status)],
              [t("संस्करण", "Revision"), fmt(data.tree.revisionNumber)],
              [t("जमा", "Submitted"), fmtDate(data.tree.submittedAt)],
              [t("समीक्षक", "Reviewer"), esc(data.tree.reviewerEmail || "—")],
            ])}
            <div class="admin-form-actions">
              ${actionButton(t("बॉक्स वृक्ष देखें", "View box tree"), "verification-preview", id)}
              ${actionButton(t("बॉक्स में संपादित", "Edit in box tree"), "tree-box-edit", id)}
            </div>
            <h4>${t("सदस्य", "Members")}</h4>${table([{ key: "name", label: t("नाम", "Name") }, { key: "memberType", label: t("भूमिका", "Role") }, { key: "wifeName", label: t("जीवनसाथी", "Spouse") }, { key: "wifeGotra", label: t("जीवनसाथी गोत्र", "Spouse gotra") }, { key: "marriedGotra", label: t("विवाहित गोत्र", "Married gotra") }], data.people, null)}
            <h4>${t("सत्यापन इतिहास", "Verification history")}</h4>${timeline(data.verifications, "decision", "createdAt")}
            <h4>${t("संस्करण इतिहास", "Revision history")}</h4>${timeline(data.revisions, "note", "createdAt")}`, trigger);
          break;
        }
        case "tree-edit": {
          const [row, options, detail] = await Promise.all([
            Promise.resolve((state.cache.trees?.trees || []).find(item => item.id === id) || {}),
            gotraOptions(),
            api(`/api/admin/console/trees/${id}`).catch(() => ({ tree: {} })),
          ]);
          const revising = trigger?.dataset?.revision === "true" || rowStatus(id) === "verified" || detail.tree.status === "verified";
          openForm({
            title: revising
              ? t("सत्यापित वृक्ष का नया संस्करण", "Create a verified-tree revision")
              : t("वृक्ष संपादित करें", "Edit tree"),
            values: {
              gotraId: detail.tree.gotraId || "", village: row.village, district: row.district,
              state: row.state, submitterName: row.submitterName, reviewNotes: row.reviewNotes,
            },
            fields: [
              { name: "gotraId", label: t("गोत्र *", "Gotra *"), type: "select", required: true, options: options },
              { name: "village", label: t("गांव", "Village") }, { name: "district", label: t("ज़िला", "District") },
              { name: "state", label: t("राज्य", "State") }, { name: "submitterName", label: t("योगदानकर्ता", "Submitter") },
              { name: "note", label: t("परिवर्तन नोट", "Change note"), type: "textarea" },
              { name: "reviewNotes", label: t("समीक्षा नोट", "Review notes"), type: "textarea" },
            ],
            onSubmit: async body => {
              await send(`/api/admin/console/trees/${id}`, { ...body, revisionIntent: revising }, "PATCH");
              message(revising
                ? t("नया संस्करण सहेजा गया; पुनः सत्यापन आवश्यक है।", "Revision saved; re-verification required.")
                : t("वृक्ष अद्यतन हुआ; नया संस्करण सहेजा गया।", "Tree updated; revision saved."));
              await reload();
            },
          });
          break;
        }
        case "tree-archive":
          openConfirm(t("वृक्ष संग्रहीत करें", "Archive tree"), t("यह वृक्ष सार्वजनिक सूची से हट जाएगा; डेटा सुरक्षित रहेगा।", "The tree will leave public listings; data is retained."), t("संग्रहीत", "Archive"), async () => {
            await send(`/api/admin/console/trees/${id}/archive`, {});
            await reload();
          });
          break;
        case "tree-delete":
          openConfirm(t("वृक्ष हटाएँ", "Delete tree"), t("केवल ड्राफ्ट/लंबित वृक्ष हटाए जा सकते हैं।", "Only draft or pending trees can be deleted."), t("हटाएँ", "Delete"), async () => {
            await api(`/api/admin/console/trees/${id}`, { method: "DELETE" });
            await reload();
          });
          break;
        case "member-detail": {
          const data = await api(`/api/admin/console/members/${id}`);
          openDetail(t("सदस्य विवरण", "Member details"), `
            ${definitionList([
              [t("नाम", "Name"), esc(data.person.full_name)], [t("पब्लिक आईडी", "Public ID"), esc(data.person.public_id)],
              [t("भूमिका", "Role"), esc(data.person.member_type || "—")],
              [t("जीवनसाथी का गोत्र", "Spouse gotra"), esc(data.person.wife_gotra || "—")],
              [t("विवाहित गोत्र", "Married gotra"), esc(data.person.married_gotra || "—")],
              [t("गांव", "Village"), esc(data.person.village || "—")],
              [t("गोत्र", "Gotra"), esc(data.person.gotra || "—")], [t("स्थिति", "Status"), badge(data.person.status)],
            ])}
            <h4>${t("माता-पिता", "Parents")}</h4>${table([{ key: "name", label: t("नाम", "Name") }, { key: "relationType", label: t("प्रकार", "Type") }], data.parents, null)}
            <h4>${t("संतान", "Children")}</h4>${table([{ key: "name", label: t("नाम", "Name") }, { key: "relationType", label: t("प्रकार", "Type") }], data.children, null)}
            <h4>${t("शाखाएँ", "Branches")}</h4>${table([{ key: "name", label: t("शाखा", "Branch") }, { key: "gotra", label: t("गोत्र", "Gotra") }], data.branches, null)}`, trigger);
          break;
        }
        case "member-edit": {
          const [row, detail] = await Promise.all([
            Promise.resolve((state.cache.members?.members || []).find(item => item.id === id) || {}),
            api(`/api/admin/console/members/${id}`).catch(() => ({ person: {} })),
          ]);
          const revising = trigger?.dataset?.revision === "true" || row.treeStatus === "verified" || detail.person.treeStatus === "verified";
          openForm({
            title: revising
              ? t("सत्यापित सदस्य का नया संस्करण", "Create a verified-member revision")
              : t("सदस्य संपादित करें", "Edit member"),
            values: { fullName: row.name, wifeName: row.wifeName, wifeGotra: row.wifeGotra, marriedGotra: row.marriedGotra, village: row.village, memberType: row.memberType, status: row.status, visibility: row.visibility },
            fields: [
              { name: "fullName", label: t("पूरा नाम", "Full name"), required: true },
              { name: "wifeName", label: t("जीवनसाथी", "Spouse") },
              { name: "wifeGotra", label: t("जीवनसाथी का गोत्र", "Spouse gotra") },
              { name: "marriedGotra", label: t("विवाहित गोत्र", "Married gotra") },
              { name: "village", label: t("गांव", "Village") },
              { name: "memberType", label: t("भूमिका", "Role"), type: "select", options: ["root", "son", "daughter"].map(value => ({ value, label: value })) },
              { name: "status", label: t("स्थिति", "Status"), type: "select", options: ["verified", "pending", "draft", "archived"].map(value => ({ value, label: value })) },
              { name: "visibility", label: t("दृश्यता", "Visibility"), type: "select", options: ["public", "members", "private"].map(value => ({ value, label: value })) },
            ],
            onSubmit: async body => {
              await send(`/api/admin/console/members/${id}`, { ...body, revisionIntent: revising }, "PATCH");
              message(revising
                ? t("संशोधन सहेजा गया; पुनः सत्यापन आवश्यक है।", "Revision saved; re-verification required.")
                : t("सदस्य अद्यतन हुआ।", "Member updated."));
              await reload();
            },
          });
          break;
        }
        case "member-branch": {
          const options = await branchOptions();
          openForm({
            title: t("शाखा असाइन करें", "Assign branch"),
            fields: [{ name: "branchId", label: t("शाखा", "Branch"), type: "select", options: [{ value: "", label: t("कोई नहीं (अनासाइन)", "None (unassign)") }, ...options] }],
            onSubmit: async body => { await send(`/api/admin/console/members/${id}/branch`, body, "PUT"); message(t("शाखा अद्यतन हुई।", "Branch updated.")); await reload(); },
          });
          break;
        }
        case "member-archive":
          openConfirm(t("सदस्य आर्काइव", "Archive member"), t("यह सदस्य सार्वजनिक दृश्य से हट जाएगा; संबंध सुरक्षित रहेंगे।", "The member leaves public views; relationships are retained."), t("आर्काइव", "Archive"), async () => {
            await send(`/api/admin/console/members/${id}/archive`, {});
            await reload();
          });
          break;
        case "verification-review": {
          const data = await api(`/api/admin/console/trees/${id}`);
          const decisions = ["approve", "under_review", "correction_required", "reject"];
          openDetail(t("वृक्ष समीक्षा", "Tree review"), `
            ${definitionList([
              [t("संदर्भ", "Reference"), esc(data.tree.treeReference)],
              [t("गोत्र", "Gotra"), esc(data.tree.gotra || "—")],
              [t("मूल", "Root"), esc(data.tree.rootName || "—")],
              [t("गांव", "Village"), esc(data.tree.village || "—")],
              [t("स्थिति", "Status"), badge(data.tree.status)],
            ])}
            <div class="admin-form-actions">
              ${actionButton(t("बॉक्स वृक्ष देखें", "View box tree"), "verification-preview", id)}
              ${actionButton(t("बॉक्स में संपादित", "Edit in box tree"), "tree-box-edit", id)}
            </div>
            <h4>${t("प्रस्तावित सदस्य", "Proposed members")}</h4>${table([{ key: "name", label: t("नाम", "Name") }, { key: "memberType", label: t("भूमिका", "Role") }, { key: "wifeName", label: t("जीवनसाथी", "Spouse") }], data.members, null)}
            <label>${t("सत्यापन नोट", "Verification note")}<textarea id="admin-verification-note" rows="3" maxlength="500"></textarea></label>
            <div class="admin-form-actions">${hasAccess("verification-decision") ? decisions.map(decision => `<button type="button" class="button ${decision === "approve" ? "button-maroon" : "button-outline-dark"}" data-admin-action="verification-decision" data-id="${esc(id)}" data-decision="${decision}">${esc(STATUS_LABELS[decision] ? STATUS_LABELS[decision][lang() === "hi" ? 0 : 1] : decision)}</button>`).join("") : ""}</div>
            <h4>${t("पिछले निर्णय", "Previous decisions")}</h4>${timeline(data.verifications, "decision", "createdAt")}`, trigger);
          break;
        }
        case "verification-preview": {
          state.lastTrigger = trigger;
          const data = await api(`/api/admin/console/trees/${id}`);
          openTreePreview(
            t("प्रस्तावित वंश वृक्ष", "Proposed family tree"),
            Array.isArray(data.members) ? data.members : [],
            { treeId: id, status: data.tree?.status || rowStatus(id), editable: hasAccess("tree-box-edit") }
          );
          break;
        }
        case "tree-box-edit": {
          state.lastTrigger = trigger;
          const data = await api(`/api/admin/console/trees/${id}`);
          openTreePreview(
            t("वृक्ष बॉक्स संपादक", "Tree box editor"),
            Array.isArray(data.members) ? data.members : [],
            { treeId: id, status: data.tree?.status || rowStatus(id), editable: true }
          );
          break;
        }
        case "verification-decision": {
          const decision = trigger.dataset.decision;
          const notes = $("#admin-verification-note")?.value || "";
          const body = { decision, notes };
          const doIt = async () => {
            const result = await send(`/api/admin/console/verification/${id}/decision`, body);
            closeDetail();
            /* Follow the tree into its new queue instead of leaving the old
               pending view on screen after an approve / reject decision. */
            const nextStatus = result?.status || decision;
            state.filters.verification = { ...(state.filters.verification || {}), status: nextStatus };
            state.pages.verification = { offset: 0 };
            await reload();
            message(t(`निर्णय सहेजा गया: ${nextStatus}।`, `Decision recorded: ${nextStatus}.`));
          };
          if (decision === "reject" || decision === "approve") {
            openConfirm(t("निर्णय की पुष्टि", "Confirm decision"), `${t("निर्णय", "Decision")}: ${decision}. ${t("यह ऑडिट इतिहास में दर्ज होगा।", "This will be recorded in the audit history.")}`, t("पुष्टि", "Confirm"), doIt);
          } else await doIt();
          break;
        }
        case "verification-assign": {
          const admins = await accountOptions();
          openForm({
            title: t("समीक्षक असाइन करें", "Assign reviewer"),
            fields: [
              { name: "adminId", label: t("समीक्षक", "Reviewer"), type: "select", required: true, options: admins },
              { name: "dueAt", label: t("अंतिम तिथि", "Due date"), type: "date" },
              { name: "notes", label: t("नोट", "Notes"), type: "textarea" },
            ],
            onSubmit: async body => { await send(`/api/admin/console/verification/${id}/assign`, body); message(t("समीक्षक असाइन हुआ।", "Reviewer assigned.")); await reload(); },
          });
          break;
        }
        case "verification-classic":
          showClassic();
          break;
        case "master-ancestors": {
          const data = await api(`/api/admin/console/master/ancestors?personId=${encodeURIComponent(id)}`);
          openDetail(t("पूर्वज शृंखला", "Ancestor chain"), table([
            { key: "id", label: "ID" }, { key: "name", label: t("नाम", "Name") }, { key: "depth", label: t("स्तर", "Depth") },
          ], data.ancestors, null), trigger);
          break;
        }
        case "master-reverse":
          openConfirm(t("लिंक उल्टा करें", "Reverse link"), t("यह लिंक निरस्त होगा; इतिहास सुरक्षित रहेगा।", "The link will be reversed; history is preserved."), t("उल्टा करें", "Reverse"), async () => {
            await send(`/api/admin/console/master/links/${id}/reverse`, {});
            await reload();
          });
          break;
        case "branch-link": {
          const options = await branchOptions();
          openForm({
            title: t("शाखाओं को जोड़ें", "Link branches"),
            fields: [
              { name: "targetBranchId", label: t("लक्ष्य शाखा", "Target branch"), type: "select", required: true, options },
              { name: "relationType", label: t("संबंध", "Relation"), type: "select", options: [{ value: "related", label: t("संबंधित", "Related") }, { value: "parent", label: t("मूल", "Parent") }, { value: "merged_from", label: t("विलय स्रोत", "Merged from") }] },
              { name: "notes", label: t("नोट", "Notes"), type: "textarea" },
            ],
            onSubmit: async body => { await send(`/api/admin/console/branches/${id}/link`, body); message(t("शाखाएँ जुड़ीं।", "Branches linked.")); await reload(); },
          });
          break;
        }
        case "branch-unlink":
          openConfirm(t("लिंक हटाएँ", "Unlink"), t("शाखा लिंक निरस्त होगा; इतिहास सुरक्षित रहेगा।", "The branch link will be removed; history is preserved."), t("हटाएँ", "Unlink"), async () => {
            await send(`/api/admin/console/branches/links/${id}/unlink`, {});
            await reload();
          });
          break;
        case "duplicate-scan":
          await send("/api/admin/console/duplicates/scan", {});
          message(t("स्कैन पूरा हुआ।", "Duplicate scan complete."));
          await reload();
          break;
        case "duplicate-review":
          openForm({
            title: t("डुप्लिकेट समीक्षा", "Review duplicate"),
            fields: [
              { name: "decision", label: t("निर्णय", "Decision"), type: "select", required: true, options: ["confirmed", "dismissed", "merged", "resolved"].map(value => ({ value, label: STATUS_LABELS[value][lang() === "hi" ? 0 : 1] })) },
              { name: "notes", label: t("नोट", "Notes"), type: "textarea" },
            ],
            onSubmit: async body => { await send(`/api/admin/console/duplicates/${id}/review`, body, "PATCH"); message(t("समीक्षा सहेजी गई।", "Review saved.")); await reload(); },
          });
          break;
        case "account-edit": {
          const row = (state.cache.accounts?.accounts || []).find(item => item.id === id) || {};
          openForm({
            title: t("खाता संपादित करें", "Edit account"),
            values: { displayName: row.displayName, role: row.role, isActive: row.isActive },
            fields: [
              { name: "displayName", label: t("प्रदर्शित नाम", "Display name") },
              { name: "role", label: t("भूमिका", "Role"), type: "select", options: [{ value: "admin", label: "Admin" }, { value: "super_admin", label: "Super Admin" }] },
              { name: "isActive", label: t("सक्रिय", "Active"), type: "checkbox" },
            ],
            onSubmit: async body => { await send(`/api/admin/console/accounts/${id}`, body, "PATCH"); message(t("खाता अद्यतन हुआ।", "Account updated.")); await reload(); },
          });
          break;
        }
        case "account-password":
          openForm({
            title: t("पासवर्ड रीसेट", "Reset password"),
            fields: [{ name: "password", label: t("नया पासवर्ड (कम से कम 12)", "New password (12+ chars)"), type: "password", required: true, max: 200 }],
            onSubmit: async body => { await send(`/api/admin/console/accounts/${id}/reset-password`, body); message(t("पासवर्ड बदला गया; सत्र निरस्त हुए।", "Password changed; sessions revoked.")); await reload(); },
          });
          break;
        case "account-deactivate":
          openConfirm(t("खाता निष्क्रिय", "Deactivate account"), t("खाते के सभी सत्र तुरंत निरस्त हो जाएँगे।", "All sessions for this account will be revoked immediately."), t("निष्क्रिय", "Deactivate"), async () => {
            await api(`/api/admin/console/accounts/${id}`, { method: "DELETE" });
            await reload();
          });
          break;
        case "notification-read":
          await send(`/api/admin/console/notifications/${id}/read`, {});
          await reload();
          break;
        case "notification-read-all":
          await send("/api/admin/console/notifications/read-all", {});
          await reload();
          break;
        case "notification-delete":
          await api(`/api/admin/console/notifications/${id}`, { method: "DELETE" });
          await reload();
          break;
        case "backup-download":
          window.location.href = `/api/admin/console/backups/${encodeURIComponent(id)}/download`;
          break;
        case "backup-restore":
          openForm({
            title: t("बैकअप रिस्टोर", "Restore backup"),
            fields: [
              { name: "mode", label: t("मोड", "Mode"), type: "select", options: [{ value: "missing_only", label: t("केवल अनुपलब्ध पंक्तियाँ", "Missing rows only") }, { value: "apply_snapshot", label: t("स्नैपशॉट लागू करें (ओवरराइट)", "Apply snapshot (overwrite)") }] },
              { name: "tables", label: t("तालिकाएँ (अल्पविराम से अलग, खाली = सभी)", "Tables (comma separated, empty = all)") },
              { name: "confirm", label: t("पुष्टि शब्द: RESTORE या APPLY SNAPSHOT", "Confirmation phrase: RESTORE or APPLY SNAPSHOT"), required: true },
            ],
            danger: true,
            onSubmit: async body => {
              const tables = body.tables ? body.tables.split(",").map(value => value.trim()).filter(Boolean) : undefined;
              await send(`/api/admin/console/backups/${id}/restore`, { mode: body.mode, confirm: body.confirm, ...(tables ? { tables } : {}) });
              message(t("रिस्टोर पूरा हुआ।", "Restore complete."));
              await reload();
            },
          });
          break;
        case "backup-delete":
          openConfirm(t("बैकअप हटाएँ", "Delete backup"), t("बैकअप मेटाडेटा और पेलोड हट जाएंगे।", "Backup metadata and payload will be removed."), t("हटाएँ", "Delete"), async () => {
            await api(`/api/admin/console/backups/${id}`, { method: "DELETE" });
            await reload();
          });
          break;
        case "activity-detail": {
          const row = (state.cache.activity?.logs || []).find(item => item.id === id) || {};
          let changes = {};
          try { changes = row.changes ? JSON.parse(row.changes) : {}; } catch (_) { changes = row.changes; }
          openDetail(t("गतिविधि विवरण", "Activity details"), definitionList([
            [t("क्रिया", "Action"), esc(row.action)], [t("एडमिन", "Admin"), esc(row.admin)],
            [t("समय", "When"), fmtDate(row.createdAt)], [t("IP"), esc(row.ip || "—")],
          ]) + jsonBlock(changes), trigger);
          break;
        }
        case "role-save": {
          const grants = {};
          document.querySelectorAll("[data-grant]").forEach(input => { grants[input.dataset.grant] = input.checked; });
          await send(`/api/admin/console/roles/${encodeURIComponent(state.cache.roleSelection || "super_admin")}/permissions`, { grants }, "PATCH");
          message(t("भूमिका अनुमतियाँ सहेजी गईं।", "Role permissions saved."));
          await reload();
          break;
        }
        case "role-override-remove": {
          const key = trigger.dataset.key;
          await api(`/api/admin/console/roles/overrides/${encodeURIComponent(id)}/${encodeURIComponent(key)}`, { method: "DELETE" });
          await reload();
          break;
        }
        default:
          break;
      }
    } catch (error) {
      message(error.message, true);
    }
  }

  function buildShell() {
    if (state.shellBuilt) return;
    state.shellBuilt = true;
    root.innerHTML = `
      <div class="admin-console">
        <aside class="admin-sidebar">
          <h2 class="admin-sidebar-title">Admin Console<small>${t("17 प्रबंधन मॉड्यूल", "17 management modules")}</small></h2>
          <nav id="admin-module-nav" class="admin-module-nav" aria-label="${esc(t("एडमिन मॉड्यूल", "Admin modules"))}"></nav>
        </aside>
        <div class="admin-workspace">
          <div class="admin-workspace-head">
            <div><p class="eyebrow">${t("प्रशासन नियंत्रण", "Administration")}</p><h2 id="admin-module-title">${t("ओवरव्यू", "Overview")}</h2><p id="admin-module-desc"></p></div>
            <div class="admin-identity"><span class="admin-avatar" aria-hidden="true">A</span><div><strong id="admin-console-email">Admin</strong><small id="admin-console-role"></small></div></div>
          </div>
          <p id="admin-console-message" class="admin-console-message" role="status" aria-live="polite"></p>
          <div id="admin-module-host"></div>
        </div>
      </div>
      <aside id="admin-detail" class="admin-detail" hidden aria-label="${esc(t("विवरण पैनल", "Detail panel"))}">
        <div class="admin-detail-head"><h3 id="admin-detail-title">${t("विवरण", "Details")}</h3><button id="admin-detail-close" class="admin-mini-btn" type="button" aria-label="${esc(t("बंद करें", "Close"))}">✕</button></div>
        <div id="admin-detail-body"></div>
      </aside>
      <div id="admin-dialog" class="admin-dialog" hidden role="dialog" aria-modal="true" aria-labelledby="admin-dialog-title">
        <div class="admin-dialog-card"><h3 id="admin-dialog-title"></h3><div id="admin-dialog-body"></div>
          <div class="admin-dialog-actions"><button id="admin-dialog-cancel" class="button button-outline-dark" type="button">${t("रद्द", "Cancel")}</button><button id="admin-dialog-confirm" class="button button-maroon" type="button">${t("सहेजें", "Save")}</button></div>
        </div>
      </div>
      <div id="admin-tree-preview" class="admin-tree-preview" hidden role="dialog" aria-modal="true" aria-labelledby="admin-tree-preview-title">
        <div class="admin-tree-preview__card">
          <div class="admin-tree-preview__head">
            <h3 id="admin-tree-preview-title">${t("वंश वृक्ष", "Family tree")}</h3>
            <button id="admin-tree-preview-close" class="admin-mini-btn" type="button" aria-label="${esc(t("बंद करें", "Close"))}">✕</button>
          </div>
          <p class="tree-hint">${esc(t("किसी बॉक्स पर क्लिक करें — उसके पुत्र और पुत्रियाँ खुल जाएँगे। रेखाएँ माता-पिता को संतान से जोड़ती हैं।", "Click a box to reveal that person's sons and daughters. Lines connect parents to children."))}</p>
          <p id="admin-tree-reverify-note" class="admin-tree-reverify-note" hidden>${esc(t("यह वृक्ष सत्यापित है। कोई भी संपादन नया संस्करण खोलेगा और पुनः सत्यापन आवश्यक होगा।", "This tree is verified. Any edit opens a revision and re-verification will be required."))}</p>
          <div class="tree-controls">
            <button id="admin-tree-zoom-in" class="button button-outline-dark" type="button">＋ ${t("ज़ूम", "Zoom")}</button>
            <button id="admin-tree-zoom-out" class="button button-outline-dark" type="button">－ ${t("ज़ूम", "Zoom")}</button>
            <button id="admin-tree-zoom-fit" class="button button-outline-dark" type="button">${t("फ़िट", "Fit")}</button>
            <button id="admin-tree-expand" class="button button-outline-dark" type="button">${t("फैलाएँ", "Expand")}</button>
            <button id="admin-tree-collapse" class="button button-outline-dark" type="button">${t("संक्षिप्त", "Collapse")}</button>
          </div>
          <div class="admin-tree-preview__body">
            <div id="admin-tree-preview-canvas" class="admin-tree-preview__canvas">
              <div id="admin-tree-preview-inner" class="admin-tree-preview__inner"></div>
            </div>
            <aside id="admin-tree-editor" class="admin-tree-editor" hidden aria-label="${esc(t("बॉक्स विवरण संपादक", "Box details editor"))}">
              <h4 id="admin-tree-editor-title"></h4>
              <p class="form-note">${esc(t("बॉक्स पर क्लिक करें या पेंसिल दबाएँ; बदलाव तब तक सहेजे नहीं जाते जब तक वृक्ष सहेजें न दबाएँ।", "Click a box or its pencil to select it. Changes stay local until you save the tree."))}</p>
              <div class="admin-tree-editor__fields">
                <label>${t("नाम *", "Name *")}<input id="admin-tree-edit-name" maxlength="120" /></label>
                <label id="admin-tree-edit-wife-block">${t("पत्नी का नाम", "Spouse name")}<input id="admin-tree-edit-wife-name" maxlength="120" /></label>
                <label id="admin-tree-edit-wife-gotra-block">${t("पत्नी का गोत्र", "Spouse gotra")}<input id="admin-tree-edit-wife-gotra" maxlength="120" /></label>
                <label id="admin-tree-edit-married-block" hidden>${t("विवाहित गोत्र", "Married gotra")}<input id="admin-tree-edit-married-gotra" maxlength="120" /></label>
                <label id="admin-tree-edit-village-block">${t("गांव *", "Village *")}<input id="admin-tree-edit-village" maxlength="120" /></label>
                <label>${t("भूमिका", "Role")}<select id="admin-tree-edit-type"><option value="root">${t("मूल", "Root")}</option><option value="son">${t("पुत्र", "Son")}</option><option value="daughter">${t("पुत्री", "Daughter")}</option></select></label>
                <label>${t("माता-पिता", "Parent")}<select id="admin-tree-edit-parent"></select></label>
                <label>${t("जन्म क्रम", "Birth order")}<input id="admin-tree-edit-birth-order" type="number" step="1" /></label>
              </div>
              <div class="admin-tree-editor__actions">
                <button id="admin-tree-edit-apply" class="button button-maroon" type="button">${t("बॉक्स लागू करें", "Apply box")}</button>
                <span id="admin-tree-edit-add">
                  <button id="admin-tree-edit-add-son" class="button button-outline-dark" type="button">＋ ${t("पुत्र", "Son")}</button>
                  <button id="admin-tree-edit-add-daughter" class="button button-outline-dark" type="button">＋ ${t("पुत्री", "Daughter")}</button>
                </span>
                <button id="admin-tree-edit-remove" class="button button-outline-dark admin-danger" type="button">${t("बॉक्स हटाएँ", "Remove box")}</button>
              </div>
            </aside>
          </div>
          <div id="admin-tree-preview-save" class="admin-tree-preview__save" hidden>
            <label>${t("परिवर्तन नोट", "Change note")}<input id="admin-tree-change-note" maxlength="300" /></label>
            <button id="admin-tree-save" class="button button-maroon" type="button">${t("वृक्ष सहेजें", "Save tree")}</button>
          </div>
        </div>
      </div>`;

    state.classicHost = document.createElement("section");
    state.classicHost.id = "admin-module-classic";
    state.classicHost.className = "admin-module";
    state.classicHost.hidden = true;
    const classicTabs = panel.querySelector(".admin-tabs");
    const classicView = document.getElementById("admin-vanshawali");
    if (classicTabs) state.classicHost.appendChild(classicTabs);
    if (classicView) state.classicHost.appendChild(classicView);
    root.appendChild(state.classicHost);

    $("#admin-module-nav").addEventListener("click", event => {
      const button = event.target.closest("[data-admin-module]");
      if (button) void loadModule(button.dataset.adminModule);
    });
    $("#admin-detail-close").addEventListener("click", closeDetail);
    $("#admin-dialog-cancel").addEventListener("click", closeDialog);
    $("#admin-tree-preview-close")?.addEventListener("click", closeTreePreview);
    $("#admin-tree-zoom-in")?.addEventListener("click", () => state.treePreviewView?.zoomBy(0.15));
    $("#admin-tree-zoom-out")?.addEventListener("click", () => state.treePreviewView?.zoomBy(-0.15));
    $("#admin-tree-zoom-fit")?.addEventListener("click", () => {
      const canvas = $("#admin-tree-preview-canvas");
      if (canvas) state.treePreviewView?.fit(canvas.clientWidth);
    });
    $("#admin-tree-expand")?.addEventListener("click", () => state.treePreviewView?.expandAll());
    $("#admin-tree-collapse")?.addEventListener("click", () => state.treePreviewView?.collapseAll(true));
    $("#admin-tree-edit-type")?.addEventListener("change", event => {
      const isDaughter = event.target.value === "daughter";
      for (const selector of ["#admin-tree-edit-wife-block", "#admin-tree-edit-wife-gotra-block"]) {
        const block = $(selector);
        if (block) block.hidden = isDaughter;
      }
      const married = $("#admin-tree-edit-married-block");
      if (married) married.hidden = !isDaughter;
      const village = $("#admin-tree-edit-village-block");
      if (village) village.hidden = isDaughter;
      const add = $("#admin-tree-edit-add");
      if (add) add.hidden = isDaughter;
    });
    $("#admin-tree-edit-apply")?.addEventListener("click", applyTreeMemberEdit);
    $("#admin-tree-edit-add-son")?.addEventListener("click", () => addTreeMember("son"));
    $("#admin-tree-edit-add-daughter")?.addEventListener("click", () => addTreeMember("daughter"));
    $("#admin-tree-edit-remove")?.addEventListener("click", removeTreeMember);
    $("#admin-tree-save")?.addEventListener("click", () => void saveTreeFromPreview());
    $("#admin-dialog-confirm").addEventListener("click", async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const form = $("#admin-dialog-form");
        const data = form ? new FormData(form) : new FormData();
        if (state.dialogConfirm) await state.dialogConfirm(data);
      } catch (error) {
        message(error.message, true);
        /* Keep the reason visible above the modal backdrop instead of hiding
           it in a toast the reviewer cannot reach while the dialog is open. */
        const body = $("#admin-dialog-body");
        if (body && !body.querySelector(".admin-dialog-error")) {
          const note = document.createElement("p");
          note.className = "admin-dialog-error";
          note.setAttribute("role", "alert");
          note.textContent = error.message || "Request failed.";
          body.appendChild(note);
        }
      } finally {
        button.disabled = false;
      }
    });

    const dispatchAction = event => {
      const button = event.target.closest("[data-admin-action]");
      if (button) void handleAction(button.dataset.adminAction, button.dataset.id, button);
    };
    const host = $("#admin-module-host");
    host.addEventListener("click", dispatchAction);
    /* Detail panels are siblings of the module host, so their action buttons
       need the same delegated handler (verification decisions live here). */
    $("#admin-detail-body").addEventListener("click", dispatchAction);
    host.addEventListener("submit", event => {
      const form = event.target.closest("form[data-admin-form]");
      if (!form) return;
      event.preventDefault();
      void handleForm(form.dataset.adminForm, form);
    });
    host.addEventListener("change", event => {
      if (event.target.id === "admin-role-select") {
        state.cache.roleSelection = event.target.value;
        void reload();
      }
    });
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      if (!$("#admin-tree-preview")?.hidden) closeTreePreview();
      else if (!$("#admin-dialog").hidden) closeDialog();
      else if (!$("#admin-detail").hidden) closeDetail();
    });
  }

  function buildNav() {
    const nav = $("#admin-module-nav");
    const modules = state.meta.modules.map(module => ({ ...module, classic: false }));
    modules.push({
      id: "classic", icon: "↩", hi: "मूल सत्यापन प्रवाह", en: "Original Verification Flow",
      group: "workflow", groupLabel: t("वर्कफ़्लो", "Workflow"), classic: true, permissions: {},
    });
    const groups = new Map();
    for (const module of modules) {
      if (!module.permissions?.view && !module.classic) continue;
      const label = module.groupLabel || module.group;
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(module);
    }
    nav.innerHTML = [...groups.entries()].map(([label, items]) => `
      <div class="admin-nav-group">${esc(label)}</div>
      ${items.map(module => `
        <button type="button" class="admin-nav-item ${module.id === state.active ? "active" : ""}" data-admin-module="${esc(module.id)}" aria-label="${esc(lang() === "hi" ? module.hi : module.en)}" aria-current="${module.id === state.active ? "page" : "false"}">
          <span class="admin-nav-icon" aria-hidden="true">${esc(module.icon)}</span>
          <span>${lang() === "hi" ? esc(module.hi) : esc(module.en)}</span>
        </button>`).join("")}`).join("");
  }

  async function init() {
    if (state.initializing || state.meta) return;
    state.initializing = true;
    buildShell();
    try {
      state.meta = await api("/api/admin/console/meta");
      $("#admin-console-email").textContent = state.meta.admin.email;
      $("#admin-console-role").textContent = state.meta.admin.role === "super_admin" ? t("सुपर एडमिन", "Super Admin") : "Admin";
      buildNav();
      await loadModule("overview");
    } catch (error) {
      message(error.message, true);
    } finally {
      state.initializing = false;
    }
  }

  document.addEventListener("kulkirti:admin-ready", () => { void init(); });
  document.addEventListener("languagechange", () => {
    if (!state.meta) return;
    buildNav();
    void reload();
  });
  void init();
}());
