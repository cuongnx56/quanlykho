// Use common utilities from common.js
// DEFAULT_API_URL, sessionDefaults, and session are already declared in common.js
// Just use them directly (they're in global scope) or reference via window.CommonUtils
// No need to redeclare - they're already available

let categories = [];
let editMode = "create";
let currentPage = 1;
let totalPages = 0;
let totalCategories = 0;
const itemsPerPage = PAGINATION.DEFAULT_LIMIT;

// Image resize constants
const IMAGE_MAX_WIDTH = 68;
const IMAGE_MAX_HEIGHT = 86;

// Override resetSession to include page-specific cleanup
function resetSession() {
  // Call the original resetSession from common.js
  if (window._originalResetSession) {
    window._originalResetSession();
  }
  // Page-specific cleanup
  categories = [];
  renderCategories();
}
// Override window.resetSession with our version
window.resetSession = resetSession;

function openModal() {
  byId("category-modal").classList.add("active");
}

function closeModal() {
  byId("category-modal").classList.remove("active");
}

function clearForm() {
  byId("field-id").value = "";
  byId("field-name").value = "";
  byId("field-description").value = "";
  byId("field-image-link").value = "";
  // Clear image preview
  hideImagePreview();
}

function readForm() {
  var data = {
    id: byId("field-id").value.trim(),
    name: byId("field-name").value.trim(),
    description: byId("field-description").value.trim(),
    "image link": byId("field-image-link").value.trim()
  };
  
  return data;
}

function fillForm(category) {
  byId("field-id").value = category.id || "";
  byId("field-name").value = category.name || "";
  byId("field-description").value = category.description || "";
  byId("field-image-link").value = category["image link"] || "";
  // Show image preview if exists
  const imageLink = category["image link"] || "";
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
  await loadCategories(urlParams.page);
}

function renderCategories() {
  const tbody = byId("categories-table").querySelector("tbody");
  if (!session.token) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted">Đăng nhập để tải dữ liệu...</td></tr>`;
    return;
  }
  if (!categories.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted">Chưa có danh mục</td></tr>`;
    return;
  }

  tbody.innerHTML = categories.map(c => {
    const imageLink = c["image link"] || "";
    const imageSrc = getImageSource(imageLink);
    const imageHtml = imageSrc ? `<img src="${imageSrc}" alt="${c.name || ''}" class="category-thumbnail" onerror="this.style.display='none'">` : '';
    
    return `
    <tr data-category-id="${c.id}">
      <td>${c.id || ""}</td>
      <td>
        <div class="category-title-cell">
          ${imageHtml}
          <span>${c.name || ""}</span>
        </div>
      </td>
      <td>${c.description || ""}</td>
      <td>
        <button class="action-btn" data-id="${c.id}">Sửa</button>
        <button class="action-btn btn-danger" data-id="${c.id}" data-action="delete" style="margin-left: 0.5rem;">Xóa</button>
      </td>
    </tr>
    `;
  }).join("");

  Array.from(tbody.querySelectorAll(".action-btn")).forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const action = btn.getAttribute("data-action");
      
      if (action === "delete") {
        deleteCategory(id);
        return;
      }
      
      // Edit action
      const category = categories.find(c => c.id === id);
      if (!category) return;
      editMode = "edit";
      fillForm(category);
      byId("modal-title").textContent = "Sửa danh mục";
      openModal();
    });
  });
}

