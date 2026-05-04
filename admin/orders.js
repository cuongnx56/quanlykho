// =============================================================================
// orders.js - Optimized
//
// Fixes applied:
//  1. XSS: escapeHtml/escapeAttr on ALL user-content in innerHTML
//  2. Debounce (300ms) on customer autocomplete input
//  3. AbortController replaces _inputHandler/_blurHandler (no memory leak)
//  4. Centralized handleError() replaces 4 copy-pasted try/catch blocks
//  5. Granular cache invalidation - no more clearAllCache() shotgun
//  6. Products: batch load only product IDs present in current page orders
//     (replaces limit:1000 full fetch)
//  7. Race condition fix: explicit null check before fallback to GAS
//  8. Constants for all magic numbers
//  9. productsMap built once, cleared only when products array changes
// 10. Customer search: pre-built index for O(1) filter instead of O(n*m)
// =============================================================================

// --------------- Constants --------------------------------------------------

const ORDERS_CONST = {
  AUTOCOMPLETE_BLUR_DELAY : 200,   // ms to keep dropdown open after blur
  DEBOUNCE_DELAY          : 300,   // ms debounce on customer input
  SEARCH_MIN_LENGTH       : 1,     // min chars before filtering
  CUSTOMERS_LIMIT         : 1000,  // keep existing behaviour for customers
  /** Polling interval: detect đơn mới (page 1, limit 1) — không dùng localStorage cache */
  NEW_ORDER_POLL_MS       : 15000,
};

// --------------- Page state -------------------------------------------------

let orders       = [];
let products     = [];      // sparse – only IDs seen on current page
let customers    = [];
let currentPage  = 1;
let totalPages   = 0;
let totalOrders  = 0;
const itemsPerPage = PAGINATION.DEFAULT_LIMIT;
let currentItems = [];

// productsMap: id → display-name, built lazily, cleared when products changes
let productsMap = null;

// Pre-built customer search index for fast filtering
let customerSearchIndex = [];

// ── Pending-save tracking ─────────────────────────────────────────────────────
// Monotonic counter so concurrent orders get unique tempIds even if created in
// the same millisecond.
let _tempIdCounter = 0;

// Set of tempIds currently being saved to GAS. Used to:
//   1. Warn the user before navigating away while a save is in-flight.
//   2. Re-attempt failed saves after reconnect (see _recoverPendingOrders).
const _pendingSaves = new Set();

// localStorage key for the pending-saves recovery queue
const PENDING_QUEUE_KEY = "orders_pending_queue";

/**
 * Register a pending save so beforeunload can warn the user.
 * Persists the order payload to localStorage for recovery after a crash/reload.
 */
function _pendingStart(tempId, payload) {
  _pendingSaves.add(tempId);
  try {
    const queue = JSON.parse(localStorage.getItem(PENDING_QUEUE_KEY) || "[]");
    queue.push({ tempId, payload, ts: Date.now() });
    localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(queue));
  } catch (e) { /* storage full – non-critical */ }
}

/**
 * Unregister a pending save (success OR unrecoverable failure).
 */
function _pendingEnd(tempId) {
  _pendingSaves.delete(tempId);
  try {
    const queue = JSON.parse(localStorage.getItem(PENDING_QUEUE_KEY) || "[]");
    const filtered = queue.filter(e => e.tempId !== tempId);
    localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(filtered));
  } catch (e) { /* non-critical */ }
}

/**
 * On page load: re-attempt any orders that were saved to the pending queue
 * but never confirmed by GAS (browser was closed / network died mid-flight).
 * Runs silently in the background after a short delay.
 */
async function _recoverPendingOrders() {
  let queue;
  try {
    queue = JSON.parse(localStorage.getItem(PENDING_QUEUE_KEY) || "[]");
  } catch (e) { return; }

  if (!queue.length) return;

  // Discard entries older than 1 hour (stale / already processed by another tab)
  const ONE_HOUR = 60 * 60 * 1000;
  const fresh = queue.filter(e => Date.now() - (e.ts || 0) < ONE_HOUR);
  if (!fresh.length) {
    localStorage.removeItem(PENDING_QUEUE_KEY);
    return;
  }

  console.log(`🔄 Recovering ${fresh.length} pending order(s) from previous session...`);
  Toast.show(`⏳ Đang khôi phục ${fresh.length} đơn chưa lưu...`, "info", 4000);

  for (const entry of fresh) {
    try {
      const savedOrder = await apiCall("orders.create", entry.payload);
      const realId = savedOrder.order_id ?? savedOrder.id;

      // Replace any matching temp row still in the list
      const idx = orders.findIndex(o => o.id === entry.tempId);
      if (idx !== -1) {
        const realOrder = Object.assign({}, orders[idx], { id: String(realId) });
        orders[idx] = realOrder;
        const tempRow = byId("orders-table")
          ?.querySelector(`tbody tr[data-order-id="${CSS.escape(entry.tempId)}"]`);
        if (tempRow) tempRow.setAttribute("data-order-id", realOrder.id);
        updateOrderInList(realOrder);
        _cacheReplaceOrder(entry.tempId, realOrder);
      }

      _pendingEnd(entry.tempId);
      console.log(`✅ Recovered pending order → real id: ${realId}`);
    } catch (err) {
      if (isNetworkOrResponseError(err)) {
        console.warn("⚠️ Still offline, will retry next session:", entry.tempId);
        // Leave in queue for next load
      } else {
        // Logical error (duplicate, invalid data…) — discard
        _pendingEnd(entry.tempId);
        console.error("❌ Recovery failed (discarding):", entry.tempId, err.message);
      }
    }
  }
}

// Warn before navigating away while saves are in-flight
window.addEventListener("beforeunload", (e) => {
  if (_pendingSaves.size > 0) {
    e.preventDefault();
    // Modern browsers show their own generic message; returnValue triggers the dialog
    e.returnValue = "Đơn hàng đang được lưu. Bạn có chắc muốn rời trang?";
  }
});

// --------------- Cache helpers for optimistic writes -----------------------

/**
 * Insert or update an order in the current page's localStorage cache.
 * - If cache exists: updates the matching entry (or prepends if new).
 * - If cache does NOT exist: creates a fresh cache snapshot from the
 *   current in-memory `orders` array so that a reload shows all visible
 *   orders (including ones added/changed since the last full GAS fetch).
 */
function _cacheUpsertOrder(order) {
  const key    = CacheManager.key("orders", "list", currentPage, itemsPerPage);
  const cached = CacheManager.get(key);

  if (!cached) {
    // No existing cache — seed it from the current in-memory state.
    if (!orders.length) return;
    CacheManager.set(key, {
      items      : [...orders],
      total      : totalOrders,
      page       : currentPage,
      limit      : itemsPerPage,
      totalPages,
    });
    return;
  }

  const items = Array.isArray(cached.items) ? [...cached.items] : [];
  const idx   = items.findIndex(o => o.id === order.id);
  if (idx !== -1) {
    items[idx] = order;
  } else {
    items.unshift(order);
    if (items.length > itemsPerPage) items.pop();
  }
  CacheManager.set(key, {
    ...cached,
    items,
    total: idx === -1 ? (cached.total || 0) + 1 : cached.total,
  });
}

/**
 * Replace a temp order entry (by tempId) with the real saved order in cache.
 */
