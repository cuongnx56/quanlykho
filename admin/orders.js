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

async function loadData(page) {
  // Only read from URL when caller doesn't explicitly pass a page
  if (page == null) {
    const urlParams = Pagination.getParamsFromURL();
    page = urlParams.page;
  }
  
  currentPage = page;
  
  return apiCallWithLoading(async () => {
    // Check cache for orders
    const ordersCacheKey = CacheManager.key("orders", "list", page, itemsPerPage);
    const cachedOrders = CacheManager.get(ordersCacheKey);
    
    if (cachedOrders) {
      console.log("📦 Using cached orders data");
      orders = cachedOrders.items || [];
      totalOrders = cachedOrders.total || 0;
      totalPages = cachedOrders.totalPages || 0;
      currentPage = cachedOrders.page || 1;
    } else {
      const ordersResult = await apiCall("orders.list", {
        page: page,
        limit: itemsPerPage
      });
      
      orders = ordersResult.items || [];
      totalOrders = ordersResult.total || 0;
      totalPages = ordersResult.totalPages || 0;
      currentPage = ordersResult.page || 1;
      
      CacheManager.set(ordersCacheKey, ordersResult);
    }
    
    // Load products (check cache)
    const productsCacheKey = CacheManager.key("products", "list", 1, 1000);
    const cachedProducts = CacheManager.get(productsCacheKey);
    
    if (cachedProducts) {
      console.log("📦 Using cached products data");
      products = (cachedProducts.items) ? cachedProducts.items : (Array.isArray(cachedProducts) ? cachedProducts : []);
    } else {
      const productsResult = await apiCall("products.list", { page: 1, limit: 1000 });
      products = (productsResult && productsResult.items) ? productsResult.items : (Array.isArray(productsResult) ? productsResult : []);
      CacheManager.set(productsCacheKey, productsResult);
    }
    
    // Load customers (no cache for now, usually small dataset)
    customers = await apiCall("customers.list");
    
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

function renderOrders() {
  const tbody = byId("orders-table").querySelector("tbody");
  if (!orders.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">Chưa có đơn hàng</td></tr>`;
    return;
  }

  tbody.innerHTML = orders.map(order => {
    const status = order.status || "NEW";
    const statusClass = getStatusClass(status);
    const actions = getStatusActions(order.id, status);
    
    return `
      <tr>
        <td>${order.customer || ""}</td>
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
  }
  
  return actions.join(" ");
}

async function changeStatus(orderId, newStatus) {
  const confirmMsg = {
    "DONE": "Xác nhận hoàn thành đơn hàng? Hệ thống sẽ trừ kho.",
    "CANCEL": "Xác nhận hủy đơn hàng?",
    "RETURN": "Xác nhận trả hàng? Hệ thống sẽ hoàn kho."
  };
  
  if (!confirm(confirmMsg[newStatus])) return;
  
  Loading.show("Đang cập nhật trạng thái...");
  try {
    await apiCall("orders.updateStatus", {
      token: session.token,
      order_id: orderId,
      new_status: newStatus
    });
    
    // ✅ Invalidate cache after status change
    CacheManager.invalidateOnOrderChange();
    
    alert(`✅ Đã chuyển trạng thái sang ${newStatus}`);
    await loadData(currentPage);
  } catch (err) {
    alert(`❌ Lỗi: ${err.message}`);
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
  
  byId("order-detail-content").innerHTML = `
    <div class="detail-section">
      <span class="detail-label">Order ID:</span> ${order.id}
    </div>
    <div class="detail-section">
      <span class="detail-label">Customer:</span> ${order.customer}
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
  `;
  
  openDetailModal();
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
  byId("field-customer").value = "";
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
  const customerId = byId("field-customer").value.trim();
  const dateInput = byId("field-order-date");
  let orderDateTime = (dateInput && dateInput.value) ? String(dateInput.value).trim() : "";
  
  if (!customerId) {
    alert("Vui lòng nhập Customer ID");
    return;
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

  await apiCall("orders.create", {
    customer: customerId,
    items: items,
    created_at: orderDate // Format: yyyy-MM-dd HH:mm:ss
  });

  // ✅ Invalidate cache after create
  CacheManager.invalidateOnOrderChange();

  closeModal();
  clearOrderForm();
  await loadData(1);
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
