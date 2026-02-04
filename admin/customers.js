// Use common utilities from common.js
// DEFAULT_API_URL, sessionDefaults, and session are already declared in common.js
// Just use them directly (they're in global scope) or reference via window.CommonUtils
// No need to redeclare - they're already available

let customers = [];
let currentPage = 1;
let totalPages = 0;
let totalCustomers = 0;
const itemsPerPage = 50;

// Override resetSession to include page-specific cleanup
function resetSession() {
  // Call the original resetSession from common.js
  if (window._originalResetSession) {
    window._originalResetSession();
  }
  // Page-specific cleanup
  customers = [];
  renderCustomers();
}
// Override window.resetSession with our version
window.resetSession = resetSession;

// apiCall is now from common.js

async function login() {
  session.apiUrl = DEFAULT_API_URL;
  session.apiKey = byId("api_key").value.trim();
  session.email = byId("email").value.trim();
  const password = byId("password").value;

  if (!session.apiUrl || !session.apiKey || !session.email || !password) {
    alert("Vui lòng nhập đủ API URL, API KEY, email, password");
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
  await loadCustomers(urlParams.page);
}

function renderCustomers() {
  const tbody = byId("customers-table").querySelector("tbody");
  if (!session.token) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">Đăng nhập để tải dữ liệu...</td></tr>`;
    return;
  }
  if (!customers.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">Chưa có khách hàng</td></tr>`;
    return;
  }

  tbody.innerHTML = customers.map(c => {
    const createdAt = c.created_at ? formatDate(c.created_at) : "";
    
    return `
    <tr data-customer-id="${c.id}">
      <td>${c.id || ""}</td>
      <td>${c.name || ""}</td>
      <td>${c.phone || ""}</td>
      <td>${c.email || ""}</td>
      <td>${createdAt}</td>
    </tr>
    `;
  }).join("");
}

function formatDate(date) {
  if (!date) return "";
  
  try {
    // Handle Date objects
    if (date instanceof Date) {
      return date.toLocaleString("vi-VN");
    }
    
    // Handle string dates
    const d = new Date(date);
    if (isNaN(d.getTime())) return String(date);
    
    return d.toLocaleString("vi-VN");
  } catch (e) {
    return String(date);
  }
}

async function loadCustomers(page) {
  // Only read from URL when caller doesn't explicitly pass a page
  if (page == null) {
    const urlParams = Pagination.getParamsFromURL();
    page = urlParams.page;
  }
  
  currentPage = page;
  
  return apiCallWithLoading(async () => {
    // ✅ Step 1: Check frontend cache first (localStorage)
    const cacheKey = CacheManager.key("customers", "list", page, itemsPerPage);
    const cached = CacheManager.get(cacheKey);
    
    if (cached) {
      console.log("📦 Using cached customers data (localStorage)");
      customers = cached.items || [];
      
      totalCustomers = cached.total || 0;
      totalPages = cached.totalPages || 0;
      currentPage = cached.page || 1;
      
      renderCustomers();
      renderPagination();
      Pagination.updateURL(currentPage, itemsPerPage);
      return;
    }
    
    // ✅ Step 2: Try Cloudflare Worker first (fast, edge network)
    let result = null;
    
    if (WorkerAPI && WorkerAPI.isConfigured()) {
      try {
        console.log("🚀 Trying Cloudflare Worker for customers.list...");
        result = await WorkerAPI.customersList({
          page: page,
          limit: itemsPerPage
        });
        
        if (result) {
          console.log("✅ Worker cache HIT! Loaded from Cloudflare KV");
        } else {
          console.log("⚠️ Worker cache MISS, falling back to GAS");
        }
      } catch (error) {
        console.error("⚠️ Worker error:", error);
        console.log("Falling back to GAS...");
      }
    }
    
    // ✅ Step 3: Fallback to GAS if Worker fails or cache miss
    if (!result) {
      console.log("📡 Fetching from GAS /exec endpoint...");
      result = await apiCall("customers.list", {
        page: page,
        limit: itemsPerPage
      });
    }
    
    customers = result.items || [];
    totalCustomers = result.total || 0;
    totalPages = result.totalPages || 0;
    currentPage = result.page || 1;
    
    // Save to frontend cache
    CacheManager.set(cacheKey, result);
    
    renderCustomers();
    renderPagination();
    
    // Update URL
    Pagination.updateURL(currentPage, itemsPerPage);
  }, "Đang tải khách hàng...");
}

function renderPagination() {
  Pagination.render(
    "customers-pagination",
    currentPage,
    totalPages,
    totalCustomers,
    loadCustomers,
    "khách hàng"
  );
}

byId("btn-login").addEventListener("click", async () => {
  const btn = byId("btn-login");
  Loading.button(btn, true);
  try {
    await login();
  } catch (err) {
    alert(err.message);
  } finally {
    Loading.button(btn, false);
  }
});

byId("btn-logout").addEventListener("click", () => {
  resetSession();
});

// Initialize WorkerAPI if configured
if (window.WorkerAPI && window.CommonUtils && window.CommonUtils.WORKER_URL) {
  WorkerAPI.init(window.CommonUtils.WORKER_URL);
  console.log("✅ WorkerAPI initialized for READ operations");
} else if (window.WorkerAPI) {
  console.log("ℹ️ WorkerAPI available but WORKER_URL not configured. Using GAS only.");
}

syncInputsFromSession();
applyQueryParams_();
updateSessionUI();
if (session.token) {
  const urlParams = Pagination.getParamsFromURL();
  loadCustomers(urlParams.page).catch(err => {
    alert(err.message);
    resetSession();
  });
}
