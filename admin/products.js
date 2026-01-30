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
    <tr data-product-id="${p.id}">
      <td>${p.id || ""}</td>
      <td>${p.title || p.name || ""}</td>
      <td>${p.price || ""}</td>
      <td>${p.amount_in_stock || ""}</td>
      <td>${p.availability || ""}</td>
      <td>${p.brand || ""}</td>
      <td>${p.mpn || ""}</td>
      <td>
        <button class="action-btn" data-id="${p.id}">Sửa</button>
        <button class="action-btn btn-danger" data-id="${p.id}" data-action="delete" style="margin-left: 0.5rem;">Xóa</button>
      </td>
    </tr>
  `).join("");

  Array.from(tbody.querySelectorAll(".action-btn")).forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const action = btn.getAttribute("data-action");
      
      if (action === "delete") {
        deleteProduct(id);
        return;
      }
      
      // Edit action
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

function updateProductInList(product) {
  // Update in products array
  const index = products.findIndex(p => p.id === product.id);
  if (index !== -1) {
    products[index] = product;
  }
  
  // Update in DOM
  const tbody = byId("products-table").querySelector("tbody");
  const row = tbody.querySelector(`tr[data-product-id="${product.id}"]`);
  if (row) {
    row.innerHTML = `
      <td>${product.id || ""}</td>
      <td>${product.title || product.name || ""}</td>
      <td>${product.price || ""}</td>
      <td>${product.amount_in_stock || ""}</td>
      <td>${product.availability || ""}</td>
      <td>${product.brand || ""}</td>
      <td>${product.mpn || ""}</td>
      <td><button class="action-btn" data-id="${product.id}">Sửa</button></td>
    `;
    // Re-attach event listener
    const btn = row.querySelector(".action-btn");
    if (btn) {
      btn.addEventListener("click", () => {
        editMode = "edit";
        fillForm(product);
        byId("modal-title").textContent = "Sửa sản phẩm";
        const wrapper = byId("field-amount-in-stock-wrapper");
        if (wrapper) wrapper.style.display = "none";
        openModal();
      });
    }
  }
}

function addProductToList(product) {
  // Add to products array (at the beginning if on page 1)
  if (currentPage === 1) {
    products.unshift(product);
    // If exceeds page limit, remove last item
    if (products.length > itemsPerPage) {
      products.pop();
    }
  }
  
  // Update DOM
  const tbody = byId("products-table").querySelector("tbody");
  if (tbody && products.length > 0) {
    // Remove "no products" message if exists
    if (tbody.querySelector(".muted")) {
      tbody.innerHTML = "";
    }
    
    // Add new row at the top
    const newRow = document.createElement("tr");
    newRow.setAttribute("data-product-id", product.id);
    newRow.innerHTML = `
      <td>${product.id || ""}</td>
      <td>${product.title || product.name || ""}</td>
      <td>${product.price || ""}</td>
      <td>${product.amount_in_stock || ""}</td>
      <td>${product.availability || ""}</td>
      <td>${product.brand || ""}</td>
      <td>${product.mpn || ""}</td>
      <td><button class="action-btn" data-id="${product.id}">Sửa</button></td>
    `;
    tbody.insertBefore(newRow, tbody.firstChild);
    
    // Re-attach event listeners for all buttons
    Array.from(tbody.querySelectorAll(".action-btn")).forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const p = products.find(pr => pr.id === id);
        if (!p) return;
        editMode = "edit";
        fillForm(p);
        byId("modal-title").textContent = "Sửa sản phẩm";
        const wrapper = byId("field-amount-in-stock-wrapper");
        if (wrapper) wrapper.style.display = "none";
        openModal();
      });
    });
  }
}

async function loadProducts(page) {
  // Only read from URL when caller doesn't explicitly pass a page
  if (page == null) {
    const urlParams = Pagination.getParamsFromURL();
    page = urlParams.page;
  }
  
  currentPage = page;
  
  return apiCallWithLoading(async () => {
    // ✅ Step 1: Check frontend cache first (localStorage)
    const cacheKey = CacheManager.key("products", "list", page, itemsPerPage);
    const cached = CacheManager.get(cacheKey);
    
    if (cached) {
      console.log("📦 Using cached products data (localStorage)");
      products = cached.items || [];
      totalProducts = cached.total || 0;
      totalPages = cached.totalPages || 0;
      currentPage = cached.page || 1;
      
      renderProducts();
      renderPagination();
      Pagination.updateURL(currentPage, itemsPerPage);
      return;
    }
    
    // ✅ Step 2: Try Cloudflare Worker first (fast, edge network)
    let result = null;
    
    if (WorkerAPI && WorkerAPI.isConfigured()) {
      try {
        console.log("🚀 Trying Cloudflare Worker for products.list...");
        result = await WorkerAPI.productsList({
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
      result = await apiCall("products.list", {
        page: page,
        limit: itemsPerPage
      });
    }
    
    products = result.items || [];
    totalProducts = result.total || 0;
    totalPages = result.totalPages || 0;
    currentPage = result.page || 1;
    
    // Save to frontend cache
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

  let savedProduct;
  try {
    if (editMode === "create") {
      data.token = session.token;
      savedProduct = await apiCall("products.create", data);
    } else {
      if (!data.id) {
        alert("Thiếu ID sản phẩm");
        return;
      }
      data.token = session.token;
      savedProduct = await apiCall("products.update", data);
    }

    // ✅ Invalidate cache after create/update
    CacheManager.invalidateOnProductChange();
    
    closeModal();
    clearForm();
    
    // ✅ Update UI directly instead of reloading
    if (editMode === "create") {
      // Add new product to current page if on page 1, otherwise reload
      if (currentPage === 1 && products.length < itemsPerPage) {
        addProductToList(savedProduct);
        totalProducts++;
        totalPages = Math.ceil(totalProducts / itemsPerPage);
        renderPagination();
      } else {
        await loadProducts(currentPage);
      }
    } else {
      // Update existing product in list
      updateProductInList(savedProduct);
    }
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

async function deleteProduct(productId) {
  if (!productId) return;
  
  const product = products.find(p => p.id === productId);
  if (!product) {
    alert("Không tìm thấy sản phẩm");
    return;
  }
  
  const confirmMsg = `Xác nhận xóa sản phẩm "${product.id}"?\n\nLưu ý: Hành động này không thể hoàn tác.`;
  if (!confirm(confirmMsg)) return;
  
  if (!session.token) {
    alert("Vui lòng đăng nhập trước");
    return;
  }
  
  if (!session.apiKey) {
    alert("Vui lòng đăng nhập lại (thiếu API key)");
    return;
  }
  
  Loading.show("Đang xóa sản phẩm...");
  try {
    await apiCall("products.delete", {
      token: session.token,
      id: productId
    });
    
    // ✅ Invalidate cache after delete
    CacheManager.invalidateOnProductChange();
    
    // ✅ Remove product from UI
    removeProductFromList(productId);
    
    // Update totals
    totalProducts--;
    totalPages = Math.ceil(totalProducts / itemsPerPage);
    
    // If current page becomes empty and not page 1, go to previous page
    if (products.length === 0 && currentPage > 1) {
      await loadProducts(currentPage - 1);
    } else {
      renderPagination();
    }
    
    alert("✅ Đã xóa sản phẩm thành công");
  } catch (err) {
    if (err.message && (err.message.includes("Unauthorized") || err.message.includes("Forbidden"))) {
      alert("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.\n\n" + err.message);
      resetSession();
    } else {
      alert("Lỗi: " + err.message);
    }
  } finally {
    Loading.hide();
  }
}

function removeProductFromList(productId) {
  // Remove from products array
  const index = products.findIndex(p => p.id === productId);
  if (index !== -1) {
    products.splice(index, 1);
  }
  
  // Remove from DOM
  const tbody = byId("products-table").querySelector("tbody");
  const row = tbody.querySelector(`tr[data-product-id="${productId}"]`);
  if (row) {
    row.remove();
  }
  
  // If no products left, show empty message
  if (products.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="muted">Chưa có sản phẩm</td></tr>`;
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
  loadProducts(urlParams.page).catch(err => {
    alert(err.message);
    resetSession();
  });
}