function updateCategoryInList(category) {
  // Update in categories array
  const index = categories.findIndex(c => c.id === category.id);
  if (index !== -1) {
    categories[index] = category;
  }
  
  // Update in DOM
  const tbody = byId("categories-table").querySelector("tbody");
  const row = tbody.querySelector(`tr[data-category-id="${category.id}"]`);
  if (row) {
    const imageLink = category["image link"] || "";
    const imageSrc = getImageSource(imageLink);
    const imageHtml = imageSrc ? `<img src="${imageSrc}" alt="${category.name || ''}" class="category-thumbnail" onerror="this.style.display='none'">` : '';
    
    row.innerHTML = `
      <td>${category.id || ""}</td>
      <td>
        <div class="category-title-cell">
          ${imageHtml}
          <span>${category.name || ""}</span>
        </div>
      </td>
      <td>${category.description || ""}</td>
      <td>
        <button class="action-btn" data-id="${category.id}">Sửa</button>
        <button class="action-btn btn-danger" data-id="${category.id}" data-action="delete" style="margin-left: 0.5rem;">Xóa</button>
      </td>
    `;
    // Re-attach event listeners
    Array.from(row.querySelectorAll(".action-btn")).forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const action = btn.getAttribute("data-action");
        if (action === "delete") {
          deleteCategory(id);
        } else {
          editMode = "edit";
          fillForm(category);
          byId("modal-title").textContent = "Sửa danh mục";
          openModal();
        }
      });
    });
  }
}

function addCategoryToList(category) {
  // Add to categories array (at the beginning if on page 1)
  if (currentPage === 1) {
    categories.unshift(category);
    // If exceeds page limit, remove last item
    if (categories.length > itemsPerPage) {
      categories.pop();
    }
  }
  
  // Update DOM
  const tbody = byId("categories-table").querySelector("tbody");
  if (tbody && categories.length > 0) {
    // Remove "no categories" message if exists
    if (tbody.querySelector(".muted")) {
      tbody.innerHTML = "";
    }
    
    // Add new row at the top
    const newRow = document.createElement("tr");
    newRow.setAttribute("data-category-id", category.id);
    const imageLink = category["image link"] || "";
    const imageSrc = getImageSource(imageLink);
    const imageHtml = imageSrc ? `<img src="${imageSrc}" alt="${category.name || ''}" class="category-thumbnail" onerror="this.style.display='none'">` : '';
    
    newRow.innerHTML = `
      <td>${category.id || ""}</td>
      <td>
        <div class="category-title-cell">
          ${imageHtml}
          <span>${category.name || ""}</span>
        </div>
      </td>
      <td>${category.description || ""}</td>
      <td>
        <button class="action-btn" data-id="${category.id}">Sửa</button>
        <button class="action-btn btn-danger" data-id="${category.id}" data-action="delete" style="margin-left: 0.5rem;">Xóa</button>
      </td>
    `;
    tbody.insertBefore(newRow, tbody.firstChild);
    
    // Re-attach event listeners for all buttons
    Array.from(tbody.querySelectorAll(".action-btn")).forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const action = btn.getAttribute("data-action");
        const c = categories.find(cat => cat.id === id);
        if (!c) return;
        if (action === "delete") {
          deleteCategory(id);
        } else {
          editMode = "edit";
          fillForm(c);
          byId("modal-title").textContent = "Sửa danh mục";
          openModal();
        }
      });
    });
  }
}

