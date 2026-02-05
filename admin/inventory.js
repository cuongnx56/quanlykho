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

async function loadData(page) {
  // Only read from URL when caller doesn't explicitly pass a page
  if (page == null) {
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
    let movementsResult = CacheManager.get(movementsCacheKey);
    
    if (movementsResult) {
      console.log("📦 Using cached inventory movements (localStorage)");
      movements = movementsResult.items || [];
      
      // ✅ Sort movements by created_at desc (newest first) - ensure correct order
      movements.sort(function(a, b) {
        var dateA = a.created_at || "";
        var dateB = b.created_at || "";
        // Handle Date objects
        if (dateA instanceof Date) dateA = dateA.toISOString();
        if (dateB instanceof Date) dateB = dateB.toISOString();
        // Compare as strings
        return dateB.localeCompare(dateA);
      });
      
      totalMovements = movementsResult.total || 0;
      totalPages = movementsResult.totalPages || 0;
      currentPage = movementsResult.page || 1;
      
      renderSummary();
      renderMovements();
      renderProductOptions();
      renderPagination();
      Pagination.updateURL(currentPage, itemsPerPage);
      return;
    } else {
      // ✅ Step 1: Try Cloudflare Worker first (fast, edge network)
      if (WorkerAPI && WorkerAPI.isConfigured()) {
        try {
          console.log("🚀 Trying Cloudflare Worker for inventory.list...");
          movementsResult = await WorkerAPI.inventoryList({
            page: page,
            limit: itemsPerPage
          });
          
          if (movementsResult) {
            console.log("✅ Worker cache HIT! Loaded from Cloudflare KV");
          } else {
            console.log("⚠️ Worker cache MISS, falling back to GAS");
          }
        } catch (error) {
          console.error("⚠️ Worker error:", error);
          console.log("Falling back to GAS...");
        }
      }
      
      // ✅ Step 2: Fallback to GAS if Worker fails or cache miss
      if (!movementsResult) {
        console.log("📡 Fetching from GAS /exec endpoint...");
        movementsResult = await apiCall("inventory.list", {
          page: page,
          limit: itemsPerPage
        });
      }
      
      // ✅ Sort movements by created_at desc (newest first) - ensure correct order
      if (movementsResult && movementsResult.items && Array.isArray(movementsResult.items)) {
        movementsResult.items.sort(function(a, b) {
          var dateA = a.created_at || "";
          var dateB = b.created_at || "";
          // Handle Date objects
          if (dateA instanceof Date) dateA = dateA.toISOString();
          if (dateB instanceof Date) dateB = dateB.toISOString();
          // Compare as strings
          return dateB.localeCompare(dateA);
        });
      }
      
      movements = movementsResult.items || [];
      totalMovements = movementsResult.total || 0;
      totalPages = movementsResult.totalPages || 0;
      currentPage = movementsResult.page || 1;
      
      // Save to frontend cache
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
    <tr data-movement-id="${item.id}">
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

function addMovementToList(movement) {
  // Add to movements array (at the beginning if on page 1)
  if (currentPage === 1) {
    movements.unshift(movement);
    // If exceeds page limit, remove last item
    if (movements.length > itemsPerPage) {
      movements.pop();
    }
  }
  
  // Update DOM
  const tbody = byId("movements-table").querySelector("tbody");
  if (tbody && movements.length > 0) {
    // Remove "no movements" message if exists
    if (tbody.querySelector(".muted")) {
      tbody.innerHTML = "";
    }
    
    // Add new row at the top
    const newRow = document.createElement("tr");
    newRow.setAttribute("data-movement-id", movement.id);
    newRow.innerHTML = `
      <td>${movement.id || ""}</td>
      <td>${movement.product_id || ""}</td>
      <td>${movement.type || ""}</td>
      <td class="text-center">${movement.qty || ""}</td>
      <td class="text-center">${formatPrice(movement.unit_price || 0)}</td>
      <td>${movement.note || ""}</td>
      <td>${movement.created_at || ""}</td>
    `;
    tbody.insertBefore(newRow, tbody.firstChild);
  }
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
  // ✅ Reload session from localStorage to ensure token is up to date
  reloadSession();
  
  // Clear previous validation errors
  Validator.clearErrors();
  
  if (!session.token) {
    alert("Vui lòng đăng nhập trước");
    return;
  }
  
  const productId = byId("product_id").value;
  const type = byId("movement_type").value;
  const qty = byId("qty").value;
  const unitPrice = byId("unit_price").value;
  const note = byId("note").value.trim();
  
  // Define validation rules (sử dụng constants mặc định)
  const rules = {
    product_id: { required: true },
    movement_type: { required: true },
    qty: Validator.helpers.requiredPositiveNumber(999999),
    unit_price: {
      required: false,
      type: 'number',
      nonNegative: true,
      max: 999999999
    },
    note: Validator.helpers.textarea(false)  // Max 100 ký tự (từ constants)
  };
  
  // Validate form
  const data = {
    product_id: productId,
    movement_type: type,
    qty: qty,
    unit_price: unitPrice,
    note: note
  };
  
  const result = Validator.validateForm(data, rules);
  if (!result.valid) {
    // Map field names to actual input IDs
    const fieldMap = {
      'product_id': 'product_id',
      'movement_type': 'movement_type',
      'qty': 'qty',
      'unit_price': 'unit_price',
      'note': 'note'
    };
    
    const mappedErrors = {};
    for (const field in result.errors) {
      if (fieldMap[field]) {
        mappedErrors[fieldMap[field]] = result.errors[field];
      }
    }
    
    Validator.showErrors(mappedErrors);
    return;
  }

  try {
    const newMovement = await apiCall("inventory.create", {
      token: session.token,
      product_id: productId,
      type,
      qty,
      unit_price: unitPrice || 0,
      note
    });

    // ✅ Clear ALL cache after write action (create movement)
    CacheManager.clearAllCache();
    
    // ✅ Also invalidate specific caches to be thorough
    CacheManager.invalidateOnInventoryChange();

    byId("qty").value = "";
    byId("unit_price").value = "";
    byId("note").value = "";
    
    // ✅ Add new movement to list instead of reloading
    if (currentPage === 1 && movements.length < itemsPerPage) {
      addMovementToList(newMovement);
      totalMovements++;
      totalPages = Math.ceil(totalMovements / itemsPerPage);
      renderPagination();
      // Reload summary to update stock (summary needs to be reloaded)
      await loadData(currentPage);
    } else {
      const urlParams = Pagination.getParamsFromURL();
      await loadData(urlParams.page);
    }
  } catch (err) {
    // ✅ Handle token expiration - prompt user to login again
    if (err.message && (err.message.includes("Token expired") || err.message.includes("Unauthorized") || err.message.includes("hết hạn"))) {
      alert("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
      resetSession();
      window.location.reload();
    } else {
      alert(`❌ Lỗi: ${err.message}`);
    }
  }
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
  loadData(urlParams.page).catch(err => {
    alert(err.message);
    resetSession();
  });
}