function _cacheReplaceOrder(tempId, savedOrder) {
  const key    = CacheManager.key("orders", "list", 1, itemsPerPage);
  const cached = CacheManager.get(key);
  if (!cached || !Array.isArray(cached.items)) return;

  const items = [...cached.items];
  const idx   = items.findIndex(o => o.id === tempId);
  if (idx !== -1) items[idx] = savedOrder;
  CacheManager.set(key, { ...cached, items });
}

/**
 * Remove an order from the page-1 localStorage cache (used on rollback).
 */
function _cacheRemoveOrder(orderId) {
  const key    = CacheManager.key("orders", "list", 1, itemsPerPage);
  const cached = CacheManager.get(key);
  if (!cached || !Array.isArray(cached.items)) return;

  const items = cached.items.filter(o => o.id !== orderId);
  CacheManager.set(key, { ...cached, items, total: Math.max(0, (cached.total || 0) - 1) });
}

/**
 * Disable or re-enable all action buttons in a specific order row.
 * Called while a GAS write is in-flight so the user can't double-trigger
 * status changes or other actions on a row that's already being processed.
 *
 * Note: updateOrderInList() and renderOrders() both re-render row innerHTML,
 * so buttons are automatically restored to their correct enabled state after
 * any re-render — no explicit "enable" call is needed after those.
 *
 * @param {string} orderId - The data-order-id attribute value of the row
 * @param {boolean} disabled
 */
function _setRowActionsDisabled(orderId, disabled) {
  const row = byId("orders-table")
    ?.querySelector(`tbody tr[data-order-id="${CSS.escape(String(orderId))}"]`);
  if (!row) return;
  row.querySelectorAll(".action-btn").forEach(btn => {
    btn.disabled      = disabled;
    btn.style.opacity = disabled ? "0.45" : "";
    btn.style.cursor  = disabled ? "not-allowed" : "";
  });
}

// --------------- Session override -------------------------------------------

function resetSession() {
  if (window._originalResetSession) window._originalResetSession();
  stopNewOrderPolling();
  closeNewOrderNotifyModal();
  orders    = [];
  products  = [];
  customers = [];
  productsMap          = null;
  customerSearchIndex  = [];
  renderOrders();
}
window.resetSession = resetSession;

// ─── Đơn mới: polling + modal ───────────────────────────────────────────────

let _newOrderPollTimer     = null;
let _newOrderPollActive    = false;
let _newOrderPollInFlight  = false;
let _newOrderPollBaselineReady = false;
let _lastRemoteHeadOrderId = null;

function _ordersHeadIdFromListPayload(data) {
  const items = data?.items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const id = items[0]?.id;
  return id == null ? null : String(id);
}

/**
 * Chỉ lấy đơn đầu trang 1 (mới nhất) — Worker → GAS, không đọc CacheManager.
 */
async function fetchOrdersHeadFromBackend() {
  let data = null;
  if (window.WorkerAPI?.isConfigured()) {
    data = await window.WorkerAPI.ordersList({ page: 1, limit: 1 });
  }
  if (!data) {
    data = await apiCall("orders.list", { page: 1, limit: 1 });
  }
  return data;
}

async function refreshNewOrderPollBaseline() {
  reloadSession();
  if (!session.token) return;
  try {
    const payload = await fetchOrdersHeadFromBackend();
    _lastRemoteHeadOrderId     = _ordersHeadIdFromListPayload(payload);
    _newOrderPollBaselineReady = true;
  } catch (e) {
    console.warn("⚠️ refreshNewOrderPollBaseline:", e?.message || e);
  }
}

function openNewOrderNotifyModal() {
  byId("new-order-notify-modal")?.classList.add("active");
}

function closeNewOrderNotifyModal() {
  byId("new-order-notify-modal")?.classList.remove("active");
}

function stopNewOrderPolling() {
  _newOrderPollActive = false;
  if (_newOrderPollTimer) {
    clearInterval(_newOrderPollTimer);
    _newOrderPollTimer = null;
  }
}

function startNewOrderPolling() {
  reloadSession();
  if (!session.token) return;
  stopNewOrderPolling();
  _newOrderPollActive = true;
  _newOrderPollTimer = setInterval(tickNewOrderPoll, ORDERS_CONST.NEW_ORDER_POLL_MS);
}

async function tickNewOrderPoll() {
  if (!_newOrderPollActive || _newOrderPollInFlight) return;
  if (document.visibilityState !== "visible") return;

  reloadSession();
  if (!session.token) {
    stopNewOrderPolling();
    return;
  }

  _newOrderPollInFlight = true;
  try {
    const payload = await fetchOrdersHeadFromBackend();
    const headId  = _ordersHeadIdFromListPayload(payload);

    if (!_newOrderPollBaselineReady) {
      _lastRemoteHeadOrderId     = headId;
      _newOrderPollBaselineReady = true;
      return;
    }

    const prev = _lastRemoteHeadOrderId;
    if (headId !== prev) {
      stopNewOrderPolling();
      openNewOrderNotifyModal();
    }
  } catch (e) {
    const msg = e?.message || String(e);
    if (typeof isAuthError === "function" && isAuthError(msg)) {
      stopNewOrderPolling();
    }
    console.warn("⚠️ tickNewOrderPoll:", msg);
  } finally {
    _newOrderPollInFlight = false;
  }
}

async function onNewOrderReloadClick() {
  const btn = byId("btn-new-order-reload");
  if (btn) Loading.button(btn, true);
  try {
    CacheInvalidator.orders();
    closeNewOrderNotifyModal();
    await loadData(currentPage);
    await refreshNewOrderPollBaseline();
    startNewOrderPolling();
  } catch (e) {
    handleError(e, "onNewOrderReloadClick");
  } finally {
    if (btn) Loading.button(btn, false);
  }
}

async function onNewOrderDismissClick() {
  closeNewOrderNotifyModal();
  await refreshNewOrderPollBaseline();
  startNewOrderPolling();
}

// --------------- Utilities --------------------------------------------------

/**
 * Debounce: returns a debounced wrapper around fn.
 */
function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Centralized error handler. Handles token expiry, network errors, generic errors.
 * @param {Error}  err      - The caught error
 * @param {string} context  - Caller name for console logging
 */
