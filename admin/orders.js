// =============================================================================
// orders.js - Optimized
//
// Fixes applied:
//  1. XSS: escapeHtml/escapeAttr on ALL user-content in innerHTML
//  2. Debounce (300ms) on customer autocomplete input
//  3. AbortController replaces _inputHandler/_blurHandler (no memory leak)
//  4. Centralized handleError() replaces 4 copy-pasted try/catch blocks
//  5. Granular cache invalidation - no more clearAllCache() shotgun
//  6. Products: batch load only product IDs present in current page orders
//  7. Race condition fix: explicit null check before fallback to GAS
//  8. Constants for all magic numbers
//  9. productsMap built once, cleared only when products array changes
// 10. Customer search: pre-built index for O(1) filter instead of O(n*m)
// 11. WebSocket push thay thế polling 15s (OrderNotifyDO)
// 12. [NEW] Bỏ confirm/prompt/alert:
//     - changeStatus() → Toast undo 5s với progress bar
//     - createInvoiceFromOrder() → Invoice modal (VAT + note inline)
//     - buildOrderRowHTML() → click row mở detail, nút invoice dùng openInvoiceModal()
// =============================================================================

// --------------- Constants --------------------------------------------------
// shop_info cache — load 1 lần từ Worker/GAS, dùng cho invoice preview
let _shopInfo = null;

async function _loadShopInfo() {
  if (_shopInfo) return _shopInfo;

  // 1. localStorage cache (TTL 1h)
  const cacheKey = CacheManager.key("settings", "shop_info");
  const cached   = CacheManager.get(cacheKey);
  if (cached) { _shopInfo = cached; return _shopInfo; }

  // 2. Worker KV → GAS fallback
  try {
    let settings = null;
    if (window.WorkerAPI?.isConfigured()) {
      try {
        // Worker /settings dùng api_key auth — không cần token
        settings = await WorkerAPI.call("/settings");
        if (settings?.data) settings = settings.data;
      } catch (e) { settings = null; }
    }
    if (!settings) {
      // GAS settings.list yêu cầu owner token
      settings = await apiCall("settings.list", { token: session.token });
      // Normalize: GAS trả { shop_name, ... }, Worker trả { data: { shop_name, ... } }
      if (settings?.data) settings = settings.data;
    }
    if (settings) {
      _shopInfo = {
        name        : settings.shop_name        || "",
        address     : settings.shop_address     || "",
        phone       : settings.shop_phone       || "",
        email       : settings.shop_email       || "",
        tax_code    : settings.shop_tax_code    || "",
        footer_text : settings.shop_footer_text || "Cảm ơn quý khách! Hẹn gặp lại 🙏",
      };
      CacheManager.set(cacheKey, _shopInfo);
    }
  } catch (e) {
    console.warn("⚠️ Could not load shop settings:", e.message);
  }
  return _shopInfo || {};
}



const ORDERS_CONST = {
  AUTOCOMPLETE_BLUR_DELAY : 200,
  DEBOUNCE_DELAY          : 300,
  SEARCH_MIN_LENGTH       : 1,
  CUSTOMERS_LIMIT         : 1000,
  NEW_ORDER_POLL_MS       : 15000,
  WS_PING_INTERVAL_MS     : 30000,
  WS_RECONNECT_DELAYS     : [1000, 2000, 5000, 10000, 30000],
  STATUS_UNDO_MS          : 5000,  // ms để undo trước khi commit GAS
};

// --------------- Page state -------------------------------------------------

let orders       = [];
let products     = [];
let customers    = [];
let currentPage  = 1;
let totalPages   = 0;
let totalOrders  = 0;
const itemsPerPage = PAGINATION.DEFAULT_LIMIT;
let currentItems = [];
let productsMap  = null;
let customerSearchIndex = [];

// ── Pending-save tracking ──────────────────────────────────────────────────────
let _tempIdCounter = 0;
const _pendingSaves = new Set();
const PENDING_QUEUE_KEY = "orders_pending_queue";

function _pendingStart(tempId, payload) {
  _pendingSaves.add(tempId);
  try {
    const queue = JSON.parse(localStorage.getItem(PENDING_QUEUE_KEY) || "[]");
    queue.push({ tempId, payload, ts: Date.now() });
    localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {}
}

function _pendingEnd(tempId) {
  _pendingSaves.delete(tempId);
  try {
    const queue = JSON.parse(localStorage.getItem(PENDING_QUEUE_KEY) || "[]");
    localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(queue.filter(e => e.tempId !== tempId)));
  } catch (e) {}
}

async function _recoverPendingOrders() {
  let queue;
  try { queue = JSON.parse(localStorage.getItem(PENDING_QUEUE_KEY) || "[]"); }
  catch (e) { return; }
  if (!queue.length) return;

  const ONE_HOUR = 60 * 60 * 1000;
  const fresh = queue.filter(e => Date.now() - (e.ts || 0) < ONE_HOUR);
  if (!fresh.length) { localStorage.removeItem(PENDING_QUEUE_KEY); return; }

  console.log(`🔄 Recovering ${fresh.length} pending order(s)...`);
  Toast.show(`⏳ Đang khôi phục ${fresh.length} đơn chưa lưu...`, "info", 4000);

  for (const entry of fresh) {
    try {
      // Worker queue — nhất quán với luồng tạo đơn chính
      let savedOrder;
      if (window.WorkerAPI?.isConfigured() && window.CommonUtils?.WORKER_URL) {
        try {
          const apiKey = session?.apiKey || window.CommonUtils?.session?.apiKey;
          const resp = await fetch(
            `${window.CommonUtils.WORKER_URL}/orders?api_key=${encodeURIComponent(apiKey)}`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry.payload) }
          );
          if (resp.ok) {
            const json = await resp.json();
            savedOrder = json?.data ?? json;
          }
        } catch (e) { console.warn("⚠️ Worker orders.create (recovery) failed:", e.message); }
      }
      if (!savedOrder) {
        savedOrder = await apiCall("orders.create", entry.payload);
      }
      const realId = savedOrder.order_id ?? savedOrder.id;
      const idx = orders.findIndex(o => o.id === entry.tempId);
      if (idx !== -1) {
        const realOrder = Object.assign({}, orders[idx], { id: String(realId) });
        orders[idx] = realOrder;
        const tempRow = byId("orders-table")?.querySelector(`tbody tr[data-order-id="${CSS.escape(entry.tempId)}"]`);
        if (tempRow) tempRow.setAttribute("data-order-id", realOrder.id);
        updateOrderInList(realOrder);
        _cacheReplaceOrder(entry.tempId, realOrder);
      }
      // Cập nhật baseline để WS không popup "có đơn mới" cho đơn admin vừa tạo
      _lastRemoteHeadOrderId = String(realId);
      _pendingEnd(entry.tempId);
    } catch (err) {
      if (!isNetworkOrResponseError(err)) _pendingEnd(entry.tempId);
    }
  }
}

window.addEventListener("beforeunload", (e) => {
  if (_pendingSaves.size > 0) {
    e.preventDefault();
    e.returnValue = "Đơn hàng đang được lưu. Bạn có chắc muốn rời trang?";
  }
});

// --------------- Cache helpers ----------------------------------------------

function _cacheUpsertOrder(order) {
  const key    = CacheManager.key("orders", "list", currentPage, itemsPerPage);
  const cached = CacheManager.get(key);
  if (!cached) {
    if (!orders.length) return;
    CacheManager.set(key, { items: [...orders], total: totalOrders, page: currentPage, limit: itemsPerPage, totalPages });
    return;
  }
  const items = Array.isArray(cached.items) ? [...cached.items] : [];
  const idx   = items.findIndex(o => o.id === order.id);
  if (idx !== -1) { items[idx] = order; }
  else { items.unshift(order); if (items.length > itemsPerPage) items.pop(); }
  CacheManager.set(key, { ...cached, items, total: idx === -1 ? (cached.total || 0) + 1 : cached.total });
}

function _cacheReplaceOrder(tempId, savedOrder) {
  const key    = CacheManager.key("orders", "list", 1, itemsPerPage);
  const cached = CacheManager.get(key);
  if (!cached || !Array.isArray(cached.items)) return;
  const items = [...cached.items];
  const idx   = items.findIndex(o => o.id === tempId);
  if (idx !== -1) items[idx] = savedOrder;
  CacheManager.set(key, { ...cached, items });
}

function _cacheRemoveOrder(orderId) {
  const key    = CacheManager.key("orders", "list", 1, itemsPerPage);
  const cached = CacheManager.get(key);
  if (!cached || !Array.isArray(cached.items)) return;
  CacheManager.set(key, { ...cached, items: cached.items.filter(o => o.id !== orderId), total: Math.max(0, (cached.total || 0) - 1) });
}

function _setRowActionsDisabled(orderId, disabled) {
  const row = byId("orders-table")?.querySelector(`tbody tr[data-order-id="${CSS.escape(String(orderId))}"]`);
  if (!row) return;
  row.querySelectorAll(".action-btn").forEach(btn => {
    btn.disabled      = disabled;
    btn.style.opacity = disabled ? "0.45" : "";
    btn.style.cursor  = disabled ? "not-allowed" : "";
  });
}

// --------------- Session override -------------------------------------------

