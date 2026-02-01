// Use common utilities from common.js
// DEFAULT_API_URL, sessionDefaults, and session are already declared in common.js
// Just use them directly (they're in global scope) or reference via window.CommonUtils
// No need to redeclare - they're already available

let orders = [];
let products = [];
let customers = [];
let currentPage = 1;
let totalPages = 0;
let totalOrders = 0;
const itemsPerPage = 50;
let currentItems = [];

// Override resetSession to include page-specific cleanup
function resetSession() {
  // Call the original resetSession from common.js
  if (window._originalResetSession) {
    window._originalResetSession();
  }
  // Page-specific cleanup
  orders = [];
  products = [];
  customers = [];
  renderOrders();
}
// Override window.resetSession with our version
window.resetSession = resetSession;

function openModal() {
  byId("order-modal").classList.add("active");
  // ✅ Load customers for autocomplete when opening modal
  loadCustomersForAutocomplete();
}

// ✅ Load customers for autocomplete
async function loadCustomersForAutocomplete() {
  if (!customers || customers.length === 0) {
    // Load customers if not already loaded
    try {
      const customersCacheKey = CacheManager.key("customers", "list", 1, 1000);
      const cachedCustomers = CacheManager.get(customersCacheKey);
      
      if (cachedCustomers) {
        customers = (cachedCustomers.items) ? cachedCustomers.items : (Array.isArray(cachedCustomers) ? cachedCustomers : []);
      } else {
        // Try Worker API first
        let customersData = null;
        if (WorkerAPI && WorkerAPI.isConfigured()) {
          try {
            customersData = await WorkerAPI.customersList({ page: 1, limit: 1000 });
            if (customersData) {
              customers = (customersData.items) ? customersData.items : (Array.isArray(customersData) ? customersData : []);
              CacheManager.set(customersCacheKey, customersData);
            }
          } catch (error) {
            console.error("⚠️ Worker customers error:", error);
          }
        }
        
        // Fallback to GAS
        if (!customersData) {
          const customersResult = await apiCall("customers.list", { page: 1, limit: 1000 });
          customers = (customersResult && customersResult.items) ? customersResult.items : (Array.isArray(customersResult) ? customersResult : []);
          CacheManager.set(customersCacheKey, customersResult);
        }
      }
    } catch (err) {
      console.error("Error loading customers:", err);
    }
  }
  
  // Setup autocomplete
  setupCustomerAutocomplete();
}

