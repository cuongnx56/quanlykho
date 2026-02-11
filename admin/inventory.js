// Use common utilities from common.js
// DEFAULT_API_URL, sessionDefaults, and session are already declared in common.js
// Just use them directly (they're in global scope) or reference via window.CommonUtils
// No need to redeclare - they're already available

let summary = [];
let movements = [];
let currentPage = 1;
let totalPages = 0;
let totalMovements = 0;
const itemsPerPage = 20; // ✅ Match backend limit (max 20)

// Summary pagination variables
let currentSummaryPage = 1;
let totalSummaryPages = 0;
let totalSummaryItems = 0;
const summaryItemsPerPage = 20; // ✅ Match backend limit (max 20)

// Product IDs index cache for search
let productIdsIndex = [];
let productSearchInitialized = false;

// Override resetSession to include page-specific cleanup
function resetSession() {
  // Call the original resetSession from common.js
  if (window._originalResetSession) {
    window._originalResetSession();
  }
  // Page-specific cleanup
  summary = [];
  movements = [];
  currentSummaryPage = 1;
  totalSummaryPages = 0;
  totalSummaryItems = 0;
  productIdsIndex = [];
  productSearchInitialized = false;
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
  
  // Show loading state for movements table
  const movementsTbody = byId("movements-table")?.querySelector("tbody");
  if (movementsTbody) {
    movementsTbody.innerHTML = `<tr><td colspan="7" class="muted" style="text-align: center;">⏳ Đang tải dữ liệu...</td></tr>`;
  }
  
  // Show loading state for summary table
  const summaryTbody = byId("summary-table")?.querySelector("tbody");
  if (summaryTbody) {
    summaryTbody.innerHTML = `<tr><td colspan="3" class="muted" style="text-align: center;">⏳ Đang tải dữ liệu...</td></tr>`;
  }
  
  return apiCallWithLoading(async () => {
    // ✅ Use page parameter for cache key (not currentSummaryPage which might be stale)
    const summaryPage = currentSummaryPage || 1;
    const summaryCacheKey = CacheManager.key("inventory", "summary", summaryPage);
    const cachedSummaryResult = CacheManager.get(summaryCacheKey);
    
    if (cachedSummaryResult) {
      console.log("📦 Using cached inventory summary");
      // Handle both old format (array) and new format (pagination object)
      if (Array.isArray(cachedSummaryResult)) {
        summary = cachedSummaryResult;
        totalSummaryItems = cachedSummaryResult.length;
        totalSummaryPages = 1;
      } else {
        summary = cachedSummaryResult.items || [];
        totalSummaryItems = cachedSummaryResult.total || 0;
        totalSummaryPages = cachedSummaryResult.totalPages || 1;
        currentSummaryPage = cachedSummaryResult.page || 1;
      }
    } else {
      // ✅ Step 1: Try Cloudflare Worker first (use products API since summary is list products)
      let productsResult = null;
      
      if (WorkerAPI && WorkerAPI.isConfigured()) {
        try {
          console.log("🚀 Trying Cloudflare Worker for inventory.summary (using products API)...");
          productsResult = await WorkerAPI.productsList({
            page: summaryPage,
            limit: summaryItemsPerPage
          });
          
          if (productsResult) {
            console.log("✅ Worker cache HIT! Loaded from KV");
          } else {
            console.log("⚠️ Worker cache MISS, falling back to GAS");
          }
        } catch (error) {
          console.error("⚠️ Worker error:", error);
          console.log("Falling back to GAS...");
        }
      }
      
      // ✅ Step 2: Fallback to GAS if Worker fails or cache miss
      if (!productsResult) {
        console.log("📡 Fetching from GAS /exec endpoint...");
        productsResult = await apiCall("inventory.summary", {
          page: summaryPage,
          limit: summaryItemsPerPage
        });
      }
      
      // Map products to summary format (id, title, amount_in_stock, price)
      let summaryResult;
      if (Array.isArray(productsResult)) {
        summary = productsResult.map(p => ({
          id: p.id || "",
          title: p.title || p.name || "",
          amount_in_stock: p.amount_in_stock || 0,
          price: p.price || 0
        }));
        totalSummaryItems = summary.length;
        totalSummaryPages = 1;
        summaryResult = summary;
      } else {
        summary = (productsResult.items || []).map(p => ({
          id: p.id || "",
          title: p.title || p.name || "",
          amount_in_stock: p.amount_in_stock || 0,
          price: p.price || 0
        }));
        totalSummaryItems = productsResult.total || 0;
        totalSummaryPages = productsResult.totalPages || 1;
        currentSummaryPage = productsResult.page || 1;
        summaryResult = {
          items: summary,
          total: totalSummaryItems,
          page: currentSummaryPage,
          limit: productsResult.limit || summaryItemsPerPage,
          totalPages: totalSummaryPages
        };
      }
      
      CacheManager.set(summaryCacheKey, summaryResult);
    }
    
    // Check cache for movements
    const movementsCacheKey = CacheManager.key("inventory", "movements", page, itemsPerPage);
    let movementsResult = CacheManager.get(movementsCacheKey);
    
    if (movementsResult) {
      console.log("📦 Using cached inventory movements (localStorage)");
      movements = movementsResult.items || [];
      
      // ✅ Backend already sorts by created_at desc, no need to sort again
      
      totalMovements = movementsResult.total || 0;
      totalPages = movementsResult.totalPages || 0;
      currentPage = movementsResult.page || 1;
      
      renderSummary();
      renderSummaryPagination();
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
      
      // ✅ Backend already sorts by created_at desc, no need to sort again
      movements = movementsResult.items || [];
      totalMovements = movementsResult.total || 0;
      totalPages = movementsResult.totalPages || 0;
      currentPage = movementsResult.page || 1;
      
      // Save to frontend cache
      CacheManager.set(movementsCacheKey, movementsResult);
    }
    
    renderSummary();
    renderSummaryPagination();
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

/**
 * Load summary page (for pagination)
 */
async function loadSummaryPage(page) {
  currentSummaryPage = page || 1;
  
  // Show loading state for summary table
  const summaryTbody = byId("summary-table")?.querySelector("tbody");
  if (summaryTbody) {
    summaryTbody.innerHTML = `<tr><td colspan="3" class="muted" style="text-align: center;">⏳ Đang tải dữ liệu...</td></tr>`;
  }
  
  return apiCallWithLoading(async () => {
    // ✅ Use page parameter for cache key (not currentSummaryPage which might be stale)
    const summaryPage = currentSummaryPage;
    const summaryCacheKey = CacheManager.key("inventory", "summary", summaryPage);
    CacheManager.invalidate(summaryCacheKey);
    
    // ✅ Step 1: Try Cloudflare Worker first (use products API since summary is list products)
    let productsResult = null;
    
    if (WorkerAPI && WorkerAPI.isConfigured()) {
      try {
        console.log("🚀 Trying Cloudflare Worker for inventory.summary (using products API)...");
        productsResult = await WorkerAPI.productsList({
          page: summaryPage,
          limit: summaryItemsPerPage
        });
        
        if (productsResult) {
          console.log("✅ Worker cache HIT! Loaded from KV");
        } else {
          console.log("⚠️ Worker cache MISS, falling back to GAS");
        }
      } catch (error) {
        console.error("⚠️ Worker error:", error);
        console.log("Falling back to GAS...");
      }
    }
    
    // ✅ Step 2: Fallback to GAS if Worker fails or cache miss
    if (!productsResult) {
      console.log("📡 Fetching from GAS /exec endpoint...");
      productsResult = await apiCall("inventory.summary", {
        page: summaryPage,
        limit: summaryItemsPerPage
      });
    }
    
    // Map products to summary format (id, title, amount_in_stock, price)
    let summaryResult;
    if (Array.isArray(productsResult)) {
      summary = productsResult.map(p => ({
        id: p.id || "",
        title: p.title || p.name || "",
        amount_in_stock: p.amount_in_stock || 0,
        price: p.price || 0
      }));
      totalSummaryItems = summary.length;
      totalSummaryPages = 1;
      summaryResult = summary;
    } else {
      summary = (productsResult.items || []).map(p => ({
        id: p.id || "",
        title: p.title || p.name || "",
        amount_in_stock: p.amount_in_stock || 0,
        price: p.price || 0
      }));
      totalSummaryItems = productsResult.total || 0;
      totalSummaryPages = productsResult.totalPages || 1;
      currentSummaryPage = productsResult.page || 1;
      summaryResult = {
        items: summary,
        total: totalSummaryItems,
        page: currentSummaryPage,
        limit: productsResult.limit || summaryItemsPerPage,
        totalPages: totalSummaryPages
      };
    }
    
    // Save to cache
    CacheManager.set(summaryCacheKey, summaryResult);
    
    renderSummary();
    renderSummaryPagination();
    renderProductOptions();
  }, "Đang tải tồn kho...");
}

function renderSummaryPagination() {
  // Only show pagination if there's more than 1 page
  if (totalSummaryPages <= 1) {
    const paginationEl = byId("summary-pagination");
    if (paginationEl) paginationEl.innerHTML = "";
    return;
  }
  
  Pagination.render(
    "summary-pagination",
    currentSummaryPage,
    totalSummaryPages,
    totalSummaryItems,
    loadSummaryPage,
    "sản phẩm"
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

/**
 * Load product IDs index for search
 */
async function loadProductIdsIndex() {
  // Check cache
  const idsCacheKey = CacheManager.key("inventory", "product_ids_index");
  const cachedIds = CacheManager.get(idsCacheKey);
  
  if (cachedIds && Array.isArray(cachedIds) && cachedIds.length > 0) {
    console.log("📦 Using cached product IDs index");
    productIdsIndex = cachedIds;
    return;
  }
  
  try {
    // Load first page to get total, then we can infer IDs index exists
    // Actually, we need to get IDs index from backend
    // For now, extract from summary (already loaded products)
    productIdsIndex = summary.map(item => item.id).filter(id => id);
    
    // Also try to get from products.list if available
    if (productIdsIndex.length === 0) {
      const result = await apiCall("products.list", { page: 1, limit: 20 });
      if (result && result.items) {
        productIdsIndex = result.items.map(item => item.id).filter(id => id);
      } else if (Array.isArray(result)) {
        productIdsIndex = result.map(item => item.id).filter(id => id);
      }
    }
    
    CacheManager.set(idsCacheKey, productIdsIndex);
    console.log(`✅ Loaded ${productIdsIndex.length} product IDs for search`);
  } catch (err) {
    console.error("⚠️ Error loading product IDs index:", err);
    productIdsIndex = summary.map(item => item.id).filter(id => id);
  }
}

/**
 * Search product by ID in cache
 */
function searchProductId(searchTerm) {
  if (!searchTerm || searchTerm.trim() === "") {
    return [];
  }
  
  const term = searchTerm.trim().toLowerCase();
  return productIdsIndex.filter(id => {
    const idStr = String(id || "").toLowerCase();
    return idStr.includes(term);
  });
}

/**
 * Load product detail and fill form
 * Exposed to global scope for onclick handlers
 */
window.loadProductDetailAndFill = async function(productId) {
  if (!productId || productId.trim() === "") {
    return;
  }
  
  const loadingEl = byId("product_loading");
  const searchInput = byId("product_search");
  const dropdown = byId("product_dropdown");
  
  try {
    // Show loading spinner
    if (loadingEl) loadingEl.style.display = "inline-block";
    if (dropdown) dropdown.style.display = "none";
    
    const product = await apiCall("products.get", { id: productId });
    
    if (product) {
      // Fill product_id select (hidden)
      const select = byId("product_id");
      if (select) select.value = product.id;
      
      // Get movement type to determine which price to use
      const movementType = byId("movement_type")?.value || "IN";
      
      // Fill price based on movement type:
      // - IN (nhập kho): import_price > price
      // - OUT (xuất kho): price
      let price = 0;
      if (movementType === "OUT") {
        price = product.price || 0;
      } else {
        // IN or default
        price = product.import_price || product.price || 0;
      }
      
      const unitPriceInput = byId("unit_price");
      if (unitPriceInput) {
        unitPriceInput.value = price;
        unitPriceInput.placeholder = `Giá đề xuất: ${formatPrice(price)}`;
      }
      
      // Update search input with product info
      if (searchInput) {
        searchInput.value = `${product.id} - ${product.title || product.name || ""}`;
      }
      
      console.log("✅ Product loaded:", product);
    }
  } catch (err) {
    console.error("⚠️ Error loading product detail:", err);
    alert(`Không tìm thấy sản phẩm: ${productId}`);
  } finally {
    // Hide loading spinner
    if (loadingEl) loadingEl.style.display = "none";
  }
}

/**
 * Render dropdown items
 */
function renderDropdownItems(items, isSearchMode = false) {
  const dropdown = byId("product_dropdown");
  if (!dropdown) return;
  
  if (!items || items.length === 0) {
    dropdown.innerHTML = `<div style="padding: 8px; color: #666; text-align: center;">Không tìm thấy sản phẩm</div>`;
    dropdown.style.display = "block";
    return;
  }
  
  const itemsHtml = items.map(item => {
    const productId = item.id || item;
    const productTitle = item.title || item.name || "";
    const displayText = productTitle ? `${productId} - ${productTitle}` : productId;
    
    return `
      <div 
        class="dropdown-item" 
        style="padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #f0f0f0;"
        onmouseover="this.style.background='#f5f5f5'"
        onmouseout="this.style.background='white'"
        onclick="selectProductFromDropdown('${productId}')"
      >
        ${displayText}
      </div>
    `;
  }).join("");
  
  dropdown.innerHTML = itemsHtml;
  dropdown.style.display = "block";
}

/**
 * Select product from dropdown
 */
window.selectProductFromDropdown = async function(productId) {
  const searchInput = byId("product_search");
  const dropdown = byId("product_dropdown");
  
  // Close dropdown immediately
  if (dropdown) dropdown.style.display = "none";
  
  // Find product in summary to show title
  const product = summary.find(p => p.id === productId);
  if (product) {
    if (searchInput) searchInput.value = `${productId} - ${product.title || ""}`;
  } else {
    if (searchInput) searchInput.value = productId;
  }
  
  // Load product detail and fill form (with loading spinner)
  await loadProductDetailAndFill(productId);
};

/**
 * Initialize product search dropdown
 */
function initProductSearch() {
  const searchInput = byId("product_search");
  const dropdown = byId("product_dropdown");
  const select = byId("product_id");
  
  if (!searchInput) return;
  
  // Only initialize once
  if (productSearchInitialized) return;
  productSearchInitialized = true;
  
  // Load product IDs index
  loadProductIdsIndex();
  
  let searchTimeout = null;
  let isDropdownOpen = false;
  
  // Show dropdown when input is focused (always show, even if has value)
  searchInput.addEventListener("focus", function() {
    const searchTerm = this.value.trim();
    if (searchTerm === "") {
      // Show summary products when empty
      renderDropdownItems(summary);
      isDropdownOpen = true;
    } else {
      // If has value, show search results
      const matches = searchProductId(searchTerm);
      if (matches.length > 0) {
        const matchItems = matches.map(id => {
          const found = summary.find(p => p.id === id);
          return found || { id: id };
        });
        renderDropdownItems(matchItems, true);
        isDropdownOpen = true;
      } else {
        // Show summary if no matches
        renderDropdownItems(summary);
        isDropdownOpen = true;
      }
    }
  });
  
  // Handle input/search
  searchInput.addEventListener("input", function() {
    const searchTerm = this.value.trim();
    
    if (searchTerm === "") {
      // Show summary products when empty
      renderDropdownItems(summary);
      select.value = "";
      return;
    }
    
    // Debounce search
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      const matches = searchProductId(searchTerm);
      
      if (matches.length > 0) {
        // Convert IDs to objects with id property for rendering
        const matchItems = matches.map(id => {
          // Try to find in summary first
          const found = summary.find(p => p.id === id);
          return found || { id: id };
        });
        renderDropdownItems(matchItems, true);
        isDropdownOpen = true;
      } else {
        renderDropdownItems([]);
        isDropdownOpen = true;
      }
    }, 300);
  });
  
  // Handle Enter key
  searchInput.addEventListener("keydown", async function(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      const searchTerm = this.value.trim();
      if (searchTerm) {
        const matches = searchProductId(searchTerm);
        if (matches.length > 0) {
          await selectProductFromDropdown(matches[0]);
        }
      }
    } else if (e.key === "Escape") {
      dropdown.style.display = "none";
      isDropdownOpen = false;
    }
  });
  
  // Close dropdown when clicking outside
  document.addEventListener("click", function(e) {
    if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = "none";
      isDropdownOpen = false;
    }
  });
  
  // Update price when movement type changes
  const movementTypeSelect = byId("movement_type");
  if (movementTypeSelect) {
    movementTypeSelect.addEventListener("change", async function() {
      const productId = byId("product_id")?.value;
      if (productId) {
        // Reload product detail to update price based on new movement type
        await loadProductDetailAndFill(productId);
      }
    });
  }
}

function renderProductOptions() {
  // Initialize search dropdown
  if (typeof initProductSearch === 'function') {
    initProductSearch();
  }
  
  // Also populate hidden select with summary products (for form submission)
  const select = byId("product_id");
  if (!summary.length) {
    if (select) select.innerHTML = "";
    return;
  }
  
  if (select) {
    select.innerHTML = summary.map(item => `
      <option value="${item.id}">${item.id} - ${item.title || ""}</option>
    `).join("");
  }
  
  // Update product IDs index from summary
  productIdsIndex = summary.map(item => item.id).filter(id => id);
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

    // ✅ Invalidate specific caches (optimized - only invalidate what's needed)
    CacheManager.invalidateOnInventoryChange();
    
    // ✅ Invalidate movements cache for page 1 (where new movement appears)
    const movementsCacheKeyPage1 = CacheManager.key("inventory", "movements", 1, itemsPerPage);
    CacheManager.invalidate(movementsCacheKeyPage1);
    
    // ✅ Invalidate summary cache to reload updated stock
    const summaryCacheKey = CacheManager.key("inventory", "summary", currentSummaryPage);
    CacheManager.invalidate(summaryCacheKey);
    
    // ✅ Invalidate product IDs index cache
    const idsCacheKey = CacheManager.key("inventory", "product_ids_index");
    CacheManager.invalidate(idsCacheKey);

    byId("qty").value = "";
    byId("unit_price").value = "";
    byId("note").value = "";
    
    // ✅ Add new movement to list instead of reloading
    if (currentPage === 1 && movements.length < itemsPerPage) {
      addMovementToList(newMovement);
      totalMovements++;
      totalPages = Math.ceil(totalMovements / itemsPerPage);
      renderPagination();
      
      // ✅ Reload summary to update stock (reload current summary page)
      await loadSummaryPage(currentSummaryPage);
    } else {
      const urlParams = Pagination.getParamsFromURL();
      await loadData(urlParams.page);
      // ✅ Also reload summary to update stock
      await loadSummaryPage(currentSummaryPage);
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