async function loadCategories(page) {
  // Only read from URL when caller doesn't explicitly pass a page
  if (page == null) {
    const urlParams = Pagination.getParamsFromURL();
    page = urlParams.page;
  }
  
  currentPage = page;
  
  return apiCallWithLoading(async () => {
    // ✅ Step 1: Check frontend cache first (localStorage)
    const cacheKey = CacheManager.key("categories", "list", page, itemsPerPage);
    const cached = CacheManager.get(cacheKey);
    
    if (cached) {
      console.log("📦 Using cached categories data (localStorage)");
      categories = cached.items || [];
      
      // ✅ Sort categories by created_at desc (newest first) - ensure correct order
      categories.sort(function(a, b) {
        var dateA = a.created_at || "";
        var dateB = b.created_at || "";
        // Handle Date objects
        if (dateA instanceof Date) dateA = dateA.toISOString();
        if (dateB instanceof Date) dateB = dateB.toISOString();
        // Compare as strings
        return dateB.localeCompare(dateA);
      });
      
      totalCategories = cached.total || 0;
      totalPages = cached.totalPages || 0;
      currentPage = cached.page || 1;
      
      renderCategories();
      renderPagination();
      Pagination.updateURL(currentPage, itemsPerPage);
      return;
    }
    
    // ✅ Step 2: Try Cloudflare Worker first (fast, edge network)
    let result = null;
    
    if (WorkerAPI && WorkerAPI.isConfigured()) {
      try {
        console.log("🚀 Trying Cloudflare Worker for categories.list...");
        result = await WorkerAPI.categoriesList({
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
      result = await apiCall("categories.list", {
        page: page,
        limit: itemsPerPage
      });
    }
    
    // ✅ Sort categories by created_at desc (newest first) - ensure correct order
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
    
    categories = result.items || [];
    totalCategories = result.total || 0;
    totalPages = result.totalPages || 0;
    currentPage = result.page || 1;
    
    // Save to frontend cache
    CacheManager.set(cacheKey, result);
    
    renderCategories();
    renderPagination();
    
    // Update URL
    Pagination.updateURL(currentPage, itemsPerPage);
  }, "Đang tải danh mục...");
}

function renderPagination() {
  Pagination.render(
    "categories-pagination",
    currentPage,
    totalPages,
    totalCategories,
    loadCategories,
    "danh mục"
  );
}

async function saveCategory() {
  // ✅ Reload session from localStorage to ensure token is up to date
  reloadSession();
  
  // Clear previous validation errors
  Validator.clearErrors();
  
  const data = readForm();
  
  // Define validation rules (sử dụng constants mặc định)
  const rules = {
    id: Validator.helpers.requiredId(1),  // Max 15 ký tự (từ constants)
    name: Validator.helpers.requiredString(2),  // Max 50 ký tự (từ constants)
    description: Validator.helpers.textarea(false),  // Max 100 ký tự (từ constants)
    "image link": Validator.helpers.optionalUrl()
  };
  
  // Validate form
  const result = Validator.validateForm(data, rules);
  if (!result.valid) {
    // Map field names to input IDs
    const fieldIdMap = {
      'id': 'field-id',
      'name': 'field-name',
      'description': 'field-description',
      'image link': 'field-image-link'
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

  let savedCategory;
  try {
    if (editMode === "create") {
      data.token = session.token;
      savedCategory = await apiCall("categories.create", data);
    } else {
      if (!data.id) {
        alert("Thiếu ID danh mục");
        return;
      }
      data.token = session.token;
      savedCategory = await apiCall("categories.update", data);
    }

    // ✅ Clear ALL cache after write action (create/update)
    CacheManager.clearAllCache();
    
    // ✅ Also invalidate specific caches to be thorough
    CacheManager.invalidateOnProductChange();
    
    closeModal();
    clearForm();
    
    // ✅ Update UI directly instead of reloading
    if (editMode === "create") {
      // Add new category to current page if on page 1, otherwise reload
      if (currentPage === 1 && categories.length < itemsPerPage) {
        addCategoryToList(savedCategory);
        totalCategories++;
        totalPages = Math.ceil(totalCategories / itemsPerPage);
        renderPagination();
      } else {
        await loadCategories(currentPage);
      }
    } else {
      // Update existing category in list
      updateCategoryInList(savedCategory);
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

async function deleteCategory(categoryId) {
  // ✅ Reload session from localStorage to ensure token is up to date
  reloadSession();
  
  if (!categoryId) return;
  
  const category = categories.find(c => c.id === categoryId);
  if (!category) {
    alert("Không tìm thấy danh mục");
    return;
  }
  
  const confirmMsg = `Xác nhận xóa danh mục "${category.id}"?\n\nLưu ý: Hành động này không thể hoàn tác.`;
  if (!confirm(confirmMsg)) return;
  
  if (!session.token) {
    alert("Vui lòng đăng nhập trước");
    return;
  }
  
  if (!session.apiKey) {
    alert("Vui lòng đăng nhập lại (thiếu API key)");
    return;
  }
  
  Loading.show("Đang xóa danh mục...");
  try {
    await apiCall("categories.delete", {
      token: session.token,
      id: categoryId
    });
    
    // ✅ Clear ALL cache after write action (delete)
    CacheManager.clearAllCache();
    
    // ✅ Also invalidate specific caches to be thorough
    CacheManager.invalidateOnProductChange();
    
    // ✅ Remove category from UI
    removeCategoryFromList(categoryId);
    
    // Update totals
    totalCategories--;
    totalPages = Math.ceil(totalCategories / itemsPerPage);
    
    // If current page becomes empty and not page 1, go to previous page
    if (categories.length === 0 && currentPage > 1) {
      await loadCategories(currentPage - 1);
    } else {
      renderPagination();
    }
    
    alert("✅ Đã xóa danh mục thành công");
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

function removeCategoryFromList(categoryId) {
  // Remove from categories array
  const index = categories.findIndex(c => c.id === categoryId);
  if (index !== -1) {
    categories.splice(index, 1);
  }
  
  // Remove from DOM
  const tbody = byId("categories-table").querySelector("tbody");
  const row = tbody.querySelector(`tr[data-category-id="${categoryId}"]`);
  if (row) {
    row.remove();
  }
  
  // If no categories left, show empty message
  if (categories.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted">Chưa có danh mục</td></tr>`;
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
  byId("modal-title").textContent = "Thêm danh mục";
  openModal();
});

byId("btn-close").addEventListener("click", () => {
  closeModal();
});

byId("btn-save").addEventListener("click", async () => {
  const btn = byId("btn-save");
  Loading.button(btn, true);
  try {
    await saveCategory();
  } catch (err) {
    alert(err.message);
  } finally {
    Loading.button(btn, false);
  }
});

byId("btn-logout").addEventListener("click", () => {
  resetSession();
});

// Image upload handlers - Tạm thời comment lại vì không cần upload ảnh
/*
// ✅ Check if btn-upload-image exists before adding event listener (may be commented out in HTML)
const btnUploadImage = byId("btn-upload-image");
if (btnUploadImage) {
  btnUploadImage.addEventListener("click", () => {
    const fileUpload = byId("file-image-upload");
    if (fileUpload) {
      fileUpload.click();
    }
  });
}

// ✅ Check if file-image-upload exists before adding event listener (may be commented out in HTML)
const fileImageUpload = byId("file-image-upload");
if (fileImageUpload) {
  fileImageUpload.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
      alert('Vui lòng chọn file ảnh');
      return;
    }
    
    try {
      const base64 = await resizeAndConvertToBase64(file, IMAGE_MAX_WIDTH, IMAGE_MAX_HEIGHT);
      byId("field-image-link").value = base64;
      showImagePreview(base64);
    } catch (error) {
      console.error('Error processing image:', error);
      alert('Lỗi khi xử lý ảnh: ' + error.message);
    }
  });
}

// ✅ Check if btn-remove-image exists before adding event listener (may be commented out in HTML)
const btnRemoveImage = byId("btn-remove-image");
if (btnRemoveImage) {
  btnRemoveImage.addEventListener("click", () => {
    byId("field-image-link").value = "";
    hideImagePreview();
    const fileUpload = byId("file-image-upload");
    if (fileUpload) {
      fileUpload.value = "";
    }
  });
}
*/

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
  
  // ✅ Check if elements exist (they may be commented out in HTML)
  if (!preview || !previewImg) {
    return; // Elements don't exist, skip preview
  }
  
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
  if (preview) {
    preview.style.display = 'none';
  }
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

syncInputsFromSession();
applyQueryParams_();
updateSessionUI();
if (session.token) {
  const urlParams = Pagination.getParamsFromURL();
  loadCategories(urlParams.page).catch(err => {
    alert(err.message);
    resetSession();
  });
}