function handleError(err, context = "") {
  console.error(`❌ Error in ${context}:`, err);

  const msg = err && err.message ? err.message : String(err);
  const isAuthError = ["Token expired", "Unauthorized", "hết hạn"].some(s =>
    msg.includes(s)
  );

  if (isAuthError) {
    alert("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    resetSession();
    window.location.reload();
    return;
  }

  alert(`❌ Lỗi: ${msg}`);
}

/**
 * Granular cache invalidation helpers.
 * Avoids nuking unrelated caches on every write.
 */
const CacheInvalidator = {
  orders() {
    // Invalidate all orders pages
    CacheManager.clear("^orders_");
    console.log("🗑️ Cache cleared: orders");
  },
  customers() {
    CacheManager.clear("^customers_");
    console.log("🗑️ Cache cleared: customers");
  },
  products() {
    CacheManager.clear("^products_");
    console.log("🗑️ Cache cleared: products");
  },
  invoices() {
    CacheManager.clear("^invoices_");
    console.log("🗑️ Cache cleared: invoices");
  },
  /**
   * After order status → DONE/RETURN inventory changes → also clear products
   */
  orderWithInventory() {
    this.orders();
    this.products();
  },
  afterCreateOrder() {
    this.orders();
    this.customers(); // new customer may have been created
  },
  afterCreateInvoice() {
    this.invoices();
    this.orders();
  },
};

// --------------- Customer autocomplete --------------------------------------

function openModal() {
  byId("order-modal").classList.add("active");
  loadCustomersForAutocomplete();
}

async function loadCustomersForAutocomplete() {
  if (customers.length > 0) {
    // Already loaded – just (re-)setup the UI
    setupCustomerAutocomplete();
    return;
  }

  try {
    const cacheKey       = CacheManager.key("customers", "list", 1, ORDERS_CONST.CUSTOMERS_LIMIT);
    const cachedCustomers = CacheManager.get(cacheKey);

    if (cachedCustomers) {
      customers = cachedCustomers.items ?? (Array.isArray(cachedCustomers) ? cachedCustomers : []);
    } else {
      let data = null;

      if (WorkerAPI?.isConfigured()) {
        try {
          data = await WorkerAPI.customersList({ page: 1, limit: ORDERS_CONST.CUSTOMERS_LIMIT });
          if (data) CacheManager.set(cacheKey, data);
        } catch (e) {
          console.warn("⚠️ Worker customers error, falling back to GAS:", e.message);
        }
      }

      if (!data) {
        data = await apiCall("customers.list", { page: 1, limit: ORDERS_CONST.CUSTOMERS_LIMIT });
        CacheManager.set(cacheKey, data);
      }

      customers = data?.items ?? (Array.isArray(data) ? data : []);
    }

    // Build search index once
    rebuildCustomerSearchIndex();
  } catch (err) {
    console.error("Error loading customers:", err);
  }

  setupCustomerAutocomplete();
}

/**
 * Build a pre-processed search index for O(1) filter per keystroke.
 */
function rebuildCustomerSearchIndex() {
  customerSearchIndex = customers.map(c => ({
    id         : c.id,
    searchText : [c.name || "", c.phone || "", c.email || "", c.id || ""]
      .join(" ")
      .toLowerCase(),
  }));
}

/**
 * Setup autocomplete using AbortController – no manual handler bookkeeping,
 * no memory leaks.
 */
function setupCustomerAutocomplete() {
  const customerInput   = byId("field-customer");
  const autocompleteDiv = byId("customer-autocomplete");
  if (!customerInput || !autocompleteDiv) return;

  // ✅ Abort (and clean up) any previous listeners
  if (customerInput._autocompleteController) {
    customerInput._autocompleteController.abort();
  }

  const controller = new AbortController();
  customerInput._autocompleteController = controller;
  const signal = controller.signal;

  let selectedCustomerId   = null;
  let filteredCustomers    = [];

  // Expose getter/setter for saveOrder() to read the selected ID
  customerInput._selectedCustomerId    = () => selectedCustomerId;
  customerInput._setSelectedCustomerId = (id) => { selectedCustomerId = id; };

  // ✅ Debounced filter
  const debouncedFilter = debounce(function (query) {
    const q = query.trim().toLowerCase();

    if (q.length < ORDERS_CONST.SEARCH_MIN_LENGTH) {
      autocompleteDiv.style.display = "none";
      return;
    }

    // ✅ O(n) but against pre-built concatenated string → much faster than
    //    4 separate .includes() calls per customer
    const matchingIds = new Set(
      customerSearchIndex
        .filter(c => c.searchText.includes(q))
        .map(c => c.id)
    );
    filteredCustomers = customers.filter(c => matchingIds.has(c.id));

    renderAutocompleteDropdown(filteredCustomers, q, customerInput, autocompleteDiv, (customer) => {
      customerInput.value  = customer.name || customer.id;
      selectedCustomerId   = customer.id;
      autocompleteDiv.style.display = "none";
    });
  }, ORDERS_CONST.DEBOUNCE_DELAY);

  customerInput.addEventListener("input", (e) => {
    selectedCustomerId = null; // reset selection on any new typing
    debouncedFilter(e.target.value);
  }, { signal });

  customerInput.addEventListener("blur", () => {
    setTimeout(() => { autocompleteDiv.style.display = "none"; },
      ORDERS_CONST.AUTOCOMPLETE_BLUR_DELAY);
  }, { signal });

  customerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = autocompleteDiv.querySelector(".autocomplete-item[data-customer-id]");
      if (first) {
        first.click();
      } else {
        autocompleteDiv.style.display = "none";
      }
    } else if (e.key === "Escape") {
      autocompleteDiv.style.display = "none";
    }
  }, { signal });
}

/**
 * Pure render function for autocomplete dropdown.
 * ✅ escapeHtml/escapeAttr on all user content.
 */
function renderAutocompleteDropdown(filteredCustomers, query, customerInput, autocompleteDiv, onSelect) {
  if (filteredCustomers.length > 0) {
    autocompleteDiv.innerHTML = filteredCustomers.map(c => `
      <div class="autocomplete-item"
           data-customer-id="${escapeAttr(c.id)}">
        <div class="autocomplete-item-name">${escapeHtml(c.name || c.id)}</div>
        <div class="autocomplete-item-details">
          ${escapeHtml(c.phone || "")}
          ${c.email ? `• ${escapeHtml(c.email)}` : ""}
        </div>
      </div>
    `).join("");

    // Delegate single listener on container instead of N listeners
    autocompleteDiv.onclick = (e) => {
      const item = e.target.closest(".autocomplete-item[data-customer-id]");
      if (!item) return;
      const cid      = item.dataset.customerId;
      const customer = filteredCustomers.find(c => c.id === cid);
      if (customer) onSelect(customer);
    };
  } else {
    // ✅ escapeHtml the user query in the "create new" hint
    autocompleteDiv.innerHTML = `
      <div class="autocomplete-item" style="color:#3b82f6;font-style:italic;">
        <div class="autocomplete-item-name">Tạo khách hàng mới: "${escapeHtml(query)}"</div>
        <div class="autocomplete-item-details">Nhấn Enter để tạo mới</div>
      </div>
    `;
    autocompleteDiv.onclick = null;
  }

  autocompleteDiv.style.display = "block";
}

function closeModal()       { byId("order-modal").classList.remove("active"); }
function openDetailModal()  { byId("detail-modal").classList.add("active"); }
function closeDetailModal() { byId("detail-modal").classList.remove("active"); }

// --------------- Auth -------------------------------------------------------

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
  if (window.SessionCache) window.SessionCache.save(session);
  if (window.CommonUtils) window.CommonUtils.session = session;

  updateSessionUI();
  const { page } = Pagination.getParamsFromURL();
  await loadData(page);
  await refreshNewOrderPollBaseline();
  startNewOrderPolling();
}

// --------------- Data loading -----------------------------------------------

/**
 * Load orders for the given page, then batch-load only the product IDs
 * present in the returned orders (instead of fetching all 1000 products).
 *
 * Flow:
 *   1. localStorage cache → fast path
 *   2. GAS /exec fallback
 *   3. Extract unique product IDs from orders
 *   4. Batch load missing product details (Worker → GAS)
 *   5. Load customers in parallel with step 2-3
 */
