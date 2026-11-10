const headerMarkup = `<div class="topline"><div class="shell topline-inner"><span>इतिहास प्रमाणों के साथ</span><span class="topline-rule"></span><span>वंशावली पीढ़ियों के साथ</span><span class="topline-rule"></span><span>संबंध सत्यापित अभिलेखों के साथ</span></div></div><header class="site-header"><div class="shell header-inner"><a class="brand" href="/" aria-label="कुलकीर्ति होम"><span class="brand-mark">कु</span><span><strong>कुलकीर्ति</strong><small>GEHLOT RAJPUT ARCHIVE</small></span></a><button class="menu-toggle" aria-label="मेन्यू खोलें" aria-expanded="false">☰</button><nav class="main-nav"><a href="/">होम</a><a href="/history.html">वंश इतिहास</a><a href="/search.html">गोत्र खोज</a><a href="/search.html?type=village">गांव खोज</a><a href="/vanshawali.html">वंशावली</a><a href="/samiti.html">समिति निर्देशिका</a><a href="/submit.html">रिकॉर्ड भेजें</a></nav><a class="admin-link" href="/admin.html">Admin</a><button class="language-switch" type="button"><span>अ</span> हिन्दी <i>⌄</i></button></div></header>`;
const footerMarkup = `<footer class="site-footer"><div class="shell footer-inner"><div class="brand footer-brand"><span class="brand-mark">कु</span><span><strong>कुलकीर्ति</strong><small>GEHLOT RAJPUT ARCHIVE</small></span></div><p>एक ऐतिहासिक और वंशावली अभिलेखागार।<br>स्रोत, सम्मान और सत्यापन के साथ।</p><div class="footer-meta"><span>© 2024 कुलकीर्ति</span><a href="/">होम ↑</a></div></div></footer>`;
document.querySelector("#shared-header")?.insertAdjacentHTML("afterbegin", headerMarkup);
document.querySelector("#shared-footer")?.insertAdjacentHTML("afterbegin", footerMarkup);

const menuToggle = document.querySelector(".menu-toggle");
const mainNav = document.querySelector(".main-nav");
menuToggle?.addEventListener("click", () => { const open = mainNav.classList.toggle("open"); menuToggle.setAttribute("aria-expanded", String(open)); });
mainNav?.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => { mainNav.classList.remove("open"); }));

const languageButton = document.querySelector(".language-switch");
let currentLanguage = "hi";
const languageCopy = {
  hi: {
    topline: ["इतिहास प्रमाणों के साथ", "वंशावली पीढ़ियों के साथ", "संबंध सत्यापित अभिलेखों के साथ"],
    nav: ["होम", "वंश इतिहास", "गोत्र खोज", "गांव खोज", "वंशावली", "समिति निर्देशिका", "रिकॉर्ड भेजें"],
    admin: "Admin",
    language: "English",
    footer: "एक ऐतिहासिक और वंशावली अभिलेखागार।<br>स्रोत, सम्मान और सत्यापन के साथ।",
    home: "कुलकीर्ति होम"
  },
  en: {
    topline: ["History with evidence", "Genealogy across generations", "Relationships from verified records"],
    nav: ["Home", "Vansh History", "Gotra Search", "Village Search", "Vanshawali", "Samiti Directory", "Submit a Record"],
    admin: "Admin",
    language: "हिन्दी",
    footer: "A historical and genealogical archive.<br>With sources, respect, and verification.",
    home: "Kul-Kirti Home"
  }
};
function applyLanguage(language) {
  const copy = languageCopy[language] || languageCopy.hi;
  currentLanguage = language;
  document.documentElement.lang = language;
  document.querySelectorAll(".topline-inner > span:not(.topline-rule)").forEach((item, index) => { item.textContent = copy.topline[index]; });
  document.querySelectorAll(".main-nav a").forEach((item, index) => { item.textContent = copy.nav[index]; });
  document.querySelectorAll(".admin-link").forEach((item) => { item.textContent = copy.admin; });
  document.querySelectorAll(".language-switch").forEach((item) => {
    item.innerHTML = `<span>${language === "hi" ? "अ" : "A"}</span> ${copy.language} <i>⌄</i>`;
    item.setAttribute("aria-label", language === "hi" ? "Switch to English" : "हिन्दी में बदलें");
  });
  document.querySelectorAll(".footer-inner > p").forEach((item) => { item.innerHTML = copy.footer; });
  document.querySelectorAll(".brand[aria-label]").forEach((item) => { item.setAttribute("aria-label", copy.home); });
  translatePage(language);
  localStorage.setItem("kulkirti-language", language);
}
const savedLanguage = localStorage.getItem("kulkirti-language");
applyLanguage(savedLanguage === "en" ? "en" : "hi");
document.querySelectorAll(".language-switch").forEach((button) => button.addEventListener("click", () => {
  localStorage.setItem("kulkirti-language", document.documentElement.lang === "hi" ? "en" : "hi");
  location.reload();
}));

