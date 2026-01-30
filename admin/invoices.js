/**
 * Invoices Management
 */

let invoices = [];
let currentPage = 1;

// Initialize
document.addEventListener("DOMContentLoaded", async () => {
  // Reload session from localStorage to ensure it's up to date
  reloadSession();
  
  syncInputsFromSession();
  updateSessionUI();
  
  byId("btn-login").addEventListener("click", async () => {
    const btn = byId("btn-login");
    Loading.button(btn, true);
    try {
      await login(); // Use shared login function from common.js
      await loadInvoices(1);
    } catch (err) {
      alert(`❌ Lỗi: ${err.message}`);
    } finally {
      Loading.button(btn, false);
    }
  });
  
  byId("btn-logout").addEventListener("click", () => {
    resetSession();
    window.location.reload();
  });
  
  // Initialize WorkerAPI if configured
  if (window.WorkerAPI && window.CommonUtils && window.CommonUtils.WORKER_URL) {
    WorkerAPI.init(window.CommonUtils.WORKER_URL);
    console.log("✅ WorkerAPI initialized for READ operations");
  } else if (window.WorkerAPI) {
    console.log("ℹ️ WorkerAPI available but WORKER_URL not configured. Using GAS only.");
  }
  
  // Load invoices if already logged in
  if (session.token && session.apiKey) {
    await loadInvoices(1);
  }
});

