// Use common utilities from common.js
// DEFAULT_API_URL, sessionDefaults, and session are already declared in common.js
// Just use them directly (they're in global scope) or reference via window.CommonUtils
// No need to redeclare - they're already available

let products = [];
let categories = []; // Store categories for dropdown
let editMode = "create";
let currentPage = 1;
let totalPages = 0;
let totalProducts = 0;
const itemsPerPage = PAGINATION.DEFAULT_LIMIT;

// Image resize constants
const IMAGE_MAX_WIDTH = 20;
const IMAGE_MAX_HEIGHT = 20;

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

function setDetailSectionMode(mode) {
  const isCreate = mode === "create";
  const notice = byId("detail-create-notice");
  const textarea = byId("field-detail");
  const btnSave = byId("btn-save-detail");
  const btnLoad = byId("btn-load-detail");
  const detailUrlInput = byId("field-detail-url");

  if (isCreate) {
    notice.style.display = "block";
    textarea.disabled = true;
    textarea.style.background = "#f1f5f9";
    textarea.style.cursor = "not-allowed";
    btnSave.disabled = true;
    btnSave.style.opacity = "0.4";
    btnSave.style.cursor = "not-allowed";
    btnLoad.style.display = "none";
    detailUrlInput.style.display = "none";
    detailUrlInput.previousElementSibling.style.display = "none";
  } else {
    notice.style.display = "none";
    textarea.disabled = false;
    textarea.style.background = "";
    textarea.style.cursor = "";
    btnSave.disabled = false;
    btnSave.style.opacity = "";
    btnSave.style.cursor = "";
    detailUrlInput.style.display = "";
    detailUrlInput.previousElementSibling.style.display = "";
  }
}

function openHelpModal() {
  byId("image-link-help-modal").classList.add("active");
}

function closeHelpModal() {
  byId("image-link-help-modal").classList.remove("active");
}

function clearForm() {
  byId("field-id").disabled = false;
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
  byId("field-category-select").value = "";
  byId("field-detail").value = "";
  byId("field-detail-url").value = "";
  hideDetailStatus();
  byId("btn-load-detail").style.display = "none";
  byId("field-category-new").value = "";
  byId("field-category-id").value = "";
  // Clear image preview
  hideImagePreview();
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
  
  // Include detail_url if exists
  const detailUrl = byId("field-detail-url").value.trim();
  if (detailUrl) {
    data["detail_url"] = detailUrl;
  }
  
  // Handle category_id
  var categoryId = byId("field-category-id").value.trim();
  var categorySelect = byId("field-category-select").value.trim();
  var categoryNew = byId("field-category-new").value.trim();
  
  if (categoryId) {
    data["category_id"] = categoryId;
  } else if (categorySelect) {
    data["category_id"] = categorySelect;
  } else if (categoryNew) {
    // Will be handled in saveProduct - create category first
    data["_category_new_name"] = categoryNew;
  }
  
  // Only include amount_in_stock when creating (not editing)
  if (editMode === "create") {
    data["amount_in_stock"] = byId("field-amount-in-stock").value;
  }
  
  return data;
}

