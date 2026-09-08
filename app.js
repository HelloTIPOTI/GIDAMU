/* ==========================================================
   🔥 [설정] 본인의 GitHub 정보와 토큰을 입력하세요
   ========================================================== */
const GITHUB_CONFIG = {
  owner: "HelloTIPOTI",              // 본인 계정명
  repo: "GIDAMU",                    // 저장소 이름
  branch: "main",
  path: "data.json",
  get token() {
    // 브라우저에 토큰이 없으면 팝업창을 띄워 입력받고 저장합니다.
    let t = localStorage.getItem("gidamu_gh_token");
    if (!t) {
      t = prompt("GitHub Personal Access Token을 입력해주세요 (최초 1회):");
      if (t) {
        localStorage.setItem("gidamu_gh_token", t.trim());
      }
    }
    return t ? t.trim() : "";
  }
};

let ALL_DATA = [];
let editingIndex = null;
let currentView = "home";
let currentState = { search: "", categories: [], platform: [] };
let visibleCount = 50;

/* ==========================================================
   1. GitHub API 연동 (불러오기 & 저장하기)
   ========================================================== */

// GitHub 서버에서 data.json 가져오기
async function fetchFromGitHub() {
  const url = `https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${GITHUB_CONFIG.path}?ref=${GITHUB_CONFIG.branch}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `token ${GITHUB_CONFIG.token}` }
    });
    if (!res.ok) throw new Error("GitHub 데이터를 불러오지 못했습니다.");
    const json = await res.json();
    
    // GitHub API는 내용을 Base64로 인코딩해서 주므로 디코딩 필요
    const decodedContent = decodeURIComponent(escape(atob(json.content)));
    return { data: JSON.parse(decodedContent), sha: json.sha };
  } catch (err) {
    console.warn("GitHub 연동 실패 또는 파일 없음. 로컬 빈 배열로 대체합니다.", err);
    return { data: [], sha: null };
  }
}

// GitHub 서버에 데이터 저장하기 (자동 Commit & Push)
async function saveToGitHub(newData) {
  const url = `https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${GITHUB_CONFIG.path}`;
  
  // 1. 최신 파일의 SHA 값을 가져옴 (충돌 방지용)
  let sha = null;
  try {
    const checkRes = await fetch(url, {
      headers: { Authorization: `token ${GITHUB_CONFIG.token}` }
    });
    if (checkRes.ok) {
      const checkJson = await checkRes.json();
      sha = checkJson.sha;
    }
  } catch (e) {
    console.warn("SHA 조회 생략 (신규 파일 생성 가능성)");
  }

  // 2. 데이터를 Base64로 인코딩
  const contentEncoded = btoa(unescape(encodeURIComponent(JSON.stringify(newData, null, 2))));

  // 3. PUT 요청으로 GitHub에 푸시
  const bodyData = {
    message: "Update GIDAMU data via Web App",
    content: contentEncoded,
    branch: GITHUB_CONFIG.branch
  };
  if (sha) bodyData.sha = sha;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `token ${GITHUB_CONFIG.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(bodyData)
  });

  if (!res.ok) {
    const errRes = await res.json();
    throw new Error("GitHub 저장 실패: " + (errRes.message || "알 수 없는 오류"));
  }
}

/* ==========================================================
   2. 데이터 초기화 및 유틸
   ========================================================== */
async function initData() {
  const result = await fetchFromGitHub();
  ALL_DATA = Array.isArray(result.data) ? result.data : [];
  refreshUI();
}

function getFavorites() {
  return ALL_DATA.filter(item => item.favorite).map(item => item.title);
}

function toggleFavorite(title) {
  const item = ALL_DATA.find(i => i.title === title);
  if (!item) return;

  item.favorite = !item.favorite;
  refreshUI();
  if (currentView === 'fav') {
    renderSubView(ALL_DATA.filter(i => i.favorite));
  }

  // 💡 팝업 없이 백그라운드에서 조용히 깃허브 동기화
  saveToGitHub(ALL_DATA).catch(e => {
    alert("즐겨찾기 서버 저장 실패: " + e.message);
    item.favorite = !item.favorite;
    refreshUI();
  });
}

function getDDay(endDate) {
  if (!endDate) return null;
  const diff = Math.ceil((new Date(endDate) - new Date()) / (1000 * 60 * 60 * 24));
  return diff >= 0 ? `D-${diff}` : "종료";
}

