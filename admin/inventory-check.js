// Use common utilities from common.js
// DEFAULT_API_URL, sessionDefaults, and session are already declared in common.js
// Just use them directly (they're in global scope) or reference via window.CommonUtils
// No need to redeclare - they're already available

// syncInputsFromSession, applyQueryParams_, resetSession, apiCall are now from common.js

function setResult(message, type) {
  const box = byId("result");
  box.classList.remove("success", "error");
  if (type) box.classList.add(type);
  box.textContent = message;
}

// ─── Product search (Worker API search, same as inventory) ───────────────────
// Last search results: used to show product detail on select without calling API
let lastSearchItems = [];

function renderDropdownItems(items) {
  const dropdown = byId("product_dropdown");
  if (!dropdown) return;
  lastSearchItems = items && items.length ? items : [];
  if (!items || items.length === 0) {
    dropdown.innerHTML = `<div class="dropdown-empty">Không tìm thấy sản phẩm</div>`;
    dropdown.style.display = "block";
    return;
  }
  dropdown.innerHTML = items.map(item => {
    const id = item.id != null ? item.id : item;
    const title = item.title || item.name || "";
    const label = title ? `${escapeHtml(String(id))} - ${escapeHtml(title)}` : escapeHtml(String(id));
    return `<div class="dropdown-item" data-product-id="${escapeAttr(String(id))}">${label}</div>`;
  }).join("");
  dropdown.style.display = "block";
}

function initProductSearch() {
  const searchInput = byId("product_search");
  const dropdown = byId("product_dropdown");
  if (!searchInput || !dropdown) return;

  searchInput._productSearchController?.abort();
  const controller = new AbortController();
  searchInput._productSearchController = controller;
  const signal = controller.signal;

  dropdown._delegatedClick = (e) => {
    const el = e.target.closest(".dropdown-item[data-product-id]");
    if (el) {
      const product = lastSearchItems.find(p => String(p.id || p) === String(el.dataset.productId));
      selectProductFromDropdown(product || { id: el.dataset.productId }, el.textContent.trim());
    }
  };
  dropdown.addEventListener("click", dropdown._delegatedClick);

  let debounceTimer;
  async function doSearch(term) {
    clearTimeout(debounceTimer);
    if (!term) {
      renderDropdownItems([]);
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
          console.warn("⚠️ Worker product search failed:", err?.message);
        }
      }
      if (loadingEl) loadingEl.style.display = "none";
      renderDropdownItems(items);
    }, 300);
  }

  searchInput.addEventListener("input", function () {
    doSearch(this.value.trim());
  }, { signal });

  searchInput.addEventListener("focus", function () {
    dropdown.style.display = "block";
    const term = this.value.trim();
    if (term) doSearch(term);
    else renderDropdownItems([]);
  }, { signal });

  searchInput.addEventListener("keydown", async function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = dropdown.querySelector(".dropdown-item[data-product-id]");
      if (first) {
        const product = lastSearchItems.find(p => String(p.id || p) === String(first.dataset.productId));
        selectProductFromDropdown(product || { id: first.dataset.productId }, first.textContent.trim());
      }
    } else if (e.key === "Escape") {
      dropdown.style.display = "none";
    }
  }, { signal });

  searchInput.addEventListener("blur", () => {
    setTimeout(() => { dropdown.style.display = "none"; }, 200);
  }, { signal });

  document.addEventListener("click", (e) => {
    if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = "none";
    }
  }, { signal });
}

function selectProductFromDropdown(product, label) {
  const searchInput = byId("product_search");
  const dropdown = byId("product_dropdown");
  const hiddenId = byId("product_id");
  const id = product && (product.id != null) ? product.id : product;
  if (dropdown) dropdown.style.display = "none";
  if (hiddenId) hiddenId.value = id;
  if (searchInput) searchInput.value = label || id;
  // Hiển thị thông tin detail từ kết quả search (không gọi API check)
  const title = product?.title || product?.name || "";
  const stock = product?.amount_in_stock;
  const price = product?.price;
  const parts = [`Mã: ${id}`];
  if (title) parts.push(`Tên: ${title}`);
  if (stock != null && stock !== "") parts.push(`Tồn kho: ${stock}`);
  if (price != null && price !== "") parts.push(`Giá: ${typeof formatPrice === "function" ? formatPrice(price) : price}`);
  setResult(parts.join("  ·  "), "success");
}

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
  setResult("Đăng nhập thành công. Tìm hoặc chọn sản phẩm để kiểm tra tồn.", "success");
}

async function checkStock() {
  if (!session.token) {
    alert("Vui lòng đăng nhập trước");
    return;
  }
  var productId = byId("product_id").value.trim();
  if (!productId) {
    setResult("Vui lòng nhập mã sản phẩm.", "error");
    return;
  }
  const data = await apiCall("inventory.check", {
    token: session.token,
    product_id: productId
  });
  setResult(`Tồn kho hiện tại của ${data.product_id}: ${data.amount_in_stock}`, "success");
}

byId("btn-login").addEventListener("click", async () => {
  const btn = byId("btn-login");
  Loading.button(btn, true);
  try {
    await login();
  } catch (err) {
    setResult(err.message, "error");
  } finally {
    Loading.button(btn, false);
  }
});

byId("btn-check").addEventListener("click", async () => {
  const btn = byId("btn-check");
  Loading.button(btn, true);
  try {
    await checkStock();
  } catch (err) {
    setResult(err.message, "error");
  } finally {
    Loading.button(btn, false);
  }
});

byId("btn-logout").addEventListener("click", () => {
  resetSession();
  setResult("", "");
});

syncInputsFromSession();
applyQueryParams_();
updateSessionUI();

if (window.WorkerAPI) {
  const url = window.CommonUtils?.WORKER_URL || (window.AuthSession?.load?.({})?.workerUrl);
  if (url) WorkerAPI.init(url);
}
initProductSearch();
