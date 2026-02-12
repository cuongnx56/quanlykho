// =============================================================================
// inventory.js - Optimized
//
// Optimizations vs original:
//  1.  XSS: escapeHtml/escapeAttr on ALL user content in innerHTML
//  2.  handleError() centralized – replaces 3 copy-paste try/catch blocks
//  3.  fetchSummaryFromBackend() extracted – loadData & loadSummaryPage
//      shared the exact same 40-line fetch block (pure duplication)
//  4.  mapToSummaryItems() extracted – same .map() called 4 times
//  5.  formatPrice removed – uses common.js memoized version
//  6.  CacheInvalidator – granular, no shotgun cache clears
//  7.  AbortController replaces productSearchInitialized boolean flag
//  8.  renderDropdownItems: event delegation, no inline onclick/onmouseover
//  9.  summaryMap: Map for O(1) product lookup in dropdown
// 10.  loadData: summary + movements in parallel (Promise.all)
// 11.  applyQueryParams_ → applyQueryParams
// 12.  loadProductDetailAndFill: 4-tier cache:
//        Tier 1 – in-memory productDetailCache Map        (~0ms)
//        Tier 2 – localStorage per-ID key                 (~1ms)
//        Tier 3 – WorkerAPI.call("/products/{id}") → KV   (~30ms)
//        Tier 4 – GAS apiCall("products.get")             (~800ms)
//      Movement-type change re-uses cached product → zero extra network call.
// =============================================================================

// ─── Page state ──────────────────────────────────────────────────────────────

let summary   = [];
let movements = [];

let currentPage        = 1;
let totalPages         = 0;
let totalMovements     = 0;

let currentSummaryPage = 1;
let totalSummaryPages  = 0;
let totalSummaryItems  = 0;

const itemsPerPage        = PAGINATION.DEFAULT_LIMIT;
const summaryItemsPerPage = PAGINATION.DEFAULT_LIMIT;

// O(1) product lookup: id → { id, title, amount_in_stock, price, import_price }
let summaryMap = new Map();

// Product IDs array for search filter
let productIdsIndex = [];

// In-memory cache for full product detail objects (keyed by product id).
// Populated by fetchProductDetail so movement-type changes don't need
// a second network trip.
const productDetailCache = new Map();

// ─── Session override ─────────────────────────────────────────────────────────

function resetSession() {
  if (window._originalResetSession) window._originalResetSession();
  summary            = [];
  movements          = [];
  summaryMap         = new Map();
  productIdsIndex    = [];
  productDetailCache.clear();
  currentSummaryPage = 1;
  totalSummaryPages  = 0;
  totalSummaryItems  = 0;
  renderSummary();
  renderMovements();
}
window.resetSession = resetSession;

// ─── Error handler ────────────────────────────────────────────────────────────

