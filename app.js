const headerMarkup = `<div class="topline"><div class="shell topline-inner"><span>इतिहास प्रमाणों के साथ</span><span class="topline-rule"></span><span>वंशावली पीढ़ियों के साथ</span><span class="topline-rule"></span><span>संबंध सत्यापित अभिलेखों के साथ</span></div></div><header class="site-header"><div class="shell header-inner"><a class="brand" href="/" aria-label="कुलकीर्ति होम"><span class="brand-mark">कु</span><span><strong>कुलकीर्ति</strong><small>GEHLOT RAJPUT ARCHIVE</small></span></a><button class="menu-toggle" aria-label="मेन्यू खोलें" aria-expanded="false">☰</button><nav class="main-nav"><a href="/">होम</a><a href="/history.html">वंश इतिहास</a><a href="/search.html">गोत्र खोज</a><a href="/search.html?type=village">गांव खोज</a><a href="/vanshawali.html">वंशावली</a><a href="/samiti.html">समिति निर्देशिका</a><a href="/submit.html">रिकॉर्ड भेजें</a></nav><a class="admin-link" href="/admin.html">Admin</a><button class="language-switch" type="button"><span>अ</span> हिन्दी <i>⌄</i></button></div></header>`;
const footerMarkup = `<footer class="site-footer"><div class="shell footer-inner"><div class="brand footer-brand"><span class="brand-mark">कु</span><span><strong>कुलकीर्ति</strong><small>GEHLOT RAJPUT ARCHIVE</small></span></div><p>एक ऐतिहासिक और वंशावली अभिलेखागार।<br>स्रोत, सम्मान और सत्यापन के साथ।</p><div class="footer-meta"><span>© 2024 कुलकीर्ति</span><a href="/">होम ↑</a></div></div></footer>`;
document.querySelector("#shared-header")?.insertAdjacentHTML("afterbegin", headerMarkup);
document.querySelector("#shared-footer")?.insertAdjacentHTML("afterbegin", footerMarkup);

const menuToggle = document.querySelector(".menu-toggle");
const mainNav = document.querySelector(".main-nav");
menuToggle?.addEventListener("click", () => { const open = mainNav.classList.toggle("open"); menuToggle.setAttribute("aria-expanded", String(open)); });
mainNav?.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => { mainNav.classList.remove("open"); }));

const searchInput = document.querySelector("#search-input");
const searchResults = document.querySelector("#search-results");
const searchForm = document.querySelector("#record-search");
const tabs = document.querySelectorAll(".search-tab");
let searchType = new URLSearchParams(location.search).get("type") === "village" ? "village" : "gotra";

async function getRecords(query) {
  const response = await fetch(`/api/records?type=${encodeURIComponent(searchType)}&q=${encodeURIComponent(query)}`);
  if (!response.ok) throw new Error("रिकॉर्ड लाने में समस्या हुई।");
  return (await response.json()).records;
}
function renderResults(records, query) {
  if (!records.length) { searchResults.innerHTML = `<div class="empty-state"><span class="empty-icon">${query ? "⌕" : "⌖"}</span><p>${query ? "कोई प्रकाशित रिकॉर्ड नहीं मिला" : "गोत्र या गांव का नाम लिखकर अभिलेख खोजें"}</p><small>${query ? "वर्तनी जांचें या किसी दूसरे नाम से खोजें।" : "केवल स्वीकृत रिकॉर्ड सार्वजनिक खोज में दिखाई देते हैं।"}</small></div>`; return; }
  searchResults.innerHTML = `<p class="result-summary">${records.length} रिकॉर्ड मिले · सत्यापन स्थिति सहित</p>${records.map((record) => `<article class="result-card"><div><h3>${record.name}</h3><p>${[record.village, record.district, record.state].filter(Boolean).join(" · ")}</p></div><a class="result-tag" href="/vanshawali.html?id=${record.id}">${record.familyDetails?.length ? "वंशावली देखें" : "सत्यापित रिकॉर्ड"}</a></article>`).join("")}`;
}
async function search(query) { try { renderResults(await getRecords(query), query); } catch (error) { searchResults.innerHTML = `<div class="empty-state"><p>${error.message}</p></div>`; } }
if (searchInput && searchResults && searchForm) {
  tabs.forEach((tab) => tab.addEventListener("click", () => { tabs.forEach((item) => item.classList.remove("active")); tab.classList.add("active"); searchType = tab.dataset.searchType; searchInput.placeholder = searchType === "gotra" ? "गोत्र का नाम लिखें..." : "गांव का नाम लिखें..."; searchInput.value = ""; search(""); }));
  if (searchType === "village") document.querySelector('[data-search-type="village"]')?.click();
  searchForm.addEventListener("submit", (event) => { event.preventDefault(); search(searchInput.value); });
  document.querySelectorAll(".hint-link").forEach((hint) => hint.addEventListener("click", () => { const query = hint.dataset.query; if (query === "उदयपुर") document.querySelector('[data-search-type="village"]')?.click(); if (query === "सिसोदिया") document.querySelector('[data-search-type="gotra"]')?.click(); searchInput.value = query; search(query); }));
}