function resetSession() {
  if (window._originalResetSession) window._originalResetSession();
  CircuitBreaker.reset(); // reset tất cả circuit khi logout
  _shopInfo = null;       // clear shop settings cache khi logout
  _closeOrderNotifyWS();
  stopNewOrderPolling();
  _clearStatusUndo();
  closeNewOrderNotifyModal();
  closeInvoiceModal();
  orders = []; products = []; customers = [];
  productsMap = null; customerSearchIndex = [];
  renderOrders();
}
window.resetSession = resetSession;

// =============================================================================
// ─── WebSocket notify ────────────────────────────────────────────────────────
// =============================================================================

let _ws               = null;
let _wsReconnectTimer = null;
let _wsPingTimer      = null;
let _wsRetryCount     = 0;
let _wsUseFallback    = false;

let _newOrderPollBaselineReady = false;
let _lastRemoteHeadOrderId     = null;
let _newOrderPollTimer         = null;
let _newOrderPollActive        = false;
let _newOrderPollInFlight      = false;

function _buildWsUrl() {
  const workerBase = window.CommonUtils?.WORKER_URL;
  const apiKey     = session?.apiKey || window.CommonUtils?.session?.apiKey;
  if (!workerBase || !apiKey) return null;
  return `${workerBase.replace(/^https?:\/\//, "wss://").replace(/\/$/, "")}/ws?api_key=${encodeURIComponent(apiKey)}`;
}

function startOrderNotifyWS() {
  reloadSession();
  if (!session.token) return;

  const url = _buildWsUrl();
  if (!url) {
    console.log("ℹ️ Worker URL not set — falling back to polling");
    _wsUseFallback = true;
    _startPollingFallback();
    return;
  }

  _wsUseFallback = false;
  _closeOrderNotifyWS();

  let ws;
  try { ws = new WebSocket(url); }
  catch (e) { console.warn("WS init failed:", e.message); _scheduleWsReconnect(); return; }

  _ws = ws;

  ws.onopen = () => {
    console.log("✅ OrderNotify WS connected");
    _wsRetryCount = 0;
    clearInterval(_wsPingTimer);
    _wsPingTimer = setInterval(() => {
      if (_ws?.readyState === WebSocket.OPEN) _ws.send("ping");
    }, ORDERS_CONST.WS_PING_INTERVAL_MS);
    // Chỉ fetch baseline nếu chưa được set từ loadData()
    if (!_newOrderPollBaselineReady) {
      refreshNewOrderPollBaseline().catch(() => {});
    }
  };

  ws.onmessage = (event) => {
    if (event.data === "pong") return;
    let msg;
    try { msg = JSON.parse(event.data); } catch (_) { return; }
    if (msg.type === "new_order") {
      reloadSession();
      if (!session.token) return;
      if (!_newOrderPollBaselineReady) {
        _lastRemoteHeadOrderId = msg.order_id ? String(msg.order_id) : null;
        _newOrderPollBaselineReady = true;
        return;
      }
      if (String(msg.order_id) !== _lastRemoteHeadOrderId) openNewOrderNotifyModal();
    }
  };

  ws.onclose = (event) => {
    clearInterval(_wsPingTimer); _wsPingTimer = null;
    if (event.code === 1000) return;
    _scheduleWsReconnect();
  };

  ws.onerror = () => { console.warn("WS connection error — waiting for onclose..."); };
}

function _scheduleWsReconnect() {
  clearTimeout(_wsReconnectTimer);
  const delays = ORDERS_CONST.WS_RECONNECT_DELAYS;
  const delay  = delays[Math.min(_wsRetryCount, delays.length - 1)];
  _wsRetryCount++;
  _wsReconnectTimer = setTimeout(startOrderNotifyWS, delay);
}

function _closeOrderNotifyWS() {
  clearTimeout(_wsReconnectTimer); clearInterval(_wsPingTimer);
  _wsReconnectTimer = null; _wsPingTimer = null;
  if (_ws) {
    _ws.onclose = null;
    if (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING) _ws.close(1000, "logout");
    _ws = null;
  }
}

// ── Polling fallback ──────────────────────────────────────────────────────────

async function fetchOrdersHeadFromBackend() {
  let data = null;
  if (window.WorkerAPI?.isConfigured()) data = await window.WorkerAPI.ordersList({ page: 1, limit: 1 });
  if (!data) data = await apiCall("orders.list", { page: 1, limit: 1 });
  return data;
}

function _ordersHeadIdFromListPayload(data) {
  const items = data?.items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const id = items[0]?.id;
  return id == null ? null : String(id);
}

async function refreshNewOrderPollBaseline() {
  reloadSession();
  if (!session.token) return;
  try {
    const payload = await fetchOrdersHeadFromBackend();
    _lastRemoteHeadOrderId     = _ordersHeadIdFromListPayload(payload);
    _newOrderPollBaselineReady = true;
  } catch (e) { console.warn("⚠️ refreshNewOrderPollBaseline:", e?.message || e); }
}

function _startPollingFallback() {
  reloadSession();
  if (!session.token) return;
  stopNewOrderPolling();
  _newOrderPollActive = true;
  _newOrderPollTimer  = setInterval(tickNewOrderPoll, ORDERS_CONST.NEW_ORDER_POLL_MS);
}

function stopNewOrderPolling() {
  _newOrderPollActive = false;
  if (_newOrderPollTimer) { clearInterval(_newOrderPollTimer); _newOrderPollTimer = null; }
}

async function tickNewOrderPoll() {
  if (!_newOrderPollActive || _newOrderPollInFlight) return;
  if (document.visibilityState !== "visible") return;
  reloadSession();
  if (!session.token) { stopNewOrderPolling(); return; }
  _newOrderPollInFlight = true;
  try {
    const payload = await fetchOrdersHeadFromBackend();
    const headId  = _ordersHeadIdFromListPayload(payload);
    if (!_newOrderPollBaselineReady) {
      _lastRemoteHeadOrderId = headId; _newOrderPollBaselineReady = true; return;
    }
    if (headId !== _lastRemoteHeadOrderId) { stopNewOrderPolling(); openNewOrderNotifyModal(); }
  } catch (e) {
    const msg = e?.message || String(e);
    if (typeof isAuthError === "function" && isAuthError(msg)) stopNewOrderPolling();
  } finally { _newOrderPollInFlight = false; }
}

// ── Notify modal ──────────────────────────────────────────────────────────────

/**
 * Phát âm thanh thông báo đơn hàng mới bằng Web Audio API (không cần file ngoài).
 * Chuỗi 3 nốt: sol → la → đô cao — nhẹ nhàng, rõ ràng.
 */
function _playNewOrderSound() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);

    const notes = [
      { freq: 784.0, start: 0.00, dur: 0.18 },   // G5
      { freq: 880.0, start: 0.20, dur: 0.18 },   // A5
      { freq: 1046.5, start: 0.40, dur: 0.28 },  // C6
    ];

    notes.forEach(({ freq, start, dur }) => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(env);
      env.connect(gain);

      const t0 = ctx.currentTime + start;
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(0.45, t0 + 0.03);
      env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);

      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    });

    // Tự đóng context sau khi phát xong để tránh leak
    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch (e) {
    console.warn("⚠️ _playNewOrderSound:", e.message);
  }
}

function openNewOrderNotifyModal() {
  byId("new-order-notify-modal")?.classList.add("active");
  _playNewOrderSound();
}
function closeNewOrderNotifyModal() { byId("new-order-notify-modal")?.classList.remove("active"); }

async function onNewOrderReloadClick() {
  const btn = byId("btn-new-order-reload");
  if (btn) Loading.button(btn, true);
  try {
    CacheInvalidator.orders();
    closeNewOrderNotifyModal();
    await loadData(currentPage);
    await refreshNewOrderPollBaseline();
    if (_wsUseFallback) _startPollingFallback();
  } catch (e) { handleError(e, "onNewOrderReloadClick"); }
  finally { if (btn) Loading.button(btn, false); }
}

async function onNewOrderDismissClick() {
  closeNewOrderNotifyModal();
  await refreshNewOrderPollBaseline();
  if (_wsUseFallback) _startPollingFallback();
}

// =============================================================================
// ─── Status Undo Toast (thay confirm()) ──────────────────────────────────────
// =============================================================================

let _statusUndoTimer   = null;
let _statusUndoPending = null;

function _clearStatusUndo() {
  if (_statusUndoTimer) { clearTimeout(_statusUndoTimer); _statusUndoTimer = null; }
  _statusUndoPending = null;
  document.getElementById("_status_undo_toast")?.remove();
}