function handleError(err, context = "") {
  console.error(`❌ Error in ${context}:`, err);
  const msg       = err?.message ?? String(err);
  const isAuthErr = window.isAuthError
    ? isAuthError(msg)
    : ["Token expired", "Unauthorized", "hết hạn"].some(s => msg.includes(s));
  if (isAuthErr) {
    alert("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    resetSession();
    window.location.reload();
    return;
  }
  alert(`❌ Lỗi: ${msg}`);
}

// ─── Cache invalidation ───────────────────────────────────────────────────────

const CacheInvalidator = {
  inventory() {
    CacheManager.clear("^inventory_");
    console.log("🗑️ Cache cleared: inventory");
  },
  products() {
    CacheManager.clear("^products_");
    CacheManager.clear("^product_detail_");
    console.log("🗑️ Cache cleared: products + product details");
  },
  afterCreateMovement() {
    this.inventory();
    this.products();
    productDetailCache.clear();
  },
};

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function login() {
  session.apiUrl = window.CommonUtils.DEFAULT_API_URL;
  session.apiKey = byId("api_key").value.trim();
  session.email  = byId("email").value.trim();
  const password = byId("password").value;

  if (!session.apiKey || !session.email || !password) {
    alert("Vui lòng nhập đủ API KEY, email, password");
    return;
  }

  const data = await apiCall("auth.login", { email: session.email, password });
  session.token = data.token;
  session.email = data.email;
  session.role  = data.role;
  window.AuthSession.save(session);
  updateSessionUI();

  const { page } = Pagination.getParamsFromURL();
  await loadData(page);
}

// ─── Summary helpers ──────────────────────────────────────────────────────────

function mapToSummaryItems(raw) {
  const items = Array.isArray(raw) ? raw : (raw.items || []);
  return items.map(p => ({
    id              : String(p.id   || "").trim(),
    title           : p.title       || p.name   || "",
    amount_in_stock : Number(p.amount_in_stock)  || 0,
    price           : Number(p.price)            || 0,
    import_price    : Number(p.import_price)     || 0,
  }));
}

function rebuildSummaryIndex() {
  summaryMap      = new Map();
  productIdsIndex = [];
  for (const item of summary) {
    if (item.id) {
      summaryMap.set(item.id, item);
      productIdsIndex.push(item.id);
    }
  }
}

// ─── Backend fetch helpers ────────────────────────────────────────────────────

async function fetchSummaryFromBackend(page) {
  if (WorkerAPI?.isConfigured()) {
    try {
      console.log("🚀 Summary: trying Worker (products API)...");
      const result = await WorkerAPI.productsList({ page, limit: summaryItemsPerPage });
      if (result) { console.log("✅ Summary: Worker hit"); return result; }
      console.log("⚠️ Summary: Worker miss → GAS");
    } catch (e) {
      console.warn("⚠️ Summary: Worker error →", e.message);
    }
  }
  console.log("📡 Summary: GAS...");
  return apiCall("inventory.summary", { page, limit: summaryItemsPerPage });
}

async function fetchMovementsFromBackend(page) {
  if (WorkerAPI?.isConfigured()) {
    try {
      console.log("🚀 Movements: trying Worker...");
      const result = await WorkerAPI.inventoryList({ page, limit: itemsPerPage });
      if (result) { console.log("✅ Movements: Worker hit"); return result; }
      console.log("⚠️ Movements: Worker miss → GAS");
    } catch (e) {
      console.warn("⚠️ Movements: Worker error →", e.message);
    }
  }
  console.log("📡 Movements: GAS...");
  return apiCall("inventory.list", { page, limit: itemsPerPage });
}

/**
 * fetchProductDetail – 4-tier lookup for a single product object.
 *
 * Tier 1 | in-memory productDetailCache Map           | ~0ms
 * Tier 2 | localStorage CacheManager per-ID key       | ~1ms
 * Tier 3 | WorkerAPI.call("/products/{id}") → KV      | ~30ms
 * Tier 4 | apiCall("products.get", { id })  → GAS     | ~800ms
 *
 * Result stored in Tier 1 + 2 so movement-type toggle costs nothing.
 *
 * @param  {string} productId
 * @returns {Promise<Object>} full product object
 */
async function fetchProductDetail(productId) {
  const id = String(productId).trim();

  // ── Tier 1: in-memory ──────────────────────────────────────────────────
  if (productDetailCache.has(id)) {
    console.log(`📦 Product [${id}]: memory hit`);
    return productDetailCache.get(id);
  }

  // ── Tier 2: localStorage ───────────────────────────────────────────────
  const lsKey    = CacheManager.key("product", "detail", id);
  const lsCached = CacheManager.get(lsKey);
  if (lsCached) {
    console.log(`📦 Product [${id}]: localStorage hit`);
    productDetailCache.set(id, lsCached);
    return lsCached;
  }

  // ── Tier 3: Worker GET /products/{id} ──────────────────────────────────
  // Worker reads KV key: {sheetId}_product_detail_{id}
  // Same key written by Cache.saveProductDetails() on every GAS write.
  if (WorkerAPI?.isConfigured()) {
    try {
      console.log(`🚀 Product [${id}]: Worker /products/${id}...`);
      const result = await WorkerAPI.call(`/products/${id}`);
      if (result) {
        console.log(`✅ Product [${id}]: Worker hit`);
        productDetailCache.set(id, result);
        CacheManager.set(lsKey, result);
        return result;
      }
      console.log(`⚠️ Product [${id}]: Worker miss → GAS`);
    } catch (e) {
      console.warn(`⚠️ Product [${id}]: Worker error →`, e.message);
    }
  }

  // ── Tier 4: GAS products.get ───────────────────────────────────────────
  console.log(`📡 Product [${id}]: GAS products.get...`);
  const product = await apiCall("products.get", { id });
  productDetailCache.set(id, product);
  CacheManager.set(lsKey, product);
  return product;
}

// ─── Load data ────────────────────────────────────────────────────────────────

async function loadData(page) {
  if (page == null) page = Pagination.getParamsFromURL().page;
  currentPage = page;

  _showTableLoading("movements-table", 7);
  _showTableLoading("summary-table",   3);

  return apiCallWithLoading(async () => {
    const summaryCacheKey   = CacheManager.key("inventory", "summary",   currentSummaryPage, summaryItemsPerPage);
    const movementsCacheKey = CacheManager.key("inventory", "movements", page, itemsPerPage);

    const cachedSummary   = CacheManager.get(summaryCacheKey);
    const cachedMovements = CacheManager.get(movementsCacheKey);

    const summaryPromise = cachedSummary
      ? Promise.resolve(cachedSummary)
      : fetchSummaryFromBackend(currentSummaryPage).then(r => {
          CacheManager.set(summaryCacheKey, r); return r;
        });

    const movementsPromise = cachedMovements
      ? Promise.resolve(cachedMovements)
      : fetchMovementsFromBackend(page).then(r => {
          CacheManager.set(movementsCacheKey, r); return r;
        });

    // ✅ Parallel fetch
    const [summaryResult, movementsResult] = await Promise.all([
      summaryPromise,
      movementsPromise,
    ]);

    _applySummaryResult(summaryResult);
    _applyMovementsResult(movementsResult);

    renderAll();
    Pagination.updateURL(currentPage, itemsPerPage);
  }, "Đang tải dữ liệu kho...");
}

async function loadSummaryPage(page) {
  currentSummaryPage = page || 1;
  _showTableLoading("summary-table", 3);

  return apiCallWithLoading(async () => {
    const result   = await fetchSummaryFromBackend(currentSummaryPage);
    const cacheKey = CacheManager.key("inventory", "summary", currentSummaryPage, summaryItemsPerPage);
    CacheManager.set(cacheKey, result);

    _applySummaryResult(result);
    renderSummary();
    renderSummaryPagination();
    renderProductOptions();
  }, "Đang tải tồn kho...");
}

// ─── Apply helpers ────────────────────────────────────────────────────────────

function _applySummaryResult(result) {
  summary            = mapToSummaryItems(result);
  totalSummaryItems  = Array.isArray(result) ? summary.length  : (result.total      || summary.length);
  totalSummaryPages  = Array.isArray(result) ? 1               : (result.totalPages  || 1);
  currentSummaryPage = Array.isArray(result) ? 1               : (result.page        || 1);
  rebuildSummaryIndex();
}

function _applyMovementsResult(result) {
  movements      = result.items      || [];
  totalMovements = result.total      || 0;
  totalPages     = result.totalPages || 0;
  currentPage    = result.page       || 1;
}

// ─── Render ───────────────────────────────────────────────────────────────────

function _showTableLoading(tableId, cols) {
  const tbody = byId(tableId)?.querySelector("tbody");
  if (tbody) {
    tbody.innerHTML =
      `<tr><td colspan="${cols}" class="muted" style="text-align:center;">⏳ Đang tải dữ liệu...</td></tr>`;
  }
}

function renderAll() {
  renderSummary();
  renderSummaryPagination();
  renderMovements();
  renderProductOptions();
  renderPagination();
}

function renderPagination() {
  Pagination.render(
    "movements-pagination",
    currentPage, totalPages, totalMovements,
    loadData, "phiếu"
  );
}

function renderSummaryPagination() {
  if (totalSummaryPages <= 1) {
    const el = byId("summary-pagination");
    if (el) el.innerHTML = "";
    return;
  }
  Pagination.render(
    "summary-pagination",
    currentSummaryPage, totalSummaryPages, totalSummaryItems,
    loadSummaryPage, "sản phẩm"
  );
}

function renderSummary() {
  const tbody = byId("summary-table")?.querySelector("tbody");
  if (!tbody) return;
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
      <td>${escapeHtml(item.id)}</td>
      <td>${escapeHtml(item.title)}</td>
      <td class="text-center">${escapeHtml(String(item.amount_in_stock))}</td>
    </tr>
  `).join("");
}

function renderMovements() {
  const tbody = byId("movements-table")?.querySelector("tbody");
  if (!tbody) return;
  if (!session.token) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">Đăng nhập để tải dữ liệu...</td></tr>`;
    return;
  }
  if (!movements.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">Chưa có lịch sử</td></tr>`;
    return;
  }
  tbody.innerHTML = movements.map(m => buildMovementRowHTML(m)).join("");
}

