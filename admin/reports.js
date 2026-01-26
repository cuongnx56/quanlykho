// Use common utilities from common.js
// DEFAULT_API_URL, sessionDefaults, and session are already declared in common.js
// Just use them directly (they're in global scope) or reference via window.CommonUtils
// No need to redeclare - they're already available

// resetSession is now from common.js, but we can override if needed
// Use the stored original from common.js
function resetSession() {
  // Call the original resetSession from common.js
  if (window._originalResetSession) {
    window._originalResetSession();
  }
  // Page-specific cleanup if needed
}
// Override window.resetSession with our version
window.resetSession = resetSession;

// apiCall is now from common.js

async function login() {
  session.apiUrl = DEFAULT_API_URL;
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
  updateSessionUI();
  await loadAllReports();
}

async function loadAllReports() {
  return apiCallWithLoading(async () => {
    await Promise.all([
      loadDashboard(),
      loadLowStock(),
      loadStockValue(),
      loadMovementReport()
    ]);
    // Load sales report with default settings
    setDefaultSalesDates();
    await loadSalesReport();
  }, "Đang tải báo cáo...");
}

async function loadDashboard() {
  try {
    // Check cache
    const cacheKey = CacheManager.key("reports", "dashboard");
    const cached = CacheManager.get(cacheKey);
    
    let data;
    if (cached) {
      console.log("📦 Using cached dashboard data");
      data = cached;
    } else {
      data = await apiCall("reports.dashboard", {
        token: session.token
      });
      CacheManager.set(cacheKey, data);
    }

    byId("total-products").textContent = data.total_products || 0;
    byId("total-stock").textContent = data.total_stock || 0;
    byId("total-value").textContent = formatPrice(data.total_value || 0);
    byId("low-stock-count").textContent = data.low_stock_count || 0;
  } catch (err) {
    console.error(err);
  }
}

async function loadLowStock() {
  const threshold = byId("threshold").value || 10;
  try {
    // Check cache
    const cacheKey = CacheManager.key("reports", "low_stock", threshold);
    const cached = CacheManager.get(cacheKey);
    
    let data;
    if (cached) {
      console.log("📦 Using cached low stock data");
      data = cached;
    } else {
      data = await apiCall("reports.low_stock", {
        token: session.token,
        threshold: threshold
      });
      CacheManager.set(cacheKey, data);
    }

    renderLowStock(data);
  } catch (err) {
    console.error(err);
  }
}

function renderLowStock(items) {
  const tbody = byId("low-stock-table").querySelector("tbody");
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted">Không có sản phẩm sắp hết</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map(item => `
    <tr>
      <td>${item.id || ""}</td>
      <td>${item.title || ""}</td>
      <td class="text-center">${item.amount_in_stock || 0}</td>
      <td class="text-center">${formatPrice(item.price || 0)}</td>
    </tr>
  `).join("");
}

async function loadStockValue() {
  try {
    // Check cache
    const cacheKey = CacheManager.key("reports", "stock_value");
    const cached = CacheManager.get(cacheKey);
    
    let data;
    if (cached) {
      console.log("📦 Using cached stock value data");
      data = cached;
    } else {
      data = await apiCall("reports.stock_value", {
        token: session.token
      });
      CacheManager.set(cacheKey, data);
    }

    renderStockValue(data.products, data.grand_total);
  } catch (err) {
    console.error(err);
  }
}

function renderStockValue(items, grandTotal) {
  const tbody = byId("stock-value-table").querySelector("tbody");
  byId("grand-total").textContent = formatPrice(grandTotal || 0);
  
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">Chưa có dữ liệu</td></tr>`;
    return;
  }
  
  let html = "";
  items.forEach((item, index) => {
    const rowId = `product-${index}`;
    html += `
      <tr>
        <td>${item.id || ""}</td>
        <td>${item.title || ""}</td>
        <td class="text-center">${item.current_stock || 0}</td>
        <td class="text-center">${formatPrice(item.in_value || 0)}</td>
        <td class="text-center">${formatPrice(item.out_value || 0)}</td>
        <td class="text-center"><strong>${formatPrice(item.total_value || 0)}</strong></td>
        <td class="text-center">
          <button class="expand-btn" onclick="toggleDetail('${rowId}')">Xem</button>
        </td>
      </tr>
      <tr id="${rowId}" class="detail-row" style="display: none;">
        <td colspan="7">
          <div class="detail-content">
            <strong>Chi tiết nhập/xuất:</strong>
            <ul class="movement-list">
              ${renderMovements(item.movements)}
            </ul>
          </div>
        </td>
      </tr>
    `;
  });
  
  tbody.innerHTML = html;
}