const translations = {
  "सुरक्षित प्रशासन": "Secure administration", "Admin review panel": "Admin review panel", "यह क्षेत्र केवल अधिकृत admin के लिए है।": "This area is for authorized administrators only.",
  "Authentication": "Authentication", "Admin login": "Admin login", "Login": "Login", "Logout": "Logout", "Admin data management": "Admin data management",
  "Submissions review": "Submissions review", "Gotra management": "Gotra management", "Create family tree": "Create family tree", "अभी कोई submission नहीं है।": "There are no submissions yet.",
  "नया सत्यापित गोत्र जोड़ें": "Add a verified Gotra", "इतिहास और founder की जानकारी केवल प्रमाणित स्रोतों के आधार पर भरें।": "Enter history and founder information only from documented sources.",
  "गोत्र नाम *": "Gotra name *", "उद्गम स्थान": "Origin place", "उद्गम काल / अवधि": "Origin period", "स्थापक / प्रारंभिक व्यक्तित्व": "Founder / early figure",
  "स्थापक संबंधी विवरण": "Founder details", "ऐतिहासिक विवरण": "Historical details", "स्रोत संदर्भ": "Source references", "ज्ञात सदस्य": "Known members",
  "गोत्र से जुड़े लोगों को जोड़ें": "Add people associated with this Gotra", "+ सदस्य जोड़ें": "+ Add member", "गोत्र सुरक्षित करें": "Save Gotra",
  "नया परिवार वृक्ष बनाएं": "Create a family tree", "परिवार के सदस्य": "Family members", "एक-एक करके व्यक्ति जोड़ें": "Add people one at a time",
  "+ व्यक्ति जोड़ें": "+ Add person", "वृक्ष सुरक्षित और प्रकाशित करें": "Save and publish tree", "परिवार / शाखा": "Family / branch",
  "स्रोत या सत्यापन टिप्पणी": "Source or verification notes", "पूरा नाम *": "Full name *", "संबंध / भूमिका": "Relation / role", "पिता": "Father", "माता": "Mother",
  "जन्म वर्ष": "Birth year", "मृत्यु वर्ष": "Death year", "लिंग": "Gender", "नोट्स": "Notes", "हटाएं": "Remove", "अज्ञात / नहीं चुना": "Unknown / not selected",
  "अध्याय 01 / शोध एवं संदर्भ": "Chapter 01 / Research and references", "गोहिल वंश का": "The Gohil Vansh", "ऐतिहासिक परिचय": "Historical introduction",
  "दस्तावेज़, शिलालेख और परंपराओं के संदर्भ में एक सावधान ऐतिहासिक अध्ययन।": "A careful historical study based on documents, inscriptions, and traditions.",
  "स्रोत आधारित इतिहास": "Source-based history", "परिचय": "Introduction", "अध्ययन के प्रमुख क्षेत्र": "Key areas of study",
  "प्रारंभिक ऐतिहासिक संदर्भ": "Early historical references", "गोहिल एवं गेहलोत नाम": "Gohil and Gehlot names", "शाखाएं, भूगोल और प्रवास": "Branches, geography, and migration", "स्रोत और व्याख्याएं": "Sources and interpretations",
  "संपादकीय सिद्धांत": "Editorial principles", "दस्तावेज़ पहले": "Documents first", "स्रोत जोड़ें": "Add a source", "शोध सहयोग": "Research collaboration", "सहयोग करें ↗": "Collaborate ↗",
  "समुदाय का योगदान": "Community contribution", "अपना रिकॉर्ड साझा करें": "Share your record", "सहयोग करें": "Contribute", "परिवार की स्मृति": "Preserve family", "सुरक्षित करें": "memory",
  "वंशावली सदस्य": "Genealogy members", "परिवार के सभी लोगों को जोड़ें": "Add everyone in the family", "अतिरिक्त विवरण": "Additional details", "आपका नाम *": "Your name *",
  "संपर्क (वैकल्पिक)": "Contact (optional)", "सत्यापन के लिए भेजें": "Submit for verification", "परिवार / वंशावली": "Family / genealogy", "गोत्र": "Gotra", "गांव": "Village", "जिला": "District", "राज्य": "State",
  "वंशावली / Family Genealogy": "Genealogy / Family Genealogy", "परिवार की स्मृति,": "Family memory,", "पीढ़ियों का वृक्ष": "a tree across generations",
  "वंशावली कैसे जुड़ेगी?": "How will the genealogy be linked?", "अपनी वंशावली भेजें": "Submit your genealogy", "परिवार शाखा": "Family branch", "पूर्वज": "Ancestor", "परिवार": "Family", "पीढ़ी २": "Generation 2",
  "सामुदायिक निर्देशिका": "Community directory", "समाज की समितियां": "Community committees", "एवं संस्थाएं": "and organizations", "निर्देशिका निर्माणाधीन है": "Directory under construction",
  "समिति का विवरण भेजें": "Submit committee details", "अभिलेख खोज": "Archive search", "अपना गोत्र या गांव खोजें": "Search your Gotra or village", "गोत्र खोजें": "Search Gotra", "गांव खोजें": "Search village", "खोजें": "Search",
  "कोई प्रकाशित रिकॉर्ड नहीं मिला": "No published records found", "गोत्र या गांव का नाम लिखकर अभिलेख खोजें": "Enter a Gotra or village name to search the archive",
  "केवल स्वीकृत रिकॉर्ड सार्वजनिक खोज में दिखाई देते हैं।": "Only approved records appear in the public search.", "रिकॉर्ड मिले · सत्यापन स्थिति सहित": "records found · with verification status",
  "वंशावली देखें": "View genealogy", "सत्यापित रिकॉर्ड": "Verified record", "सत्यापित परिवार रिकॉर्ड": "Verified family record",
  "इस रिकॉर्ड में अभी परिवार सदस्य प्रकाशित नहीं हैं।": "No family members have been published in this record yet.",
  "परिवार रिकॉर्ड के लिए गोत्र आवश्यक है।": "Gotra is required for a family record.", "रिकॉर्ड लाने में समस्या हुई।": "There was a problem loading records.",
  "श्री गोहिल (गेहलोत) राजपूत": "Shri Gohil (Gehlot) Rajput", "गोहिल वंश का इतिहास, गौरव एवं वंशावली": "History, pride, and genealogy of the Gohil Vansh",
  "एक समर्पित डिजिटल अभिलेखागार — जहां इतिहास प्रमाणों से और परिवारों की स्मृति दस्तावेज़ों से संरक्षित होती है।": "A dedicated digital archive where history is preserved with evidence and family memories with documentation.",
  "इतिहास पढ़ें": "Read history", "अपना गोत्र खोजें": "Search your Gotra", "विरासत के पन्ने": "Pages of heritage", "मेवाड़ की ऐतिहासिक धरोहर": "The historical heritage of Mewar",
  "पत्थरों में अंकित शौर्य, परंपराओं में जीवित स्मृति और पीढ़ियों से सुरक्षित गौरव।": "Courage carved in stone, memory alive in traditions, and pride preserved across generations.",
  "चित्र संदर्भ हेतु": "Image for reference", "सत्यापित अभिलेखीय चित्र यहां जोड़ा जाएगा": "A verified archival image will be added here",
  "एकलिंग परंपरा": "Ekling tradition", "एक धरोहर, अनेक पीढ़ियों की स्मृति": "One heritage, remembered across generations",
  "मेवाड़ की स्थापत्य परंपरा और धार्मिक केंद्रों ने राजस्थान के इतिहास, कला और सामुदायिक स्मृति को गहराई से आकार दिया है। कुलकीर्ति इन्हीं प्रमाणित स्रोतों, अभिलेखों और पारिवारिक दस्तावेज़ों को आने वाली पीढ़ियों तक पहुंचाता है।": "Mewar's architectural traditions and religious centres have deeply shaped Rajasthan's history, art, and community memory. Kul-Kirti carries these verified sources, records, and family documents to future generations.",
  "अभिलेखागार के बारे में": "About the archive", "स्मरण": "Remembrance", "महाराणा प्रताप": "Maharana Pratap", "मेवाड़ के इतिहास में स्वतंत्रता, स्वाभिमान और प्रतिरोध का प्रतीक व्यक्तित्व।": "A figure symbolizing freedom, self-respect, and resistance in Mewar's history.",
  "इतिहास जानें ↗": "Learn the history ↗", "स्थापत्य": "Architecture", "चित्तौड़गढ़ दुर्ग": "Chittorgarh Fort", "किलों, स्तंभों और शिलालेखों में दर्ज राजस्थान की दीर्घ ऐतिहासिक यात्रा।": "Rajasthan's long historical journey recorded in forts, pillars, and inscriptions.",
  "विरासत देखें ↗": "View the heritage ↗", "अभिलेख तक पहुंच": "Access the archive", "कुलकीर्ति के मुख्य विभाग": "Kul-Kirti's main sections",
  "गोत्र एवं गांव खोज": "Gotra and village search", "स्वीकृत रिकॉर्ड में अपने गोत्र, गांव और परिवार शाखा की खोज करें।": "Search approved Gotra, village, and family branch records.",
  "खोज शुरू करें →": "Start searching →", "स्रोत-संदर्भित पारिवारिक संबंधों और पीढ़ियों को समझें।": "Explore source-referenced family relationships and generations.",
  "वंशावली देखें →": "View genealogy →", "रिकॉर्ड साझा करें": "Share a record", "अपना पारिवारिक विवरण समीक्षा और सत्यापन के लिए भेजें।": "Submit your family details for review and verification.", "फॉर्म भरें →": "Fill the form →",
  "गुहिल, गुहिलोत, गोहिल और गेहलोत — इन नामों का प्रयोग विभिन्न कालखंडों और क्षेत्रों में अलग-अलग संदर्भों में मिलता है। इस इतिहास को समझने के लिए शिलालेख, साहित्यिक स्रोत, स्थापत्य और मौखिक परंपराओं को सावधानी से पढ़ना आवश्यक है।": "The names Guhil, Guhilot, Gohil, and Gehlot appear in different contexts across periods and regions. Understanding this history requires careful reading of inscriptions, literary sources, architecture, and oral traditions.",
  "गुहिला नाम से जुड़े अभिलेखीय उल्लेखों और उनके संदर्भों का अध्ययन।": "Study of archival references associated with the name Guhila and their contexts.",
  "क्षेत्रीय और ऐतिहासिक उपयोगों को एक ही निश्चित वंश-दावे के रूप में प्रस्तुत नहीं किया जाएगा।": "Regional and historical usages will not be presented as one definitive genealogical claim.",
  "मेवाड़ से जुड़े क्षेत्रों और विकसित हुई सामुदायिक स्मृतियों का दस्तावेजीकरण।": "Documentation of regions connected with Mewar and evolving community memories.",
  "हर प्रकाशित ऐतिहासिक दावे के साथ संदर्भ, स्रोत और सत्यापन स्थिति जोड़ी जाएगी।": "Every published historical claim will include its reference, source, and verification status.",
  "पारंपरिक कथाओं और प्रमाणित ऐतिहासिक तथ्यों को स्पष्ट रूप से अलग रखा जाएगा।": "Traditional accounts and documented historical facts will be clearly distinguished.",
  "स्रोत या अध्याय साझा करने के लिए संपादकीय टीम से संपर्क करें।": "Contact the editorial team to share a source or chapter."
};
function translatePage(language) {
  if (language === "hi") return;
  const replaceText = (node) => {
    const value = node.textContent.trim();
    if (translations[value]) node.textContent = node.textContent.replace(value, translations[value]);
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(replaceText);
  document.querySelectorAll("input, textarea").forEach((input) => {
    const value = input.getAttribute("placeholder");
    if (value && translations[value]) input.setAttribute("placeholder", translations[value]);
  });
  if (location.pathname.endsWith("history.html")) document.title = "Vansh History | Kul-Kirti";
  if (location.pathname.endsWith("submit.html")) document.title = "Share a Record | Kul-Kirti";
  if (location.pathname.endsWith("vanshawali.html")) document.title = "Genealogy | Kul-Kirti";
  if (location.pathname.endsWith("samiti.html")) document.title = "Samiti Directory | Kul-Kirti";
  if (location.pathname.endsWith("search.html")) document.title = "Gotra and Village Search | Kul-Kirti";
  if (location.pathname.endsWith("admin.html")) document.title = "Admin Review | Kul-Kirti";
}

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
    translatePage(currentLanguage);
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
  translatePage(currentLanguage);
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
  translatePage(currentLanguage);
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
  translatePage(currentLanguage);
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