function buildMovementRowHTML(item) {
  return `
    <tr data-movement-id="${escapeAttr(item.id || "")}">
      <td>${escapeHtml(item.id           || "")}</td>
      <td>${escapeHtml(item.product_id   || "")}</td>
      <td>${escapeHtml(item.type         || "")}</td>
      <td class="text-center">${escapeHtml(String(item.qty || ""))}</td>
      <td class="text-center">${escapeHtml(formatPrice(item.unit_price || 0))}</td>
      <td>${escapeHtml(item.note         || "")}</td>
      <td>${escapeHtml(item.created_at   || "")}</td>
    </tr>
  `;
}

function addMovementToList(movement) {
  if (currentPage === 1) {
    movements.unshift(movement);
    if (movements.length > itemsPerPage) movements.pop();
  }
  const tbody = byId("movements-table")?.querySelector("tbody");
  if (!tbody) return;
  if (tbody.querySelector(".muted")) tbody.innerHTML = "";
  const tmp = document.createElement("tbody");
  tmp.innerHTML = buildMovementRowHTML(movement);
  tbody.insertBefore(tmp.firstElementChild, tbody.firstChild);
}

// ─── Product search dropdown ──────────────────────────────────────────────────

function renderProductOptions() {
  initProductSearch();
  const select = byId("product_id");
  if (!select) return;
  if (!summary.length) { select.innerHTML = ""; return; }
  select.innerHTML = summary.map(item =>
    `<option value="${escapeAttr(item.id)}">${escapeHtml(item.id)} - ${escapeHtml(item.title)}</option>`
  ).join("");
}