function _showStatusUndoToast(label, onUndo, onCommit) {
  document.getElementById("_status_undo_toast")?.remove();
  clearTimeout(_statusUndoTimer);

  const DURATION = ORDERS_CONST.STATUS_UNDO_MS;
  const el = document.createElement("div");
  el.id = "_status_undo_toast";
  Object.assign(el.style, {
    position: "fixed", bottom: "24px", right: "24px", zIndex: "99999",
    background: "#1e293b", color: "#f1f5f9",
    borderLeft: "4px solid #22c55e",
    padding: "12px 14px 16px", borderRadius: "8px",
    fontSize: "13px", fontWeight: "500",
    boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
    display: "flex", alignItems: "center", gap: "12px",
    minWidth: "280px", maxWidth: "360px",
    opacity: "0", transform: "translateY(8px)",
    transition: "opacity 0.18s ease, transform 0.18s ease",
    overflow: "hidden",
  });

  // Progress bar
  const bar = document.createElement("div");
  Object.assign(bar.style, {
    position: "absolute", bottom: "0", left: "0",
    height: "3px", width: "100%",
    background: "#22c55e", borderRadius: "0 0 8px 8px",
    transition: `width ${DURATION}ms linear`,
  });
  el.appendChild(bar);

  const text = document.createElement("span");
  text.style.flex = "1";
  text.textContent = label;
  el.appendChild(text);

  const undoBtn = document.createElement("button");
  undoBtn.textContent = "↩ Hoàn tác";
  Object.assign(undoBtn.style, {
    background: "rgba(255,255,255,0.18)", border: "none",
    color: "#fff", padding: "5px 11px", borderRadius: "6px",
    cursor: "pointer", fontSize: "12px", fontWeight: "700", flexShrink: "0",
  });
  undoBtn.onmouseenter = () => undoBtn.style.background = "rgba(255,255,255,0.28)";
  undoBtn.onmouseleave = () => undoBtn.style.background = "rgba(255,255,255,0.18)";
  undoBtn.onclick = () => { _clearStatusUndo(); onUndo(); };
  el.appendChild(undoBtn);

  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "translateY(0)";
    requestAnimationFrame(() => { bar.style.width = "0%"; });
  });

  _statusUndoTimer = setTimeout(() => {
    el.remove();
    _statusUndoPending = null;
    onCommit();
  }, DURATION);
}

function changeStatus(orderId, newStatus) {
  reloadSession();

  const originalOrder = orders.find(o => o.id === orderId);
  if (!originalOrder) return;

  // Nếu đang có undo pending của đơn khác → commit ngay
  if (_statusUndoPending && _statusUndoPending.orderId !== orderId) {
    const prev = _statusUndoPending;
    _clearStatusUndo();
    _commitStatusChange(prev.orderId, prev.newStatus, prev.originalOrder);
  }

  const labels = {
    DONE   : "✓ Đơn hoàn thành — kho đã trừ",
    CANCEL : "✕ Đã hủy đơn hàng",
    RETURN : "↩ Trả hàng — kho sẽ được hoàn",
  };

  // Optimistic UI ngay lập tức
  const optimisticOrder = Object.assign({}, originalOrder, { status: newStatus });
  updateOrderInList(optimisticOrder);
  _cacheUpsertOrder(optimisticOrder);
  _statusUndoPending = { orderId, newStatus, originalOrder };

  _showStatusUndoToast(
    labels[newStatus] || `Đã chuyển sang ${newStatus}`,
    // onUndo
    () => {
      updateOrderInList(originalOrder);
      _cacheUpsertOrder(originalOrder);
      Toast.show("↩ Đã hoàn tác thay đổi trạng thái", "info", 2500);
    },
    // onCommit
    () => _commitStatusChange(orderId, newStatus, originalOrder)
  );
}

async function _commitStatusChange(orderId, newStatus, originalOrder) {
  _setRowActionsDisabled(orderId, true);
  try {
    let updatedOrder;

    // Thử Worker trước (~50ms), fallback GAS nếu Worker miss
    if (window.WorkerAPI?.isConfigured()) {
      try {
        const result = await WorkerAPI.ordersUpdateStatus(orderId, newStatus, session.token);
        // Worker trả queued response — dùng optimistic data
        updatedOrder = Object.assign({}, originalOrder, {
          status        : newStatus,
          order_id      : orderId,
          queued        : true,
        });
        console.log("✅ updateStatus queued via Worker:", result);
      } catch (workerErr) {
        console.warn("⚠️ Worker updateStatus failed, falling back to GAS:", workerErr.message);
        updatedOrder = null;
      }
    }

    // GAS fallback nếu Worker không có hoặc lỗi
    if (!updatedOrder) {
      updatedOrder = await apiCall("orders.updateStatus", {
        token      : session.token,
        order_id   : orderId,
        new_status : newStatus,
      });
    }
    const finalOrder = Object.assign({}, originalOrder, updatedOrder, {
      id: String(updatedOrder.order_id ?? updatedOrder.id ?? orderId),
      status: newStatus,
    });
    updateOrderInList(finalOrder);
    _cacheUpsertOrder(finalOrder);
    if (newStatus === "DONE" || newStatus === "RETURN") CacheInvalidator.products();
  } catch (err) {
    const msg = err?.message || "Lỗi không xác định";
    if (isNetworkOrResponseError(err)) {
      Toast.show("⚠️ Mất kết nối — trạng thái có thể đã được lưu", "error", 5000);
      CacheInvalidator.orderWithInventory();
      await loadData(currentPage);
    } else {
      updateOrderInList(originalOrder);
      _cacheUpsertOrder(originalOrder);
      Toast.show(`✗ Lỗi cập nhật: ${msg}`, "error", 5000);
      if (["Token expired", "Unauthorized", "hết hạn"].some(s => msg.includes(s))) {
        setTimeout(() => handleError(err, "changeStatus"), 300);
      }
    }
  } finally {
    _setRowActionsDisabled(orderId, false);
  }
}

// =============================================================================
// ─── Invoice Modal — Preview từ order data local, không cần API ──────────────
// =============================================================================
//
// Flow mới:
//   Click 🧾 → Modal form (VAT + note) → Submit
//     → Render preview từ order data (0 API call)
//     → Nút "In" → window.print()
//     → Nút "Lưu hóa đơn" (tùy chọn) → gọi API lưu vào sheet
//
// Lý do không cần API để in:
//   order đã có customer_id, items_json, total, shipping_info, created_at
//   customers array đã load sẵn → tên/sđt khách hàng
//   products array đã load sẵn → tên sản phẩm
// =============================================================================

let _invoiceTargetOrderId = null;
let _invoiceVatRate       = 0;
let _invoiceNote          = "";

function openInvoiceModal(orderId) {
  const order = orders.find(o => o.id === orderId);
  if (!order) return;
  _invoiceTargetOrderId = orderId;

  const vatEl  = byId("invoice-vat-rate");
  const noteEl = byId("invoice-note");
  if (vatEl)  vatEl.value  = "0";
  if (noteEl) noteEl.value = "";

  const labelEl = byId("invoice-modal-order-id");
  if (labelEl) {
    const customer = escapeHtml(getCustomerDisplayName(order.customer_id));
    const total    = escapeHtml(formatPrice(order.total || 0));
    labelEl.textContent = `Đơn #${escapeHtml(order.id)} · ${customer} · ${total}`;
  }

  byId("invoice-modal")?.classList.add("active");
  setTimeout(() => byId("invoice-vat-rate")?.focus(), 120);
}

function closeInvoiceModal() {
  byId("invoice-modal")?.classList.remove("active");
  _invoiceTargetOrderId = null;
}

/**
 * Submit invoice form → render preview từ order data local, KHÔNG gọi API.
 * API chỉ được gọi khi user bấm "Lưu hóa đơn" trong preview.
 */
async function _submitInvoice() {
  const orderId = _invoiceTargetOrderId;
  if (!orderId) return;

  const vatRate = parseFloat(byId("invoice-vat-rate")?.value || "0") || 0;
  const note    = byId("invoice-note")?.value.trim() || "";

  if (vatRate < 0 || vatRate > 100) {
    Toast.show("VAT phải từ 0 đến 100%", "error", 3000);
    byId("invoice-vat-rate")?.focus();
    return;
  }

  const order = orders.find(o => o.id === orderId);
  if (!order) { Toast.show("Không tìm thấy đơn hàng", "error", 3000); return; }

  // Lưu lại để dùng khi bấm "Lưu hóa đơn"
  _invoiceVatRate = vatRate;
  _invoiceNote    = note;

  closeInvoiceModal();

  // Load shop settings (từ cache, 0 GAS call nếu đã load rồi)
  const shopInfo = await _loadShopInfo();

  // Build invoice object từ order data — không cần API
  const customer  = customers.find(c => c.id === order.customer_id) || {};
  const items     = getOrderItems(order);
  const subtotal  = Number(order.total) || 0;
  const vatAmount = Math.round(subtotal * vatRate / 100);
  const total     = subtotal + vatAmount;

  const invoiceFromOrder = {
    id             : null,              // chưa lưu
    invoice_number : null,              // chưa lưu
    order_id       : order.id,
    created_at     : new Date().toLocaleDateString("vi-VN", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    }),
    customer_info  : {
      id   : customer.id    || order.customer_id || "",
      name : customer.name  || order.customer_id || "Khách lẻ",
      phone: customer.phone || "",
      email: customer.email || "",
    },
    items_json     : items.map(item => ({
      product_id: item.product_id,
      name      : getProductDisplayName(item.product_id),
      qty       : item.qty,
      price     : item.price,
    })),
    subtotal,
    vat_rate       : vatRate,
    vat_amount     : vatAmount,
    total,
    note,
    shop_info      : shopInfo,
    _unsaved       : true,  // flag: chưa lưu vào sheet
  };

  openInvoicePreview(invoiceFromOrder);
}

// Giữ tên cũ để không break code gọi từ viewOrder()
function createInvoiceFromOrder(orderId) {
  openInvoiceModal(orderId);
}

/**
 * Lưu hóa đơn vào sheet — chỉ gọi khi user bấm "Lưu hóa đơn" trong preview.
 * Tách biệt hoàn toàn khỏi luồng preview/in.
 */