function renderMovements(movements) {
  if (!movements || !movements.length) {
    return '<li>Chưa có giao dịch</li>';
  }
  
  return movements.map(m => {
    const sign = m.type === "IN" ? "+" : (m.type === "OUT" ? "-" : "±");
    return `
      <li class="${m.type}">
        <strong>${m.type}</strong>: ${sign}${m.qty} × ${formatPrice(m.unit_price)} = ${formatPrice(m.value)}
        <span style="color: #94a3b8; font-size: 12px; margin-left: 8px;">${m.created_at || ""}</span>
      </li>
    `;
  }).join("");
}

function toggleDetail(rowId) {
  const row = document.getElementById(rowId);
  if (row.style.display === "none") {
    row.style.display = "table-row";
  } else {
    row.style.display = "none";
  }
}

async function loadMovementReport() {
  const fromDate = byId("from-date").value;
  const toDate = byId("to-date").value;

  try {
    // Check cache
    const cacheKey = CacheManager.key("reports", "inventory_movement", fromDate || "all", toDate || "all");
    const cached = CacheManager.get(cacheKey);
    
    let data;
    if (cached) {
      console.log("📦 Using cached movement report data");
      data = cached;
    } else {
      data = await apiCall("reports.inventory_movement", {
        token: session.token,
        from_date: fromDate,
        to_date: toDate
      });
      CacheManager.set(cacheKey, data);
    }

    renderMovementReport(data.summary);
  } catch (err) {
    console.error(err);
  }
}

