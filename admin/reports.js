// =============================================================================
// reports.js
//
// Sections:
//   1. Dashboard hôm nay  → reports.dashboard
//   2. Doanh thu          → reports.sales  (chart + table)
//   3. Sản phẩm bán chạy  → reports.top_products
//   4. Tồn kho & cảnh báo → reports.stock_alert
//
// Shared:
//   fetchReport()  – cache-or-fetch wrapper, 1 pattern dùng cho tất cả
//   renderTable()  – generic table renderer
//   handleError()  – centralized error + auth redirect
//
// Không có:
//   - formatPrice redeclare (dùng từ common.js)
//   - WorkerAPI init dead code
//   - window.onclick override
//   - Promise.all → dùng Promise.allSettled (sections độc lập)
// =============================================================================

// ─── Page state ───────────────────────────────────────────────────────────────

let salesChart = null;

// ─── Shared: fetchReport ──────────────────────────────────────────────────────

/**
 * fetchReport – cache-or-fetch wrapper dùng chung cho mọi report.
 *
 * Thay thế pattern lặp 5 lần:
 *   const cached = CacheManager.get(key);
 *   if (cached) { data = cached; } else { data = await apiCall(); CacheManager.set(); }
 *
 * @param {string}   cacheKey  – CacheManager key
 * @param {string}   action    – GAS action string (e.g. "reports.sales")
 * @param {Object}   params    – extra params (token được inject tự động)
 * @returns {*}      data từ cache hoặc API
 */
async function fetchReport(cacheKey, action, params) {
  const cached = CacheManager.get(cacheKey);
  if (cached) {
    console.log("📦 Cache hit:", cacheKey);
    return cached;
  }
  const data = await apiCall(action, { token: session.token, ...params });
  CacheManager.set(cacheKey, data);
  return data;
}

// ─── Shared: handleError ──────────────────────────────────────────────────────

function handleError(err, context) {
  const msg = err?.message || String(err);
  console.error("❌", context, msg);
  const isAuth = msg.includes("Token expired") || msg.includes("Unauthorized") || msg.includes("hết hạn");
  if (isAuth) {
    alert("Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.");
    resetSession();
    window.location.reload();
    return;
  }
  // Hiển thị lỗi nhẹ (không alert spam khi loadAllReports)
  console.warn("Report error [" + context + "]:", msg);
}

// ─── Shared: renderTable ─────────────────────────────────────────────────────

/**
 * renderTable – render tbody từ array items + column definitions.
 * Tất cả giá trị được escapeHtml() để chống XSS.
 *
 * @param {string}   tbodyId  – id của <tbody>
 * @param {Array}    items    – array of data objects
 * @param {Array}    cols     – [{ key, label, render }]
 *                             render(item) → string (đã escape bởi caller nếu HTML tùy chỉnh)
 * @param {string}   emptyMsg – text khi không có data
 */
function renderTable(tbodyId, items, cols, emptyMsg) {
  const tbody = byId(tbodyId);
  if (!tbody) return;

  if (!items || !items.length) {
    tbody.innerHTML = '<tr><td colspan="' + cols.length + '" class="muted">' +
      escapeHtml(emptyMsg || "Không có dữ liệu") + "</td></tr>";
    return;
  }

  tbody.innerHTML = items.map(function(item) {
    return "<tr>" + cols.map(function(col) {
      const val = col.render ? col.render(item) : escapeHtml(item[col.key] ?? "");
      return "<td" + (col.cls ? ' class="' + col.cls + '"' : "") + ">" + val + "</td>";
    }).join("") + "</tr>";
  }).join("");
}

// =============================================================================
// 1. Dashboard hôm nay
// =============================================================================

async function loadDashboard() {
  try {
    const cacheKey = CacheManager.key("reports", "dashboard");
    const data     = await fetchReport(cacheKey, "reports.dashboard", {});

    byId("today-revenue").textContent  = formatPrice(data.today_revenue  || 0);
    byId("today-orders").textContent   = data.today_orders   || 0;
    byId("pending-orders").textContent = data.pending_orders || 0;
    byId("low-stock-count").textContent = data.low_stock_count || 0;
  } catch (err) {
    handleError(err, "dashboard");
  }
}

// =============================================================================
// 2. Doanh thu theo thời gian
// =============================================================================

async function loadSales() {
  const period   = byId("sales-period")?.value    || "day";
  const fromDate = byId("sales-from-date")?.value || "";
  const toDate   = byId("sales-to-date")?.value   || "";

  try {
    const cacheKey = CacheManager.key("reports", "sales", period, fromDate || "all", toDate || "all");
    const data     = await fetchReport(cacheKey, "reports.sales", {
      period,
      from_date: fromDate || null,
      to_date  : toDate   || null
    });

    byId("sales-total-revenue").textContent = formatPrice(data.total_revenue       || 0);
    byId("sales-total-orders").textContent  = data.total_orders                    || 0;
    byId("sales-avg-order").textContent     = formatPrice(data.average_order_value || 0);

    renderSalesChart(data.data || [], period);
    renderSalesTable(data.data || []);
  } catch (err) {
    handleError(err, "sales");
  }
}