async function loadInvoices(page) {
  if (!session.token || !session.apiKey) {
    byId("login-section").classList.remove("hidden");
    return;
  }
  
  byId("login-section").classList.add("hidden");
  currentPage = page || 1;
  
  Loading.show("Đang tải hóa đơn...");
  try {
    // ✅ Step 1: Check frontend cache first (localStorage)
    const cacheKey = CacheManager.key("invoices", "list", page, 50);
    let result = CacheManager.get(cacheKey);
    
    if (result) {
      console.log("📦 Using cached invoices data (localStorage)");
      invoices = (result.items) ? result.items : [];
      renderInvoices();
      Pagination.render(result, currentPage, loadInvoices);
      Loading.hide();
      return;
    }
    
    // ✅ Step 2: Try Cloudflare Worker first (fast, edge network)
    if (WorkerAPI && WorkerAPI.isConfigured()) {
      try {
        console.log("🚀 Trying Cloudflare Worker for invoices.list...");
        result = await WorkerAPI.invoicesList({
          page: page,
          limit: 50
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
      result = await apiCall("invoices.list", {
        token: session.token,
        page: page,
        limit: 50
      });
    }
    
    invoices = (result && result.items) ? result.items : [];
    
    // Save to frontend cache
    CacheManager.set(cacheKey, result);
    
    renderInvoices();
    Pagination.render(result, currentPage, loadInvoices);
  } catch (err) {
    alert(`❌ Lỗi: ${err.message}`);
    byId("invoices-table tbody").innerHTML = `
      <tr>
        <td colspan="6" class="text-center">Lỗi khi tải dữ liệu</td>
      </tr>
    `;
  } finally {
    Loading.hide();
  }
}

function renderInvoices() {
  const tbody = byId("invoices-table").querySelector("tbody");
  
  if (!invoices || invoices.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center">Chưa có hóa đơn nào</td>
      </tr>
    `;
    return;
  }
  
  tbody.innerHTML = invoices.map(invoice => {
    const customer = invoice.customer_info || {};
    const customerName = invoice.customer_id || customer.name || invoice.order_id || "N/A";
    
    return `
      <tr>
        <td><strong>${invoice.invoice_number || invoice.id}</strong></td>
        <td>${invoice.order_id || ""}</td>
        <td>${customerName}</td>
        <td class="text-right">${formatPrice(invoice.total || 0)}</td>
        <td>${invoice.created_at || ""}</td>
        <td class="text-center">
          <button class="btn-action view" onclick="viewInvoice('${invoice.id}')">
            👁️ Xem/In
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

async function viewInvoice(invoiceId) {
  Loading.show("Đang tải hóa đơn...");
  try {
    const cacheKey = `invoice_${invoiceId}`;
    let invoice = CacheManager.get(cacheKey);
    
    if (!invoice) {
      invoice = await apiCall("invoices.get", {
        token: session.token,
        invoice_id: invoiceId
      });
      CacheManager.set(cacheKey, invoice, 600); // 10 minutes
    }
    
    renderInvoice(invoice);
    openInvoiceModal();
  } catch (err) {
    alert(`❌ Lỗi: ${err.message}`);
  } finally {
    Loading.hide();
  }
}

function renderInvoice(invoice) {
  const shopInfo = invoice.shop_info || {};
  const customerInfo = invoice.customer_info || {};
  const items = invoice.items_json || [];
  const customerId = invoice.customer_id || customerInfo.id || customerInfo.name || "Khách lẻ";
  
  // Calculate totals
  const subtotal = Number(invoice.subtotal) || 0;
  const vatRate = Number(invoice.vat_rate) || 0;
  const vatAmount = Number(invoice.vat_amount) || 0;
  const total = Number(invoice.total) || subtotal;
  
  const itemsHtml = items.map((item, index) => {
    const qty = Number(item.qty) || 0;
    const price = Number(item.price) || 0;
    const itemTotal = qty * price;
    
    return `
      <tr>
        <td class="text-center">${index + 1}</td>
        <td>${item.product_id || ""}</td>
        <td class="text-right">${qty}</td>
        <td class="text-right">${formatPrice(price)}</td>
        <td class="text-right">${formatPrice(itemTotal)}</td>
      </tr>
    `;
  }).join("");
  
  const invoiceBody = byId("invoice-body");
  invoiceBody.innerHTML = `
    <div class="invoice-print">
      <div class="invoice-header">
        <div class="shop-info">
          <h3>${shopInfo.name || "CỬA HÀNG"}</h3>
          <p>${shopInfo.address || ""}</p>
          <p>Điện thoại: ${shopInfo.phone || ""}</p>
          <p>Email: ${shopInfo.email || ""}</p>
          ${shopInfo.tax_code ? `<p>Mã số thuế: ${shopInfo.tax_code}</p>` : ""}
        </div>
        <div class="invoice-title">
          <h2>HÓA ĐƠN BÁN HÀNG</h2>
          <div class="invoice-number">Số: ${invoice.invoice_number || invoice.id}</div>
        </div>
      </div>
      
      <div class="invoice-info">
        <div class="customer-info">
          <h4>Thông tin khách hàng:</h4>
          <p><strong>${customerId}</strong></p>
        </div>
        <div class="invoice-details">
          <h4>Thông tin hóa đơn:</h4>
          <p>Ngày: ${invoice.created_at || ""}</p>
          <p>Order ID: ${invoice.order_id || ""}</p>
        </div>
      </div>
      
      <div class="invoice-items">
        <table>
          <thead>
            <tr>
              <th class="text-center">STT</th>
              <th>Sản phẩm</th>
              <th class="text-right">Số lượng</th>
              <th class="text-right">Đơn giá</th>
              <th class="text-right">Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>
      </div>
      
      <div class="invoice-totals">
        <table>
          <tr>
            <td class="label">Tạm tính:</td>
            <td class="value">${formatPrice(subtotal)}</td>
          </tr>
          ${vatRate > 0 ? `
          <tr>
            <td class="label">VAT (${vatRate}%):</td>
            <td class="value">${formatPrice(vatAmount)}</td>
          </tr>
          ` : ""}
          <tr class="total-row">
            <td class="label">Tổng cộng:</td>
            <td class="value">${formatPrice(total)}</td>
          </tr>
        </table>
      </div>

      <div class="invoice-signature">
        <div class="signature-block">
          <div class="signature-title">Người bán ký tên</div>
          <div class="signature-note">(Ký, ghi rõ họ tên)</div>
          <div class="signature-line"></div>
        </div>
      </div>
      
      ${invoice.note ? `
      <div class="invoice-footer">
        <p><strong>Ghi chú:</strong> ${invoice.note}</p>
      </div>
      ` : ""}
      
      <div class="invoice-footer">
        <p>Cảm ơn quý khách đã sử dụng dịch vụ!</p>
      </div>
    </div>
  `;
}

function openInvoiceModal() {
  byId("invoice-modal").classList.add("show");
}

function closeInvoiceModal() {
  byId("invoice-modal").classList.remove("show");
}

function printInvoice() {
  window.print();
}

// Close modal when clicking outside
window.onclick = function(event) {
  const modal = byId("invoice-modal");
  if (event.target === modal) {
    closeInvoiceModal();
  }
}

// Reset session function
function resetSession() {
  if (window._originalResetSession) {
    window._originalResetSession();
  }
  CacheManager.invalidateAll();
}