async function _saveInvoiceToSheet() {
  const orderId = _invoiceTargetOrderId;
  if (!orderId) { Toast.show("Không có đơn hàng để lưu", "error", 3000); return; }

  const btn = byId("btn-invoice-save");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Đang lưu..."; }

  try {
    let result;

    if (window.WorkerAPI?.isConfigured()) {
      try {
        result = await WorkerAPI.invoicesCreate({
          token    : session.token,
          order_id : orderId,
          vat_rate : _invoiceVatRate,
          note     : _invoiceNote,
        });
      } catch (e) { result = null; }
    }
    if (!result) {
      result = await apiCall("invoices.create", {
        token    : session.token,
        order_id : orderId,
        vat_rate : _invoiceVatRate,
        note     : _invoiceNote,
      });
    }

    CacheInvalidator.afterCreateInvoice();

    // Cập nhật preview với invoice number thật
    const numEl = document.querySelector(".invoice-number");
    if (numEl && result?.invoice_number) {
      numEl.textContent = `Số: ${escapeHtml(String(result.invoice_number))}`;
    }

    // Ẩn nút "Lưu hóa đơn", hiện thông báo đã lưu
    if (btn) { btn.style.display = "none"; }
    const savedBadge = byId("invoice-saved-badge");
    if (savedBadge) savedBadge.style.display = "inline-flex";

    Toast.show(`✅ Đã lưu hóa đơn ${escapeHtml(String(result.invoice_number || ""))}`, "success", 3000);
    await loadData(currentPage);
  } catch (err) {
    const msg = err?.message || "Không xác định";
    // Nếu đã tồn tại hóa đơn — không phải lỗi thực sự
    if (msg.includes("đã có hóa đơn") || msg.includes("already exists") || msg.includes("duplicate")) {
      Toast.show("ℹ️ Hóa đơn cho đơn này đã được lưu trước đó", "info", 4000);
      if (btn) { btn.style.display = "none"; }
    } else {
      Toast.show(`✗ Lỗi lưu hóa đơn: ${msg}`, "error", 5000);
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "💾 Lưu hóa đơn"; }
  }
}

// =============================================================================
// ─── Invoice Preview + Print (inline tại orders) ─────────────────────────────
// =============================================================================

/**
 * Normalize customer_info từ invoice object
 * (copy từ invoices.js để dùng độc lập tại trang orders)
 */
function _getInvoiceCustomerInfo(inv) {
  if (!inv) return { id: "", name: "", phone: "", email: "" };
  var c = inv.customer_info;
  if (!c || typeof c !== "object") {
    return { id: inv.customer_id || "", name: inv.customer_id || "Khách lẻ", phone: "", email: "" };
  }
  if (c.name && typeof c.name === "object" && (c.name.name !== undefined || c.name.id !== undefined)) c = c.name;
  return {
    id    : c.id    != null ? String(c.id)    : (inv.customer_id || ""),
    name  : c.name  != null ? String(c.name)  : (inv.customer_id || "Khách lẻ"),
    phone : c.phone != null ? String(c.phone) : "",
    email : c.email != null ? String(c.email) : "",
  };
}

/**
 * Normalize items_json từ invoice object
 */
function _getInvoiceItems(invoice) {
  if (!invoice) return [];
  const raw = invoice.items_json !== undefined ? invoice.items_json : invoice.items;
  let arr = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === "string") {
    try { const p = JSON.parse(raw); arr = Array.isArray(p) ? p : []; } catch (e) { arr = []; }
  }
  return arr.map(item => ({
    product_id : item.product_id != null ? item.product_id : (item.productId || item.id || ""),
    name       : item.name || item.product_name || "",
    qty        : item.qty  != null ? item.qty  : (item.quantity   != null ? item.quantity   : 0),
    price      : item.price != null ? item.price : (item.unit_price != null ? item.unit_price : 0),
  }));
}

/**
 * Build HTML nội dung hóa đơn (dùng cho preview và in)
 */
function _buildInvoiceHTML(invoice) {
  const shopInfo = (typeof invoice.shop_info === "string")
    ? (() => { try { return JSON.parse(invoice.shop_info); } catch(e) { return {}; } })()
    : (invoice.shop_info || {});

  const customer  = _getInvoiceCustomerInfo(invoice);
  const items     = _getInvoiceItems(invoice);
  const subtotal  = Number(invoice.subtotal)   || 0;
  const vatRate   = Number(invoice.vat_rate)   || 0;
  const vatAmount = Number(invoice.vat_amount) || Math.round(subtotal * vatRate / 100);
  const total     = Number(invoice.total)      || subtotal + vatAmount;

  const itemsHtml = items.map(item => {
    const qty       = Number(item.qty)   || 0;
    const price     = Number(item.price) || 0;
    const itemTotal = qty * price;
    const name      = getProductDisplayName(item.product_id) || item.name || item.product_id || "";
    return `<tr>
      <td class="r-name">${escapeHtml(name)}</td>
      <td class="r-qty">${escapeHtml(String(qty))}</td>
      <td class="r-price">${_fmtShort(price)}</td>
      <td class="r-total">${_fmtShort(itemTotal)}</td>
    </tr>`;
  }).join("");

  const invoiceNum  = invoice.invoice_number
    ? `<strong>${escapeHtml(String(invoice.invoice_number))}</strong>`
    : invoice._unsaved
      ? `<span style="color:#94a3b8">Đơn #${escapeHtml(String(invoice.order_id || ""))}</span>`
      : escapeHtml(String(invoice.id || ""));

  const vatRow = vatRate > 0
    ? `<tr><td>VAT ${escapeHtml(String(vatRate))}%</td><td>${_fmtShort(vatAmount)}</td></tr>` : "";

  const customerLine = (customer.name && customer.name !== "Khách lẻ")
    ? `<div class="r-customer">KH: <strong>${escapeHtml(customer.name)}</strong>${customer.phone ? " &nbsp;|&nbsp; " + escapeHtml(customer.phone) : ""}</div>` : "";

  const noteHtml = invoice.note
    ? `<div class="r-note">Ghi chú: ${escapeHtml(invoice.note)}</div>` : "";

  const now = invoice.created_at || new Date().toLocaleString("vi-VN");

  return `<div class="receipt-80mm">
  <div class="r-shop-name">${escapeHtml(shopInfo.name || "CỬA HÀNG")}</div>
  ${shopInfo.address ? `<div class="r-shop-sub">${escapeHtml(shopInfo.address)}</div>` : ""}
  ${shopInfo.phone   ? `<div class="r-shop-sub">☎ ${escapeHtml(shopInfo.phone)}</div>` : ""}
  ${shopInfo.tax_code ? `<div class="r-shop-sub">MST: ${escapeHtml(shopInfo.tax_code)}</div>` : ""}

  <div class="r-title">PHIẾU THANH TOÁN</div>

  <div class="r-meta"><span>Số: ${invoiceNum}</span><span>${escapeHtml(now)}</span></div>
  ${customerLine}

  <table class="r-items">
    <thead><tr>
      <th class="r-name">Món</th>
      <th class="r-qty">SL</th>
      <th class="r-price">Đ.giá</th>
      <th class="r-total">T.tiền</th>
    </tr></thead>
    <tbody>${itemsHtml}</tbody>
  </table>

  <table class="r-totals">
    <tr><td>Tạm tính</td><td>${_fmtShort(subtotal)}</td></tr>
    ${vatRow}
    <tr class="r-total-row"><td>TỔNG CỘNG</td><td>${_fmtShort(total)}</td></tr>
  </table>

  ${noteHtml}

  <div class="r-footer">
    ${escapeHtml(shopInfo.footer_text || "Cảm ơn quý khách! Hẹn gặp lại 🙏")}
  </div>
</div>`;
}

/** Format số tiền ngắn gọn cho receipt 80mm */
function _fmtShort(n) {
  if (!n && n !== 0) return "0";
  return Number(n).toLocaleString("vi-VN") + " ₫";
}

/**
 * Mở invoice preview modal với dữ liệu invoice vừa tạo.
 * Gọi ngay sau khi invoices.create() trả về thành công.
 */
function openInvoicePreview(invoice) {
  const bodyEl = document.getElementById("invoice-preview-body");
  if (!bodyEl) return;
  bodyEl.innerHTML = _buildInvoiceHTML(invoice);
  document.getElementById("invoice-preview-modal")?.classList.add("active");
}

function closeInvoicePreview() {
  document.getElementById("invoice-preview-modal")?.classList.remove("active");
}

/**
 * In hóa đơn: clone nội dung vào print area rồi gọi window.print()
 * CSS @media print sẽ ẩn toàn bộ trang, chỉ show #invoice-print-area
 */
function printCurrentInvoice() {
  const src = document.getElementById("invoice-preview-body");
  const dst = document.getElementById("invoice-print-area");
  if (!src || !dst) return;
  dst.innerHTML = src.innerHTML;
  window.print();
}

// --------------- Utilities --------------------------------------------------