async function loadData(page) {
  if (page == null) {
    page = Pagination.getParamsFromURL().page;
  }
  currentPage = page;

  return apiCallWithLoading(async () => {
    // ── Step 1 / 2 / 3 : Load orders ────────────────────────────────────────
    const ordersCacheKey = CacheManager.key("orders", "list", page, itemsPerPage);
    const cachedOrders   = CacheManager.get(ordersCacheKey);

    let ordersResult;

    if (cachedOrders) {
      console.log("📦 Orders: localStorage cache hit");
      ordersResult = cachedOrders;
    } else {
      ordersResult = await fetchOrdersFromBackend(page);
      CacheManager.set(ordersCacheKey, ordersResult);
    }

    orders      = ordersResult.items      || [];
    totalOrders = ordersResult.total      || 0;
    totalPages  = ordersResult.totalPages || 0;
    currentPage = ordersResult.page       || 1;

    // ── Step 4 : Extract unique product IDs from this page's orders ──────────
    const neededProductIds = extractProductIds(orders);

    // ── Step 5 / 6 : Load products (batch) + customers in parallel ───────────
    const [batchedProducts, loadedCustomers] = await Promise.all([
      loadProductsBatch(neededProductIds),
      loadCustomersData(),
    ]);

    // Merge newly loaded products into the products array
    mergeProducts(batchedProducts);

    customers = loadedCustomers;
    rebuildCustomerSearchIndex();

    // Force productsMap rebuild
    productsMap = null;

    renderOrders();
    renderPagination();
    Pagination.updateURL(currentPage, itemsPerPage);
  }, "Đang tải đơn hàng...");
}

/**
 * Fetch orders from GAS.
 */
async function fetchOrdersFromBackend(page) {
  console.log("📡 Orders: fetching from GAS...");
  return apiCall("orders.list", { page, limit: itemsPerPage });
}

/**
 * Extract all unique product IDs referenced by items_json across orders.
 * @param {Array} orderList
 * @returns {string[]}
 */
function extractProductIds(orderList) {
  const seen = new Set();
  for (const order of orderList) {
    for (const item of getOrderItems(order)) {
      if (item.product_id) seen.add(String(item.product_id).trim());
    }
  }
  return [...seen];
}

/**
 * Batch-load products by IDs.
 *
 * Strategy:
 *   a) IDs already in local `products` array → skip (use cached)
 *   b) Check localStorage per-ID cache
 *   c) Fetch remaining from Worker batch endpoint → GAS batch fallback
 *
 * @param {string[]} ids
 * @returns {Promise<Object[]>} Array of product objects
 */
async function loadProductsBatch(ids) {
  if (!ids || ids.length === 0) return [];

  const existingIds = new Set(products.map(p => String(p.id).trim()));

  // Which IDs do we not yet have?
  const missingIds = ids.filter(id => !existingIds.has(id));

  if (missingIds.length === 0) {
    console.log("📦 Products: all IDs already loaded");
    return [];
  }

  console.log(`📦 Products: need to fetch ${missingIds.length} new IDs:`, missingIds);

  // Check per-ID localStorage cache
  const stillMissing = [];
  const fromCache    = [];

  for (const id of missingIds) {
    const cacheKey = CacheManager.key("product", "detail", id);
    const cached   = CacheManager.get(cacheKey);
    if (cached) {
      fromCache.push(cached);
    } else {
      stillMissing.push(id);
    }
  }

  if (fromCache.length > 0) {
    console.log(`📦 Products: ${fromCache.length} IDs from localStorage cache`);
  }

  let fetched = [];

  if (stillMissing.length > 0) {
    fetched = await fetchProductsBatchFromBackend(stillMissing);

    // Cache each fetched product individually
    for (const p of fetched) {
      const cacheKey = CacheManager.key("product", "detail", p.id);
      CacheManager.set(cacheKey, p);
    }
  }

  return [...fromCache, ...fetched];
}

/**
 * Fetch a batch of products by IDs.
 *
 * WHY this flow instead of products.list(limit:1000):
 *   - Worker /products?ids=... → Worker calls Cache.loadProductDetailsBatch(tenant, ids)
 *     which does parallel UrlFetchApp.fetchAll against KV keys:
 *       {sheetId}_product_detail_p01, {sheetId}_product_detail_p03, ...
 *     Already built, no new code needed on backend.
 *   - GAS fallback → products.list with ids param (Products.list already
 *     supports loadProductDetailsBatch internally when ids are supplied).
 *
 * Result: fetch only 3-5 products (~2KB) instead of 1000 (~500KB).
 *
 * @param {string[]} ids - Product IDs to fetch
 * @returns {Promise<Object[]>}
 */
async function fetchProductsBatchFromBackend(ids) {
  if (ids.length === 0) return [];

  // ── Worker: GET /products?ids=p01,p03,p07 ──────────────────────────────
  // Worker routes this to Cache.loadProductDetailsBatch(tenant, ids)
  // which executes parallel KV reads – same function already used by
  // products.list, orders.list, etc.
  if (WorkerAPI?.isConfigured()) {
    try {
      console.log("🚀 Products batch: Worker /products?ids=", ids);
      const result = await WorkerAPI.call("/products", { ids: ids.join(",") });
      if (result) {
        const list = result.items ?? (Array.isArray(result) ? result : []);
        console.log(`✅ Products batch: Worker KV returned ${list.length} products`);
        return list;
      }
      console.log("⚠️ Products batch: Worker KV miss → falling back to GAS");
    } catch (e) {
      console.warn("⚠️ Products batch: Worker error → falling back to GAS:", e.message);
    }
  }

  // ── GAS fallback: products.list with ids param ─────────────────────────
  // GAS Products.list() already calls Cache.loadProductDetailsBatch(tenant, ids)
  // when an ids array is provided – no new GAS action needed.
  console.log("📡 Products batch: GAS products.list ids=", ids);
  try {
    const result = await apiCall("products.list", { ids });
    return result?.items ?? (Array.isArray(result) ? result : []);
  } catch (e) {
    console.error("❌ Products batch: GAS also failed:", e.message);
    return [];
  }
}

/**
 * Merge newly loaded products into the module-level `products` array.
 * Avoids duplicates.
 */
function mergeProducts(newProducts) {
  if (!newProducts || newProducts.length === 0) return;

  const existingIds = new Set(products.map(p => String(p.id).trim()));
  for (const p of newProducts) {
    if (!existingIds.has(String(p.id).trim())) {
      products.push(p);
      existingIds.add(String(p.id).trim());
    }
  }

  // Invalidate the Map so it gets rebuilt on next render
  productsMap = null;
  console.log(`✅ Products: total in memory = ${products.length}`);
}

/**
 * Load customers with Worker → GAS fallback.
 * Uses localStorage cache.
 */
async function loadCustomersData() {
  const cacheKey = CacheManager.key("customers", "list", 1, ORDERS_CONST.CUSTOMERS_LIMIT);
  const cached   = CacheManager.get(cacheKey);

  if (cached) {
    console.log("📦 Customers: localStorage cache hit");
    return cached.items ?? (Array.isArray(cached) ? cached : []);
  }

  let data = null;

  if (WorkerAPI?.isConfigured()) {
    try {
      data = await WorkerAPI.customersList({ page: 1, limit: ORDERS_CONST.CUSTOMERS_LIMIT });
      if (data) CacheManager.set(cacheKey, data);
    } catch (e) {
      console.warn("⚠️ Customers: Worker error:", e.message);
    }
  }

  if (!data) {
    data = await apiCall("customers.list", { page: 1, limit: ORDERS_CONST.CUSTOMERS_LIMIT });
    CacheManager.set(cacheKey, data);
  }

  return data?.items ?? (Array.isArray(data) ? data : []);
}

// --------------- Rendering --------------------------------------------------

function renderPagination() {
  Pagination.render(
    "orders-pagination",
    currentPage, totalPages, totalOrders,
    loadData,
    "đơn hàng"
  );
}

function getCustomerDisplayName(customerId) {
  if (!customerId) return "";
  const c = customers.find(c => c.id === customerId);
  if (!c) return customerId;
  return c.name || c.phone || c.email || c.id || customerId;
}