// ✅ Setup customer autocomplete/search
function setupCustomerAutocomplete() {
  const customerInput = byId("field-customer");
  const autocompleteDiv = byId("customer-autocomplete");
  let selectedCustomerId = null;
  let filteredCustomers = [];
  
  if (!customerInput || !autocompleteDiv) return;
  
  // Clear previous listeners if any
  if (customerInput._inputHandler) {
    customerInput.removeEventListener("input", customerInput._inputHandler);
  }
  if (customerInput._blurHandler) {
    customerInput.removeEventListener("blur", customerInput._blurHandler);
  }
  if (customerInput._keydownHandler) {
    customerInput.removeEventListener("keydown", customerInput._keydownHandler);
  }
  
  function handleCustomerInput(e) {
    const query = e.target.value.trim().toLowerCase();
    selectedCustomerId = null;
    
    if (query.length === 0) {
      autocompleteDiv.style.display = "none";
      return;
    }
    
    // Filter customers by name or phone
    filteredCustomers = customers.filter(c => {
      const name = (c.name || "").toLowerCase();
      const phone = (c.phone || "").toLowerCase();
      const id = (c.id || "").toLowerCase();
      return name.includes(query) || phone.includes(query) || id.includes(query);
    });
    
    // Show autocomplete dropdown
    if (filteredCustomers.length > 0) {
      autocompleteDiv.innerHTML = filteredCustomers.map((c, index) => `
        <div class="autocomplete-item" data-index="${index}" data-customer-id="${c.id}">
          <div class="autocomplete-item-name">${c.name || c.id}</div>
          <div class="autocomplete-item-details">${c.phone || ""} ${c.email ? `• ${c.email}` : ""}</div>
        </div>
      `).join("");
      
      // Add click handlers
      autocompleteDiv.querySelectorAll(".autocomplete-item").forEach(item => {
        item.addEventListener("click", () => {
          const index = parseInt(item.dataset.index);
          const customer = filteredCustomers[index];
          customerInput.value = customer.name || customer.id;
          selectedCustomerId = customer.id;
          autocompleteDiv.style.display = "none";
        });
      });
      
      autocompleteDiv.style.display = "block";
    } else {
      // No matches - show option to create new
      autocompleteDiv.innerHTML = `
        <div class="autocomplete-item" style="color: #3b82f6; font-style: italic;">
          <div class="autocomplete-item-name">Tạo khách hàng mới: "${query}"</div>
          <div class="autocomplete-item-details">Nhấn Enter để tạo mới</div>
        </div>
      `;
      autocompleteDiv.style.display = "block";
    }
  }
  
  function handleCustomerBlur(e) {
    // Delay to allow click on autocomplete item
    setTimeout(() => {
      autocompleteDiv.style.display = "none";
    }, 200);
  }
  
  function handleCustomerKeydown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (filteredCustomers.length > 0) {
        // Select first match
        const firstItem = autocompleteDiv.querySelector(".autocomplete-item");
        if (firstItem) firstItem.click();
      } else {
        // Will create new customer in saveOrder()
        autocompleteDiv.style.display = "none";
      }
    } else if (e.key === "Escape") {
      autocompleteDiv.style.display = "none";
    }
  }
  
  // Add event listeners
  customerInput.addEventListener("input", handleCustomerInput);
  customerInput.addEventListener("blur", handleCustomerBlur);
  customerInput.addEventListener("keydown", handleCustomerKeydown);
  
  // Store handlers and selected customer ID getter/setter
  customerInput._inputHandler = handleCustomerInput;
  customerInput._blurHandler = handleCustomerBlur;
  customerInput._keydownHandler = handleCustomerKeydown;
  customerInput._selectedCustomerId = () => selectedCustomerId;
  customerInput._setSelectedCustomerId = (id) => { selectedCustomerId = id; };
}

function closeModal() {
  byId("order-modal").classList.remove("active");
}

function openDetailModal() {
  byId("detail-modal").classList.add("active");
}

function closeDetailModal() {
  byId("detail-modal").classList.remove("active");
}

// apiCall is now from common.js