function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function handleError(err, context = "") {
  console.error(`❌ Error in ${context}:`, err);
  const msg = err && err.message ? err.message : String(err);
  const isAuth = ["Token expired", "Unauthorized", "hết hạn"].some(s => msg.includes(s));
  if (isAuth) {
    alert("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    resetSession();
    window.location.reload();
    return;
  }
  alert(`❌ Lỗi: ${msg}`);
}

const CacheInvalidator = {
  orders()           { CacheManager.clear("^orders_");    console.log("🗑️ Cache cleared: orders"); },
  customers()        { CacheManager.clear("^customers_"); console.log("🗑️ Cache cleared: customers"); },
  products()         { CacheManager.clear("^products_");  console.log("🗑️ Cache cleared: products"); },
  invoices()         { CacheManager.clear("^invoices_");  console.log("🗑️ Cache cleared: invoices"); },
  orderWithInventory() { this.orders(); this.products(); },
  afterCreateOrder()   { this.orders(); this.customers(); },
  afterCreateInvoice() { this.invoices(); this.orders(); },
};

// --------------- Customer autocomplete --------------------------------------

function openModal() {
  byId("order-modal").classList.add("active");
  loadCustomersForAutocomplete();
}

async function loadCustomersForAutocomplete() {
  if (customers.length > 0) { setupCustomerAutocomplete(); return; }
  try {
    const cacheKey = CacheManager.key("customers", "list", 1, ORDERS_CONST.CUSTOMERS_LIMIT);
    const cached   = CacheManager.get(cacheKey);
    if (cached) {
      customers = cached.items ?? (Array.isArray(cached) ? cached : []);
    } else {
      let data = null;
      if (WorkerAPI?.isConfigured()) {
        try {
          data = await WorkerAPI.customersList({ page: 1, limit: ORDERS_CONST.CUSTOMERS_LIMIT });
          if (data) CacheManager.set(cacheKey, data);
        } catch (e) { console.warn("⚠️ Worker customers error:", e.message); }
      }
      if (!data) { data = await apiCall("customers.list", { page: 1, limit: ORDERS_CONST.CUSTOMERS_LIMIT }); CacheManager.set(cacheKey, data); }
      customers = data?.items ?? (Array.isArray(data) ? data : []);
    }
    rebuildCustomerSearchIndex();
  } catch (err) { console.error("Error loading customers:", err); }
  setupCustomerAutocomplete();
}

function rebuildCustomerSearchIndex() {
  customerSearchIndex = customers.map(c => ({
    id: c.id,
    searchText: [c.name || "", c.phone || "", c.email || "", c.id || ""].join(" ").toLowerCase(),
  }));
}

function setupCustomerAutocomplete() {
  const customerInput   = byId("field-customer");
  const autocompleteDiv = byId("customer-autocomplete");
  if (!customerInput || !autocompleteDiv) return;

  if (customerInput._autocompleteController) customerInput._autocompleteController.abort();
  const controller = new AbortController();
  customerInput._autocompleteController = controller;
  const signal = controller.signal;

  let selectedCustomerId = null;
  let filteredCustomers  = [];

  customerInput._selectedCustomerId    = () => selectedCustomerId;
  customerInput._setSelectedCustomerId = (id) => { selectedCustomerId = id; };

  const debouncedFilter = debounce(function (query) {
    const q = query.trim().toLowerCase();
    if (q.length < ORDERS_CONST.SEARCH_MIN_LENGTH) { autocompleteDiv.style.display = "none"; return; }
    const matchingIds = new Set(customerSearchIndex.filter(c => c.searchText.includes(q)).map(c => c.id));
    filteredCustomers = customers.filter(c => matchingIds.has(c.id));
    renderAutocompleteDropdown(filteredCustomers, q, customerInput, autocompleteDiv, (customer) => {
      customerInput.value = customer.name || customer.id;
      selectedCustomerId  = customer.id;
      autocompleteDiv.style.display = "none";
    });
  }, ORDERS_CONST.DEBOUNCE_DELAY);

  customerInput.addEventListener("input", (e) => { selectedCustomerId = null; debouncedFilter(e.target.value); }, { signal });
  customerInput.addEventListener("blur",  () => { setTimeout(() => { autocompleteDiv.style.display = "none"; }, ORDERS_CONST.AUTOCOMPLETE_BLUR_DELAY); }, { signal });
  customerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = autocompleteDiv.querySelector(".autocomplete-item[data-customer-id]");
      if (first) first.click(); else autocompleteDiv.style.display = "none";
    } else if (e.key === "Escape") { autocompleteDiv.style.display = "none"; }
  }, { signal });
}

function renderAutocompleteDropdown(filteredCustomers, query, customerInput, autocompleteDiv, onSelect) {
  if (filteredCustomers.length > 0) {
    autocompleteDiv.innerHTML = filteredCustomers.map(c => `
      <div class="autocomplete-item" data-customer-id="${escapeAttr(c.id)}">
        <div class="autocomplete-item-name">${escapeHtml(c.name || c.id)}</div>
        <div class="autocomplete-item-details">${escapeHtml(c.phone || "")}${c.email ? ` • ${escapeHtml(c.email)}` : ""}</div>
      </div>`).join("");
    autocompleteDiv.onclick = (e) => {
      const item = e.target.closest(".autocomplete-item[data-customer-id]");
      if (!item) return;
      const customer = filteredCustomers.find(c => c.id === item.dataset.customerId);
      if (customer) onSelect(customer);
    };
  } else {
    autocompleteDiv.innerHTML = `
      <div class="autocomplete-item" style="color:#3b82f6;font-style:italic;">
        <div class="autocomplete-item-name">Tạo khách hàng mới: "${escapeHtml(query)}"</div>
        <div class="autocomplete-item-details">Nhấn Enter để tạo mới</div>
      </div>`;
    autocompleteDiv.onclick = null;
  }
  autocompleteDiv.style.display = "block";
}

function closeModal()       { byId("order-modal").classList.remove("active"); }
function openDetailModal()  { byId("detail-modal").classList.add("active"); }
function closeDetailModal() { byId("detail-modal").classList.remove("active"); }

// --------------- Auth -------------------------------------------------------

async function login() {
  session.apiUrl = window.CommonUtils.DEFAULT_API_URL;
  session.apiKey = byId("api_key").value.trim();
  session.email  = byId("email").value.trim();
  const password = byId("password").value;

  if (!session.apiKey || !session.email || !password) { alert("Vui lòng nhập đủ API KEY, email, password"); return; }

  const data = await apiCall("auth.login", { email: session.email, password });
  session.token = data.token; session.email = data.email; session.role = data.role;
  window.AuthSession.save(session);
  if (window.SessionCache) window.SessionCache.save(session);
  if (window.CommonUtils)  window.CommonUtils.session = session;

  updateSessionUI();
  const { page } = Pagination.getParamsFromURL();
  await loadData(page);
  _loadShopInfo().catch(() => {}); // warm cache, fire-and-forget
  if (!_newOrderPollBaselineReady) {
    await refreshNewOrderPollBaseline();
  }
  startOrderNotifyWS();
}

// --------------- Data loading -----------------------------------------------

async function loadData(page) {
  if (page == null) page = Pagination.getParamsFromURL().page;
  currentPage = page;

  return apiCallWithLoading(async () => {
    const ordersCacheKey = CacheManager.key("orders", "list", page, itemsPerPage);
    const cachedOrders   = CacheManager.get(ordersCacheKey);
    let ordersResult;

    if (cachedOrders) {
      console.log("📦 Orders: localStorage cache hit");
      ordersResult = cachedOrders;
    } else {
      // Worker-first: KV hybrid (~50ms) → GAS fallback (~2–4s)
      if (window.WorkerAPI?.isConfigured()) {
        try {
          ordersResult = await WorkerAPI.ordersList({ page, limit: itemsPerPage });
          console.log("✅ Orders: Worker KV hit");
          // Set baseline ngay từ data này — tránh gọi /orders lần 2 trong refreshNewOrderPollBaseline
          if (ordersResult?.items?.length > 0 && page === 1) {
            _lastRemoteHeadOrderId     = String(ordersResult.items[0]?.id ?? "");
            _newOrderPollBaselineReady = true;
          }
        } catch (workerErr) {
          console.warn("⚠️ Orders Worker miss, falling back to GAS:", workerErr.message);
          ordersResult = null;
        }
      }
      if (!ordersResult) {
        console.log("📡 Orders: fetching from GAS...");
        ordersResult = await apiCall("orders.list", { page, limit: itemsPerPage });
      }
      if (ordersResult) CacheManager.set(ordersCacheKey, ordersResult);
    }

    orders      = ordersResult.items      || [];
    totalOrders = ordersResult.total      || 0;
    totalPages  = ordersResult.totalPages || 0;
    currentPage = ordersResult.page       || 1;

    const neededProductIds = extractProductIds(orders);
    const [batchedProducts, loadedCustomers] = await Promise.all([
      loadProductsBatch(neededProductIds),
      loadCustomersData(),
    ]);

    mergeProducts(batchedProducts);
    customers = loadedCustomers;
    rebuildCustomerSearchIndex();
    productsMap = null;

    renderOrders();
    renderPagination();
    Pagination.updateURL(currentPage, itemsPerPage);
  }, "Đang tải đơn hàng...");
}

function extractProductIds(orderList) {
  const seen = new Set();
  for (const order of orderList)
    for (const item of getOrderItems(order))
      if (item.product_id) seen.add(String(item.product_id).trim());
  return [...seen];
}

