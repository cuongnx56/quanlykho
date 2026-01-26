// Use common utilities from common.js
// DEFAULT_API_URL, sessionDefaults, and session are already declared in common.js
// Just use them directly (they're in global scope) or reference via window.CommonUtils
// No need to redeclare - they're already available

let summary = [];
let movements = [];
let currentPage = 1;
let totalPages = 0;
let totalMovements = 0;
const itemsPerPage = 50;

// Override resetSession to include page-specific cleanup
function resetSession() {
  // Call the original resetSession from common.js
  if (window._originalResetSession) {
    window._originalResetSession();
  }
  // Page-specific cleanup
  summary = [];
  movements = [];
  renderSummary();
  renderMovements();
}
// Override window.resetSession with our version
window.resetSession = resetSession;

// apiCall is now from common.js

async function login() {
  // session is from common.js global scope
  session.apiUrl = window.CommonUtils.DEFAULT_API_URL;
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
  await loadData(urlParams.page);
}

async function loadData(page = 1) {
  // Get page from URL if available
  if (page === 1) {
    const urlParams = Pagination.getParamsFromURL();
    page = urlParams.page;
  }
  
  currentPage = page;
  
  return apiCallWithLoading(async () => {
    // Check cache for summary
    const summaryCacheKey = CacheManager.key("inventory", "summary");
    const cachedSummary = CacheManager.get(summaryCacheKey);
    
    if (cachedSummary) {
      console.log("📦 Using cached inventory summary");
      summary = cachedSummary;
    } else {
      summary = await apiCall("inventory.summary");
      CacheManager.set(summaryCacheKey, summary);
    }
    
    // Check cache for movements
    const movementsCacheKey = CacheManager.key("inventory", "movements", page, itemsPerPage);
    const cachedMovements = CacheManager.get(movementsCacheKey);
    
    if (cachedMovements) {
      console.log("📦 Using cached inventory movements");
      movements = cachedMovements.items || [];
      totalMovements = cachedMovements.total || 0;
      totalPages = cachedMovements.totalPages || 0;
      currentPage = cachedMovements.page || 1;
    } else {
      const movementsResult = await apiCall("inventory.list", {
        page: page,
        limit: itemsPerPage
      });
      
      movements = movementsResult.items || [];
      totalMovements = movementsResult.total || 0;
      totalPages = movementsResult.totalPages || 0;
      currentPage = movementsResult.page || 1;
      
      CacheManager.set(movementsCacheKey, movementsResult);
    }
    
    renderSummary();
    renderMovements();
    renderProductOptions();
    renderPagination();
    
    // Update URL
    Pagination.updateURL(currentPage, itemsPerPage);
  }, "Đang tải dữ liệu kho...");
}

function renderPagination() {
  Pagination.render(
    "movements-pagination",
    currentPage,
    totalPages,
    totalMovements,
    loadData,
    "phiếu"
  );
}

function renderSummary() {
  const tbody = byId("summary-table").querySelector("tbody");
  if (!session.token) {
    tbody.innerHTML = `<tr><td colspan="3" class="muted">Đăng nhập để tải dữ liệu...</td></tr>`;
    return;
  }
  if (!summary.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="muted">Chưa có sản phẩm</td></tr>`;
    return;
  }
  tbody.innerHTML = summary.map(item => `
    <tr>
      <td>${item.id || ""}</td>
      <td>${item.title || ""}</td>
      <td>${item.amount_in_stock || ""}</td>
    </tr>
  `).join("");
}

function renderMovements() {
  const tbody = byId("movements-table").querySelector("tbody");
  if (!session.token) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">Đăng nhập để tải dữ liệu...</td></tr>`;
    return;
  }
  if (!movements.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">Chưa có lịch sử</td></tr>`;
    return;
  }
  tbody.innerHTML = movements.map(item => `
    <tr>
      <td>${item.id || ""}</td>
      <td>${item.product_id || ""}</td>
      <td>${item.type || ""}</td>
      <td class="text-center">${item.qty || ""}</td>
      <td class="text-center">${formatPrice(item.unit_price || 0)}</td>
      <td>${item.note || ""}</td>
      <td>${item.created_at || ""}</td>
    </tr>
  `).join("");
}

function formatPrice(price) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND'
  }).format(price);
}

function renderProductOptions() {
  const select = byId("product_id");
  if (!summary.length) {
    select.innerHTML = `<option value="">Chưa có sản phẩm</option>`;
    return;
  }
  select.innerHTML = summary.map(item => `
    <option value="${item.id}" data-price="${item.price || 0}">${item.id} - ${item.title}</option>
  `).join("");
  
  // Auto-fill giá đề xuất khi chọn sản phẩm
  select.addEventListener("change", function() {
    const selectedOption = select.options[select.selectedIndex];
    const price = selectedOption.getAttribute("data-price") || 0;
    byId("unit_price").value = price;
    byId("unit_price").placeholder = `Giá đề xuất: ${formatPrice(price)}`;
  });
  
  // Trigger change để fill giá cho sản phẩm đầu tiên
  if (select.options.length > 0) {
    const firstOption = select.options[0];
    const firstPrice = firstOption.getAttribute("data-price") || 0;
    byId("unit_price").value = firstPrice;
    byId("unit_price").placeholder = `Giá đề xuất: ${formatPrice(firstPrice)}`;
  }
}

async function createMovement() {
  if (!session.token) {
    alert("Vui lòng đăng nhập trước");
    return;
  }
  const productId = byId("product_id").value;
  const type = byId("movement_type").value;
  const qty = byId("qty").value;
  const unitPrice = byId("unit_price").value;
  const note = byId("note").value.trim();

  if (!productId || !qty) {
    alert("Vui lòng chọn sản phẩm và nhập số lượng");
    return;
  }

  await apiCall("inventory.create", {
    token: session.token,
    product_id: productId,
    type,
    qty,
    unit_price: unitPrice || 0,
    note
  });

  // ✅ Invalidate cache after create
  CacheManager.invalidateOnInventoryChange();

  byId("qty").value = "";
  byId("unit_price").value = "";
  byId("note").value = "";
  const urlParams = Pagination.getParamsFromURL();
  await loadData(urlParams.page);
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

byId("btn-create").addEventListener("click", async () => {
  const btn = byId("btn-create");
  Loading.button(btn, true);
  try {
    await createMovement();
  } catch (err) {
    alert(err.message);
  } finally {
    Loading.button(btn, false);
  }
});

syncInputsFromSession();
applyQueryParams_();
updateSessionUI();
if (session.token) {
  const urlParams = Pagination.getParamsFromURL();
  loadData(urlParams.page).catch(err => {
    alert(err.message);
    resetSession();
  });
}