async function loadDetailFromUrl(detailUrl) {
  if (!detailUrl || !detailUrl.trim()) {
    return;
  }
  
  try {
    showDetailStatus("⏳ Đang tải detail từ URL...", "info");
    const response = await fetch(detailUrl.trim());
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    byId("field-detail").value = html;
    showDetailStatus("✅ Đã tải detail thành công!", "success");
    
    setTimeout(() => {
      hideDetailStatus();
    }, 2000);
  } catch (err) {
    console.error("Load detail error:", err);
    showDetailStatus("⚠️ Không thể tải detail: " + err.message, "error");
    // Don't show alert, just show status message
    setTimeout(() => {
      hideDetailStatus();
    }, 3000);
  }
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
  
  // Load detail URL if exists
  const detailUrl = product["detail_url"] || product.detail_url || "";
  byId("field-detail-url").value = detailUrl;
  
  // Show load button if detail URL exists
  if (detailUrl) {
    byId("btn-load-detail").style.display = "inline-block";
    // ✅ Tự động load detail từ URL khi có detail_url
    loadDetailFromUrl(detailUrl);
  } else {
    byId("btn-load-detail").style.display = "none";
    // Clear detail content if no URL
    byId("field-detail").value = "";
  }
  
  // Handle category_id
  const categoryId = product.category_id || "";
  if (categoryId) {
    byId("field-category-id").value = categoryId;
    byId("field-category-select").value = categoryId;
    byId("field-category-new").value = "";
  } else {
    byId("field-category-select").value = "";
    byId("field-category-new").value = "";
    byId("field-category-id").value = "";
  }
  
  // Show image preview if exists
  const imageLink = product["image link"] || "";
  if (imageLink) {
    showImagePreview(imageLink);
  } else {
    hideImagePreview();
  }
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

  tbody.innerHTML = products.map(p => {
    const imageLink = p["image link"] || "";
    const imageSrc = getImageSource(imageLink);
    const imageHtml = imageSrc ? `<img src="${imageSrc}" alt="${p.title || p.name || ''}" class="product-thumbnail" onerror="this.style.display='none'">` : '';
    
    return `
    <tr data-product-id="${p.id}">
      <td>${p.id || ""}</td>
      <td>
        <div class="product-title-cell">
          ${imageHtml}
          <span>${p.title || p.name || ""}</span>
        </div>
      </td>
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
    `;
  }).join("");

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
      byId("field-id").disabled = true;
      setDetailSectionMode("edit");
      openModal();
    });
  });
}