async function loadProductsBatch(ids) {
  if (!ids || ids.length === 0) return [];
  const existingIds = new Set(products.map(p => String(p.id).trim()));
  const missingIds  = ids.filter(id => !existingIds.has(id));
  if (missingIds.length === 0) return [];

  const stillMissing = [], fromCache = [];
  for (const id of missingIds) {
    const cached = CacheManager.get(CacheManager.key("product", "detail", id));
    if (cached) fromCache.push(cached); else stillMissing.push(id);
  }

  let fetched = [];
  if (stillMissing.length > 0) {
    fetched = await fetchProductsBatchFromBackend(stillMissing);
    for (const p of fetched) CacheManager.set(CacheManager.key("product", "detail", p.id), p);
  }
  return [...fromCache, ...fetched];
}

async function fetchProductsBatchFromBackend(ids) {
  if (ids.length === 0) return [];

  let workerItems = [];
  let missedIds   = [...ids];  // ids chưa tìm được

  // ── Bước 1: Worker KV batch ──────────────────────────────────────────────
  if (WorkerAPI?.isConfigured()) {
    try {
      const result = await WorkerAPI.call("/products", { ids: ids.join(",") });
      const items  = result?.items ?? (Array.isArray(result) ? result : []);

      if (items.length > 0) {
        workerItems = items;
        // Tính ids còn thiếu (Worker KV miss 1 phần)
        const foundIds = new Set(items.map(p => String(p.id).trim()));
        missedIds = ids.filter(id => !foundIds.has(String(id).trim()));

        if (missedIds.length === 0) {
          // Tất cả tìm thấy trong KV — không cần GAS
          return workerItems;
        }
        console.log(`⚠️ Products batch: Worker KV miss ${missedIds.length}/${ids.length} ids:`, missedIds);
      }
    } catch (e) {
      console.warn("⚠️ Products batch Worker error:", e.message);
      missedIds = [...ids]; // Worker fail hoàn toàn → GAS fetch tất cả
    }
  }

  // ── Bước 2: GAS fallback chỉ cho ids bị miss ─────────────────────────────
  if (missedIds.length === 0) return workerItems;

  try {
    const result    = await apiCall("products.list", { ids: missedIds });
    const gasItems  = result?.items ?? (Array.isArray(result) ? result : []);

    // Cache từng item vào localStorage để lần sau không cần fetch lại
    for (const p of gasItems) {
      CacheManager.set(CacheManager.key("product", "detail", p.id), p);
    }

    console.log(`✅ Products batch: GAS returned ${gasItems.length}/${missedIds.length} missing items`);
    return [...workerItems, ...gasItems];
  } catch (e) {
    console.error("❌ Products batch GAS failed:", e.message);
    return workerItems; // trả về những gì Worker có được
  }
}

function mergeProducts(newProducts) {
  if (!newProducts || newProducts.length === 0) return;
  const existingIds = new Set(products.map(p => String(p.id).trim()));
  for (const p of newProducts) {
    if (!existingIds.has(String(p.id).trim())) { products.push(p); existingIds.add(String(p.id).trim()); }
  }
  productsMap = null;
}

async function loadCustomersData() {
  const cacheKey = CacheManager.key("customers", "list", 1, ORDERS_CONST.CUSTOMERS_LIMIT);
  const cached   = CacheManager.get(cacheKey);
  if (cached) return cached.items ?? (Array.isArray(cached) ? cached : []);

  let data = null;
  if (WorkerAPI?.isConfigured()) {
    try {
      data = await WorkerAPI.customersList({ page: 1, limit: ORDERS_CONST.CUSTOMERS_LIMIT });
      if (data) CacheManager.set(cacheKey, data);
    } catch (e) { console.warn("⚠️ Customers Worker error:", e.message); }
  }
  if (!data) { data = await apiCall("customers.list", { page: 1, limit: ORDERS_CONST.CUSTOMERS_LIMIT }); CacheManager.set(cacheKey, data); }
  return data?.items ?? (Array.isArray(data) ? data : []);
}

// --------------- Rendering --------------------------------------------------

function renderPagination() {
  Pagination.render("orders-pagination", currentPage, totalPages, totalOrders, loadData, "đơn hàng");
}

function getCustomerDisplayName(customerId) {
  if (!customerId) return "";
  const c = customers.find(c => c.id === customerId);
  if (!c) return customerId;
  return c.name || c.phone || c.email || c.id || customerId;
}

function getOrderItems(order) {
  const raw = order?.items_json;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch (e) { return []; }
  }
  return [];
}

function getProductDisplayName(productId) {
  if (!productId) return "";
  const id = String(productId).trim();
  if (!productsMap) {
    productsMap = new Map();
    for (const p of products) if (p.id) productsMap.set(String(p.id).trim(), p.title || p.name || p.id);
  }
  return productsMap.get(id) ?? id;
}

function getShippingInfo(order) {
  const raw = order?.shipping_info;
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  if (typeof raw === "string") { try { return JSON.parse(raw) || null; } catch (e) { return null; } }
  return null;
}

function getStatusClass(status) {
  return { NEW: "status-new", DONE: "status-done", CANCEL: "status-cancel", RETURN: "status-return" }[status] || "";
}

function getStatusActions(orderId, status) {
  const id = escapeAttr(orderId);
  const actions = [];
  if (status === "NEW") {
    actions.push(`<button class="action-btn status-btn" onclick="event.stopPropagation();changeStatus('${id}','DONE')">✓ Done</button>`);
    actions.push(`<button class="action-btn status-btn cancel-btn" onclick="event.stopPropagation();changeStatus('${id}','CANCEL')">✕ Cancel</button>`);
  } else if (status === "DONE") {
    actions.push(`<button class="action-btn status-btn return-btn" onclick="event.stopPropagation();changeStatus('${id}','RETURN')">↩ Return</button>`);
    actions.push(`<button class="action-btn invoice-btn" onclick="event.stopPropagation();openInvoiceModal('${id}')" title="Xuất hóa đơn">🧾</button>`);
  }
  return actions.join(" ");
}

function buildOrderRowHTML(order) {
  const status       = order.status || "NEW";
  const statusClass  = escapeAttr(getStatusClass(status));
  const actions      = getStatusActions(order.id, status);
  const items        = getOrderItems(order);
  const productNames = items.length
    ? items.map(i => escapeHtml(getProductDisplayName(i.product_id))).filter(Boolean).join(", ")
    : "-";
  const customerName = escapeHtml(getCustomerDisplayName(order.customer_id));
  const oid          = escapeAttr(order.id);

  return `
    <td onclick="viewOrder('${oid}')" style="cursor:pointer">${customerName}</td>
    <td onclick="viewOrder('${oid}')" style="cursor:pointer">${productNames}</td>
    <td class="text-center" onclick="viewOrder('${oid}')" style="cursor:pointer">${escapeHtml(formatPrice(order.total || 0))}</td>
    <td class="text-center" onclick="viewOrder('${oid}')" style="cursor:pointer">
      <span class="status-badge ${statusClass}">${escapeHtml(status)}</span>
    </td>
    <td onclick="viewOrder('${oid}')" style="cursor:pointer">${escapeHtml(order.created_at || "")}</td>
    <td class="text-center">${actions}</td>
  `;
}

function renderOrders() {
  const tbody = byId("orders-table").querySelector("tbody");
  if (!orders.length) { tbody.innerHTML = `<tr><td colspan="6" class="muted">Chưa có đơn hàng</td></tr>`; return; }
  const sorted = [...orders].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  tbody.innerHTML = sorted.map(o => `<tr data-order-id="${escapeAttr(o.id)}">${buildOrderRowHTML(o)}</tr>`).join("");
}

function updateOrderInList(order) {
  const idx = orders.findIndex(o => o.id === order.id);
  if (idx !== -1) orders[idx] = order;
  const row = byId("orders-table").querySelector(`tbody tr[data-order-id="${CSS.escape(order.id)}"]`);
  if (row) row.innerHTML = buildOrderRowHTML(order);
}

// --------------- Actions ----------------------------------------------------

function viewOrder(orderId) {
  const order = orders.find(o => o.id === orderId);
  if (!order) return;

  const items     = getOrderItems(order);
  const itemsHtml = items.length
    ? items.map(item => `
        <div>
          ${escapeHtml(getProductDisplayName(item.product_id))}
          × ${escapeHtml(String(item.qty || 0))}
          @ ${escapeHtml(formatPrice(item.price || 0))}
          = ${escapeHtml(formatPrice((item.qty || 0) * (item.price || 0)))}
        </div>`).join("")
    : "Không có dữ liệu items";

  const invoiceBtn = order.status === "DONE"
    ? `<button class="btn-secondary" onclick="openInvoiceModal('${escapeAttr(order.id)}')" style="margin-top:1rem;">🧾 Xuất hóa đơn</button>`
    : "";

  const shipping     = getShippingInfo(order);
  const shippingHtml = shipping ? `
    <div class="detail-section">
      <span class="detail-label">Thông tin giao hàng:</span>
      <div class="shipping-info-detail">
        ${shipping.address ? `<div><strong>Địa chỉ:</strong> ${escapeHtml(shipping.address)}</div>` : ""}
        ${shipping.city    ? `<div><strong>Thành phố:</strong> ${escapeHtml(shipping.city)}</div>` : ""}
        ${shipping.zipcode ? `<div><strong>Mã bưu điện:</strong> ${escapeHtml(shipping.zipcode)}</div>` : ""}
        ${shipping.note    ? `<div><strong>Ghi chú giao hàng:</strong> ${escapeHtml(shipping.note)}</div>` : ""}
      </div>
    </div>` : "";

  byId("order-detail-content").innerHTML = `
    <div class="detail-section"><span class="detail-label">Order ID:</span> ${escapeHtml(order.id)}</div>
    <div class="detail-section"><span class="detail-label">Khách hàng:</span> ${escapeHtml(getCustomerDisplayName(order.customer_id))}</div>
    <div class="detail-section"><span class="detail-label">Trạng thái:</span> ${escapeHtml(order.status)}</div>
    <div class="detail-section"><span class="detail-label">Ngày tạo:</span> ${escapeHtml(order.created_at)}</div>
    <div class="detail-section">
      <span class="detail-label">Sản phẩm:</span>
      <div class="items-list">${itemsHtml}</div>
    </div>
    <div class="detail-section">
      <span class="detail-label">Tổng tiền:</span>
      <strong>${escapeHtml(formatPrice(order.total || 0))}</strong>
    </div>
    ${shippingHtml}
    ${order.note ? `<div class="detail-section"><span class="detail-label">Ghi chú:</span> ${escapeHtml(order.note)}</div>` : ""}
    ${invoiceBtn}
  `;

  openDetailModal();
}

