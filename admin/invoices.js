// =============================================================================
// invoices.js - Optimized
//
// Fixes vs original:
//  1.  XSS: escapeHtml/escapeAttr on ALL user content in renderInvoices()
//      and renderInvoice() — shopInfo.*, customerId, invoice.*, item.*
//  2.  onclick="viewInvoice('${invoice.id}')" → escapeAttr(invoice.id)
//  3.  sortByCreatedAtDesc() extracted – same sort written twice (cache
//      path + fresh path)
//  4.  handleError() centralized – replaces 3 alert(❌ Lỗi:...) blocks
//  5.  loadInvoices: 2-tier – localStorage → GAS only (no Worker).
//      Invoices list is served directly from GAS/KV via GAS endpoint;
//      Worker layer removed.
//  6.  Pagination.render() call fixed to match pagination.js new signature:
//        render(containerId, currentPage, totalPages, total, cb, label)
//      (original called render(result, page, cb) – wrong)
//  7.  viewInvoice: 2-tier – localStorage cache → GAS only.
//      Invoice detail is not stored in Worker KV so no Worker call.
//  8.  window.onclick override removed → replaced with proper
//      addEventListener("click") on the modal backdrop
//  9.  resetSession: granular cache clear instead of invalidateAll()
// 10.  items_json: normalised via getInvoiceItems() – handles array or
//      JSON string (same pattern as getOrderItems in orders.js)
// 11.  DOMContentLoaded split into small init functions for readability
// 12.  INVOICES_LIMIT constant (default 20, aligned with products)
// =============================================================================

// ─── Constants ────────────────────────────────────────────────────────────────

const INVOICES_LIMIT = 20;

// ─── Page state ───────────────────────────────────────────────────────────────

let invoices      = [];
let currentPage   = 1;
let totalPages    = 0;
let totalInvoices = 0;

// ─── Session override ─────────────────────────────────────────────────────────

function resetSession() {
  if (window._originalResetSession) window._originalResetSession();
  // Granular: only clear invoices cache, not products/customers/etc.
  CacheManager.clear("^invoices_");
  CacheManager.clear("^invoice_");
  invoices = [];
}
window.resetSession = resetSession;

// ─── Error handler ────────────────────────────────────────────────────────────

