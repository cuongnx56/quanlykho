// Use common utilities from common.js
// DEFAULT_API_URL, sessionDefaults, and session are already declared in common.js
// Just use them directly (they're in global scope) or reference via window.CommonUtils
// No need to redeclare - they're already available

let products = [];
let editMode = "create";
let currentPage = 1;
let totalPages = 0;
let totalProducts = 0;
const itemsPerPage = 50;

// Override resetSession to include page-specific cleanup
function resetSession() {
  // Call the original resetSession from common.js
  if (window._originalResetSession) {
    window._originalResetSession();
  }
  // Page-specific cleanup
  products = [];
  renderProducts();
}
// Override window.resetSession with our version
window.resetSession = resetSession;

function openModal() {
  byId("product-modal").classList.add("active");
}

function closeModal() {
  byId("product-modal").classList.remove("active");
}

function clearForm() {
  byId("field-id").value = "";
  byId("field-title").value = "";
  byId("field-description").value = "";
  byId("field-availability").value = "";
  byId("field-image-link").value = "";
  byId("field-import-price").value = "";
  byId("field-price").value = "";
  byId("field-amount-in-stock").value = "";
  byId("field-mpn").value = "";
  byId("field-brand").value = "";
}

function readForm() {
  var data = {
    id: byId("field-id").value.trim(),
    title: byId("field-title").value.trim(),
    description: byId("field-description").value.trim(),
    "availability": byId("field-availability").value.trim(),
    "image link": byId("field-image-link").value.trim(),
    "import_price": byId("field-import-price").value,
    price: byId("field-price").value,
    mpn: byId("field-mpn").value.trim(),
    brand: byId("field-brand").value.trim()
  };
  
  // Only include amount_in_stock when creating (not editing)
  if (editMode === "create") {
    data["amount_in_stock"] = byId("field-amount-in-stock").value;
  }
  
  return data;
}

function fillForm(product) {
  byId("field-id").value = product.id || "";
  byId("field-title").value = product.title || product.name || "";
  byId("field-description").value = product.description || "";
  byId("field-availability").value = product.availability || "";
  byId("field-image-link").value = product["image link"] || "";
  byId("field-import-price").value = product.import_price || "";
  byId("field-price").value = product.price || "";
  byId("field-amount-in-stock").value = product.amount_in_stock || "";
  byId("field-mpn").value = product.mpn || "";
  byId("field-brand").value = product.brand || "";
}

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
  await loadProducts(urlParams.page);
}

function renderProducts() {
  const tbody = byId("products-table").querySelector("tbody");
  if (!session.token) {
    tbody.innerHTML = `<tr><td colspan="8" class="muted">Đăng nhập để tải dữ liệu...</td></tr>`;
    return;
  }
  if (!products.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="muted">Chưa có sản phẩm</td></tr>`;
    return;
  }

  tbody.innerHTML = products.map(p => `
    <tr>
      <td>${p.id || ""}</td>
      <td>${p.title || p.name || ""}</td>
      <td>${p.price || ""}</td>
      <td>${p.amount_in_stock || ""}</td>
      <td>${p.availability || ""}</td>
      <td>${p.brand || ""}</td>
      <td>${p.mpn || ""}</td>
      <td><button class="action-btn" data-id="${p.id}">Sửa</button></td>
    </tr>
  `).join("");

  Array.from(tbody.querySelectorAll(".action-btn")).forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const product = products.find(p => p.id === id);
      if (!product) return;
      editMode = "edit";
      fillForm(product);
      byId("modal-title").textContent = "Sửa sản phẩm";
      // Hide amount_in_stock field when editing
      const wrapper = byId("field-amount-in-stock-wrapper");
      if (wrapper) wrapper.style.display = "none";
      openModal();
    });
  });
}

async function loadProducts(page) {
  // Only read from URL when caller doesn't explicitly pass a page
  if (page == null) {
    const urlParams = Pagination.getParamsFromURL();
    page = urlParams.page;
  }
  
  currentPage = page;
  
  return apiCallWithLoading(async () => {
    // Check cache first
    const cacheKey = CacheManager.key("products", "list", page, itemsPerPage);
    const cached = CacheManager.get(cacheKey);
    
    if (cached) {
      console.log("📦 Using cached products data");
      products = cached.items || [];
      totalProducts = cached.total || 0;
      totalPages = cached.totalPages || 0;
      currentPage = cached.page || 1;
      
      renderProducts();
      renderPagination();
      Pagination.updateURL(currentPage, itemsPerPage);
      return;
    }
    
    // Fetch from API
    const result = await apiCall("products.list", {
      page: page,
      limit: itemsPerPage
    });
    
    products = result.items || [];
    totalProducts = result.total || 0;
    totalPages = result.totalPages || 0;
    currentPage = result.page || 1;
    
    // Save to cache
    CacheManager.set(cacheKey, result);
    
    renderProducts();
    renderPagination();
    
    // Update URL
    Pagination.updateURL(currentPage, itemsPerPage);
  }, "Đang tải sản phẩm...");
}

function renderPagination() {
  Pagination.render(
    "products-pagination",
    currentPage,
    totalPages,
    totalProducts,
    loadProducts,
    "sản phẩm"
  );
}

async function saveProduct() {
  const data = readForm();
  if (!data.id || !data.title || data.price === "") {
    alert("ID, Title và Price là bắt buộc");
    return;
  }

  if (!session.token) {
    alert("Vui lòng đăng nhập trước");
    return;
  }

  if (!session.apiKey) {
    alert("Vui lòng đăng nhập lại (thiếu API key)");
    return;
  }

  try {
    if (editMode === "create") {
      data.token = session.token;
      await apiCall("products.create", data);
    } else {
      if (!data.id) {
        alert("Thiếu ID sản phẩm");
        return;
      }
      data.token = session.token;
      await apiCall("products.update", data);
    }

    // ✅ Invalidate cache after create/update
    CacheManager.invalidateOnProductChange();
    
    closeModal();
    clearForm();
    await loadProducts(currentPage); // Stay on current page
  } catch (err) {
    // If unauthorized, suggest re-login
    if (err.message && (err.message.includes("Unauthorized") || err.message.includes("Forbidden"))) {
      alert("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.\n\n" + err.message);
      resetSession();
    } else {
      alert("Lỗi: " + err.message);
    }
    throw err;
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

byId("btn-new").addEventListener("click", () => {
  editMode = "create";
  clearForm();
  byId("modal-title").textContent = "Thêm sản phẩm";
  // Show amount_in_stock field when creating
  const wrapper = byId("field-amount-in-stock-wrapper");
  if (wrapper) wrapper.style.display = "";
  openModal();
});

byId("btn-close").addEventListener("click", () => {
  closeModal();
});

byId("btn-save").addEventListener("click", async () => {
  const btn = byId("btn-save");
  Loading.button(btn, true);
  try {
    await saveProduct();
  } catch (err) {
    alert(err.message);
  } finally {
    Loading.button(btn, false);
  }
});

byId("btn-logout").addEventListener("click", () => {
  resetSession();
});

syncInputsFromSession();
applyQueryParams_();
updateSessionUI();
if (session.token) {
  const urlParams = Pagination.getParamsFromURL();
  loadProducts(urlParams.page).catch(err => {
    alert(err.message);
    resetSession();
  });
}