const submissionForm = document.querySelector("#submission-form");
if (submissionForm) {
  const message = document.querySelector("#submission-message");
  const memberList = document.querySelector("#member-list");
  const members = [];
  function memberOptions(selected) {
    return `<option value="">अज्ञात / नहीं चुना</option>${members.map((member) => `<option value="${member.clientId}" ${member.clientId === selected ? "selected" : ""}>${member.name || "नया सदस्य"}</option>`).join("")}`;
  }
  function renderMembers() {
    memberList.innerHTML = members.map((member, index) => `<div class="member-row" data-member="${member.clientId}"><div class="member-row-heading"><strong>सदस्य ${index + 1}</strong><button class="remove-member" type="button" data-remove="${member.clientId}">हटाएं</button></div><div class="form-row"><label>पूरा नाम *<input data-field="name" value="${member.name || ""}" required maxlength="120" placeholder="जैसे: मोहन सिंह"></label><label>संबंध<input data-field="relation" value="${member.relation || ""}" maxlength="80" placeholder="दादा, पिता, पुत्र..."></label></div><div class="form-row"><label>पिता<select data-field="fatherId">${memberOptions(member.fatherId)}</select></label><label>माता<select data-field="motherId">${memberOptions(member.motherId)}</select></label></div><div class="form-row"><label>जन्म वर्ष<input data-field="birthYear" value="${member.birthYear || ""}" maxlength="20" placeholder="उदा. 1945"></label><label>लिंग<input data-field="gender" value="${member.gender || ""}" maxlength="30" placeholder="वैकल्पिक"></label></div><label>नोट्स<input data-field="notes" value="${member.notes || ""}" maxlength="300" placeholder="स्रोत या सत्यापन टिप्पणी"></label></div>`).join("");
    memberList.querySelectorAll("[data-field]").forEach((input) => input.addEventListener("input", () => { const row = members.find((item) => item.clientId === input.closest("[data-member]").dataset.member); row[input.dataset.field] = input.value; if (input.dataset.field === "name") renderMembers(); }));
    memberList.querySelectorAll("[data-remove]").forEach((button) => button.addEventListener("click", () => { const index = members.findIndex((item) => item.clientId === button.dataset.remove); members.splice(index, 1); renderMembers(); }));
  }
  document.querySelector("#add-member")?.addEventListener("click", () => { members.push({ clientId: crypto.randomUUID() }); renderMembers(); });
  document.querySelector("#add-member")?.click();
  submissionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = Object.fromEntries(new FormData(submissionForm));
    formData.familyDetails = members;
    try { const response = await fetch("/api/submissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(formData) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); message.textContent = result.message; message.classList.remove("error"); submissionForm.reset(); } catch (error) { message.textContent = error.message; message.classList.add("error"); }
  });
}

