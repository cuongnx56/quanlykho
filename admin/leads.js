// Use common utilities from common.js (session, apiCall, etc.)

let leads = [];
let currentPage = 1;
let totalPages = 0;
let totalLeads = 0;
const itemsPerPage = 50;

// Override resetSession to include page-specific cleanup
function resetSession() {
  if (window._originalResetSession) {
    window._originalResetSession();
  }
  leads = [];
  renderLeads();
}
window.resetSession = resetSession;

async function login() {
  session.apiUrl = DEFAULT_API_URL;
  session.apiKey = byId("api_key").value.trim();
  session.email = byId("email").value.trim();
  const password = byId("password").value;

  if (!session.apiUrl || !session.apiKey || !session.email || !password) {
    alert("Vui lòng nhập đủ API KEY, email, password");
    return;
  }

  const data = await apiCall("auth.login", {
    email: session.email,
    password
  });

  session.token = data.token;
  session.email = data.email;
  session.role = data.role;
  window.AuthSession.save(session);
  updateSessionUI();

  const urlParams = Pagination.getParamsFromURL();
  await loadLeads(urlParams.page);
}

function formatDate(date) {
  if (!date) return "";
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return String(date);
    return d.toLocaleString("vi-VN");
  } catch (e) {
    return String(date);
  }
}

function renderLeads() {
  const tbody = byId("leads-table").querySelector("tbody");
  if (!session.token) {
    tbody.innerHTML = `<tr><td colspan="8" class="muted">Đăng nhập để tải dữ liệu...</td></tr>`;
    return;
  }
  if (!leads.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="muted">Chưa có leads</td></tr>`;
    return;
  }

  tbody.innerHTML = leads.map(l => {
    const createdAt = l.created_at ? formatDate(l.created_at) : "";
    return `
      <tr data-lead-id="${l.id}">
        <td>${l.id ?? ""}</td>
        <td>${l.name ?? ""}</td>
        <td>${l.phone ?? ""}</td>
        <td>${l.email ?? ""}</td>
        <td>${l.source ?? ""}</td>
        <td>${l.status ?? ""}</td>
        <td>${l.note ?? ""}</td>
        <td>${createdAt}</td>
      </tr>
    `;
  }).join("");
}

function renderPagination() {
  Pagination.render(
    "leads-pagination",
    currentPage,
    totalPages,
    totalLeads,
    async (page) => {
      Pagination.updateURL(page, itemsPerPage);
      await loadLeads(page);
    },
    "leads"
  );
}

async function loadLeads(page) {
  if (page == null) {
    const urlParams = Pagination.getParamsFromURL();
    page = urlParams.page;
  }

  currentPage = page;

  return apiCallWithLoading(async () => {
    // Frontend cache (localStorage)
    const cacheKey = CacheManager.key("leads", "list", page, itemsPerPage);
    const cached = CacheManager.get(cacheKey);
    if (cached) {
      leads = cached.items || [];
      totalLeads = cached.total || 0;
      totalPages = cached.totalPages || 0;
      currentPage = cached.page || 1;
      renderLeads();
      renderPagination();
      return;
    }

    let result = null;
    // Try Worker first (READ)
    if (WorkerAPI && WorkerAPI.isConfigured && WorkerAPI.isConfigured()) {
      result = await WorkerAPI.leadsList({ page, limit: itemsPerPage });
    }

    // Fallback to GAS
    if (!result) {
      result = await apiCall("leads.list", { page, limit: itemsPerPage });
    }

    leads = result.items || [];
    totalLeads = result.total || 0;
    totalPages = result.totalPages || 0;
    currentPage = result.page || page;

    CacheManager.set(cacheKey, result, 5 * 60 * 1000);

    renderLeads();
    renderPagination();
  }, "Đang tải leads...");
}

// Init page
document.addEventListener("DOMContentLoaded", async () => {
  reloadSession();
  updateSessionUI();
  syncInputsFromSession();

  // Init worker URL from session config (same as other pages)
  if (window.WORKER_URL) {
    WorkerAPI.init(window.WORKER_URL);
  } else if (session.workerUrl) {
    WorkerAPI.init(session.workerUrl);
  }

  byId("btn-login")?.addEventListener("click", login);
  byId("btn-logout")?.addEventListener("click", () => {
    resetSession();
  });

  // Auto load if already logged in
  if (session.token) {
    const urlParams = Pagination.getParamsFromURL();
    await loadLeads(urlParams.page);
  }
});