async function login() {
  // session is from common.js global scope
  session.apiUrl = window.CommonUtils.DEFAULT_API_URL;
  session.apiKey = byId("api_key").value.trim();
  session.email = byId("email").value.trim();
  const password = byId("password").value;

  if (!session.apiKey || !session.email || !password) {
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
  
  // Update common session
  if (window.CommonUtils) {
    window.CommonUtils.session = session;
  }
  
  updateSessionUI();
  const urlParams = Pagination.getParamsFromURL();
  await loadData(urlParams.page);
}

async function loadData(page, forceFromGAS = false) {
  // Only read from URL when caller doesn't explicitly pass a page
  if (page == null) {
    const urlParams = Pagination.getParamsFromURL();
    page = urlParams.page;
  }
  
  currentPage = page;
  
  return apiCallWithLoading(async () => {
    // ✅ Step 1: Check frontend cache first (localStorage) - skip if forceFromGAS
    const ordersCacheKey = CacheManager.key("orders", "list", page, itemsPerPage);
    const cachedOrders = forceFromGAS ? null : CacheManager.get(ordersCacheKey);
    
    if (cachedOrders) {
      console.log("📦 Using cached orders data (localStorage)");
      orders = cachedOrders.items || [];
      totalOrders = cachedOrders.total || 0;
      totalPages = cachedOrders.totalPages || 0;
      currentPage = cachedOrders.page || 1;
    } else {
      // ✅ Step 2: Try Cloudflare Worker first (fast, edge network) - skip if forceFromGAS
      let ordersResult = null;
      
      if (!forceFromGAS && WorkerAPI && WorkerAPI.isConfigured()) {
        try {
          console.log("🚀 Trying Cloudflare Worker for orders.list...");
          ordersResult = await WorkerAPI.ordersList({
            page: page,
            limit: itemsPerPage
          });
          
          if (ordersResult) {
            console.log("✅ Worker cache HIT! Loaded from Cloudflare KV");
          } else {
            console.log("⚠️ Worker cache MISS, falling back to GAS");
          }
        } catch (error) {
          console.error("⚠️ Worker error:", error);
          console.log("Falling back to GAS...");
        }
      } else if (forceFromGAS) {
        console.log("🔄 Force reload from GAS (bypassing Worker cache)...");
      }
      
      // ✅ Step 3: Fallback to GAS if Worker fails or cache miss or forceFromGAS
      if (!ordersResult) {
        console.log("📡 Fetching from GAS /exec endpoint...");
        ordersResult = await apiCall("orders.list", {
          page: page,
          limit: itemsPerPage
        });
      }
      
      orders = ordersResult.items || [];
      totalOrders = ordersResult.total || 0;
      totalPages = ordersResult.totalPages || 0;
      currentPage = ordersResult.page || 1;
      
      // Save to frontend cache
      CacheManager.set(ordersCacheKey, ordersResult);
    }
    
    // ✅ Load products and customers in parallel (not sequential) for better performance
    // ✅ Try Worker API first, then fallback to GAS
    const [productsResult, customersResult] = await Promise.all([
      // Load products
      (async () => {
        const productsCacheKey = CacheManager.key("products", "list", 1, 1000);
        const cachedProducts = CacheManager.get(productsCacheKey);
        
        if (cachedProducts) {
          console.log("📦 Using cached products data");
          return (cachedProducts.items) ? cachedProducts.items : (Array.isArray(cachedProducts) ? cachedProducts : []);
        }
        
        // ✅ Try Worker API first
        let productsData = null;
        if (WorkerAPI && WorkerAPI.isConfigured()) {
          try {
            productsData = await WorkerAPI.productsList({ page: 1, limit: 1000 });
            if (productsData) {
              console.log("✅ Products loaded from Worker cache");
              const productsList = (productsData.items) ? productsData.items : (Array.isArray(productsData) ? productsData : []);
              CacheManager.set(productsCacheKey, productsData);
              return productsList;
            }
          } catch (error) {
            console.error("⚠️ Worker products error:", error);
          }
        }
        
        // Fallback to GAS
        console.log("📡 Loading products from GAS...");
        const productsResult = await apiCall("products.list", { page: 1, limit: 1000 });
        const productsList = (productsResult && productsResult.items) ? productsResult.items : (Array.isArray(productsResult) ? productsResult : []);
        CacheManager.set(productsCacheKey, productsResult);
        return productsList;
      })(),
      
      // Load customers
      (async () => {
        const customersCacheKey = CacheManager.key("customers", "list", 1, 1000);
        const cachedCustomers = CacheManager.get(customersCacheKey);
        
        if (cachedCustomers) {
          console.log("📦 Using cached customers data");
          return (cachedCustomers.items) ? cachedCustomers.items : (Array.isArray(cachedCustomers) ? cachedCustomers : []);
        }
        
        // ✅ Try Worker API first (if available)
        let customersData = null;
        if (WorkerAPI && WorkerAPI.isConfigured()) {
          try {
            customersData = await WorkerAPI.customersList({ page: 1, limit: 1000 });
            if (customersData) {
              console.log("✅ Customers loaded from Worker cache");
              const customersList = (customersData.items) ? customersData.items : (Array.isArray(customersData) ? customersData : []);
              CacheManager.set(customersCacheKey, customersData);
              return customersList;
            }
          } catch (error) {
            console.error("⚠️ Worker customers error:", error);
          }
        }
        
        // Fallback to GAS
        console.log("📡 Loading customers from GAS...");
        const customersResult = await apiCall("customers.list", { page: 1, limit: 1000 });
        const customersList = (customersResult && customersResult.items) ? customersResult.items : (Array.isArray(customersResult) ? customersResult : []);
        CacheManager.set(customersCacheKey, customersResult);
        return customersList;
      })()
    ]);
    
    products = productsResult;
    customers = customersResult;
    
    // ✅ Clear productsMap to force rebuild on next render
    window.productsMap = null;
    
    renderOrders();
    renderPagination();
    
    // Update URL
    Pagination.updateURL(currentPage, itemsPerPage);
  }, "Đang tải đơn hàng...");
}

function renderPagination() {
  Pagination.render(
    "orders-pagination",
    currentPage,
    totalPages,
    totalOrders,
    loadData,
    "đơn hàng"
  );
}

// ✅ Helper function to get customer display name
// Priority: name → phone → email → id
function getCustomerDisplayName(customerId) {
  if (!customerId) return "";
  
  // Find customer in customers array
  const customer = customers.find(c => c.id === customerId);
  
  if (!customer) {
    return customerId; // Fallback to ID if customer not found
  }
  
  // Priority: name → phone → email → id
  return customer.name || customer.phone || customer.email || customer.id || customerId;
}

function renderOrders() {
  const tbody = byId("orders-table").querySelector("tbody");
  if (!orders.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">Chưa có đơn hàng</td></tr>`;
    return;
  }

  // ✅ Sort orders by created_at desc (newest first) - ensure consistent sorting
  const sortedOrders = [...orders].sort((a, b) => {
    const dateA = a.created_at || "";
    const dateB = b.created_at || "";
    return dateB.localeCompare(dateA);
  });

  // ✅ Create products Map once for O(1) lookup (instead of find() which is O(n))
  // This significantly improves performance when rendering many orders
  if (!window.productsMap || window.productsMap.size === 0) {
    window.productsMap = new Map();
    if (products && Array.isArray(products)) {
      products.forEach(p => {
        if (p.id) {
          window.productsMap.set(p.id, p.title || p.name || p.id);
        }
      });
    }
  }

  tbody.innerHTML = sortedOrders.map(order => {
    const status = order.status || "NEW";
    const statusClass = getStatusClass(status);
    const actions = getStatusActions(order.id, status);
    
    // ✅ Get product names from items_json (optimized with Map for O(1) lookup)
    let productNames = "";
    try {
      const items = JSON.parse(order.items_json || "[]");
      if (Array.isArray(items) && items.length > 0) {
        // Get product names using Map lookup (O(1) instead of O(n))
        const productNameList = items.map(item => {
          const productId = item.product_id || "";
          return window.productsMap.get(productId) || productId;
        });
        productNames = productNameList.join(", ");
      }
    } catch (e) {
      productNames = "";
    }
    
    // ✅ Get customer display name (name → phone → email → id)
    const customerDisplayName = getCustomerDisplayName(order.customer_id);
    
    return `
      <tr data-order-id="${order.id}">
        <td>${customerDisplayName}</td>
        <td>${productNames || "-"}</td>
        <td class="text-center">${formatPrice(order.total || 0)}</td>
        <td class="text-center"><span class="status-badge ${statusClass}">${status}</span></td>
        <td>${order.created_at || ""}</td>
        <td class="text-center">
          <button class="action-btn" onclick="viewOrder('${order.id}')">Xem</button>
          ${actions}
        </td>
      </tr>
    `;
  }).join("");
}

function updateOrderInList(order) {
  // Update in orders array
  const index = orders.findIndex(o => o.id === order.id);
  if (index !== -1) {
    orders[index] = order;
  }
  
  // Update in DOM
  const tbody = byId("orders-table").querySelector("tbody");
  const row = tbody.querySelector(`tr[data-order-id="${order.id}"]`);
  if (row) {
    const status = order.status || "NEW";
    const statusClass = getStatusClass(status);
    const actions = getStatusActions(order.id, status);
    
    // ✅ Get product names from items_json (optimized with Map for O(1) lookup)
    let productNames = "";
    try {
      const items = JSON.parse(order.items_json || "[]");
      if (Array.isArray(items) && items.length > 0) {
        // Ensure productsMap exists
        if (!window.productsMap || window.productsMap.size === 0) {
          window.productsMap = new Map();
          if (products && Array.isArray(products)) {
            products.forEach(p => {
              if (p.id) {
                window.productsMap.set(p.id, p.title || p.name || p.id);
              }
            });
          }
        }
        
        // Get product names using Map lookup (O(1) instead of O(n))
        const productNameList = items.map(item => {
          const productId = item.product_id || "";
          return window.productsMap.get(productId) || productId;
        });
        productNames = productNameList.join(", ");
      }
    } catch (e) {
      productNames = "";
    }
    
    // ✅ Get customer display name (name → phone → email → id)
    const customerDisplayName = getCustomerDisplayName(order.customer_id);
    
    row.innerHTML = `
      <td>${customerDisplayName}</td>
      <td>${productNames || "-"}</td>
      <td class="text-center">${formatPrice(order.total || 0)}</td>
      <td class="text-center"><span class="status-badge ${statusClass}">${status}</span></td>
      <td>${order.created_at || ""}</td>
      <td class="text-center">
        <button class="action-btn" onclick="viewOrder('${order.id}')">Xem</button>
        ${actions}
      </td>
    `;
  }
}

function getStatusClass(status) {
  const classes = {
    "NEW": "status-new",
    "DONE": "status-done",
    "CANCEL": "status-cancel",
    "RETURN": "status-return"
  };
  return classes[status] || "";
}

function getStatusActions(orderId, status) {
  let actions = [];
  
  if (status === "NEW") {
    actions.push(`<button class="action-btn status-btn" onclick="changeStatus('${orderId}', 'DONE')">✓ Done</button>`);
    actions.push(`<button class="action-btn status-btn cancel-btn" onclick="changeStatus('${orderId}', 'CANCEL')">✕ Cancel</button>`);
  } else if (status === "DONE") {
    actions.push(`<button class="action-btn status-btn return-btn" onclick="changeStatus('${orderId}', 'RETURN')">↩ Return</button>`);
    actions.push(`<button class="action-btn invoice-btn" onclick="createInvoiceFromOrder('${orderId}')" title="Xuất hóa đơn">🧾 Hóa đơn</button>`);
  }
  
  return actions.join(" ");
}

async function changeStatus(orderId, newStatus) {
  // ✅ Reload session from localStorage to ensure token is up to date
  reloadSession();
  
  const confirmMsg = {
    "DONE": "Xác nhận hoàn thành đơn hàng? Hệ thống sẽ trừ kho.",
    "CANCEL": "Xác nhận hủy đơn hàng?",
    "RETURN": "Xác nhận trả hàng? Hệ thống sẽ hoàn kho."
  };
  
  if (!confirm(confirmMsg[newStatus])) return;
  
  Loading.show("Đang cập nhật trạng thái...");
  try {
    const updatedOrder = await apiCall("orders.updateStatus", {
      token: session.token,
      order_id: orderId,
      new_status: newStatus
    });
    
    // ✅ Clear ALL cache after write action (update status)
    // This ensures no stale cache remains, especially for products (amount_in_stock)
    const oldStatus = updatedOrder.old_status || "unknown";
    console.log(`🔄 Clearing all cache (status change: ${oldStatus} → ${newStatus})`);
    
    // ✅ Use common function to clear all cache
    CacheManager.clearAllCache();
    
    // ✅ Also invalidate specific caches to be thorough
    CacheManager.invalidateOnOrderChange();
    
    // ✅ If status is DONE or RETURN, inventory changed → ensure products cache is cleared
    if (newStatus === "DONE" || newStatus === "RETURN") {
      console.log(`🔄 Inventory changed (${oldStatus} → ${newStatus}), ensuring products cache is cleared`);
      CacheManager.invalidateOnInventoryChange();
    }
    
    // ✅ Force reload from GAS to ensure fresh data
    // Clear frontend cache to force reload
    const ordersCacheKey = CacheManager.key("orders", "list", currentPage, itemsPerPage);
    CacheManager.remove(ordersCacheKey);
    
    // ✅ Update order in list directly instead of reloading
    updateOrderInList(updatedOrder);
    
    alert(`✅ Đã chuyển trạng thái sang ${newStatus}`);
  } catch (err) {
    // ✅ Handle token expiration - prompt user to login again
    if (err.message && (err.message.includes("Token expired") || err.message.includes("Unauthorized") || err.message.includes("hết hạn"))) {
      alert("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
      resetSession();
      window.location.reload();
    } else {
      alert(`❌ Lỗi: ${err.message}`);
    }
  } finally {
    Loading.hide();
  }
}

function viewOrder(orderId) {
  const order = orders.find(o => o.id === orderId);
  if (!order) return;
  
  let itemsHtml = "";
  try {
    const items = JSON.parse(order.items_json || "[]");
    itemsHtml = items.map(item => `
      <div>${item.product_id || ""} × ${item.qty || 0} @ ${formatPrice(item.price || 0)} = ${formatPrice((item.qty || 0) * (item.price || 0))}</div>
    `).join("");
  } catch (e) {
    itemsHtml = "Không có dữ liệu items";
  }
  
  let invoiceBtn = "";
  if (order.status === "DONE") {
    invoiceBtn = `<button class="btn-secondary" onclick="createInvoiceFromOrder('${order.id}')" style="margin-top: 1rem;">🧾 Xuất hóa đơn</button>`;
  }
  
  // ✅ Get customer display name (name → phone → email → id)
  const customerDisplayName = getCustomerDisplayName(order.customer_id);
  
  byId("order-detail-content").innerHTML = `
    <div class="detail-section">
      <span class="detail-label">Order ID:</span> ${order.id}
    </div>
    <div class="detail-section">
      <span class="detail-label">Customer:</span> ${customerDisplayName}
    </div>
    <div class="detail-section">
      <span class="detail-label">Status:</span> ${order.status}
    </div>
    <div class="detail-section">
      <span class="detail-label">Created:</span> ${order.created_at}
    </div>
    <div class="detail-section">
      <span class="detail-label">Sản phẩm:</span>
      <div class="items-list">${itemsHtml}</div>
    </div>
    <div class="detail-section">
      <span class="detail-label">Tổng tiền:</span> <strong>${formatPrice(order.total || 0)}</strong>
    </div>
    ${invoiceBtn}
  `;
  
  openDetailModal();
}

async function createInvoiceFromOrder(orderId) {
  // ✅ Reload session from localStorage to ensure token is up to date
  reloadSession();
  
  if (!confirm("Tạo hóa đơn cho đơn hàng này?")) return;
  
  Loading.show("Đang tạo hóa đơn...");
  try {
    // Prompt for VAT rate (optional)
    const vatRate = prompt("Nhập % VAT (để trống nếu không có VAT):", "0");
    const vatRateNum = vatRate ? parseFloat(vatRate) : 0;
    
    // Prompt for note (optional)
    const note = prompt("Ghi chú (để trống nếu không có):", "");
    
    const result = await apiCall("invoices.create", {
      token: session.token,
      order_id: orderId,
      vat_rate: vatRateNum,
      note: note || ""
    });
    
    // ✅ Clear ALL cache after write action (create invoice)
    CacheManager.clearAllCache();
    
    // ✅ Also invalidate specific caches to be thorough
    CacheManager.invalidateOnInvoiceChange();
    
    alert(`✅ Đã tạo hóa đơn: ${result.invoice_number || result.id}\n\nBạn có muốn xem hóa đơn ngay?`);
    
    // Option to view invoice
    if (confirm("Mở trang quản lý hóa đơn?")) {
      window.location.href = "/admin/invoices.html";
    } else {
      await loadData(currentPage);
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
  } finally {
    Loading.hide();
  }
}

function addItemRow() {
  const container = byId("items-container");
  const index = currentItems.length;
  
  const row = document.createElement("div");
  row.className = "item-row";
  row.dataset.index = index;
  row.innerHTML = `
    <div>
      <label>Sản phẩm</label>
      <select class="item-product" data-index="${index}">
        <option value="">Chọn sản phẩm</option>
        ${products.map(p => `
          <option value="${p.id}" data-price="${p.price || 0}">${p.id} - ${p.title || p.name}</option>
        `).join("")}
      </select>
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
  
  currentItems.push({
    product_id: "",
    qty: 1,
    price: 0
  });
  
  // Event listeners
  const productSelect = row.querySelector(".item-product");
  const qtyInput = row.querySelector(".item-qty");
  const priceInput = row.querySelector(".item-price");
  
  productSelect.addEventListener("change", function() {
    const selectedOption = productSelect.options[productSelect.selectedIndex];
    const defaultPrice = selectedOption.getAttribute("data-price") || 0;
    priceInput.value = defaultPrice;
    priceInput.placeholder = `Giá đề xuất: ${formatPrice(defaultPrice)}`;
    updateItemRow(index);
  });
  
  qtyInput.addEventListener("input", () => updateItemRow(index));
  priceInput.addEventListener("input", () => updateItemRow(index));
}

function updateItemRow(index) {
  const row = document.querySelector(`.item-row[data-index="${index}"]`);
  if (!row) return;
  
  const productId = row.querySelector(".item-product").value;
  const qty = Number(row.querySelector(".item-qty").value) || 0;
  const price = Number(row.querySelector(".item-price").value) || 0;
  const total = qty * price;
  
  row.querySelector(".item-total").value = formatPrice(total);
  
  currentItems[index] = {
    product_id: productId,
    qty: qty,
    price: price
  };
  
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
    .filter(item => item)
    .reduce((sum, item) => sum + (item.qty * item.price), 0);
  byId("order-total").textContent = formatPrice(total);
}

function clearOrderForm() {
  const customerInput = byId("field-customer");
  if (customerInput) {
    customerInput.value = "";
    if (customerInput._setSelectedCustomerId) {
      customerInput._setSelectedCustomerId(null);
    }
  }
  const autocompleteDiv = byId("customer-autocomplete");
  if (autocompleteDiv) {
    autocompleteDiv.style.display = "none";
  }
  const dateEl = byId("field-order-date");
  if (dateEl) dateEl.value = "";
  byId("items-container").innerHTML = "";
  currentItems = [];
  byId("order-total").textContent = formatPrice(0);
}

function getNowDateTimeLocal_() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function isValidDateTimeLocal_(s) {
  // Format: yyyy-MM-ddTHH:mm hoặc yyyy-MM-ddTHH:mm:ss
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) return false;
  try {
    const dt = new Date(s);
    return !isNaN(dt.getTime());
  } catch (e) {
    return false;
  }
}

async function saveOrder() {
  // ✅ Reload session from localStorage to ensure token is up to date
  reloadSession();
  
  const customerInput = byId("field-customer");
  const customerValue = customerInput.value.trim();
  const dateInput = byId("field-order-date");
  let orderDateTime = (dateInput && dateInput.value) ? String(dateInput.value).trim() : "";
  
  if (!customerValue) {
    alert("Vui lòng nhập tên khách hàng");
    return;
  }
  
  // ✅ Check if customer was selected from autocomplete or needs to be created
  let customerId = null;
  const selectedCustomerId = customerInput._selectedCustomerId ? customerInput._selectedCustomerId() : null;
  
  if (selectedCustomerId) {
    // Customer was selected from autocomplete
    customerId = selectedCustomerId;
  } else {
    // Try to find customer by name or phone
    const foundCustomer = customers.find(c => {
      const name = (c.name || "").toLowerCase();
      const phone = (c.phone || "").toLowerCase();
      const query = customerValue.toLowerCase();
      return name === query || phone === query || c.id === customerValue;
    });
    
    if (foundCustomer) {
      customerId = foundCustomer.id;
    } else {
      // ✅ Auto-create new customer if not found
      try {
        Loading.show("Đang tạo khách hàng mới...");
        
        // Parse customer value: could be "name" or "name|phone" or "name|phone|email"
        const parts = customerValue.split("|").map(s => s.trim());
        const customerName = parts[0] || customerValue;
        const customerPhone = parts[1] || "";
        const customerEmail = parts[2] || "";
        
        const newCustomer = await apiCall("customers.create", {
          name: customerName,
          phone: customerPhone || customerName, // Use name as phone if phone not provided
          email: customerEmail
        });
        
        customerId = newCustomer.id;
        
        // ✅ Clear ALL cache after write action (create customer)
        CacheManager.clearAllCache();
        
        // ✅ Also invalidate customers cache specifically
        CacheManager.clear('^customers_');
        
        // ✅ Add to local customers array
        customers.push(newCustomer);
        
        Loading.hide();
        console.log(`✅ Created new customer: ${newCustomer.name} (${newCustomer.id})`);
      } catch (err) {
        Loading.hide();
        alert(`❌ Lỗi khi tạo khách hàng mới: ${err.message}`);
        return;
      }
    }
  }

  if (!orderDateTime) {
    orderDateTime = getNowDateTimeLocal_();
  }
  // Convert datetime-local format (yyyy-MM-ddTHH:mm) to yyyy-MM-dd HH:mm:ss for backend
  if (!isValidDateTimeLocal_(orderDateTime)) {
    alert("Ngày giờ đặt hàng không hợp lệ. Vui lòng nhập đúng định dạng.");
    return;
  }
  
  // Convert to format backend expects: yyyy-MM-dd HH:mm:ss
  // datetime-local gives yyyy-MM-ddTHH:mm, we need to add seconds and replace T with space
  let orderDate = orderDateTime;
  if (orderDateTime.includes("T")) {
    const parts = orderDateTime.split("T");
    const datePart = parts[0];
    const timePart = parts[1] || "00:00";
    // Ensure time has seconds
    const timeParts = timePart.split(":");
    const hh = timeParts[0] || "00";
    const mm = timeParts[1] || "00";
    const ss = timeParts[2] || "00";
    orderDate = `${datePart} ${hh}:${mm}:${ss}`;
  }
  
  const items = currentItems.filter(item => item && item.product_id && item.qty > 0);
  
  if (!items.length) {
    alert("Vui lòng thêm ít nhất 1 sản phẩm");
    return;
  }

  // Validate qty & price
  for (const it of items) {
    const qty = Number(it.qty);
    const price = Number(it.price);
    if (!Number.isFinite(qty) || qty <= 0 || Math.floor(qty) !== qty) {
      alert("Số lượng không hợp lệ (phải là số nguyên > 0).");
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      alert("Giá không hợp lệ (phải là số >= 0).");
      return;
    }
  }

  try {
    const result = await apiCall("orders.create", {
      customer_id: customerId,
      items: items,
      created_at: orderDate // Format: yyyy-MM-dd HH:mm:ss
    });

    // ✅ Clear ALL cache after write action (create)
    CacheManager.clearAllCache();
    
    // ✅ Also invalidate specific caches to be thorough
    CacheManager.invalidateOnOrderChange();
    
    closeModal();
    clearOrderForm();
    
    // ✅ Force reload from GAS (bypass Worker cache) to ensure fresh data with new order
    // Clear ALL orders cache keys to force reload
    CacheManager.clear('^orders_');
    
    // ✅ Small delay to ensure backend snapshot is complete
    // (Backend snapshot is async, but we wait a bit to be safe)
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // ✅ Load page 1 to show new order - force from GAS to bypass Worker cache
    await loadData(1, true); // true = forceFromGAS
    
    // ✅ After loadData, ensure UI is updated (loadData already calls renderOrders internally)
    // But we can force render again to be safe
    renderOrders();
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

function formatPrice(price) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND'
  }).format(price);
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

byId("btn-new").addEventListener("click", () => {
  clearOrderForm();
  // Auto-fill datetime-local với ngày giờ hiện tại
  const dateEl = byId("field-order-date");
  if (dateEl) {
    dateEl.value = getNowDateTimeLocal_();
  }
  addItemRow();
  openModal();
});

byId("btn-close").addEventListener("click", () => {
  closeModal();
});

byId("btn-close-detail").addEventListener("click", () => {
  closeDetailModal();
});

byId("btn-save").addEventListener("click", async () => {
  const btn = byId("btn-save");
  Loading.button(btn, true);
  try {
    await saveOrder();
  } catch (err) {
    alert(err.message);
  } finally {
    Loading.button(btn, false);
  }
});

byId("btn-add-item").addEventListener("click", () => {
  addItemRow();
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