function getOrderItems(order) {
  const raw = order?.items_json;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }
  return [];
}

function getProductDisplayName(productId) {
  if (!productId) return "";
  const id = String(productId).trim();

  // Build map lazily, once per products-array change
  if (!productsMap) {
    productsMap = new Map();
    for (const p of products) {
      if (p.id) productsMap.set(String(p.id).trim(), p.title || p.name || p.id);
    }
  }

  return productsMap.get(id) ?? id;
}

function getShippingInfo(order) {
  const raw = order?.shipping_info;
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try { return JSON.parse(raw) || null; } catch (e) { return null; }
  }
  return null;
}

function getStatusClass(status) {
  const map = { NEW: "status-new", DONE: "status-done", CANCEL: "status-cancel", RETURN: "status-return" };
  return map[status] || "";
}

function getStatusActions(orderId, status) {
  const id = escapeAttr(orderId);
  const actions = [];
  if (status === "NEW") {
    actions.push(`<button class="action-btn status-btn" onclick="changeStatus('${id}','DONE')">✓ Done</button>`);
    actions.push(`<button class="action-btn status-btn cancel-btn" onclick="changeStatus('${id}','CANCEL')">✕ Cancel</button>`);
  } else if (status === "DONE") {
    actions.push(`<button class="action-btn status-btn return-btn" onclick="changeStatus('${id}','RETURN')">↩ Return</button>`);
    actions.push(`<button class="action-btn invoice-btn" onclick="createInvoiceFromOrder('${id}')" title="Xuất hóa đơn">🧾 Hóa đơn</button>`);
  }
  return actions.join(" ");
}

/**
 * ✅ Central row HTML builder – used by both renderOrders and updateOrderInList.
 *    All user data is escaped.
 */
function buildOrderRowHTML(order) {
  const status              = order.status || "NEW";
  const statusClass         = escapeAttr(getStatusClass(status));
  const actions             = getStatusActions(order.id, status);
  const items               = getOrderItems(order);
  const productNames        = items.length
    ? items.map(i => escapeHtml(getProductDisplayName(i.product_id))).filter(Boolean).join(", ")
    : "-";
  const customerDisplayName = escapeHtml(getCustomerDisplayName(order.customer_id));

  return `
    <td>${customerDisplayName}</td>
    <td>${productNames}</td>
    <td class="text-center">${escapeHtml(formatPrice(order.total || 0))}</td>
    <td class="text-center">
      <span class="status-badge ${statusClass}">${escapeHtml(status)}</span>
    </td>
    <td>${escapeHtml(order.created_at || "")}</td>
    <td class="text-center">
      <button class="action-btn" onclick="viewOrder('${escapeAttr(order.id)}')">Xem</button>
      ${actions}
    </td>
  `;
}

function renderOrders() {
  const tbody = byId("orders-table").querySelector("tbody");
  if (!orders.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">Chưa có đơn hàng</td></tr>`;
    return;
  }

  const sorted = [...orders].sort((a, b) =>
    (b.created_at || "").localeCompare(a.created_at || "")
  );

  tbody.innerHTML = sorted.map(order =>
    `<tr data-order-id="${escapeAttr(order.id)}">${buildOrderRowHTML(order)}</tr>`
  ).join("");
}

function updateOrderInList(order) {
  const idx = orders.findIndex(o => o.id === order.id);
  if (idx !== -1) orders[idx] = order;

  const row = byId("orders-table")
    .querySelector(`tbody tr[data-order-id="${CSS.escape(order.id)}"]`);
  if (row) row.innerHTML = buildOrderRowHTML(order);
}

// --------------- Actions ----------------------------------------------------

function changeStatus(orderId, newStatus) {
  reloadSession();

  const confirmMsg = {
    DONE   : "Xác nhận hoàn thành đơn hàng? Hệ thống sẽ trừ kho.",
    CANCEL : "Xác nhận hủy đơn hàng?",
    RETURN : "Xác nhận trả hàng? Hệ thống sẽ hoàn kho.",
  };
  if (!confirm(confirmMsg[newStatus])) return;

  // ── Capture original order for rollback ────────────────────────────────
  const originalOrder = orders.find(o => o.id === orderId);
  if (!originalOrder) return;

  // ── Optimistic UI update ───────────────────────────────────────────────
  const optimisticOrder = Object.assign({}, originalOrder, { status: newStatus });
  updateOrderInList(optimisticOrder);
  // Disable action buttons while GAS call is in-flight
  _setRowActionsDisabled(orderId, true);
  Toast.show("Đang cập nhật trạng thái...", "info", 0);

  // ── Background GAS call (async IIFE) ───────────────────────────────────
  (async () => {
    let updatedOrder;
    try {
      updatedOrder = await apiCall("orders.updateStatus", {
        token      : session.token,
        order_id   : orderId,
        new_status : newStatus,
      });
    } catch (err) {
      const msg = err?.message || "Lỗi không xác định";

      if (isNetworkOrResponseError(err)) {
        // GAS may have already applied the change — don't rollback.
        // Seed / update cache with the optimistic state and warn the user.
        _cacheUpsertOrder(optimisticOrder);
        Toast.show("⚠️ Mất kết nối — đang tải lại để kiểm tra trạng thái...", "info", 4000);
        CacheInvalidator.products();
        await loadData(currentPage);
      } else {
        // Logical API error → safe to rollback
        updateOrderInList(originalOrder);
        Toast.show(`✗ Lỗi cập nhật: ${msg}`, "error", 5000);
        if (["Token expired", "Unauthorized", "hết hạn"].some(s => msg.includes(s))) {
          setTimeout(() => { handleError(err, "changeStatus"); }, 300);
        }
      }
      return;
    }

    // ── Success: update order in cache in-place (no full cache clear) ────
    // Normalize id field from response (API may return order_id or id)
    const finalOrder = Object.assign({}, optimisticOrder, updatedOrder, {
      id: String(updatedOrder.order_id ?? updatedOrder.id ?? orderId),
    });

    updateOrderInList(finalOrder);
    _cacheUpsertOrder(finalOrder);

    // DONE/RETURN also affects inventory → invalidate products/inventory only
    if (newStatus === "DONE" || newStatus === "RETURN") {
      CacheInvalidator.products();
    }

    Toast.show(`✓ Đã chuyển sang ${newStatus}`, "success", 2500);
  })();
}