function renderSalesChart(data, period) {
  const ctx = byId("sales-chart");
  if (!ctx) return;

  // ✅ Guard: chỉ destroy nếu chart còn gắn vào DOM
  if (salesChart) {
    try { salesChart.destroy(); } catch (e) {}
    salesChart = null;
  }

  if (!data.length) return;

  salesChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels  : data.map(function(d) { return d.date_label; }),
      datasets: [{
        label          : "Doanh thu (₫)",
        data           : data.map(function(d) { return d.revenue; }),
        backgroundColor: "rgba(59,130,246,0.7)",
        borderColor    : "rgb(59,130,246)",
        borderWidth    : 1,
        borderRadius   : 4
      }]
    },
    options: {
      responsive         : true,
      maintainAspectRatio: false,
      plugins: {
        legend : { display: false },
        tooltip: {
          callbacks: {
            label: function(ctx) {
              return "Doanh thu: " + formatPrice(ctx.parsed.y) +
                     "  |  Số đơn: " + (data[ctx.dataIndex]?.orders || 0);
            }
          }
        }
      },
      scales: {
        y: {
          ticks: { callback: function(v) { return formatPrice(v); } },
          grid : { color: "rgba(0,0,0,0.05)" }
        }
      }
    }
  });
}

function renderSalesTable(data) {
  renderTable("sales-tbody", data, [
    { key: "date_label", label: "Kỳ" },
    { key: "revenue",    label: "Doanh thu",   cls: "text-right",
      render: function(d) { return escapeHtml(formatPrice(d.revenue)); } },
    { key: "orders",     label: "Số đơn",      cls: "text-center",
      render: function(d) { return escapeHtml(String(d.orders)); } },
    { key: "avg",        label: "TB/đơn",       cls: "text-right",
      render: function(d) {
        const avg = d.orders > 0 ? d.revenue / d.orders : 0;
        return escapeHtml(formatPrice(avg));
      }
    }
  ], "Không có dữ liệu doanh thu");
}

// ── Default dates (30 ngày gần nhất) ────────────────────────────────────────

function setDefaultSalesDates() {
  const today        = new Date();
  const thirtyAgo    = new Date();
  thirtyAgo.setDate(today.getDate() - 30);
  const fmt = function(d) { return d.toISOString().split("T")[0]; };

  const elFrom = byId("sales-from-date");
  const elTo   = byId("sales-to-date");
  if (elFrom && !elFrom.value) elFrom.value = fmt(thirtyAgo);
  if (elTo   && !elTo.value)   elTo.value   = fmt(today);
}

// =============================================================================
// 3. Sản phẩm bán chạy
// =============================================================================

async function loadTopProducts() {
  const fromDate = byId("top-from-date")?.value || "";
  const toDate   = byId("top-to-date")?.value   || "";

  try {
    const cacheKey = CacheManager.key("reports", "top_products", fromDate || "all", toDate || "all");
    const data     = await fetchReport(cacheKey, "reports.top_products", {
      from_date: fromDate || null,
      to_date  : toDate   || null,
      limit    : 20
    });

    byId("top-total-revenue").textContent = formatPrice(data.total_revenue || 0);
    renderTopProducts(data.items || []);
  } catch (err) {
    handleError(err, "top_products");
  }
}

function renderTopProducts(items) {
  renderTable("top-products-tbody", items, [
    { key: "rank",        label: "#",          cls: "text-center",
      render: function(item, idx) { return escapeHtml(String(items.indexOf(item) + 1)); }
    },
    { key: "name",        label: "Sản phẩm",
      render: function(d) { return escapeHtml(d.name); }
    },
    { key: "qty_sold",    label: "SL bán",     cls: "text-center",
      render: function(d) { return escapeHtml(String(d.qty_sold)); }
    },
    { key: "order_count", label: "Số đơn",     cls: "text-center",
      render: function(d) { return escapeHtml(String(d.order_count)); }
    },
    { key: "revenue",     label: "Doanh thu",  cls: "text-right",
      render: function(d) { return escapeHtml(formatPrice(d.revenue)); }
    },
    { key: "revenue_pct", label: "% DT",       cls: "text-center",
      render: function(d) {
        return '<span class="pct-bar" style="--pct:' + escapeHtml(String(d.revenue_pct)) + '%">' +
               escapeHtml(String(d.revenue_pct)) + "%</span>";
      }
    }
  ], "Chưa có dữ liệu bán hàng");
}