function renderMovementReport(summary) {
  const tbody = byId("movement-report-table").querySelector("tbody");
  const keys = Object.keys(summary);
  if (!keys.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">Chưa có dữ liệu</td></tr>`;
    return;
  }
  tbody.innerHTML = keys.map(productId => {
    const item = summary[productId];
    return `
      <tr>
        <td>${productId}</td>
        <td class="text-center">${item.in_qty || 0}</td>
        <td class="text-center">${formatPrice(item.in_value || 0)}</td>
        <td class="text-center">${item.out_qty || 0}</td>
        <td class="text-center">${formatPrice(item.out_value || 0)}</td>
        <td class="text-center">${item.adjust_qty || 0}</td>
      </tr>
    `;
  }).join("");
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

byId("btn-refresh-low-stock").addEventListener("click", async () => {
  const btn = byId("btn-refresh-low-stock");
  Loading.button(btn, true);
  try {
    await loadLowStock();
  } catch (err) {
    alert(err.message);
  } finally {
    Loading.button(btn, false);
  }
});

byId("btn-filter-movement").addEventListener("click", async () => {
  const btn = byId("btn-filter-movement");
  Loading.button(btn, true);
  try {
    await loadMovementReport();
  } catch (err) {
    alert(err.message);
  } finally {
    Loading.button(btn, false);
  }
});

// Sales Report
let salesChart = null;

async function loadSalesReport() {
  const period = byId("sales-period").value;
  const fromDate = byId("sales-from-date").value;
  const toDate = byId("sales-to-date").value;

  try {
    // Check cache
    const cacheKey = CacheManager.key("reports", "sales", period, fromDate || "all", toDate || "all");
    const cached = CacheManager.get(cacheKey);
    
    let data;
    if (cached) {
      console.log("📦 Using cached sales report data");
      data = cached;
    } else {
      data = await apiCall("reports.sales", {
        token: session.token,
        period: period,
        from_date: fromDate || null,
        to_date: toDate || null
      });
      CacheManager.set(cacheKey, data);
    }

    // Update summary
    byId("sales-total-revenue").textContent = formatPrice(data.total_revenue || 0);
    byId("sales-total-orders").textContent = data.total_orders || 0;
    byId("sales-avg-order").textContent = formatPrice(data.average_order_value || 0);

    // Render chart
    renderSalesChart(data.data, period);

    // Render table
    renderSalesTable(data.data, period);
  } catch (err) {
    console.error("Error loading sales report:", err);
    alert("Lỗi: " + err.message);
  }
}

function renderSalesChart(data, period) {
  const ctx = document.getElementById("sales-chart");
  if (!ctx) return;

  // Destroy existing chart
  if (salesChart) {
    salesChart.destroy();
  }

  const labels = data.map(item => item.date_label);
  const revenues = data.map(item => item.revenue);
  const orders = data.map(item => item.orders);

  salesChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Doanh thu (₫)",
          data: revenues,
          borderColor: "rgb(59, 130, 246)",
          backgroundColor: "rgba(59, 130, 246, 0.1)",
          tension: 0.4,
          yAxisID: "y"
        },
        {
          label: "Số đơn hàng",
          data: orders,
          borderColor: "rgb(16, 185, 129)",
          backgroundColor: "rgba(16, 185, 129, 0.1)",
          tension: 0.4,
          yAxisID: "y1"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false
      },
      plugins: {
        legend: {
          position: "top"
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              if (context.datasetIndex === 0) {
                return "Doanh thu: " + formatPrice(context.parsed.y);
              } else {
                return "Số đơn: " + context.parsed.y;
              }
            }
          }
        }
      },
      scales: {
        y: {
          type: "linear",
          display: true,
          position: "left",
          title: {
            display: true,
            text: "Doanh thu (₫)"
          },
          ticks: {
            callback: function(value) {
              return formatPrice(value);
            }
          }
        },
        y1: {
          type: "linear",
          display: true,
          position: "right",
          title: {
            display: true,
            text: "Số đơn hàng"
          },
          grid: {
            drawOnChartArea: false
          }
        }
      }
    }
  });
}

function renderSalesTable(data, period) {
  const tbody = byId("sales-report-table").querySelector("tbody");
  
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted">Không có dữ liệu</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(item => {
    const avgOrder = item.orders > 0 ? item.revenue / item.orders : 0;
    return `
      <tr>
        <td>${item.date_label}</td>
        <td class="text-center">${formatPrice(item.revenue)}</td>
        <td class="text-center">${item.orders}</td>
        <td class="text-center">${formatPrice(avgOrder)}</td>
      </tr>
    `;
  }).join("");
}

// Set default dates (last 30 days)
function setDefaultSalesDates() {
  const today = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(today.getDate() - 30);
  
  byId("sales-from-date").value = thirtyDaysAgo.toISOString().split("T")[0];
  byId("sales-to-date").value = today.toISOString().split("T")[0];
}

// Event listeners
byId("btn-load-sales").addEventListener("click", () => {
  apiCallWithLoading(loadSalesReport, "Đang tải báo cáo doanh thu...");
});

byId("sales-period").addEventListener("change", () => {
  // Auto load when period changes
  if (session.token) {
    apiCallWithLoading(loadSalesReport, "Đang tải báo cáo doanh thu...");
  }
});

syncInputsFromSession();
applyQueryParams_();
updateSessionUI();
if (session.token) {
  setDefaultSalesDates();
  loadAllReports().catch(err => {
    alert(err.message);
    resetSession();
  });
}