function updateProductInList(product) {
  // Merge with existing product to preserve fields not returned by update API (e.g. amount_in_stock)
  const index = products.findIndex(p => p.id === product.id);
  if (index !== -1) {
    product = Object.assign({}, products[index], product);
    products[index] = product;
  }
  
  // Update in DOM
  const tbody = byId("products-table").querySelector("tbody");
  const row = tbody.querySelector(`tr[data-product-id="${product.id}"]`);
  if (row) {
    const imageLink = product["image link"] || "";
    const imageSrc = getImageSource(imageLink);
    const imageHtml = imageSrc ? `<img src="${imageSrc}" alt="${product.title || product.name || ''}" class="product-thumbnail" onerror="this.style.display='none'">` : '';
    
    row.innerHTML = `
      <td>${product.id || ""}</td>
      <td>
        <div class="product-title-cell">
          ${imageHtml}
          <span>${product.title || product.name || ""}</span>
        </div>
      </td>
      <td>${product.price || ""}</td>
      <td>${product.amount_in_stock ?? ""}</td>
      <td>${product.availability || ""}</td>
      <td>${product.brand || ""}</td>
      <td>${product.mpn || ""}</td>
      <td>
        <button class="action-btn" data-id="${product.id}">Sửa</button>
        <button class="action-btn btn-danger" data-id="${product.id}" data-action="delete" style="margin-left: 0.5rem;">Xóa</button>
      </td>
    `;
    // Re-attach event listeners
    Array.from(row.querySelectorAll(".action-btn")).forEach(btn => {
      btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-action");
        if (action === "delete") {
          deleteProduct(product.id);
          return;
        }
        editMode = "edit";
        fillForm(product);
        byId("modal-title").textContent = "Sửa sản phẩm";
        const wrapper = byId("field-amount-in-stock-wrapper");
        if (wrapper) wrapper.style.display = "none";
        byId("field-id").disabled = true;
        setDetailSectionMode("edit");
        openModal();
      });
    });
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
    const imageLink = product["image link"] || "";
    const imageSrc = getImageSource(imageLink);
    const imageHtml = imageSrc ? `<img src="${imageSrc}" alt="${product.title || product.name || ''}" class="product-thumbnail" onerror="this.style.display='none'">` : '';
    
    newRow.innerHTML = `
      <td>${product.id || ""}</td>
      <td>
        <div class="product-title-cell">
          ${imageHtml}
          <span>${product.title || product.name || ""}</span>
        </div>
      </td>
      <td>${product.price || ""}</td>
      <td>${product.amount_in_stock || ""}</td>
      <td>${product.availability || ""}</td>
      <td>${product.brand || ""}</td>
      <td>${product.mpn || ""}</td>
      <td>
        <button class="action-btn" data-id="${product.id}">Sửa</button>
        <button class="action-btn btn-danger" data-id="${product.id}" data-action="delete" style="margin-left: 0.5rem;">Xóa</button>
      </td>
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
        setDetailSectionMode("edit");
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
      
      // ✅ Sort products by created_at desc (newest first) - ensure correct order
      products.sort(function(a, b) {
        var dateA = a.created_at || "";
        var dateB = b.created_at || "";
        // Handle Date objects
        if (dateA instanceof Date) dateA = dateA.toISOString();
        if (dateB instanceof Date) dateB = dateB.toISOString();
        // Compare as strings
        return dateB.localeCompare(dateA);
      });
      
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
          console.log("✅ Worker success! (may be from KV cache or GAS fallback)");
        }
      } catch (error) {
        console.error("⚠️ Worker error:", error);
        console.log("Worker failed completely, will fallback to GAS...");
      }
    }
    
    // ✅ Step 3: Fallback to GAS only if Worker completely fails (network error, timeout, etc.)
    // Note: Worker already has fallback to GAS for cache miss, so this is only for Worker failure
    if (!result) {
      console.log("📡 Worker unavailable, fetching directly from GAS /exec endpoint...");
      result = await apiCall("products.list", {
        page: page,
        limit: itemsPerPage
      });
    }
    
    // ✅ Sort products by created_at desc (newest first) - ensure correct order
    if (result && result.items && Array.isArray(result.items)) {
      result.items.sort(function(a, b) {
        var dateA = a.created_at || "";
        var dateB = b.created_at || "";
        // Handle Date objects
        if (dateA instanceof Date) dateA = dateA.toISOString();
        if (dateB instanceof Date) dateB = dateB.toISOString();
        // Compare as strings
        return dateB.localeCompare(dateA);
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
  // ✅ Reload session from localStorage to ensure token is up to date
  reloadSession();
  
  // Clear previous validation errors
  Validator.clearErrors();
  
  const data = readForm();
  
  // Define validation rules (sử dụng constants mặc định, có thể ghi đè)
  const rules = {
    id: Validator.helpers.requiredId(1),  // Max 15 ký tự (từ constants)
    title: Validator.helpers.requiredString(2),  // Max 50 ký tự (từ constants)
    price: Validator.helpers.requiredPositiveNumber(999999999),
    description: Validator.helpers.textarea(false),  // Max 100 ký tự (từ constants)
    availability: Validator.helpers.optionalString(),  // Max 50 ký tự (từ constants)
    "image link": {
      required: false,
      type: 'url',
      maxLength: 150  // Override limit lên 150 ký tự
    },
    "import_price": {
      required: false,
      type: 'number',
      min: 0,
      max: 999999999
    },
    mpn: Validator.helpers.optionalString(),  // Max 50 ký tự (từ constants)
    brand: Validator.helpers.optionalString()  // Max 50 ký tự (từ constants)
  };
  
  // Only validate amount_in_stock when creating
  if (editMode === "create") {
    rules["amount_in_stock"] = Validator.helpers.requiredNonNegativeNumber(999999);
  }
  
  // Validate form
  const result = Validator.validateForm(data, rules);
  if (!result.valid) {
    // Map field names to input IDs (field names in data vs input IDs in HTML)
    const fieldIdMap = {
      'id': 'field-id',
      'title': 'field-title',
      'description': 'field-description',
      'availability': 'field-availability',
      'image link': 'field-image-link',
      'import_price': 'field-import-price',
      'price': 'field-price',
      'amount_in_stock': 'field-amount-in-stock',
      'mpn': 'field-mpn',
      'brand': 'field-brand'
    };
    
    // Map errors to use correct input IDs
    const mappedErrors = {};
    for (const fieldName in result.errors) {
      const inputId = fieldIdMap[fieldName] || fieldName;
      mappedErrors[inputId] = result.errors[fieldName];
    }
    
    Validator.showErrors(mappedErrors);
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

  // ✅ Handle category: if new category name provided, create category first
  if (data._category_new_name) {
    try {
      Loading.show("Đang tạo danh mục mới...");
      const newCategory = await apiCall("categories.create", {
        token: session.token,
        name: data._category_new_name
      });
      data.category_id = newCategory.id;
      delete data._category_new_name;
      // Reload categories to update dropdown
      await loadCategories();
      Loading.hide();
    } catch (err) {
      Loading.hide();
      // If category already exists, try to find it
      if (err.message && err.message.includes("đã tồn tại")) {
        // Try to find existing category by name
        await loadCategories();
        const existingCategory = categories.find(c => 
          String(c.name || "").trim().toLowerCase() === String(data._category_new_name).trim().toLowerCase()
        );
        if (existingCategory) {
          data.category_id = existingCategory.id;
          delete data._category_new_name;
        } else {
          alert("Lỗi khi tạo danh mục: " + err.message);
          return;
        }
      } else {
        alert("Lỗi khi tạo danh mục: " + err.message);
        return;
      }
    }
  }

  // Convert number fields after validation
  data.price = Number(data.price);
  if (data["import_price"]) {
    data["import_price"] = Number(data["import_price"]);
  }
  if (data["amount_in_stock"]) {
    data["amount_in_stock"] = Number(data["amount_in_stock"]);
  }

  let savedProduct;
  try {
    if (editMode === "create") {
      data.token = session.token;
      savedProduct = await apiCall("products.create", data);
    } else {
      data.token = session.token;
      savedProduct = await apiCall("products.update", data);
    }

    // ✅ Clear ALL cache after write action (create/update)
    CacheManager.clearAllCache();
    
    // ✅ Also invalidate specific caches to be thorough
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
    // ✅ Handle token expiration - prompt user to login again
    if (err.message && (err.message.includes("Token expired") || err.message.includes("Unauthorized") || err.message.includes("hết hạn"))) {
      alert("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
      resetSession();
      window.location.reload();
    } else {
      alert("Lỗi: " + err.message);
    }
    throw err;
  }
}

async function deleteProduct(productId) {
  // ✅ Reload session from localStorage to ensure token is up to date
  reloadSession();
  
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
    
    // ✅ Clear ALL cache after write action (delete)
    CacheManager.clearAllCache();
    
    // ✅ Also invalidate specific caches to be thorough
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
  byId("field-id").disabled = false;
  setDetailSectionMode("create");
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

// Image upload handlers
byId("btn-upload-image").addEventListener("click", () => {
  byId("file-image-upload").click();
});

byId("file-image-upload").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  if (!file.type.startsWith('image/')) {
    alert('Vui lòng chọn file ảnh');
    return;
  }
  
  // Validate file size (max 5MB)
  if (file.size > 5 * 1024 * 1024) {
    alert('Kích thước ảnh phải nhỏ hơn 5MB');
    byId("file-image-upload").value = "";
    return;
  }
  
  // Get GitHub config from settings
  let githubConfig = null;
  let settingsError = null;
  
  try {
    // Reload session to ensure token is available
    reloadSession();
    
    if (!session.token || !session.apiKey) {
      settingsError = "Vui lòng đăng nhập trước khi upload ảnh";
    } else {
      // Try to get from window.currentSettings (if settings page was loaded)
      if (window.currentSettings && window.currentSettings.github_token) {
        githubConfig = {
          owner: window.currentSettings.github_owner || '',
          repo: window.currentSettings.github_repo || '',
          branch: window.currentSettings.github_branch || 'main',
          token: window.currentSettings.github_token || ''
        };
      }
      
      // If not available, try to load settings
      if (!githubConfig || !githubConfig.token || !githubConfig.owner || !githubConfig.repo) {
        const settings = await apiCall("settings.list", {
          token: session.token
        });
        
        githubConfig = {
          owner: settings.github_owner || '',
          repo: settings.github_repo || '',
          branch: settings.github_branch || 'main',
          token: settings.github_token || ''
        };
        
        // Cache for next time
        window.currentSettings = settings;
      }
    }
  } catch (err) {
    console.error("Error loading settings:", err);
    settingsError = err.message;
    
    // If token expired, show specific message
    if (err.message && (err.message.includes("Token expired") || err.message.includes("Unauthorized") || err.message.includes("hết hạn"))) {
      settingsError = "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
    }
  }
  
  // Validate GitHub config
  if (settingsError) {
    alert('❌ ' + settingsError);
    byId("file-image-upload").value = "";
    return;
  }
  
  if (!githubConfig || !githubConfig.token || !githubConfig.owner || !githubConfig.repo) {
    alert('⚠️ Vui lòng cấu hình GitHub trong Settings trước khi upload ảnh:\n- GitHub Owner\n- GitHub Repo\n- GitHub Token\n\nVào Settings → Điền thông tin GitHub → Lưu cài đặt');
    byId("file-image-upload").value = "";
    return;
  }
  
  // Show loading spinner
  const btnUpload = byId("btn-upload-image");
  const originalHTML = btnUpload.innerHTML;
  btnUpload.disabled = true;
  btnUpload.innerHTML = '<span class="spinner-small"></span> Đang upload...';
  
  try {
    // Show preview immediately (local)
    const reader = new FileReader();
    reader.onload = (e) => {
      showImagePreview(e.target.result);
    };
    reader.readAsDataURL(file);
    
    // Upload to GitHub via Cloudflare Worker with GitHub config
    const formData = new FormData();
    formData.append('image', file);
    formData.append('github_owner', githubConfig.owner);
    formData.append('github_repo', githubConfig.repo);
    formData.append('github_branch', githubConfig.branch);
    formData.append('github_token', githubConfig.token);
    
    const workerUrl = window.CommonUtils?.WORKER_URL || "https://quanlykho-api.nguyenxuancuongk56.workers.dev";
    const response = await fetch(`${workerUrl}/upload-image`, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ 
        error: `Upload failed (${response.status} ${response.statusText})`,
        message: 'Failed to parse error response'
      }));
      const errorMessage = errorData.error || errorData.message || `Upload failed (${response.status})`;
      throw new Error(errorMessage);
    }
    
    const result = await response.json();
    if (!result.success) {
      const errorMessage = result.error || result.message || 'Upload failed';
      throw new Error(errorMessage);
    }
    
    // ✅ Auto-fill image link and show preview (no alert needed)
    // API returns: { success: true, data: { url: "...", filename: "..." } }
    const imageUrl = result.data?.url || result.url || '';
    byId("field-image-link").value = imageUrl;
    showImagePreview(imageUrl);
    
    // Show success indicator briefly
    btnUpload.innerHTML = '✅ Hoàn thành';
    btnUpload.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
    setTimeout(() => {
      btnUpload.innerHTML = originalHTML;
      btnUpload.style.background = '';
    }, 1500);
    
  } catch (err) {
    // Show error (still need alert for errors)
    alert("❌ Lỗi upload ảnh: " + err.message);
    console.error("Upload error:", err);
    hideImagePreview();
    byId("field-image-link").value = "";
    btnUpload.innerHTML = originalHTML;
  } finally {
    btnUpload.disabled = false;
    byId("file-image-upload").value = "";
  }
});

byId("btn-remove-image").addEventListener("click", () => {
  byId("field-image-link").value = "";
  hideImagePreview();
  byId("file-image-upload").value = "";
});

// Listen to image link input changes
byId("field-image-link").addEventListener("input", (e) => {
  const value = e.target.value.trim();
  if (value) {
    // Check if it's a base64 string or URL
    if (value.startsWith('data:image')) {
      showImagePreview(value);
    } else if (value.startsWith('http://') || value.startsWith('https://')) {
      showImagePreview(value);
    } else {
      hideImagePreview();
    }
  } else {
    hideImagePreview();
  }
});

/**
 * Resize image to specified dimensions and convert to base64
 * @param {File} file - Image file
 * @param {number} maxWidth - Maximum width
 * @param {number} maxHeight - Maximum height
 * @returns {Promise<string>} Base64 string
 */
function resizeAndConvertToBase64(file, maxWidth, maxHeight) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const img = new Image();
      
      img.onload = () => {
        // Calculate new dimensions maintaining aspect ratio
        let width = img.width;
        let height = img.height;
        
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        
        // Create canvas and resize
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        
        // Draw resized image
        ctx.drawImage(img, 0, 0, width, height);
        
        // Convert to base64 (JPEG format, quality 0.85)
        const base64 = canvas.toDataURL('image/jpeg', 0.85);
        resolve(base64);
      };
      
      img.onerror = () => {
        reject(new Error('Failed to load image'));
      };
      
      img.src = e.target.result;
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    
    reader.readAsDataURL(file);
  });
}

/**
 * Show image preview
 * @param {string} imageSrc - Image URL or base64 string
 */
function showImagePreview(imageSrc) {
  const preview = byId("image-preview");
  const previewImg = byId("image-preview-img");
  
  if (imageSrc) {
    previewImg.src = imageSrc;
    preview.style.display = 'block';
  } else {
    hideImagePreview();
  }
}

/**
 * Hide image preview
 */
function hideImagePreview() {
  const preview = byId("image-preview");
  preview.style.display = 'none';
}

/**
 * Get image source for display (handles both URL and base64)
 * @param {string} imageLink - Image link (URL or base64)
 * @returns {string} Image source for img tag
 */
function getImageSource(imageLink) {
  if (!imageLink) return '';
  
  // If it's already a base64 string, return as is
  if (imageLink.startsWith('data:image')) {
    return imageLink;
  }
  
  // If it's a URL, return as is
  if (imageLink.startsWith('http://') || imageLink.startsWith('https://')) {
    return imageLink;
  }
  
  // Otherwise, assume it's a base64 string without prefix
  // Try to construct base64 data URL (this is a fallback)
  return imageLink;
}

// Initialize WorkerAPI if configured
if (window.WorkerAPI && window.CommonUtils && window.CommonUtils.WORKER_URL) {
  WorkerAPI.init(window.CommonUtils.WORKER_URL);
  console.log("✅ WorkerAPI initialized for READ operations");
} else if (window.WorkerAPI) {
  console.log("ℹ️ WorkerAPI available but WORKER_URL not configured. Using GAS only.");
}

/**
 * Load categories for dropdown
 */
async function loadCategories() {
  try {
    let result = null;
    
    // Try WorkerAPI first
    if (WorkerAPI && WorkerAPI.isConfigured()) {
      try {
        result = await WorkerAPI.categoriesList({
          page: 1,
          limit: 1000 // Get all categories
        });
      } catch (error) {
        console.error("⚠️ Worker error loading categories:", error);
      }
    }
    
    // Fallback to GAS
    if (!result) {
      result = await apiCall("categories.list", {
        page: 1,
        limit: 1000
      });
    }
    
    categories = result.items || [];
    renderCategoryDropdown();
  } catch (err) {
    console.error("Error loading categories:", err);
    categories = [];
    renderCategoryDropdown();
  }
}

/**
 * Render category dropdown
 */
function renderCategoryDropdown() {
  const select = byId("field-category-select");
  if (!select) return;
  
  // Keep current value
  const currentValue = select.value;
  
  // Clear and add default option
  select.innerHTML = '<option value="">-- Chọn danh mục --</option>';
  
  // Add categories
  categories.forEach(category => {
    const option = document.createElement("option");
    option.value = category.id || "";
    option.textContent = category.name || "";
    select.appendChild(option);
  });
  
  // Restore value if still exists
  if (currentValue) {
    select.value = currentValue;
  }
}

// Event listeners for category fields
byId("field-category-select").addEventListener("change", (e) => {
  const value = e.target.value;
  byId("field-category-id").value = value;
  if (value) {
    byId("field-category-new").value = ""; // Clear new category input
  }
});

byId("field-category-new").addEventListener("input", (e) => {
  const value = e.target.value.trim();
  if (value) {
    byId("field-category-select").value = ""; // Clear select
    byId("field-category-id").value = ""; // Clear hidden field
  }
});

// Product Detail Upload
byId("btn-save-detail").addEventListener("click", async () => {
  const btnSave = byId("btn-save-detail");
  const productId = byId("field-id").value;
  const detailHtml = byId("field-detail").value.trim();
  
  if (!detailHtml) {
    alert("⚠️ Vui lòng nhập nội dung Product Detail trước khi lưu!");
    return;
  }
  
  if (!productId) {
    alert("⚠️ Vui lòng lưu sản phẩm trước (có ID) để upload detail!");
    return;
  }
  
  // Get GitHub config from settings (same pattern as image upload)
  let githubConfig = null;
  let settingsError = null;
  
  try {
    // Reload session to ensure token is available
    reloadSession();
    
    if (!session.token || !session.apiKey) {
      settingsError = "Vui lòng đăng nhập trước khi upload detail";
    } else {
      // Try to get from window.currentSettings (if settings page was loaded)
      if (window.currentSettings && window.currentSettings.github_token) {
        githubConfig = {
          owner: window.currentSettings.github_owner || '',
          repo: window.currentSettings.github_repo || '',
          branch: window.currentSettings.github_branch || 'main',
          token: window.currentSettings.github_token || ''
        };
      }
      
      // If not available, try to load settings
      if (!githubConfig || !githubConfig.token || !githubConfig.owner || !githubConfig.repo) {
        const settings = await apiCall("settings.list", {
          token: session.token
        });
        
        githubConfig = {
          owner: settings.github_owner || '',
          repo: settings.github_repo || '',
          branch: settings.github_branch || 'main',
          token: settings.github_token || ''
        };
        
        // Cache for next time
        window.currentSettings = settings;
      }
    }
  } catch (err) {
    console.error("Error loading settings:", err);
    settingsError = err.message;
  }
  
  // Validate GitHub config
  if (settingsError || !githubConfig || !githubConfig.token || !githubConfig.owner || !githubConfig.repo) {
    alert('⚠️ Vui lòng cấu hình GitHub trong Settings trước khi upload detail:\n- GitHub Owner\n- GitHub Repo\n- GitHub Token' + (settingsError ? `\n\nLỗi: ${settingsError}` : ''));
    return;
  }
  
  const originalText = btnSave.textContent;
  btnSave.disabled = true;
  btnSave.textContent = "⏳ Đang lưu...";
  showDetailStatus("⏳ Đang upload detail lên GitHub...", "info");
  
  try {
    const formData = new FormData();
    formData.append('html', detailHtml);
    formData.append('product_id', productId);
    formData.append('github_owner', githubConfig.owner);
    formData.append('github_repo', githubConfig.repo);
    formData.append('github_branch', githubConfig.branch);
    formData.append('github_token', githubConfig.token);
    
    const workerUrl = window.CommonUtils?.WORKER_URL || "https://quanlykho-api.nguyenxuancuongk56.workers.dev";
    const response = await fetch(`${workerUrl}/upload-product-detail`, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }
    
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || 'Upload failed');
    }
    
    // Auto-fill detail URL
    // API returns: { success: true, data: { url: "...", product_id: "..." } }
    const detailUrl = result.data?.url || result.url || '';
    byId("field-detail-url").value = detailUrl;
    showDetailStatus("✅ Đã lưu detail lên GitHub thành công!", "success");
    byId("btn-load-detail").style.display = "inline-block";
    
    // Reset button after 2 seconds
    setTimeout(() => {
      btnSave.textContent = originalText;
      hideDetailStatus();
    }, 2000);
    
  } catch (err) {
    alert("❌ Lỗi upload detail: " + err.message);
    console.error("Upload detail error:", err);
    showDetailStatus("❌ Lỗi: " + err.message, "error");
  } finally {
    btnSave.disabled = false;
  }
});

// Load Detail from URL
byId("btn-load-detail").addEventListener("click", async () => {
  const detailUrl = byId("field-detail-url").value.trim();
  
  if (!detailUrl) {
    alert("⚠️ Không có Detail URL để load!");
    return;
  }
  
  const btnLoad = byId("btn-load-detail");
  const originalText = btnLoad.textContent;
  btnLoad.disabled = true;
  btnLoad.textContent = "⏳ Đang tải...";
  showDetailStatus("⏳ Đang tải detail từ GitHub...", "info");
  
  try {
    const response = await fetch(detailUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    byId("field-detail").value = html;
    showDetailStatus("✅ Đã tải detail thành công!", "success");
    
    setTimeout(() => {
      hideDetailStatus();
    }, 2000);
    
  } catch (err) {
    alert("❌ Lỗi load detail: " + err.message);
    console.error("Load detail error:", err);
    showDetailStatus("❌ Lỗi: " + err.message, "error");
  } finally {
    btnLoad.disabled = false;
    btnLoad.textContent = originalText;
  }
});

function showDetailStatus(message, type) {
  const statusEl = byId("detail-status");
  statusEl.textContent = message;
  statusEl.style.display = "block";
  statusEl.className = `detail-status detail-status-${type}`;
}

function hideDetailStatus() {
  byId("detail-status").style.display = "none";
}

// Image Link Help Modal
byId("image-link-help").addEventListener("click", (e) => {
  e.preventDefault();
  openHelpModal();
});

byId("btn-close-help").addEventListener("click", () => {
  closeHelpModal();
});

byId("btn-close-help-footer").addEventListener("click", () => {
  closeHelpModal();
});

// Close help modal when clicking outside
byId("image-link-help-modal").addEventListener("click", (e) => {
  if (e.target.id === "image-link-help-modal") {
    closeHelpModal();
  }
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
  loadCategories(); // Load categories on page load
}