// =============================================================================
// 4. Tồn kho & cảnh báo
// =============================================================================

async function loadStockAlert() {
  const threshold = byId("stock-threshold")?.value || 10;

  try {
    const cacheKey = CacheManager.key("reports", "stock_alert", threshold);
    const data     = await fetchReport(cacheKey, "reports.stock_alert", { threshold });

    byId("stock-out-count").textContent = data.out_count || 0;
    byId("stock-low-count").textContent = data.low_count || 0;
    byId("stock-grand-total").textContent = formatPrice(data.grand_total || 0);
    renderStockAlert(data.items || []);
  } catch (err) {
    handleError(err, "stock_alert");
  }
}

const STATUS_LABEL = { OK: "✅ Đủ hàng", LOW: "⚠️ Sắp hết", OUT: "🔴 Hết hàng" };
const STATUS_CLS   = { OK: "status-ok",   LOW: "status-low",  OUT: "status-out" };

function renderStockAlert(items) {
  renderTable("stock-tbody", items, [
    { key: "name",        label: "Sản phẩm",
      render: function(d) { return escapeHtml(d.name); }
    },
    { key: "stock",       label: "Tồn kho",    cls: "text-center",
      render: function(d) { return escapeHtml(String(d.stock)); }
    },
    { key: "in_value",    label: "Giá trị nhập", cls: "text-right",
      render: function(d) { return escapeHtml(formatPrice(d.in_value)); }
    },
    { key: "out_value",   label: "Giá trị xuất", cls: "text-right",
      render: function(d) { return escapeHtml(formatPrice(d.out_value)); }
    },
    { key: "stock_value", label: "Giá trị tồn", cls: "text-right",
      render: function(d) { return "<strong>" + escapeHtml(formatPrice(d.stock_value)) + "</strong>"; }
    },
    { key: "status",      label: "Trạng thái",  cls: "text-center",
      render: function(d) {
        return '<span class="' + escapeHtml(STATUS_CLS[d.status] || "") + '">' +
               escapeHtml(STATUS_LABEL[d.status] || d.status) + "</span>";
      }
    }
  ], "Chưa có dữ liệu tồn kho");
}

// =============================================================================
// Init & event listeners
// =============================================================================

async function loadAllReports() {
  return apiCallWithLoading(async function() {
    setDefaultSalesDates();

    // ✅ Promise.allSettled: sections độc lập, 1 section lỗi không block section khác
    const results = await Promise.allSettled([
      loadDashboard(),
      loadSales(),
      loadTopProducts(),
      loadStockAlert()
    ]);

    results.forEach(function(r, i) {
      if (r.status === "rejected") {
        const names = ["dashboard", "sales", "top_products", "stock_alert"];
        console.warn("Section [" + names[i] + "] failed:", r.reason?.message);
      }
    });
  }, "Đang tải báo cáo...");
}

// ── Login ────────────────────────────────────────────────────────────────────

byId("btn-login")?.addEventListener("click", async function() {
  const btn = byId("btn-login");
  Loading.button(btn, true);
  try {
    await login();
    await loadAllReports();
  } catch (err) {
    handleError(err, "login");
  } finally {
    Loading.button(btn, false);
  }
});

// ── Logout ───────────────────────────────────────────────────────────────────

byId("btn-logout")?.addEventListener("click", function() {
  resetSession();
  window.location.reload();
});

// ── Sales: filter ─────────────────────────────────────────────────────────────

// Debounce để tránh double-fire khi bấm nút + đổi period cùng lúc
let _salesDebounce = null;
function debouncedLoadSales() {
  clearTimeout(_salesDebounce);
  _salesDebounce = setTimeout(function() {
    if (!session.token) return;
    apiCallWithLoading(loadSales, "Đang tải doanh thu...");
  }, 120);
}

byId("btn-load-sales")?.addEventListener("click", debouncedLoadSales);
byId("sales-period")?.addEventListener("change", debouncedLoadSales);

// ── Top products: filter ──────────────────────────────────────────────────────

byId("btn-load-top")?.addEventListener("click", function() {
  if (!session.token) return;
  apiCallWithLoading(loadTopProducts, "Đang tải sản phẩm bán chạy...");
});

// ── Stock: filter ─────────────────────────────────────────────────────────────

byId("btn-load-stock")?.addEventListener("click", function() {
  if (!session.token) return;
  apiCallWithLoading(loadStockAlert, "Đang tải tồn kho...");
});

// ── Auto-load nếu đã đăng nhập ───────────────────────────────────────────────

reloadSession();
syncInputsFromSession();
applyQueryParams_();
updateSessionUI();

if (session.token) {
  loadAllReports().catch(function(err) { handleError(err, "init"); });
}