function searchProductId(term) {
  if (!term) return [];
  const q = term.trim().toLowerCase();
  return productIdsIndex.filter(id => String(id).toLowerCase().includes(q));
}

function renderDropdownItems(items) {
  const dropdown = byId("product_dropdown");
  if (!dropdown) return;

  if (!items || items.length === 0) {
    dropdown.innerHTML = `<div class="dropdown-empty">Không tìm thấy sản phẩm</div>`;
    dropdown.style.display = "block";
    return;
  }

  dropdown.innerHTML = items.map(item => {
    const id    = item.id    || item;
    const title = item.title || item.name || "";
    // Show current stock in dropdown for quick reference
    const stock = item.amount_in_stock != null
      ? ` <span class="dropdown-stock">(tồn: ${escapeHtml(String(item.amount_in_stock))})</span>`
      : "";
    const label = title
      ? `${escapeHtml(String(id))} - ${escapeHtml(title)}${stock}`
      : escapeHtml(String(id));
    return `<div class="dropdown-item" data-product-id="${escapeAttr(String(id))}">${label}</div>`;
  }).join("");

  dropdown.style.display = "block";
}

/**
 * initProductSearch – set up search input + dropdown.
 * ✅ AbortController: idempotent, safe to call on every renderProductOptions().
 */