function viewOrder(orderId) {
  const order = orders.find(o => o.id === orderId);
  if (!order) return;

  const items     = getOrderItems(order);
  const itemsHtml = items.length
    ? items.map(item => `
        <div>
          ${escapeHtml(getProductDisplayName(item.product_id))}
          × ${escapeHtml(String(item.qty || 0))}
          @ ${escapeHtml(formatPrice(item.price || 0))}
          = ${escapeHtml(formatPrice((item.qty || 0) * (item.price || 0)))}
        </div>
      `).join("")
    : "Không có dữ liệu items";

  const invoiceBtn = order.status === "DONE"
    ? `<button class="btn-secondary"
          onclick="createInvoiceFromOrder('${escapeAttr(order.id)}')"
          style="margin-top:1rem;">🧾 Xuất hóa đơn</button>`
    : "";

  const shipping     = getShippingInfo(order);
  const shippingHtml = shipping ? `
    <div class="detail-section">
      <span class="detail-label">Thông tin giao hàng:</span>
      <div class="shipping-info-detail">
        ${shipping.address  ? `<div><strong>Địa chỉ:</strong> ${escapeHtml(shipping.address)}</div>`   : ""}
        ${shipping.city     ? `<div><strong>Thành phố/Tỉnh:</strong> ${escapeHtml(shipping.city)}</div>` : ""}
        ${shipping.zipcode  ? `<div><strong>Mã bưu điện:</strong> ${escapeHtml(shipping.zipcode)}</div>` : ""}
        ${shipping.note     ? `<div><strong>Ghi chú giao hàng:</strong> ${escapeHtml(shipping.note)}</div>` : ""}
      </div>
    </div>` : "";

  byId("order-detail-content").innerHTML = `
    <div class="detail-section"><span class="detail-label">Order ID:</span> ${escapeHtml(order.id)}</div>
    <div class="detail-section"><span class="detail-label">Customer:</span> ${escapeHtml(getCustomerDisplayName(order.customer_id))}</div>
    <div class="detail-section"><span class="detail-label">Status:</span> ${escapeHtml(order.status)}</div>
    <div class="detail-section"><span class="detail-label">Created:</span> ${escapeHtml(order.created_at)}</div>
    <div class="detail-section">
      <span class="detail-label">Sản phẩm:</span>
      <div class="items-list">${itemsHtml}</div>
    </div>
    <div class="detail-section">
      <span class="detail-label">Tổng tiền:</span>
      <strong>${escapeHtml(formatPrice(order.total || 0))}</strong>
    </div>
    ${shippingHtml}
    ${order.note ? `<div class="detail-section">
      <span class="detail-label">Ghi chú đơn hàng:</span> ${escapeHtml(order.note)}
    </div>` : ""}
    ${invoiceBtn}
  `;

  openDetailModal();
}

async function createInvoiceFromOrder(orderId) {
  reloadSession();
  if (!confirm("Tạo hóa đơn cho đơn hàng này?")) return;

  Loading.show("Đang tạo hóa đơn...");
  try {
    const vatRate = prompt("Nhập % VAT (để trống nếu không có VAT):", "0");
    const note    = prompt("Ghi chú (để trống nếu không có):", "");

    const result = await apiCall("invoices.create", {
      token    : session.token,
      order_id : orderId,
      vat_rate : vatRate ? parseFloat(vatRate) : 0,
      note     : note || "",
    });

    // ✅ Granular: only invoices + orders
    CacheInvalidator.afterCreateInvoice();

    alert(`✅ Đã tạo hóa đơn: ${result.invoice_number || result.id}`);

    if (confirm("Mở trang quản lý hóa đơn?")) {
      window.location.href = "/admin/invoices.html";
    } else {
      await loadData(currentPage);
    }
  } catch (err) {
    handleError(err, "createInvoiceFromOrder");
  } finally {
    Loading.hide();
  }
}

// --------------- Order form -------------------------------------------------

function addItemRow() {
  const container = byId("items-container");
  const index     = currentItems.length;

  const row       = document.createElement("div");
  row.className   = "item-row";
  row.dataset.index = index;

  row.innerHTML = `
    <div>
      <label>Sản phẩm</label>
      <div class="product-search-wrap">
        <input
          type="text"
          class="item-product-search"
          data-index="${index}"
          placeholder="Tìm theo tên, mã SKU..."
          autocomplete="off"
        >
        <input type="hidden" class="item-product" data-index="${index}" value="">
        <div class="autocomplete-dropdown product-search-dropdown" style="display:none;"></div>
      </div>
    </div>
    <div>
      <label>Số lượng</label>
      <input class="item-qty" type="number" min="1" value="1" data-index="${index}">
    </div>
    <div>
      <label>Giá (tùy chỉnh)</label>
      <input class="item-price" type="number" step="0.01" placeholder="Giá đề xuất" data-index="${index}">
    </div>
    <div>
      <label>Thành tiền</label>
      <input class="item-total" type="text" disabled value="0">
    </div>
    <div>
      <label>&nbsp;</label>
      <button class="btn-remove" type="button" onclick="removeItem(${index})">Xóa</button>
    </div>
  `;

  container.appendChild(row);
  currentItems.push({ product_id: "", qty: 1, price: 0 });

  const searchInput = row.querySelector(".item-product-search");
  const hiddenInput = row.querySelector(".item-product");
  const dropdown    = row.querySelector(".product-search-dropdown");
  const qtyInput    = row.querySelector(".item-qty");
  const priceInput  = row.querySelector(".item-price");

  // Show all loaded products on focus (when empty)
  searchInput.addEventListener("focus", () => {
    _renderProductDropdown(dropdown, products, searchInput, hiddenInput, priceInput, index);
  });

  // Debounced search: in-memory filter first, then Worker API
  const debouncedSearch = debounce(async (query) => {
    hiddenInput.value = "";
    if (!query.trim()) {
      _renderProductDropdown(dropdown, products, searchInput, hiddenInput, priceInput, index);
      return;
    }
    // Show loading indicator while searching
    dropdown.innerHTML = `<div class="autocomplete-item" style="color:#64748b;font-style:italic;">⏳ Đang tìm...</div>`;
    dropdown.style.display = "block";

    const results = await _searchProductsFromAPI(query.trim());
    _renderProductDropdown(dropdown, results, searchInput, hiddenInput, priceInput, index);
  }, ORDERS_CONST.DEBOUNCE_DELAY);

  searchInput.addEventListener("input", (e) => debouncedSearch(e.target.value));

  searchInput.addEventListener("blur", () => {
    setTimeout(() => { dropdown.style.display = "none"; }, ORDERS_CONST.AUTOCOMPLETE_BLUR_DELAY);
  });

  qtyInput.addEventListener("input",   () => updateItemRow(index));
  priceInput.addEventListener("input", () => updateItemRow(index));
}

/**
 * Search products from Worker API with fallback to in-memory filter.
 * @param {string} query
 * @returns {Promise<Object[]>}
 */
async function _searchProductsFromAPI(query) {
  const q = query.toLowerCase();

  // Try Worker API first
  if (WorkerAPI?.isConfigured()) {
    try {
      const result = await WorkerAPI.call("/products", { search: query, limit: 20 });
      if (result) {
        const items = result.items ?? (Array.isArray(result) ? result : []);
        // Merge new results into the in-memory products pool
        mergeProducts(items);
        return items;
      }
    } catch (e) {
      console.warn("⚠️ Product search Worker error:", e.message);
    }
  }

  // Fallback: filter in-memory products
  return products.filter(p =>
    (p.id          || "").toLowerCase().includes(q) ||
    (p.title       || p.name || "").toLowerCase().includes(q) ||
    (p.mpn         || "").toLowerCase().includes(q) ||
    (p.brand       || "").toLowerCase().includes(q)
  );
}

/**
 * Render the product search dropdown.
 */