// --------------- Order form -------------------------------------------------

function addItemRow() {
  const container = byId("items-container");
  const index     = currentItems.length;
  const row       = document.createElement("div");
  row.className   = "item-row";
  row.dataset.index = index;

  row.innerHTML = `
    <div>
      <label>Sản phẩm</label>
      <div class="product-search-wrap">
        <input type="text" class="item-product-search" data-index="${index}" placeholder="Tìm theo tên, mã SKU..." autocomplete="off">
        <input type="hidden" class="item-product" data-index="${index}" value="">
        <div class="autocomplete-dropdown product-search-dropdown" style="display:none;"></div>
      </div>
    </div>
    <div><label>Số lượng</label><input class="item-qty" type="number" min="1" value="1" data-index="${index}"></div>
    <div><label>Giá (tùy chỉnh)</label><input class="item-price" type="number" step="0.01" placeholder="Giá đề xuất" data-index="${index}"></div>
    <div><label>Thành tiền</label><input class="item-total" type="text" disabled value="0"></div>
    <div><label>&nbsp;</label><button class="btn-remove" type="button" onclick="removeItem(${index})">Xóa</button></div>
  `;

  container.appendChild(row);
  currentItems.push({ product_id: "", qty: 1, price: 0 });

  const searchInput = row.querySelector(".item-product-search");
  const hiddenInput = row.querySelector(".item-product");
  const dropdown    = row.querySelector(".product-search-dropdown");
  const qtyInput    = row.querySelector(".item-qty");
  const priceInput  = row.querySelector(".item-price");

  searchInput.addEventListener("focus", () => { _renderProductDropdown(dropdown, products, searchInput, hiddenInput, priceInput, index); });

  const debouncedSearch = debounce(async (query) => {
    hiddenInput.value = "";
    if (!query.trim()) { _renderProductDropdown(dropdown, products, searchInput, hiddenInput, priceInput, index); return; }
    dropdown.innerHTML = `<div class="autocomplete-item" style="color:#64748b;font-style:italic;">⏳ Đang tìm...</div>`;
    dropdown.style.display = "block";
    const results = await _searchProductsFromAPI(query.trim());
    _renderProductDropdown(dropdown, results, searchInput, hiddenInput, priceInput, index);
  }, ORDERS_CONST.DEBOUNCE_DELAY);

  searchInput.addEventListener("input", (e) => debouncedSearch(e.target.value));
  searchInput.addEventListener("blur",  () => { setTimeout(() => { dropdown.style.display = "none"; }, ORDERS_CONST.AUTOCOMPLETE_BLUR_DELAY); });
  qtyInput.addEventListener("input",   () => updateItemRow(index));
  priceInput.addEventListener("input", () => updateItemRow(index));
}

async function _searchProductsFromAPI(query) {
  const q = query.toLowerCase();
  if (WorkerAPI?.isConfigured()) {
    try {
      const result = await WorkerAPI.call("/products", { search: query, limit: 20 });
      if (result) { const items = result.items ?? (Array.isArray(result) ? result : []); mergeProducts(items); return items; }
    } catch (e) { console.warn("⚠️ Product search Worker error:", e.message); }
  }
  return products.filter(p =>
    (p.id || "").toLowerCase().includes(q) ||
    (p.title || p.name || "").toLowerCase().includes(q) ||
    (p.mpn || "").toLowerCase().includes(q) ||
    (p.brand || "").toLowerCase().includes(q)
  );
}

function _renderProductDropdown(dropdown, productList, searchInput, hiddenInput, priceInput, index) {
  if (!productList || productList.length === 0) {
    dropdown.innerHTML = `<div class="autocomplete-item" style="color:#94a3b8;font-style:italic;"><div class="autocomplete-item-name">Không tìm thấy sản phẩm</div></div>`;
    dropdown.style.display = "block";
    return;
  }
  dropdown.innerHTML = productList.slice(0, 20).map(p => `
    <div class="autocomplete-item" data-product-id="${escapeAttr(p.id)}" data-price="${escapeAttr(String(p.price || 0))}">
      <div class="autocomplete-item-name">${escapeHtml(p.id)} &mdash; ${escapeHtml(p.title || p.name || p.id)}</div>
      <div class="autocomplete-item-details">
        ${p.amount_in_stock != null ? `Tồn: <strong>${escapeHtml(String(p.amount_in_stock))}</strong> &nbsp;·&nbsp;` : ""}
        Giá: <strong>${escapeHtml(formatPrice(p.price || 0))}</strong>
        ${p.brand ? `&nbsp;·&nbsp; ${escapeHtml(p.brand)}` : ""}
      </div>
    </div>`).join("");

  dropdown.onclick = (e) => {
    const item = e.target.closest(".autocomplete-item[data-product-id]");
    if (!item) return;
    const productId = item.dataset.productId;
    const price     = item.dataset.price;
    const product   = productList.find(p => p.id === productId) || {};
    searchInput.value      = `${productId} — ${product.title || product.name || productId}`;
    hiddenInput.value      = productId;
    priceInput.value       = price;
    priceInput.placeholder = `Giá đề xuất: ${formatPrice(price)}`;
    dropdown.style.display = "none";
    updateItemRow(index);
  };
  dropdown.style.display = "block";
}

function updateItemRow(index) {
  const row = document.querySelector(`.item-row[data-index="${index}"]`);
  if (!row) return;
  const productId = row.querySelector(".item-product").value;
  const qty       = Number(row.querySelector(".item-qty").value)   || 0;
  const price     = Number(row.querySelector(".item-price").value) || 0;
  row.querySelector(".item-total").value = formatPrice(qty * price);
  currentItems[index] = { product_id: productId, qty, price };
  updateOrderTotal();
}

function removeItem(index) {
  const row = document.querySelector(`.item-row[data-index="${index}"]`);
  if (row) row.remove();
  currentItems[index] = null;
  updateOrderTotal();
}

function updateOrderTotal() {
  byId("order-total").textContent = formatPrice(
    currentItems.filter(Boolean).reduce((sum, item) => sum + item.qty * item.price, 0)
  );
}

function clearOrderForm() {
  const customerInput = byId("field-customer");
  if (customerInput) { customerInput.value = ""; customerInput._setSelectedCustomerId?.(null); }
  const autocompleteDiv = byId("customer-autocomplete");
  if (autocompleteDiv) autocompleteDiv.style.display = "none";
  const dateEl = byId("field-order-date");
  if (dateEl) dateEl.value = "";
  byId("items-container").innerHTML = "";
  currentItems = [];
  byId("order-total").textContent = formatPrice(0);
  ["field-shipping-address","field-shipping-city","field-shipping-zipcode","field-shipping-note","field-order-note"]
    .forEach(id => { const el = byId(id); if (el) el.value = ""; });
}

function getNowDateTimeLocal_() {
  const d = new Date(), pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isValidDateTimeLocal_(s) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) return false;
  try { return !isNaN(new Date(s).getTime()); } catch (e) { return false; }
}

// --------------- Save order -------------------------------------------------