const adminLogin = document.querySelector("#admin-login-form");
const adminLoginBox = document.querySelector("#admin-login");
const adminPanel = document.querySelector("#admin-panel");
const adminSubmissions = document.querySelector("#admin-submissions");
async function loadSubmissions() {
  const response = await fetch("/api/admin/submissions", { credentials: "include" });
  if (!response.ok) throw new Error("Admin session समाप्त हो गया।");
  const submissions = (await response.json()).submissions;
  adminSubmissions.innerHTML = submissions.length ? submissions.map((item) => `<article class="admin-submission"><h3>${item.name} <span class="result-tag">${item.type}</span></h3><p>${[item.village, item.district, item.state].filter(Boolean).join(" · ")}</p><p>योगदानकर्ता: ${item.contributorName}${item.contributorContact ? ` · ${item.contributorContact}` : ""}</p><p>${item.notes || "कोई अतिरिक्त विवरण नहीं"}</p>${item.familyDetails?.length ? `<details><summary>${item.familyDetails.length} परिवार सदस्य · unique IDs सहित</summary><div class="admin-family-list">${item.familyDetails.map((person) => `<div><strong>${person.name}</strong> · ${person.relation || "सदस्य"}<small>ID: ${person.id}${person.fatherId ? ` · पिता: ${person.fatherId}` : ""}${person.motherId ? ` · माता: ${person.motherId}` : ""}</small></div>`).join("")}</div></details>` : ""}<p><strong>स्थिति:</strong> ${item.status}</p>${item.status === "pending" ? `<div class="admin-actions"><button class="approve" data-id="${item.id}" data-status="approved">स्वीकृत करें</button><button class="reject" data-id="${item.id}" data-status="rejected">अस्वीकृत करें</button></div>` : ""}</article>`).join("") : '<div class="admin-empty">अभी कोई submission नहीं है।</div>';
  adminSubmissions.querySelectorAll("[data-id]").forEach((button) => button.addEventListener("click", async () => { await fetch(`/api/admin/submissions/${button.dataset.id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: button.dataset.status }) }); loadSubmissions(); }));
}
if (adminLogin) {
  adminLogin.addEventListener("submit", async (event) => { event.preventDefault(); const response = await fetch("/api/admin/login", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: document.querySelector("#admin-email").value, password: document.querySelector("#admin-password").value }) }); const result = await response.json(); if (!response.ok) { document.querySelector("#admin-login-message").textContent = result.error; return; } adminLoginBox.hidden = true; adminPanel.hidden = false; loadSubmissions(); });
  document.querySelector("#admin-logout")?.addEventListener("click", async () => { await fetch("/api/admin/logout", { method: "POST", credentials: "include" }); adminPanel.hidden = true; adminLoginBox.hidden = false; });
}

const adminTabs = document.querySelectorAll(".admin-tab");
const adminViews = { submissions: document.querySelector("#admin-submissions"), gotras: document.querySelector("#admin-gotras"), "family-builder": document.querySelector("#admin-family-builder") };
adminTabs.forEach((tab) => tab.addEventListener("click", () => {
  adminTabs.forEach((item) => item.classList.remove("active"));
  tab.classList.add("active");
  Object.entries(adminViews).forEach(([name, view]) => { if (view) view.hidden = name !== tab.dataset.adminView; });
  if (tab.dataset.adminView === "gotras") loadGotras();
}));

const gotraForm = document.querySelector("#gotra-form");
const gotraMembers = [];
function renderGotraMembers() {
  const list = document.querySelector("#gotra-member-list");
  if (!list) return;
  list.innerHTML = gotraMembers.map((member, index) => `<div class="member-row" data-gotra-member="${member.clientId}"><div class="member-row-heading"><strong>सदस्य ${index + 1}</strong><button class="remove-member" type="button" data-remove-gotra-member="${member.clientId}">हटाएं</button></div><div class="form-row"><label>नाम *<input data-gotra-field="personName" value="${member.personName || ""}" required></label><label>भूमिका / संबंध<input data-gotra-field="relationOrRole" value="${member.relationOrRole || ""}" placeholder="संस्थापक, शाखा, ऐतिहासिक व्यक्ति"></label></div><div class="form-row"><label>गांव<input data-gotra-field="village" value="${member.village || ""}"></label><label>जिला<input data-gotra-field="district" value="${member.district || ""}"></label></div><label>राज्य<input data-gotra-field="state" value="${member.state || ""}"></label><label>नोट्स<input data-gotra-field="notes" value="${member.notes || ""}></label></div>`).join("");
  list.querySelectorAll("[data-gotra-field]").forEach((input) => input.addEventListener("input", () => { const member = gotraMembers.find((item) => item.clientId === input.closest("[data-gotra-member]").dataset.gotraMember); member[input.dataset.gotraField] = input.value; }));
  list.querySelectorAll("[data-remove-gotra-member]").forEach((button) => button.addEventListener("click", () => { gotraMembers.splice(gotraMembers.findIndex((item) => item.clientId === button.dataset.removeGotraMember), 1); renderGotraMembers(); }));
}
document.querySelector("#add-gotra-member")?.addEventListener("click", () => { gotraMembers.push({ clientId: crypto.randomUUID() }); renderGotraMembers(); });
async function loadGotras() {
  const response = await fetch("/api/admin/gotras", { credentials: "include" });
  if (!response.ok) return;
  const gotras = (await response.json()).gotras;
  document.querySelector("#gotra-list").innerHTML = gotras.length ? gotras.map((gotra) => `<article class="admin-submission"><h3>${gotra.name}</h3><p>उद्गम: ${gotra.originPlace || "उल्लेखित नहीं"} · स्थापक: ${gotra.founderName || "उल्लेखित नहीं"}</p><p>${gotra.memberCount} ज्ञात सदस्य · स्थिति: ${gotra.status}</p><p>${gotra.sourceReferences || "स्रोत संदर्भ उपलब्ध नहीं"}</p></article>`).join("") : '<div class="admin-empty">अभी कोई गोत्र नहीं जोड़ा गया है।</div>';
}
gotraForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(gotraForm));
  payload.members = gotraMembers;
  const response = await fetch("/api/admin/gotras", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const result = await response.json();
  const message = document.querySelector("#gotra-message");
  message.textContent = response.ok ? result.message : result.error;
  message.classList.toggle("error", !response.ok);
  if (response.ok) { gotraForm.reset(); gotraMembers.splice(0); renderGotraMembers(); loadGotras(); }
});

const adminFamilyForm = document.querySelector("#admin-family-form");
const adminFamilyMembers = [];
function renderAdminFamilyMembers() {
  const list = document.querySelector("#admin-member-list");
  if (!list) return;
  const options = (selected) => `<option value="">अज्ञात / नहीं चुना</option>${adminFamilyMembers.map((member) => `<option value="${member.clientId}" ${member.clientId === selected ? "selected" : ""}>${member.name || "नया व्यक्ति"}</option>`).join("")}`;
  list.innerHTML = adminFamilyMembers.map((member, index) => `<div class="member-row admin-member-box" data-admin-member="${member.clientId}"><div class="member-row-heading"><strong>व्यक्ति ${index + 1}</strong><button class="remove-member" type="button" data-remove-admin-member="${member.clientId}">हटाएं</button></div><div class="form-row"><label>पूरा नाम *<input data-admin-field="name" value="${member.name || ""}" required maxlength="120" placeholder="जैसे: मोहन सिंह"></label><label>संबंध / भूमिका<input data-admin-field="relation" value="${member.relation || ""}" maxlength="80" placeholder="दादा, पिता, भाई, पुत्री"></label></div><div class="form-row"><label>पिता<select data-admin-field="fatherId">${options(member.fatherId)}</select></label><label>माता<select data-admin-field="motherId">${options(member.motherId)}</select></label></div><div class="form-row"><label>जन्म वर्ष<input data-admin-field="birthYear" value="${member.birthYear || ""}" maxlength="20" placeholder="उदा. 1945"></label><label>मृत्यु वर्ष<input data-admin-field="deathYear" value="${member.deathYear || ""}" maxlength="20" placeholder="यदि ज्ञात हो"></label></div><div class="form-row"><label>लिंग<input data-admin-field="gender" value="${member.gender || ""}" maxlength="30"></label><label>नोट्स<input data-admin-field="notes" value="${member.notes || ""}" maxlength="300" placeholder="स्रोत या सत्यापन टिप्पणी"></label></div></div>`).join("");
  list.querySelectorAll("[data-admin-field]").forEach((input) => input.addEventListener("input", () => {
    const member = adminFamilyMembers.find((item) => item.clientId === input.closest("[data-admin-member]").dataset.adminMember);
    member[input.dataset.adminField] = input.value;
    if (input.dataset.adminField === "name") renderAdminFamilyMembers();
  }));
  list.querySelectorAll("[data-remove-admin-member]").forEach((button) => button.addEventListener("click", () => {
    const index = adminFamilyMembers.findIndex((item) => item.clientId === button.dataset.removeAdminMember);
    adminFamilyMembers.splice(index, 1);
    renderAdminFamilyMembers();
  }));
}
document.querySelector("#add-admin-member")?.addEventListener("click", () => {
  adminFamilyMembers.push({ clientId: crypto.randomUUID() });
  renderAdminFamilyMembers();
});
if (adminFamilyForm) document.querySelector("#add-admin-member")?.click();
adminFamilyForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = document.querySelector("#admin-family-message");
  const payload = Object.fromEntries(new FormData(adminFamilyForm));
  payload.familyDetails = adminFamilyMembers;
  try {
    const response = await fetch("/api/admin/family-records", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "परिवार वृक्ष सुरक्षित नहीं हो सका।");
    message.innerHTML = `${result.message} <a href="/vanshawali.html?id=${encodeURIComponent(result.id)}">वृक्ष देखें →</a>`;
    message.classList.remove("error");
    adminFamilyForm.reset();
    adminFamilyMembers.splice(0);
    document.querySelector("#add-admin-member")?.click();
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("error");
  }
});

const treeRoot = document.querySelector("#published-tree");
if (treeRoot) {
  const treeId = new URLSearchParams(location.search).get("id");
  if (treeId) fetch(`/api/records/${encodeURIComponent(treeId)}/tree`).then((response) => response.json()).then(({ record, error }) => {
    if (error) throw new Error(error);
    treeRoot.innerHTML = `<div class="tree-record-heading"><p class="eyebrow">सत्यापित परिवार रिकॉर्ड</p><h2>${record.name}</h2><p>${[record.village, record.district, record.state].filter(Boolean).join(" · ")}</p></div>${record.familyDetails?.length ? record.familyDetails.map((person) => `<article class="published-person"><strong>${person.name}</strong><span>${person.relation || "परिवार सदस्य"}</span><small>ID: ${person.id}${person.fatherId ? ` · पिता ID: ${person.fatherId}` : ""}${person.motherId ? ` · माता ID: ${person.motherId}` : ""}</small></article>`).join("") : "<p>इस रिकॉर्ड में अभी परिवार सदस्य प्रकाशित नहीं हैं।"}`;
  }).catch((error) => { treeRoot.innerHTML = `<div class="empty-state"><p>${error.message}</p></div>`; });
}