function initProductSearch() {
  const searchInput = byId("product_search");
  const dropdown    = byId("product_dropdown");
  if (!searchInput || !dropdown) return;

  // Abort and replace previous listeners
  searchInput._productSearchController?.abort();
  const controller = new AbortController();
  searchInput._productSearchController = controller;
  const signal = controller.signal;

  // ── Delegated click on dropdown ──────────────────────────────────────────
  if (dropdown._delegatedClick) {
    dropdown.removeEventListener("click", dropdown._delegatedClick);
  }
  dropdown._delegatedClick = (e) => {
    const item = e.target.closest(".dropdown-item[data-product-id]");
    if (item) selectProductFromDropdown(item.dataset.productId);
  };
  dropdown.addEventListener("click", dropdown._delegatedClick);

  // ── Debounced search: Worker API by ID when configured, else local filter ──
  let debounceTimer;
  async function doSearch(term) {
    clearTimeout(debounceTimer);
    if (!term) {
      renderDropdownItems(summary);
      return;
    }
    debounceTimer = setTimeout(async () => {
      const loadingEl = byId("product_loading");
      if (loadingEl) loadingEl.style.display = "inline-block";

      let items = [];
      if (window.WorkerAPI?.isConfigured?.()) {
        try {
          const result = await WorkerAPI.call("/products", { search: term });
          items = result?.items ?? (Array.isArray(result) ? result : []);
        } catch (err) {
          console.warn("⚠️ Worker product search failed, using local filter:", err?.message);
        }
      }
      if (items.length === 0) {
        items = searchProductId(term).map(id => summaryMap.get(id) || { id });
      }

      if (loadingEl) loadingEl.style.display = "none";
      renderDropdownItems(items);
    }, 300);
  }

  searchInput.addEventListener("input", function () {
    doSearch(this.value.trim());
  }, { signal });

  searchInput.addEventListener("focus", function () {
    const term = this.value.trim();
    dropdown.style.display = "block";
    if (!term) {
      renderDropdownItems(summary);
    } else {
      doSearch(term);
    }
  }, { signal });

  searchInput.addEventListener("keydown", async function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = dropdown.querySelector(".dropdown-item[data-product-id]");
      if (first) await selectProductFromDropdown(first.dataset.productId);
    } else if (e.key === "Escape") {
      dropdown.style.display = "none";
    }
  }, { signal });

  searchInput.addEventListener("blur", () => {
    // Delay so delegated click fires before hide
    setTimeout(() => { dropdown.style.display = "none"; }, 200);
  }, { signal });

  document.addEventListener("click", (e) => {
    if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = "none";
    }
  }, { signal });

  // ── Movement type change: re-price using cached product (no network) ──────
  byId("movement_type")?.addEventListener("change", async function () {
    const productId = byId("product_id")?.value;
    if (productId) await fillFormFromProduct(productId);
  }, { signal });
}

// ─── Product detail loading ───────────────────────────────────────────────────

/**
 * selectProductFromDropdown – delegated click handler entry point.
 *
 * 1. Close dropdown instantly (no wait)
 * 2. Show label immediately from summaryMap (O(1))
 * 3. Fetch full detail via 4-tier fetchProductDetail
 * 4. Fill price fields via fillFormFromProduct
 */
window.selectProductFromDropdown = async function (productId) {
  const searchInput = byId("product_search");
  const dropdown    = byId("product_dropdown");

  // ✅ Instant close + instant label – user sees feedback before network call
  if (dropdown) dropdown.style.display = "none";
  const summaryItem = summaryMap.get(productId);
  if (searchInput) {
    searchInput.value = summaryItem
      ? `${productId} - ${summaryItem.title || ""}`
      : productId;
  }

  await loadProductDetailAndFill(productId);
};

/**
 * fillFormFromProduct – fill price inputs given a product object (or ID).
 *
 * If passed an ID, checks productDetailCache first (free) then fetches.
 * Called by both loadProductDetailAndFill AND movement_type change listener.
 *
 * @param {string|Object} productOrId
 */
async function fillFormFromProduct(productOrId) {
  const product = (typeof productOrId === "string")
    ? await fetchProductDetail(productOrId)
    : productOrId;

  if (!product) return;

  // IN (nhập kho) → prefer import_price; OUT (xuất kho) → sale price
  const movementType = byId("movement_type")?.value || "IN";
  const price = movementType === "OUT"
    ? (product.price        || 0)
    : (product.import_price || product.price || 0);

  const unitPriceInput = byId("unit_price");
  if (unitPriceInput) {
    unitPriceInput.value       = price;
    unitPriceInput.placeholder = `Giá đề xuất: ${formatPrice(price)}`;
  }

  // Sync hidden select value
  const select = byId("product_id");
  if (select) select.value = product.id;

  // Sync search label (only if not already showing this product)
  const searchInput = byId("product_search");
  if (searchInput && !searchInput.value.startsWith(String(product.id))) {
    searchInput.value =
      `${product.id} - ${product.title || product.name || ""}`;
  }
}