/* ==========================================================
   3. 화면 전환 (SPA Router)
   ========================================================== */
function switchView(viewName, param) {
  currentView = viewName;
  document.querySelectorAll(".view-section").forEach(el => el.style.display = "none");

  if (viewName === "home") {
    document.getElementById("view-home").style.display = "block";
    refreshUI();
  } else if (viewName === "detail") {
    document.getElementById("view-detail").style.display = "block";
    renderDetail(param);
  } else if (viewName === "admin") {
    document.getElementById("view-admin").style.display = "block";
    resetAdminForm();
    renderAdminList();
  } else if (viewName === "fav") {
    document.getElementById("view-sub").style.display = "block";
    renderSubView(ALL_DATA.filter(item => getFavorites().includes(item.title)));
  } else if (viewName === "author") {
    document.getElementById("view-sub").style.display = "block";
    document.getElementById("subViewTitle").textContent = `작가: ${param}`;
    renderSubView(ALL_DATA.filter(item => item.artist === param || item.writer === param));
  } else if (viewName === "list") {
    document.getElementById("view-sub").style.display = "block";
    renderAuthorList();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ==========================================================
   4. 메인 화면 렌더링 & 필터
   ========================================================== */
function refreshUI() {
  renderFilters();
  renderMainCards();
}

function getFilteredData() {
  let list = [...ALL_DATA];
  let selectedDay = currentState.categories[0] || "전체";
  let selectedPlatform = currentState.platform[0] || null;

  if (currentState.search.length >= 2) {
    const q = currentState.search.toLowerCase();
    return list.filter(item =>
      (item.title || "").toLowerCase().includes(q) ||
      (item.artist || "").toLowerCase().includes(q) ||
      (item.writer || "").toLowerCase().includes(q)
    );
  }

  if (selectedDay !== "전체") {
    list = list.filter(item => item.day === selectedDay);
  }
  if (selectedPlatform) {
    list = list.filter(item => (item.platform || []).includes(selectedPlatform));
  }
  return list;
}

function renderFilters() {
  const catWrap = document.getElementById("categoryFilter");
  const platWrap = document.getElementById("tagFilter");
  if (!catWrap || !platWrap) return;

  catWrap.innerHTML = "";
  platWrap.innerHTML = "";

  const days = ["전체","월","화","수","목","금","토","일","1일","2일","3일","4일","5일","6일","7일","8일","9일","10일","기타","완결"];
  days.forEach(day => {
    const el = document.createElement("div");
    const isActive = (day === "전체" && currentState.categories.length === 0) || currentState.categories.includes(day);
    el.className = "pill" + (isActive ? " active" : "");
    el.textContent = day;
    el.onclick = () => {
      visibleCount = 50;
      currentState.categories = day === "전체" ? [] : [day];
      refreshUI();
    };
    catWrap.appendChild(el);
  });

  const platforms = ["카카오","리디","시리즈","미블","마녀","웹소(카카오)","웹소(리디)"];
  platforms.forEach(p => {
    const el = document.createElement("div");
    const isActive = currentState.platform.includes(p);
    el.className = "pill" + (isActive ? " active" : "");
    el.textContent = p;
    el.onclick = () => {
      visibleCount = 50;
      currentState.platform = currentState.platform[0] === p ? [] : [p];
      refreshUI();
    };
    platWrap.appendChild(el);
  });
}

function renderMainCards() {
  const wrap = document.getElementById("cards");
  const count = document.getElementById("resultCount");
  const loadBtn = document.getElementById("loadMoreBtn");
  if (!wrap) return;

  wrap.innerHTML = "";
  const filtered = getFilteredData();
  const favList = getFavorites();
  const sliceList = filtered.slice(0, visibleCount);

  sliceList.forEach(item => {
    const isFav = favList.includes(item.title);
    const dday = getDDay(item.endDate);
    const platform = (item.platform || [])[0] || "";
    const platformClass = platform.replace(/[()\s]/g, "");
    const rawDay = (item.day || "").replace(/\s/g, "");
    const dayClass = rawDay.match(/^\d/) ? "d" + rawDay : rawDay;

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="fav-btn ${isFav ? "active" : ""}"></div>
      <div class="thumb-wrap">
        <img class="card-thumb" src="${item.thumbnail || ''}">
        ${platform ? `<div class="platform-badge ${platformClass}">${platform}</div>` : ""}
        ${item.day ? `<div class="day-badge ${dayClass}">${item.day}</div>` : ""}
      </div>
      <div class="card-body">
        <div class="card-title">${item.title || ""}</div>
        <div class="card-author">
          <span class="author-click" data-name="${item.artist}">${item.artist || ""}</span>
          ${item.artist && item.writer ? " / " : ""}
          <span class="author-click" data-name="${item.writer}">${item.writer || ""}</span>
        </div>
        <div class="card-author">${item.currentEp || ""} / ${item.totalEp || ""}</div>
        ${dday ? `<div class="dday">${dday}</div>` : ""}
        ${item.note ? `<div class="card-note">${item.note}</div>` : ""}
        ${item.link ? `<div class="link-circle link1" data-link="${item.link}"></div>` : ""}
        ${item.link2 ? `<div class="link-circle link2" data-link="${item.link2}"></div>` : ""}
        <div class="edit-circle" data-title="${item.title}"></div>
      </div>
    `;

    card.onclick = () => switchView('detail', item);
    card.querySelector(".fav-btn").onclick = (e) => { e.stopPropagation(); toggleFavorite(item.title); };
    card.querySelectorAll(".author-click").forEach(el => {
      el.onclick = (e) => { e.stopPropagation(); if(el.dataset.name) switchView('author', el.dataset.name); };
    });
    card.querySelectorAll(".link-circle").forEach(el => {
      el.onclick = (e) => { e.stopPropagation(); window.open(el.dataset.link, "_blank"); };
    });
    card.querySelector(".edit-circle").onclick = (e) => {
      e.stopPropagation();
      const idx = ALL_DATA.findIndex(i => i.title === item.title);
      if(idx > -1) { switchView('admin'); loadItemToEdit(idx); }
    };

    wrap.appendChild(card);
  });

  if (count) count.textContent = `${filtered.length}개 작품`;
  if (loadBtn) {
    loadBtn.style.display = visibleCount >= filtered.length ? "none" : "inline-block";
    loadBtn.onclick = () => { visibleCount += 50; renderMainCards(); };
  }
}

/* ==========================================================
   5. 상세 페이지 & 서브 뷰
   ========================================================== */
let currentSlideImages = [];
let currentSlideIndex = 0;

function renderDetail(item) {
  document.getElementById("detailTitle").textContent = item.title || "";
  document.getElementById("detailPlatform").textContent = (item.platform || []).join(", ");
  document.getElementById("detailDay").textContent = item.day || "";
  document.getElementById("detailEp").textContent = `${item.currentEp || ""} / ${item.totalEp || ""}`;
  
  const authWrap = document.getElementById("detailAuthor");
  authWrap.innerHTML = "";
  [item.artist, item.writer].filter(Boolean).forEach((name, i, arr) => {
    const span = document.createElement("span");
    span.className = "author-link";
    span.textContent = name;
    span.onclick = () => switchView('author', name);
    authWrap.appendChild(span);
    if(i < arr.length - 1) authWrap.appendChild(document.createTextNode(" / "));
  });

  const dateEl = document.getElementById("detailDate");
  const dateWrap = document.getElementById("detailDateWrap");
  if(item.startDate || item.endDate) {
    dateEl.textContent = `${item.startDate || ""} ${item.endDate ? "/ " + item.endDate : ""}`;
    dateWrap.style.display = "flex";
  } else { dateWrap.style.display = "none"; }

  const noteEl = document.getElementById("detailNote");
  const noteWrap = document.getElementById("detailNoteWrap");
  if(item.note) { noteEl.textContent = item.note; noteWrap.style.display = "flex"; }
  else { noteWrap.style.display = "none"; }

  const l1El = document.getElementById("detailLink1");
  const l1Wrap = document.getElementById("detailLink1Wrap");
  if(item.link) { l1El.innerHTML = `<a href="${item.link}" target="_blank" class="detail-link">${item.link}</a>`; l1Wrap.style.display = "flex"; }
  else { l1Wrap.style.display = "none"; }

  const l2El = document.getElementById("detailLink2");
  const l2Wrap = document.getElementById("detailLink2Wrap");
  if(item.link2) { l2El.innerHTML = `<a href="${item.link2}" target="_blank" class="detail-link">${item.link2}</a>`; l2Wrap.style.display = "flex"; }
  else { l2Wrap.style.display = "none"; }

  // 💡 버튼형 슬라이드를 위한 이미지 세팅
  currentSlideImages = (item.images && item.images.length > 0) ? item.images : (item.thumbnail ? [item.thumbnail] : []);
  currentSlideIndex = 0;
  updateSlideView();

  document.getElementById("detailEditBtn").onclick = () => {
    const idx = ALL_DATA.findIndex(i => i.title === item.title);
    if(idx > -1) { switchView('admin'); loadItemToEdit(idx); }
  };
}

// 💡 좌우 버튼을 눌렀을 때 실행되는 슬라이드 전환 함수
function moveSlide(direction) {
  if (currentSlideImages.length <= 1) return;
  
  currentSlideIndex += direction;
  
  // 무한 순환 구조 (마지막 장에서 다음 누르면 첫 장으로, 첫 장에서 이전 누르면 끝장으로)
  if (currentSlideIndex < 0) {
    currentSlideIndex = currentSlideImages.length - 1;
  } else if (currentSlideIndex >= currentSlideImages.length) {
    currentSlideIndex = 0;
  }
  
  updateSlideView();
}

// 💡 슬라이드 이미지와 버튼/인디케이터 상태를 업데이트하는 함수
function updateSlideView() {
  const imgEl = document.getElementById("detailThumb");
  const prevBtn = document.getElementById("sliderPrevBtn");
  const nextBtn = document.getElementById("sliderNextBtn");
  const indicator = document.getElementById("sliderIndicator");

  if (currentSlideImages.length > 0) {
    imgEl.src = currentSlideImages[currentSlideIndex];
    imgEl.style.display = "block";
  } else {
    imgEl.src = "";
  }

  // 이미지가 2장 이상일 때만 좌우 버튼과 인디케이터 표시
  if (currentSlideImages.length > 1) {
    prevBtn.style.display = "flex";
    nextBtn.style.display = "flex";
    indicator.textContent = `${currentSlideIndex + 1} / ${currentSlideImages.length}`;
    indicator.style.display = "block";
  } else {
    prevBtn.style.display = "none";
    nextBtn.style.display = "none";
    indicator.style.display = "none";
  }
}

function renderSubView(list) {
  const wrap = document.getElementById("subCards");
  const count = document.getElementById("subResultCount");
  if (!wrap) return;

  wrap.innerHTML = "";
  count.textContent = `${list.length}개 작품`;
  const favList = getFavorites();

  list.forEach(item => {
    const isFav = favList.includes(item.title);
    const dday = getDDay(item.endDate);
    const platform = (item.platform || [])[0] || "";
    const platformClass = platform.replace(/[()\s]/g, "");
    const rawDay = (item.day || "").replace(/\s/g, "");
    const dayClass = rawDay.match(/^\d/) ? "d" + rawDay : rawDay;

    const card = document.createElement("div");
    card.className = "card";
    // 💡 메인(H) 페이지 카드와 100% 동일한 HTML 구조 적용
    card.innerHTML = `
      <div class="fav-btn ${isFav ? "active" : ""}"></div>
      <div class="thumb-wrap">
        <img class="card-thumb" src="${item.thumbnail || ''}">
        ${platform ? `<div class="platform-badge ${platformClass}">${platform}</div>` : ""}
        ${item.day ? `<div class="day-badge ${dayClass}">${item.day}</div>` : ""}
      </div>
      <div class="card-body">
        <div class="card-title">${item.title || ""}</div>
        <div class="card-author">
          <span class="author-click" data-name="${item.artist}">${item.artist || ""}</span>
          ${item.artist && item.writer ? " / " : ""}
          <span class="author-click" data-name="${item.writer}">${item.writer || ""}</span>
        </div>
        <div class="card-author">${item.currentEp || ""} / ${item.totalEp || ""}</div>
        ${dday ? `<div class="dday">${dday}</div>` : ""}
        ${item.note ? `<div class="card-note">${item.note}</div>` : ""}
        ${item.link ? `<div class="link-circle link1" data-link="${item.link}"></div>` : ""}
        ${item.link2 ? `<div class="link-circle link2" data-link="${item.link2}"></div>` : ""}
        <div class="edit-circle" data-title="${item.title}"></div>
      </div>
    `;

    // 메인 페이지와 동일한 클릭 이벤트 연결
    card.onclick = () => switchView('detail', item);
    card.querySelector(".fav-btn").onclick = (e) => { e.stopPropagation(); toggleFavorite(item.title); refreshUI(); if(currentView === 'fav') renderSubView(ALL_DATA.filter(i => getFavorites().includes(i.title))); };
    card.querySelectorAll(".author-click").forEach(el => {
      el.onclick = (e) => { e.stopPropagation(); if(el.dataset.name) switchView('author', el.dataset.name); };
    });
    card.querySelectorAll(".link-circle").forEach(el => {
      el.onclick = (e) => { e.stopPropagation(); window.open(el.dataset.link, "_blank"); };
    });
    card.querySelector(".edit-circle").onclick = (e) => {
      e.stopPropagation();
      const idx = ALL_DATA.findIndex(i => i.title === item.title);
      if(idx > -1) { switchView('admin'); loadItemToEdit(idx); }
    };

    wrap.appendChild(card);
  });
}

function renderAuthorList() {
  const wrap = document.getElementById("subCards");
  const count = document.getElementById("subResultCount");
  wrap.innerHTML = "";
  
  const map = new Map();
  ALL_DATA.forEach(item => {
    [item.artist, item.writer].filter(Boolean).forEach(str => {
      str.split("/").forEach(n => {
        const name = n.trim();
        if(name) map.set(name, (map.get(name) || 0) + 1);
      });
    });
  });

  const authors = [...map.entries()].sort((a,b) => a[0].localeCompare(b[0], "ko"));
  count.textContent = `${authors.length}명`;

  authors.forEach(([name, cnt]) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<div class="card-body"><div class="card-title">${name}</div><div class="card-author">${cnt}개 작품</div></div>`;
    card.onclick = () => switchView('author', name);
    wrap.appendChild(card);
  });
}

/* ==========================================================
   6. 관리자 기능 (추가/수정/삭제 및 GitHub 즉시 반영)
   ========================================================== */
async function processSubmit() {
  const title = document.getElementById("admTitle").value.trim();
  if(!title) { alert("작품명을 입력하세요!"); return; }

  const platform = document.getElementById("admPlatform").value;
  const rawInput = document.getElementById("admImageNames").value.trim();
  
  let images = [];
  if (rawInput) {
    // 쉼표(,) 또는 줄바꿈 기준으로 여러 개를 분리
    images = rawInput.split(/,|\n/).map(link => {
      let cleanLink = link.trim();
      if (!cleanLink) return "";

      // 💡 구글 드라이브 링크 패턴 감지 (Ctrl+C 복사 포함 다양한 형태 대응)
      if (cleanLink.includes("drive.google.com")) {
        // /d/ 뒤에 오는 ID 혹은 id= 뒤에 오는 ID를 정규식으로 안전하게 추출
        const fileIdMatch = cleanLink.match(/\/d\/([a-zA-Z0-9_-]+)/) || cleanLink.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (fileIdMatch && fileIdMatch[1]) {
          cleanLink = `https://lh3.googleusercontent.com/d/${fileIdMatch[1]}`;
        }
      }
      return cleanLink;
    }).filter(Boolean);
  }

  // 첫 번째 이미지를 대표 썸네일로 사용, 나머지와 함께 배열로 저장
  const thumbnail = images.length > 0 ? images[0] : (editingIndex !== null ? ALL_DATA[editingIndex].thumbnail : "");

  const newItem = {
    title,
    artist: document.getElementById("admArtist").value.trim(),
    writer: document.getElementById("admWriter").value.trim(),
    day: document.getElementById("admDay").value,
    platform: platform ? [platform] : [],
    currentEp: document.getElementById("admCurrentEp").value.trim(),
    totalEp: document.getElementById("admTotalEp").value.trim(),
    startDate: document.getElementById("admStartDate").value,
    endDate: document.getElementById("admEndDate").value,
    note: document.getElementById("admNote").value.trim(),
    link: document.getElementById("admLink").value.trim(),
    link2: document.getElementById("admLink2").value.trim(),
    thumbnail,
    images: images.length > 0 ? images : (editingIndex !== null ? (ALL_DATA[editingIndex].images || [thumbnail]) : [])
  };

  if(editingIndex !== null) {
    ALL_DATA[editingIndex] = newItem;
  } else {
    ALL_DATA.unshift(newItem);
  }

  try {
    document.getElementById("admSubmitBtn").textContent = "GitHub 서버 동기화 중...";
    await saveToGitHub(ALL_DATA);
    resetAdminForm();
    renderAdminList();
  } catch(e) {
    alert(e.message);
  } finally {
    document.getElementById("admSubmitBtn").textContent = "+ 작품 추가 (GitHub 실시간 저장)";
  }
}

// 기존 작품을 수정하려고 불러올 때 여러 장의 이미지 링크를 다시 input에 채워주는 함수
function loadItemToEdit(index) {
  editingIndex = index;
  const item = ALL_DATA[index];
  document.getElementById("admTitle").value = item.title || "";
  document.getElementById("admArtist").value = item.artist || "";
  document.getElementById("admWriter").value = item.writer || "";
  document.getElementById("admDay").value = item.day || "";
  document.getElementById("admPlatform").value = (item.platform || [])[0] || "";
  document.getElementById("admCurrentEp").value = item.currentEp || "";
  document.getElementById("admTotalEp").value = item.totalEp || "";
  document.getElementById("admStartDate").value = item.startDate || "";
  document.getElementById("admEndDate").value = item.endDate || "";
  document.getElementById("admNote").value = item.note || "";
  document.getElementById("admLink").value = item.link || "";
  document.getElementById("admLink2").value = item.link2 || "";
  
  // 저장된 이미지 배열이 있다면 쉼표로 이어붙여서 input에 표시
  document.getElementById("admImageNames").value = (item.images && item.images.length > 0) ? item.images.join(", ") : (item.thumbnail || "");
  
  document.getElementById("adminPanelTitle").textContent = "작품 수정";
  document.getElementById("admSubmitBtn").textContent = "수정사항 GitHub 반영하기";
}

async function deleteAdminItem(index) {
  if(!confirm("정말 이 작품을 삭제하시겠습니까?")) return;
  ALL_DATA.splice(index, 1);
  try {
    await saveToGitHub(ALL_DATA);
    renderAdminList();
    alert("삭제 및 서버 반영 완료");
  } catch(e) {
    alert(e.message);
  }
}

function resetAdminForm() {
  editingIndex = null;
  document.querySelectorAll("#view-admin input").forEach(input => input.value = "");
  document.getElementById("admDay").value = "";
  document.getElementById("admPlatform").value = "";
  document.getElementById("adminPanelTitle").textContent = "작품 추가";
  document.getElementById("admSubmitBtn").textContent = "+ 작품 추가 (GitHub 실시간 저장)";
}

function renderAdminList() {
  const container = document.getElementById("admListContainer");
  const countEl = document.getElementById("admResultCount");
  const keyword = (document.getElementById("admSearch")?.value || "").toLowerCase();
  if(!container) return;

  container.innerHTML = "";
  const filtered = ALL_DATA.map((item, index) => ({ item, index })).filter(({item}) => {
    if(!keyword) return true;
    return (item.title||"").toLowerCase().includes(keyword) || (item.artist||"").toLowerCase().includes(keyword);
  });

  countEl.textContent = `검색 결과 ${filtered.length}개`;

  filtered.forEach(({item, index}) => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid #eee;";
    row.innerHTML = `
      <div><b>${item.title}</b> <span style="font-size:12px; color:#777;">(${item.artist || '작가미상'})</span></div>
      <div>
        <button onclick="loadItemToEdit(${index}); window.scrollTo({top:0, behavior:'smooth'});" style="padding:5px 10px; cursor:pointer;">수정</button>
        <button onclick="deleteAdminItem(${index})" style="padding:5px 10px; cursor:pointer; background:#ff4d6d; color:white; border:none; border-radius:4px;">삭제</button>
      </div>
    `;
    container.appendChild(row);
  });
}

document.getElementById("admSearch")?.addEventListener("input", renderAdminList);
document.getElementById("brandTitle")?.addEventListener("click", () => switchView('home'));

// 최초 실행
initData();