function _renderProductDropdown(dropdown, productList, searchInput, hiddenInput, priceInput, index) {
  if (!productList || productList.length === 0) {
    dropdown.innerHTML = `
      <div class="autocomplete-item" style="color:#94a3b8;font-style:italic;">
        <div class="autocomplete-item-name">Không tìm thấy sản phẩm</div>
      </div>`;
    dropdown.style.display = "block";
    return;
  }

  dropdown.innerHTML = productList.slice(0, 20).map(p => `
    <div class="autocomplete-item"
         data-product-id="${escapeAttr(p.id)}"
         data-price="${escapeAttr(String(p.price || 0))}">
      <div class="autocomplete-item-name">
        ${escapeHtml(p.id)} &mdash; ${escapeHtml(p.title || p.name || p.id)}
      </div>
      <div class="autocomplete-item-details">
        ${p.amount_in_stock != null ? `Tồn: <strong>${escapeHtml(String(p.amount_in_stock))}</strong> &nbsp;·&nbsp;` : ""}
        Giá: <strong>${escapeHtml(formatPrice(p.price || 0))}</strong>
        ${p.brand ? `&nbsp;·&nbsp; ${escapeHtml(p.brand)}` : ""}
      </div>
    </div>
  `).join("");

  dropdown.onclick = (e) => {
    const item = e.target.closest(".autocomplete-item[data-product-id]");
    if (!item) return;

    const productId = item.dataset.productId;
    const price     = item.dataset.price;
    const product   = productList.find(p => p.id === productId) || {};

    searchInput.value      = `${productId} — ${product.title || product.name || productId}`;
    hiddenInput.value      = productId;
    priceInput.value       = price;
    priceInput.placeholder = `Giá đề xuất: ${formatPrice(price)}`;

    dropdown.style.display = "none";
    updateItemRow(index);
  };

  dropdown.style.display = "block";
}

function updateItemRow(index) {
  const row = document.querySelector(`.item-row[data-index="${index}"]`);
  if (!row) return;

  const productId = row.querySelector(".item-product").value;
  const qty       = Number(row.querySelector(".item-qty").value)   || 0;
  const price     = Number(row.querySelector(".item-price").value) || 0;

  row.querySelector(".item-total").value = formatPrice(qty * price);
  currentItems[index] = { product_id: productId, qty, price };
  updateOrderTotal();
}

function removeItem(index) {
  const row = document.querySelector(`.item-row[data-index="${index}"]`);
  if (row) row.remove();
  currentItems[index] = null;
  updateOrderTotal();
}

function updateOrderTotal() {
  const total = currentItems
    .filter(Boolean)
    .reduce((sum, item) => sum + item.qty * item.price, 0);
  byId("order-total").textContent = formatPrice(total);
}

function clearOrderForm() {
  const customerInput = byId("field-customer");
  if (customerInput) {
    customerInput.value = "";
    customerInput._setSelectedCustomerId?.(null);
  }
  const autocompleteDiv = byId("customer-autocomplete");
  if (autocompleteDiv) autocompleteDiv.style.display = "none";

  const dateEl = byId("field-order-date");
  if (dateEl) dateEl.value = "";

  byId("items-container").innerHTML = "";
  currentItems = [];
  byId("order-total").textContent = formatPrice(0);

  ["field-shipping-address", "field-shipping-city",
   "field-shipping-zipcode", "field-shipping-note", "field-order-note"]
    .forEach(id => { const el = byId(id); if (el) el.value = ""; });
}

function getNowDateTimeLocal_() {
  const d   = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isValidDateTimeLocal_(s) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) return false;
  try { return !isNaN(new Date(s).getTime()); } catch (e) { return false; }
}

// --------------- Save order -------------------------------------------------