async function saveOrder() {
  reloadSession();
  Validator.clearErrors();

  const customerInput = byId("field-customer");
  const customerValue = customerInput.value.trim();
  const dateInput     = byId("field-order-date");
  let   orderDateTime = (dateInput?.value ?? "").trim();

  const customerResult = Validator.validateField(customerValue, { required: true, minLength: 1, maxLength: Validator.limits.STRING_MAX_LENGTH }, "field-customer");
  if (!customerResult.valid) { Validator.showError("field-customer", customerResult.error); return; }

  let customerId = null;
  const selectedId = customerInput._selectedCustomerId?.();
  if (selectedId) {
    customerId = selectedId;
  } else {
    const q = customerValue.toLowerCase(), qDigits = q.replace(/\D/g, "");
    const found = customers.find(c => {
      const name = (c.name || "").trim().toLowerCase(), phone = (c.phone || "").replace(/\D/g, ""), email = (c.email || "").trim().toLowerCase();
      return name === q || (qDigits && phone && phone === qDigits) || email === q || c.id === customerValue;
    });
    if (found) {
      customerId = found.id;
    } else {
      try {
        Loading.show("Đang tạo khách hàng mới...");
        const parts = customerValue.split("|").map(s => s.trim());
        // Worker-first: POST /customers (~100ms) → GAS fallback
        let newCustomer;
        const custPayload = { name: parts[0] || customerValue, phone: parts[1] || parts[0] || customerValue, email: parts[2] || "" };
        if (window.WorkerAPI?.isConfigured() && window.CommonUtils?.WORKER_URL) {
          try {
            const apiKey = session?.apiKey || window.CommonUtils?.session?.apiKey;
            const resp = await fetch(
              `${window.CommonUtils.WORKER_URL}/customers?api_key=${encodeURIComponent(apiKey)}`,
              { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(custPayload) }
            );
            if (resp.ok) {
              const json = await resp.json();
              newCustomer = json?.data ?? json;
            }
          } catch (e) { console.warn("⚠️ Worker customers.create failed:", e.message); }
        }
        if (!newCustomer || newCustomer.status === "pending") {
          // pending = queued temp id → cần real id từ GAS
          newCustomer = await apiCall("customers.create", custPayload);
        }
        customerId = newCustomer.id;
        CacheInvalidator.customers(); customers.push(newCustomer); rebuildCustomerSearchIndex();
        Loading.hide();
      } catch (err) { Loading.hide(); alert(`❌ Lỗi khi tạo khách hàng mới: ${err.message}`); return; }
    }
  }

  if (!orderDateTime) orderDateTime = getNowDateTimeLocal_();
  if (!isValidDateTimeLocal_(orderDateTime)) { alert("Ngày giờ đặt hàng không hợp lệ."); return; }

  let orderDate = orderDateTime;
  if (orderDateTime.includes("T")) {
    const [datePart, timePart = "00:00"] = orderDateTime.split("T");
    const [hh = "00", mm = "00", ss = "00"] = timePart.split(":");
    orderDate = `${datePart} ${hh}:${mm}:${ss}`;
  }

  const items = currentItems.filter(item => item?.product_id && item.qty > 0);
  if (!items.length) { alert("Vui lòng thêm ít nhất 1 sản phẩm"); return; }

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const qtyRes   = Validator.validateField(Number(it.qty),   { required: true, type: "integer", min: 1 });
    const priceRes = Validator.validateField(Number(it.price), { required: true, type: "number",  nonNegative: true });
    if (!qtyRes.valid)   { alert(`Sản phẩm ${i+1}: ${qtyRes.error}`);   return; }
    if (!priceRes.valid) { alert(`Sản phẩm ${i+1}: ${priceRes.error}`); return; }
  }

  const shippingAddress = byId("field-shipping-address")?.value.trim() || "";
  const shippingCity    = byId("field-shipping-city")?.value.trim()    || "";
  const shippingZipcode = byId("field-shipping-zipcode")?.value.trim() || "";
  const shippingNote    = byId("field-shipping-note")?.value.trim()    || "";
  const orderNote       = byId("field-order-note")?.value.trim()       || "";

  const shippingResult = Validator.validateForm(
    { "field-shipping-address": shippingAddress, "field-shipping-city": shippingCity, "field-shipping-zipcode": shippingZipcode, "field-shipping-note": shippingNote, "field-order-note": orderNote },
    { "field-shipping-address": Validator.helpers.requiredString(1), "field-shipping-city": Validator.helpers.optionalString(), "field-shipping-zipcode": Validator.helpers.optionalString(), "field-shipping-note": Validator.helpers.textarea(false), "field-order-note": Validator.helpers.textarea(false) }
  );
  if (!shippingResult.valid) { Validator.showErrors(shippingResult.errors); return; }

  const shippingInfo = {};
  if (shippingAddress) shippingInfo.address = shippingAddress;
  if (shippingCity)    shippingInfo.city     = shippingCity;
  if (shippingZipcode) shippingInfo.zipcode  = shippingZipcode;
  if (shippingNote)    shippingInfo.note     = shippingNote;

  const total   = currentItems.filter(Boolean).reduce((sum, item) => sum + item.qty * item.price, 0);
  const tempId  = `temp_${Date.now()}_${++_tempIdCounter}`;
  const optimisticOrder = {
    id: tempId, customer_id: customerId, items_json: JSON.stringify(items), total,
    status: "NEW",
    created_at: orderDate.replace("T", " ") + (orderDate.includes(":") && orderDate.split(":").length < 3 ? ":00" : ""),
    shipping_info: JSON.stringify(shippingInfo), note: orderNote || "",
  };

  closeModal(); clearOrderForm();
  orders.unshift(optimisticOrder); renderOrders();
  _setRowActionsDisabled(tempId, true);
  _cacheUpsertOrder(optimisticOrder);

  const gasPayload = { customer_id: customerId, items, created_at: orderDate, shipping_info: JSON.stringify(shippingInfo), note: orderNote || undefined };
  Toast.show("Đang lưu đơn hàng...", "info", 0);
  _pendingStart(tempId, gasPayload);

  (async () => {
    let savedOrder;
    try { savedOrder = await apiCall("orders.create", gasPayload); }
    catch (err) {
      const msg = err?.message || "Lỗi không xác định";
      if (isNetworkOrResponseError(err)) {
        Toast.show("⚠️ Mất kết nối — đơn hàng có thể đã được lưu. Sẽ thử lại khi tải lại trang.", "info", 6000);
      } else {
        _pendingEnd(tempId);
        const idx = orders.findIndex(o => o.id === tempId);
        if (idx !== -1) orders.splice(idx, 1);
        _cacheRemoveOrder(tempId); renderOrders();
        Toast.show(`✗ Lỗi tạo đơn: ${msg}`, "error", 6000);
        if (["Token expired", "Unauthorized", "hết hạn", "AUTH_ERROR"].some(s => msg.includes(s)))
          setTimeout(() => handleError(err, "saveOrder"), 300);
      }
      return;
    }

    _pendingEnd(tempId);
    const realId    = savedOrder.order_id ?? savedOrder.id;
    const realOrder = Object.assign({}, optimisticOrder, { id: String(realId), total: savedOrder.total ?? optimisticOrder.total });
    const idx = orders.findIndex(o => o.id === tempId);
    if (idx !== -1) orders[idx] = realOrder;
    const tempRow = byId("orders-table")?.querySelector(`tbody tr[data-order-id="${CSS.escape(tempId)}"]`);
    if (tempRow) tempRow.setAttribute("data-order-id", realOrder.id);
    updateOrderInList(realOrder);
    _cacheReplaceOrder(tempId, realOrder);
    Toast.show("✓ Đã tạo đơn hàng", "success", 2500);
    _lastRemoteHeadOrderId     = String(realId);
    _newOrderPollBaselineReady = true;
  })();
}

// --------------- Event listeners --------------------------------------------

byId("btn-login").addEventListener("click", async () => {
  const btn = byId("btn-login");
  Loading.button(btn, true);
  try   { await login(); }
  catch (err) { handleError(err, "login"); }
  finally     { Loading.button(btn, false); }
});

byId("btn-logout").addEventListener("click", () => resetSession());

byId("btn-new").addEventListener("click", () => {
  clearOrderForm();
  const dateEl = byId("field-order-date");
  if (dateEl) dateEl.value = getNowDateTimeLocal_();
  addItemRow(); openModal();
});

byId("btn-close").addEventListener("click",        () => closeModal());
byId("btn-close-detail").addEventListener("click", () => closeDetailModal());

byId("btn-save").addEventListener("click", async () => {
  const btn = byId("btn-save");
  if (btn.disabled) return;
  Loading.button(btn, true);
  try   { await saveOrder(); }
  catch (err) { handleError(err, "saveOrder"); }
  finally     { Loading.button(btn, false); }
});

byId("btn-add-item").addEventListener("click", () => addItemRow());

// Invoice modal — Escape key đóng modal
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (byId("invoice-preview-modal")?.classList.contains("active")) { closeInvoicePreview(); return; }
    if (byId("invoice-modal")?.classList.contains("active"))         { closeInvoiceModal();   return; }
  }
});

byId("btn-new-order-reload")?.addEventListener("click",          () => onNewOrderReloadClick());
byId("btn-new-order-dismiss")?.addEventListener("click",         () => onNewOrderDismissClick());
byId("btn-close-new-order-notify")?.addEventListener("click",    () => onNewOrderDismissClick());

// --------------- Init -------------------------------------------------------

if (window.WorkerAPI && window.CommonUtils?.WORKER_URL) {
  WorkerAPI.init(window.CommonUtils.WORKER_URL);
  console.log("✅ WorkerAPI initialized");
}

if (!window.escapeAttr) {
  window.escapeAttr = function escapeAttr(text) {
    if (text == null) return "";
    return String(text).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/'/g,"&#x27;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  };
}

reloadSession();
syncInputsFromSession();
applyQueryParams_();
updateSessionUI();

if (session.token) {
  const { page } = Pagination.getParamsFromURL();
  loadData(page)
    .then(async () => {
      setTimeout(_recoverPendingOrders, 1500);
      // Không gọi refreshNewOrderPollBaseline() ở đây —
      // loadData() đã set _lastRemoteHeadOrderId từ items[0] khi Worker hit.
      // Chỉ cần gọi nếu baseline chưa được set (KV miss → GAS fallback)
      if (!_newOrderPollBaselineReady) {
        await refreshNewOrderPollBaseline();
      }
      startOrderNotifyWS();
    })
    .catch(err => handleError(err, "initial loadData"));
}