/**
 * loadProductDetailAndFill – public entry point.
 *
 * Fetch full product detail via 4-tier cache then fill the form.
 * Exposed on window so it can be called from HTML if needed.
 *
 * Tier 1 | in-memory productDetailCache        | ~0ms
 * Tier 2 | localStorage (CacheManager)         | ~1ms
 * Tier 3 | WorkerAPI /products/{id} → KV       | ~30ms
 * Tier 4 | GAS apiCall("products.get", { id }) | ~800ms
 */
window.loadProductDetailAndFill = async function (productId) {
  if (!productId?.trim()) return;

  const loadingEl = byId("product_loading");
  const dropdown  = byId("product_dropdown");

  try {
    if (loadingEl) loadingEl.style.display = "inline-block";
    if (dropdown)  dropdown.style.display  = "none";

    const product = await fetchProductDetail(productId);
    await fillFormFromProduct(product);

    console.log(`✅ Product detail filled [${productId}]`);
  } catch (err) {
    console.error("⚠️ loadProductDetailAndFill error:", err);
    alert(`Không tìm thấy sản phẩm: ${productId}`);
  } finally {
    if (loadingEl) loadingEl.style.display = "none";
  }
};

// ─── Create movement ──────────────────────────────────────────────────────────

async function createMovement() {
  reloadSession();
  Validator.clearErrors();

  if (!session.token) {
    alert("Vui lòng đăng nhập trước");
    return;
  }

  const productId = byId("product_id")?.value    || "";
  const type      = byId("movement_type")?.value || "";
  const qty       = byId("qty")?.value           || "";
  const unitPrice = byId("unit_price")?.value    || "";
  const note      = byId("note")?.value.trim()   || "";

  const rules = {
    product_id    : { required: true },
    movement_type : { required: true },
    qty           : Validator.helpers.requiredPositiveNumber(999_999),
    unit_price    : { required: false, type: "number", nonNegative: true, max: 999_999_999 },
    note          : Validator.helpers.textarea(false),
  };

  const result = Validator.validateForm(
    { product_id: productId, movement_type: type, qty, unit_price: unitPrice, note },
    rules
  );
  if (!result.valid) {
    Validator.showErrors(result.errors);
    return;
  }

  try {
    const newMovement = await apiCall("inventory.create", {
      token      : session.token,
      product_id : productId,
      type,
      qty,
      unit_price : unitPrice || 0,
      note,
    });

    // ✅ Granular: movement changes stock → clear inventory + product caches
    CacheInvalidator.afterCreateMovement();

    // Reset form (keep product selection for quick consecutive entries)
    byId("qty").value        = "";
    byId("unit_price").value = "";
    byId("note").value       = "";

    // ✅ Optimistic prepend when on page 1 and page not full
    if (currentPage === 1 && movements.length < itemsPerPage) {
      addMovementToList(newMovement);
      totalMovements++;
      totalPages = Math.ceil(totalMovements / itemsPerPage);
      renderPagination();
      // Reload summary to show updated stock numbers
      await loadSummaryPage(currentSummaryPage);
    } else {
      await loadData(Pagination.getParamsFromURL().page);
    }
  } catch (err) {
    handleError(err, "createMovement");
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

byId("btn-login").addEventListener("click", async () => {
  const btn = byId("btn-login");
  Loading.button(btn, true);
  try   { await login(); }
  catch (err) { handleError(err, "login"); }
  finally     { Loading.button(btn, false); }
});

byId("btn-logout").addEventListener("click", () => resetSession());

byId("btn-create").addEventListener("click", async () => {
  const btn = byId("btn-create");
  Loading.button(btn, true);
  try   { await createMovement(); }
  catch (err) { handleError(err, "createMovement"); }
  finally     { Loading.button(btn, false); }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

if (window.WorkerAPI && window.CommonUtils?.WORKER_URL) {
  WorkerAPI.init(window.CommonUtils.WORKER_URL);
  console.log("✅ WorkerAPI initialized");
} else if (window.WorkerAPI) {
  console.log("ℹ️ WorkerAPI available but WORKER_URL not configured – GAS only");
}

syncInputsFromSession();
applyQueryParams();
updateSessionUI();

if (session.token) {
  const { page } = Pagination.getParamsFromURL();
  loadData(page).catch(err => handleError(err, "initial loadData"));
}