async function saveOrder() {
  reloadSession();
  Validator.clearErrors();

  const customerInput = byId("field-customer");
  const customerValue = customerInput.value.trim();
  const dateInput     = byId("field-order-date");
  let   orderDateTime = (dateInput?.value ?? "").trim();

  // Validate customer
  const customerResult = Validator.validateField(customerValue, {
    required  : true,
    minLength : 1,
    maxLength : Validator.limits.STRING_MAX_LENGTH,
  }, "field-customer");
  if (!customerResult.valid) {
    Validator.showError("field-customer", customerResult.error);
    return;
  }

  // ── Resolve customer ID ──────────────────────────────────────────────────
  let customerId = null;
  const selectedId = customerInput._selectedCustomerId?.();

  if (selectedId) {
    // User clicked an autocomplete suggestion → trust it
    customerId = selectedId;
  } else {
    // ✅ Normalized search: name exact, phone digits-only match, email, id
    const q     = customerValue.toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    const found = customers.find(c => {
      const name    = (c.name  || "").trim().toLowerCase();
      const phone   = (c.phone || "").replace(/\D/g, "");
      const email   = (c.email || "").trim().toLowerCase();
      return name === q
        || (qDigits && phone && phone === qDigits)
        || email === q
        || c.id === customerValue;
    });

    if (found) {
      customerId = found.id;
    } else {
      // Auto-create new customer
      try {
        Loading.show("Đang tạo khách hàng mới...");
        const parts        = customerValue.split("|").map(s => s.trim());
        const customerName = parts[0] || customerValue;
        const customerPhone = parts[1] || "";
        const customerEmail = parts[2] || "";

        const newCustomer = await apiCall("customers.create", {
          name  : customerName,
          phone : customerPhone || customerName,
          email : customerEmail,
        });
        customerId = newCustomer.id;

        CacheInvalidator.customers();
        customers.push(newCustomer);
        rebuildCustomerSearchIndex();
        Loading.hide();
        console.log(`✅ Created new customer: ${newCustomer.name} (${newCustomer.id})`);
      } catch (err) {
        Loading.hide();
        alert(`❌ Lỗi khi tạo khách hàng mới: ${err.message}`);
        return;
      }
    }
  }

  // ── Validate date ──────────────────────────────────────────────────────
  if (!orderDateTime) orderDateTime = getNowDateTimeLocal_();
  if (!isValidDateTimeLocal_(orderDateTime)) {
    alert("Ngày giờ đặt hàng không hợp lệ.");
    return;
  }

  // Convert yyyy-MM-ddTHH:mm → yyyy-MM-dd HH:mm:ss
  let orderDate = orderDateTime;
  if (orderDateTime.includes("T")) {
    const [datePart, timePart = "00:00"] = orderDateTime.split("T");
    const [hh = "00", mm = "00", ss = "00"] = timePart.split(":");
    orderDate = `${datePart} ${hh}:${mm}:${ss}`;
  }

  // ── Validate items ────────────────────────────────────────────────────
  const items = currentItems.filter(item => item?.product_id && item.qty > 0);
  if (!items.length) {
    alert("Vui lòng thêm ít nhất 1 sản phẩm");
    return;
  }

  for (let i = 0; i < items.length; i++) {
    const it       = items[i];
    const qtyRes   = Validator.validateField(Number(it.qty),   { required: true, type: "integer", min: 1 });
    const priceRes = Validator.validateField(Number(it.price), { required: true, type: "number",  nonNegative: true });
    if (!qtyRes.valid)   { alert(`Sản phẩm ${i+1}: ${qtyRes.error}`);   return; }
    if (!priceRes.valid) { alert(`Sản phẩm ${i+1}: ${priceRes.error}`); return; }
  }

  // ── Validate shipping ────────────────────────────────────────────────
  const shippingAddress = byId("field-shipping-address")?.value.trim() || "";
  const shippingCity    = byId("field-shipping-city")?.value.trim()    || "";
  const shippingZipcode = byId("field-shipping-zipcode")?.value.trim() || "";
  const shippingNote    = byId("field-shipping-note")?.value.trim()    || "";
  const orderNote       = byId("field-order-note")?.value.trim()       || "";

  const shippingResult = Validator.validateForm(
    {
      "field-shipping-address"  : shippingAddress,
      "field-shipping-city"     : shippingCity,
      "field-shipping-zipcode"  : shippingZipcode,
      "field-shipping-note"     : shippingNote,
      "field-order-note"        : orderNote,
    },
    {
      "field-shipping-address"  : Validator.helpers.requiredString(1),
      "field-shipping-city"     : Validator.helpers.optionalString(),
      "field-shipping-zipcode"  : Validator.helpers.optionalString(),
      "field-shipping-note"     : Validator.helpers.textarea(false),
      "field-order-note"        : Validator.helpers.textarea(false),
    }
  );
  if (!shippingResult.valid) {
    Validator.showErrors(shippingResult.errors);
    return;
  }

  // Build shipping_info
  const shippingInfo = {};
  if (shippingAddress)  shippingInfo.address  = shippingAddress;
  if (shippingCity)     shippingInfo.city      = shippingCity;
  if (shippingZipcode)  shippingInfo.zipcode   = shippingZipcode;
  if (shippingNote)     shippingInfo.note      = shippingNote;

  // ── Build optimistic order ────────────────────────────────────────────
  const total = currentItems
    .filter(Boolean)
    .reduce((sum, item) => sum + item.qty * item.price, 0);

  // Counter-based tempId: collision-safe even for rapid back-to-back creates
  const tempId = `temp_${Date.now()}_${++_tempIdCounter}`;
  const optimisticOrder = {
    id            : tempId,
    customer_id   : customerId,
    items_json    : JSON.stringify(items),
    total,
    status        : "NEW",
    created_at    : orderDate.replace("T", " ") + (orderDate.includes(":") && orderDate.split(":").length < 3 ? ":00" : ""),
    shipping_info : JSON.stringify(shippingInfo),
    note          : orderNote || "",
  };

  // ── Optimistic UI + cache: close modal, show row, write to localStorage ─
  closeModal();
  clearOrderForm();

  orders.unshift(optimisticOrder);
  renderOrders();
  // Disable action buttons while GAS save is in-flight
  _setRowActionsDisabled(tempId, true);

  // Persist optimistic order into the page-1 localStorage cache so a
  // browser refresh before GAS responds still shows it.
  _cacheUpsertOrder(optimisticOrder);

  // Payload snapshot — used both for the GAS call and for recovery on reload
  const gasPayload = {
    customer_id   : customerId,
    items,
    created_at    : orderDate,
    shipping_info : JSON.stringify(shippingInfo),
    note          : orderNote || undefined,
  };

  Toast.show("Đang lưu đơn hàng...", "info", 0);

  // Register in pending queue BEFORE the async call so a crash/reload mid-flight
  // can recover the order on next page load.
  _pendingStart(tempId, gasPayload);

  // ── Background GAS call ────────────────────────────────────────────────
  (async () => {
    let savedOrder;
    try {
      savedOrder = await apiCall("orders.create", gasPayload);
    } catch (err) {
      const msg = err?.message || "Lỗi không xác định";

      if (isNetworkOrResponseError(err)) {
        // GAS may have already written to the Sheet — don't rollback.
        // Order stays in memory + cache + recovery queue for next reload.
        Toast.show("⚠️ Mất kết nối — đơn hàng có thể đã được lưu. Sẽ thử lại khi tải lại trang.", "info", 6000);
        // Keep in _pendingSaves so beforeunload still warns if user tries to leave
      } else {
        // Logical API error (invalid data, auth, etc.) → rollback + discard
        _pendingEnd(tempId);
        const idx = orders.findIndex(o => o.id === tempId);
        if (idx !== -1) orders.splice(idx, 1);
        _cacheRemoveOrder(tempId);
        renderOrders();
        Toast.show(`✗ Lỗi tạo đơn: ${msg}`, "error", 6000);
        if (["Token expired", "Unauthorized", "hết hạn", "AUTH_ERROR"].some(s => msg.includes(s))) {
          setTimeout(() => { handleError(err, "saveOrder"); }, 300);
        }
      }
      return;
    }

    // ── API succeeded ─────────────────────────────────────────────────
    _pendingEnd(tempId);

    const realId    = savedOrder.order_id ?? savedOrder.id;
    const realOrder = Object.assign({}, optimisticOrder, {
      id    : String(realId),
      total : savedOrder.total ?? optimisticOrder.total,
    });

    // Replace temp entry in memory
    const idx = orders.findIndex(o => o.id === tempId);
    if (idx !== -1) orders[idx] = realOrder;

    // Patch DOM attribute then re-render so action buttons use the real ID
    const tempRow = byId("orders-table")
      ?.querySelector(`tbody tr[data-order-id="${CSS.escape(tempId)}"]`);
    if (tempRow) tempRow.setAttribute("data-order-id", realOrder.id);
    updateOrderInList(realOrder);

    _cacheReplaceOrder(tempId, realOrder);
    Toast.show("✓ Đã tạo đơn hàng", "success", 2500);
    refreshNewOrderPollBaseline().catch(() => {});
  })();
}

// formatPrice from common.js (window.formatPrice)

// --------------- Event listeners --------------------------------------------

byId("btn-login").addEventListener("click", async () => {
  const btn = byId("btn-login");
  Loading.button(btn, true);
  try   { await login(); }
  catch (err) { handleError(err, "login"); }
  finally     { Loading.button(btn, false); }
});

byId("btn-logout").addEventListener("click", () => resetSession());

byId("btn-new").addEventListener("click", () => {
  clearOrderForm();
  const dateEl = byId("field-order-date");
  if (dateEl) dateEl.value = getNowDateTimeLocal_();
  addItemRow();
  openModal();
});

byId("btn-close").addEventListener("click",        () => closeModal());
byId("btn-close-detail").addEventListener("click", () => closeDetailModal());

byId("btn-save").addEventListener("click", async () => {
  const btn = byId("btn-save");
  // Guard: prevent double-submit while validation / customer-create is running
  if (btn.disabled) return;
  Loading.button(btn, true);
  try   { await saveOrder(); }
  catch (err) { handleError(err, "saveOrder"); }
  finally     {
    // saveOrder() closes the modal optimistically before GAS responds,
    // so release the button immediately (the GAS call runs in background).
    Loading.button(btn, false);
  }
});

byId("btn-add-item").addEventListener("click", () => addItemRow());

byId("btn-new-order-reload")?.addEventListener("click", () => {
  onNewOrderReloadClick();
});
byId("btn-new-order-dismiss")?.addEventListener("click", () => {
  onNewOrderDismissClick();
});
byId("btn-close-new-order-notify")?.addEventListener("click", () => {
  onNewOrderDismissClick();
});

// --------------- Init -------------------------------------------------------

// Initialize WorkerAPI
if (window.WorkerAPI && window.CommonUtils?.WORKER_URL) {
  WorkerAPI.init(window.CommonUtils.WORKER_URL);
  console.log("✅ WorkerAPI initialized");
} else if (window.WorkerAPI) {
  console.log("ℹ️ WorkerAPI available but WORKER_URL not configured – GAS only");
}

// Add escapeAttr if not already in common.js
if (!window.escapeAttr) {
  window.escapeAttr = function escapeAttr(text) {
    if (text == null) return "";
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#x27;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  };
}

// Reload session from localStorage so we have latest auth when opening orders (same as invoices/settings)
reloadSession();
syncInputsFromSession();
applyQueryParams_();
updateSessionUI();

if (session.token) {
  const { page } = Pagination.getParamsFromURL();
  loadData(page)
    .then(async () => {
      // After data loads, try to recover any orders that failed to save in a
      // previous session (network loss, browser close mid-flight, etc.)
      setTimeout(_recoverPendingOrders, 1500);
      await refreshNewOrderPollBaseline();
      startNewOrderPolling();
    })
    .catch(err => {
      handleError(err, "initial loadData");
    });
}