function handleError(err, context) {
  console.error("❌ Error in " + (context || "") + ":", err);
  var msg       = (err && err.message) ? err.message : String(err);
  var isAuthErr = window.isAuthError
    ? isAuthError(msg)
    : ["Token expired", "Unauthorized", "hết hạn"].some(function(s) { return msg.indexOf(s) !== -1; });
  if (isAuthErr) {
    alert("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    resetSession();
    window.location.reload();
    return;
  }
  alert("❌ Lỗi: " + msg);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * sortByCreatedAtDesc – extracted because the exact same sort was written
 * twice in the original (cache path AND fresh-fetch path).
 */
function sortByCreatedAtDesc(arr) {
  return arr.slice().sort(function(a, b) {
    var dateA = a.created_at || "";
    var dateB = b.created_at || "";
    if (dateA instanceof Date) dateA = dateA.toISOString();
    if (dateB instanceof Date) dateB = dateB.toISOString();
    return dateB.localeCompare(dateA);
  });
}

/**
 * getInvoiceInfo – normalise customer_info so list/view always get { id, name, phone, email }.
 * Handles wrong shape from backend (e.g. { name: { id, name, phone, email } }).
 */
function getInvoiceCustomerInfo(inv) {
  if (!inv) return { id: "", name: "", phone: "", email: "" };
  var c = inv.customer_info;
  if (!c || typeof c !== "object") {
    return { id: inv.customer_id || "", name: inv.customer_id || "N/A", phone: "", email: "" };
  }
  if (c.name && typeof c.name === "object" && (c.name.name !== undefined || c.name.id !== undefined)) {
    c = c.name;
  }
  return {
    id:    c.id != null ? String(c.id) : (inv.customer_id || ""),
    name:  c.name != null ? String(c.name) : (inv.customer_id || "N/A"),
    phone: c.phone != null ? String(c.phone) : "",
    email: c.email != null ? String(c.email) : ""
  };
}

/**
 * getInvoiceItems – normalise items_json (or items) which can be array or JSON string.
 * Each item is normalised to { product_id, qty, price } for display (supports productId, quantity, unit_price).
 */
function getInvoiceItems(invoice) {
  if (!invoice) return [];
  var raw = invoice.items_json !== undefined ? invoice.items_json : invoice.items;
  var arr = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === "string") {
    try {
      var parsed = JSON.parse(raw);
      arr = Array.isArray(parsed) ? parsed : [];
    } catch (e) { arr = []; }
  }
  return arr.map(function(item) {
    return {
      product_id: item.product_id != null ? item.product_id : (item.productId || item.id || ""),
      qty:        item.qty != null ? item.qty : (item.quantity != null ? item.quantity : 0),
      price:      item.price != null ? item.price : (item.unit_price != null ? item.unit_price : 0)
    };
  });
}

// ─── Data loading ─────────────────────────────────────────────────────────────

/**
 * loadInvoices – 2-tier: localStorage → GAS.
 *
 * Tier 1 | localStorage (CacheManager)        | ~1ms
 * Tier 2 | GAS apiCall("invoices.list")       | ~800ms
 *
 * Worker removed: invoice list served from GAS/KV cache via GAS endpoint
 * directly; adding a Worker hop between frontend and GAS adds latency
 * without benefit for this page.
 */
async function loadInvoices(page) {
  if (!session.token || !session.apiKey) {
    byId("login-section") && byId("login-section").classList.remove("hidden");
    return;
  }

  byId("login-section") && byId("login-section").classList.add("hidden");
  currentPage = page || 1;

  return apiCallWithLoading(async () => {
    const cacheKey = CacheManager.key("invoices", "list", currentPage, INVOICES_LIMIT);
    let   result   = CacheManager.get(cacheKey);

    if (result) {
      console.log("📦 Invoices: localStorage cache hit");
    } else {
      // ── GAS ────────────────────────────────────────────────────────────
      console.log("📡 Invoices: GAS...");
      result = await apiCall("invoices.list", {
        token : session.token,
        page  : currentPage,
        limit : INVOICES_LIMIT,
      });
      CacheManager.set(cacheKey, result);
    }

    // ✅ Sort runs once regardless of cache/fresh path
    var rawItems  = (result && result.items) ? result.items : [];
    invoices      = sortByCreatedAtDesc(rawItems);
    totalInvoices = (result && result.total != null) ? result.total : invoices.length;
    totalPages    = (result && result.totalPages) ? result.totalPages : 1;

    renderInvoices();
    renderPagination();
  }, "Đang tải hóa đơn...");
}

/**
 * viewInvoice – 2-tier: localStorage cache → GAS only.
 *
 * Tier 1 | localStorage per-ID cache          | ~1ms
 * Tier 2 | GAS apiCall("invoices.get")        | ~800ms
 */
async function viewInvoice(invoiceId) {
  return apiCallWithLoading(async () => {
    const lsKey   = CacheManager.key("invoice", "detail", invoiceId);
    let   invoice = CacheManager.get(lsKey);

    if (invoice) {
      console.log("📦 Invoice [" + invoiceId + "]: localStorage hit");
    } else {
      console.log("📡 Invoice [" + invoiceId + "]: GAS...");
      invoice = await apiCall("invoices.get", {
        token      : session.token,
        invoice_id : invoiceId,
      });
      CacheManager.set(lsKey, invoice);
    }

    renderInvoice(invoice);
    openInvoiceModal();
  }, "Đang tải hóa đơn...");
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderPagination() {
  // ✅ Correct Pagination.render signature (matches pagination.js new API):
  //    render(containerId, currentPage, totalPages, totalItems, onPageChange, label)
  Pagination.render(
    "invoices-pagination",
    currentPage,
    totalPages,
    totalInvoices,
    loadInvoices,
    "hóa đơn"
  );
}

/**
 * renderInvoices – ✅ escapeHtml/escapeAttr on ALL user content.
 *
 * Original injected invoice_number, order_id, customerName, invoice.id
 * directly into HTML without any escaping.
 */
function renderInvoices() {
  var tbody = byId("invoices-table") && byId("invoices-table").querySelector("tbody");
  if (!tbody) return;

  if (!invoices.length) {
    tbody.innerHTML = "<tr><td colspan=\"6\" class=\"text-center\">Chưa có hóa đơn nào</td></tr>";
    return;
  }

  tbody.innerHTML = invoices.map(function(inv) {
    var customer = getInvoiceCustomerInfo(inv);
    return (
      "<tr>" +
        "<td><strong>" + escapeHtml(inv.invoice_number || inv.id || "") + "</strong></td>" +
        "<td>" + escapeHtml(inv.order_id   || "") + "</td>" +
        "<td>" + escapeHtml(customer.name)        + "</td>" +
        "<td class=\"text-right\">" + escapeHtml(formatPrice(inv.total || 0)) + "</td>" +
        "<td>" + escapeHtml(inv.created_at || "") + "</td>" +
        "<td class=\"text-center\">" +
          "<button class=\"btn-action view\" onclick=\"viewInvoice('" + escapeAttr(inv.id || "") + "')\">" +
            "👁️ Xem/In" +
          "</button>" +
        "</td>" +
      "</tr>"
    );
  }).join("");
}

/**
 * renderInvoice – ✅ escapeHtml on all dynamic content inside the invoice
 * template: shopInfo.*, customerId, invoice.*, item.product_id.
 */
function renderInvoice(invoice) {
  var shopInfo     = invoice.shop_info     || {};
  var customer     = getInvoiceCustomerInfo(invoice);
  var items        = getInvoiceItems(invoice);

  var subtotal  = Number(invoice.subtotal)   || 0;
  var vatRate   = Number(invoice.vat_rate)   || 0;
  var vatAmount = Number(invoice.vat_amount) || 0;
  var total     = Number(invoice.total)      || subtotal;

  var itemsHtml = items.map(function(item, i) {
    var qty       = Number(item.qty)   || 0;
    var price     = Number(item.price) || 0;
    var itemTotal = qty * price;
    return (
      "<tr>" +
        "<td class=\"text-center\">" + (i + 1) + "</td>" +
        "<td>" + escapeHtml(item.product_id || "") + "</td>" +
        "<td class=\"text-right\">" + escapeHtml(String(qty)) + "</td>" +
        "<td class=\"text-right\">" + escapeHtml(formatPrice(price)) + "</td>" +
        "<td class=\"text-right\">" + escapeHtml(formatPrice(itemTotal)) + "</td>" +
      "</tr>"
    );
  }).join("");

  var vatRow = vatRate > 0
    ? ("<tr><td class=\"label\">VAT (" + escapeHtml(String(vatRate)) + "%):</td>" +
       "<td class=\"value\">" + escapeHtml(formatPrice(vatAmount)) + "</td></tr>")
    : "";

  var taxCodeRow = shopInfo.tax_code
    ? "<p>Mã số thuế: " + escapeHtml(shopInfo.tax_code) + "</p>"
    : "";

  var noteSection = invoice.note
    ? ("<div class=\"invoice-footer\"><p><strong>Ghi chú:</strong> " +
       escapeHtml(invoice.note) + "</p></div>")
    : "";

  byId("invoice-body").innerHTML = (
    "<div class=\"invoice-print\">" +
      "<div class=\"invoice-header\">" +
        "<div class=\"shop-info\">" +
          "<h3>" + escapeHtml(shopInfo.name    || "CỬA HÀNG") + "</h3>" +
          "<p>"  + escapeHtml(shopInfo.address || "") + "</p>" +
          "<p>Điện thoại: " + escapeHtml(shopInfo.phone || "") + "</p>" +
          "<p>Email: "      + escapeHtml(shopInfo.email || "") + "</p>" +
          taxCodeRow +
        "</div>" +
        "<div class=\"invoice-title\">" +
          "<h2>HÓA ĐƠN BÁN HÀNG</h2>" +
          "<div class=\"invoice-number\">Số: " +
            escapeHtml(invoice.invoice_number || invoice.id || "") +
          "</div>" +
        "</div>" +
      "</div>" +
      "<div class=\"invoice-info\">" +
        "<div class=\"customer-info\">" +
          "<h4>Thông tin khách hàng:</h4>" +
          "<p><strong>" + escapeHtml(customer.name || customer.id || "Khách lẻ") + "</strong></p>" +
          (customer.phone ? "<p>Điện thoại: " + escapeHtml(customer.phone) + "</p>" : "") +
          (customer.email ? "<p>Email: " + escapeHtml(customer.email) + "</p>" : "") +
        "</div>" +
        "<div class=\"invoice-details\">" +
          "<h4>Thông tin hóa đơn:</h4>" +
          "<p>Ngày: "     + escapeHtml(invoice.created_at || "") + "</p>" +
          "<p>Order ID: " + escapeHtml(invoice.order_id   || "") + "</p>" +
        "</div>" +
      "</div>" +
      "<div class=\"invoice-items\">" +
        "<table>" +
          "<thead><tr>" +
            "<th class=\"text-center\">STT</th>" +
            "<th>Sản phẩm</th>" +
            "<th class=\"text-right\">Số lượng</th>" +
            "<th class=\"text-right\">Đơn giá</th>" +
            "<th class=\"text-right\">Thành tiền</th>" +
          "</tr></thead>" +
          "<tbody>" + itemsHtml + "</tbody>" +
        "</table>" +
      "</div>" +
      "<div class=\"invoice-totals\">" +
        "<table>" +
          "<tr>" +
            "<td class=\"label\">Tạm tính:</td>" +
            "<td class=\"value\">" + escapeHtml(formatPrice(subtotal)) + "</td>" +
          "</tr>" +
          vatRow +
          "<tr class=\"total-row\">" +
            "<td class=\"label\">Tổng cộng:</td>" +
            "<td class=\"value\">" + escapeHtml(formatPrice(total)) + "</td>" +
          "</tr>" +
        "</table>" +
      "</div>" +
      "<div class=\"invoice-signature\">" +
        "<div class=\"signature-block\">" +
          "<div class=\"signature-title\">Người bán ký tên</div>" +
          "<div class=\"signature-note\">(Ký, ghi rõ họ tên)</div>" +
          "<div class=\"signature-line\"></div>" +
        "</div>" +
      "</div>" +
      noteSection +
      "<div class=\"invoice-footer\">" +
        "<p>Cảm ơn quý khách đã sử dụng dịch vụ!</p>" +
      "</div>" +
    "</div>"
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function openInvoiceModal() {
  var el = byId("invoice-modal");
  if (el) el.classList.add("show");
}

function closeInvoiceModal() {
  var el = byId("invoice-modal");
  if (el) el.classList.remove("show");
}

function printInvoice() {
  window.print();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function _initEventListeners() {
  // Login
  var btnLogin = byId("btn-login");
  if (btnLogin) {
    btnLogin.addEventListener("click", async function() {
      Loading.button(btnLogin, true);
      try {
        await login();
        await loadInvoices(1);
      } catch (err) {
        handleError(err, "login");
      } finally {
        Loading.button(btnLogin, false);
      }
    });
  }

  // Logout
  var btnLogout = byId("btn-logout");
  if (btnLogout) {
    btnLogout.addEventListener("click", function() {
      resetSession();
      window.location.reload();
    });
  }

  // ✅ Modal backdrop click – replaced window.onclick which would override
  //    ALL click handlers on the page. addEventListener is additive and safe.
  var modal = byId("invoice-modal");
  if (modal) {
    modal.addEventListener("click", function(e) {
      if (e.target === modal) closeInvoiceModal();
    });
  }
}

document.addEventListener("DOMContentLoaded", async function() {
  reloadSession();
  syncInputsFromSession();
  updateSessionUI();

  _initEventListeners();

  if (session.token && session.apiKey) {
    await loadInvoices(1).catch(function(err) { handleError(err, "initial loadInvoices"); });
  }
});