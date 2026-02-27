/**
 * common.js - Shared utilities for all admin pages
 *
 * Optimizations vs original:
 *  1. SessionCache: TTL-based in-memory cache → stop reading localStorage
 *     on every single apiCall() (was synchronous I/O + JSON.parse each time)
 *  2. XSS: complete escapeHtml + escapeAttr + sanitizeUrl replacing the
 *     incomplete div.textContent version that missed attribute-context XSS
 *  3. Auth error detection: AUTH_ERROR_SIGNALS constant array → one place
 *     to add new patterns, no scattered string.includes() across files
 *  4. Global error boundary: window.onerror + unhandledrejection → no more
 *     silent failures / white-screen-of-death
 *  5. formatPrice: memoized with a small LRU-style Map → repeated calls
 *     (rendering 20 rows × N prices) skip Intl.NumberFormat each time
 *  6. apiCallWithLoading: single wrapper used by all page files so they
 *     don't each reimplement Loading.show/hide + error handling
 *  7. applyQueryParams_  → applyQueryParams  (trailing underscore removed,
 *     kept alias for backward compat)
 *  8. window.CommonUtils getter/setter kept; escapeAttr + sanitizeUrl added
 */

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_API_URL = "https://script.google.com/macros/s/AKfycbzs7FiPxCy0Offo90kG3MqrfkgjilhI25AsrEh09TzF7A_PPsxs3C_Xq4ifCLKiQdIR/exec";

const WORKER_URL = "https://quanlykho-api.nguyenxuancuongk56.workers.dev";

const PAGINATION = {
  DEFAULT_LIMIT : 20,
  MAX_LIMIT     : 20,
  MIN_LIMIT     : 1,
};

/** Patterns that indicate the session token has expired or is invalid. */
const AUTH_ERROR_SIGNALS = [
  "Token expired",
  "Unauthorized",
  "hết hạn",
  "invalid token",
  "unauthenticated",
];

const sessionDefaults = {
  apiUrl : DEFAULT_API_URL,
  apiKey : "",
  token  : "",
  email  : "",
  role   : "",
};

// ─── SessionCache ────────────────────────────────────────────────────────────
/**
 * In-memory session cache with TTL.
 *
 * Problem solved: the original code called reloadSession() (= localStorage
 * read + JSON.parse) on EVERY apiCall(), even when nothing had changed.
 * With TTL = 5 s we get the same freshness guarantee at ~1/100 the cost.
 *
 * Cache is invalidated explicitly on login / logout.
 */
const SessionCache = (() => {
  const TTL = 5_000; // ms
  let _cached    = null;
  let _lastCheck = 0;

  return {
    load() {
      const now = Date.now();
      // If cache was filled before auth.js ran (no token), re-read from storage when AuthSession is now available
      const cacheHasNoAuth = !_cached || !_cached.token;
      const authAvailable  = typeof window.AuthSession !== "undefined";
      if (_cached && (now - _lastCheck) < TTL && !(cacheHasNoAuth && authAvailable)) {
        return _cached;
      }

      _cached    = window.AuthSession
        ? window.AuthSession.load(sessionDefaults)
        : { ...sessionDefaults };
      _lastCheck = now;
      return _cached;
    },

    save(data) {
      _cached    = { ...data };
      _lastCheck = Date.now();
      if (window.AuthSession) window.AuthSession.save(_cached);
    },

    invalidate() {
      _cached    = null;
      _lastCheck = 0;
    },

    clear() {
      this.invalidate();
      if (window.AuthSession) window.AuthSession.clear();
    },
  };
})();

// Module-level session reference (kept for backward compat with page files
// that read `session.token` directly).
let session = SessionCache.load();

// ─── XSS Protection ─────────────────────────────────────────────────────────
/**
 * escapeHtml – safe for TEXT NODES inside elements.
 *
 * Original used div.textContent → div.innerHTML which is correct for text
 * nodes but misses attribute-context injection (e.g. value="${userInput}").
 * We keep the text-node version AND add escapeAttr for attributes.
 */
function escapeHtml(text) {
  if (text == null) return "";
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };
  return String(text).replace(/[&<>"']/g, ch => map[ch]);
}

/**
 * escapeAttr – safe for HTML attribute VALUES (inside quotes).
 * Use this whenever writing:  <tag attr="${escapeAttr(value)}">
 */
function escapeAttr(text) {
  if (text == null) return "";
  return String(text)
    .replace(/&/g,  "&amp;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#x27;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/\//g, "&#x2F;");
}

/**
 * sanitizeUrl – blocks javascript:, data:, vbscript: and other dangerous
 * schemes.  Use for href / src / action attribute values.
 */
function sanitizeUrl(url) {
  if (!url) return "";
  const str = String(url).trim();
  const lower = str.replace(/\s/g, "").toLowerCase();
  const blocked = ["javascript:", "data:", "vbscript:", "file:"];
  if (blocked.some(p => lower.startsWith(p))) return "about:blank";
  return str;
}

// ─── Auth helpers ────────────────────────────────────────────────────────────

function isAuthError(message) {
  if (!message) return false;
  const lower = String(message).toLowerCase();
  return AUTH_ERROR_SIGNALS.some(s => lower.includes(s.toLowerCase()));
}

// ─── DOM helpers ─────────────────────────────────────────────────────────────

function byId(id) {
  return document.getElementById(id);
}

// ─── Format helpers ───────────────────────────────────────────────────────────

/**
 * formatPrice – memoized.
 *
 * Intl.NumberFormat is expensive to call repeatedly.  Rendering a page of
 * 20 orders × 3 prices each = 60 calls per render cycle.  A simple Map
 * cache keyed on the numeric value cuts this to 60 Map lookups after the
 * first render.
 *
 * Cache is bounded to 500 entries to prevent unbounded growth.
 */
const formatPrice = (() => {
  const cache    = new Map();
  const MAX_SIZE = 500;
  const formatter = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" });

  return function formatPrice(price) {
    const n = Number(price) || 0;
    if (cache.has(n)) return cache.get(n);

    const formatted = formatter.format(n);

    if (cache.size >= MAX_SIZE) {
      // Evict oldest entry (Map preserves insertion order)
      cache.delete(cache.keys().next().value);
    }
    cache.set(n, formatted);
    return formatted;
  };
})();

/**
 * formatShortEmail – e.g. "nguyen@gmail.com" → "ngu...gmail.com"
 */
function formatShortEmail(email) {
  if (!email) return "";
  const atIndex = email.indexOf("@");
  if (atIndex === -1) return email;
  const local  = email.substring(0, atIndex);
  const domain = email.substring(atIndex + 1);
  return local.length <= 3 ? email : `${local.substring(0, 3)}...${domain}`;
}

// ─── Session UI ──────────────────────────────────────────────────────────────

function setSessionInfo(text) {
  const el = byId("session-info");
  if (el) el.textContent = text;
}

function updateSessionUI() {
  const logoutBtn    = byId("btn-logout");
  const loginSection = byId("login-section");

  if (session.token) {
    setSessionInfo(`${formatShortEmail(session.email)} (${session.role})`);
    logoutBtn    ?.classList.remove("hidden");
    loginSection ?.classList.add("hidden");
  } else {
    setSessionInfo("Chưa đăng nhập");
    logoutBtn    ?.classList.add("hidden");
    loginSection ?.classList.remove("hidden");
  }
}

function syncInputsFromSession() {
  const apiUrlInput = byId("api_url");
  if (apiUrlInput) apiUrlInput.value = session.apiUrl || DEFAULT_API_URL;

  const apiKeyInput = byId("api_key");
  if (apiKeyInput) apiKeyInput.value = session.apiKey || "";

  const emailInput = byId("email");
  if (emailInput) emailInput.value = session.email || "";
}

/**
 * applyQueryParams – populate form inputs from URL search params.
 * Renamed from applyQueryParams_ (trailing underscore removed).
 * Old name kept as alias for backward compatibility.
 */
function applyQueryParams() {
  const params      = new URLSearchParams(window.location.search);
  const apiUrl      = params.get("api_url");
  const apiKey      = params.get("api_key");
  const email       = params.get("email");

  const apiUrlInput = byId("api_url");
  if (apiUrl && apiUrlInput) apiUrlInput.value = apiUrl;

  const apiKeyInput = byId("api_key");
  if (apiKey && apiKeyInput) apiKeyInput.value = apiKey;

  const emailInput = byId("email");
  if (email && emailInput) emailInput.value = email;
}
// Backward-compat alias
const applyQueryParams_ = applyQueryParams;

// ─── Session management ───────────────────────────────────────────────────────

function reloadSession() {
  // ✅ Uses SessionCache instead of raw localStorage read every call
  session = SessionCache.load();
  return session;
}

function resetSession() {
  session = { ...sessionDefaults };
  SessionCache.clear();

  if (window.CacheManager) CacheManager.invalidateAll?.();

  syncInputsFromSession();
  updateSessionUI();
}

// ─── API call ─────────────────────────────────────────────────────────────────

/**
 * apiCall – POST to GAS /exec endpoint.
 *
 * Optimizations:
 * - Uses SessionCache.load() instead of reloadSession() on every call
 *   (avoids synchronous localStorage I/O + JSON.parse each time)
 * - Auth error detection via AUTH_ERROR_SIGNALS constant
 * - Throws typed errors: "AUTH_ERROR" prefix so callers can distinguish
 */
/**
 * Returns true when the error is a network / HTTP-transport problem
 * (fetch failure, non-JSON body, redirect to Google login, etc.).
 *
 * These errors do NOT mean the GAS script failed — the script may have
 * already written to the Sheet before the response was lost.  Callers
 * that perform write operations should NOT rollback on these errors and
 * should instead reload from the server to discover the real state.
 */
function isNetworkOrResponseError(err) {
  if (!err) return false;
  const msg = String(err.message || "").toLowerCase();
  return (
    err.name === "TypeError" ||          // fetch() network failure
    msg.includes("failed to fetch") ||   // Chrome / Safari wording
    msg.includes("networkerror") ||      // Firefox wording
    msg.includes("load failed") ||       // iOS Safari wording
    msg.includes("syntaxerror") ||       // res.json() got HTML instead of JSON
    msg.includes("unexpected token") ||  // same
    msg.includes("json")                 // generic JSON parse failure
  );
}

async function apiCall(action, data = {}) {
  // ✅ Smart cache: only re-reads localStorage when TTL expired (~5 s)
  if (action !== "auth.login") {
    session = SessionCache.load();
  }

  if (!session.apiUrl) session.apiUrl = DEFAULT_API_URL;

  if (action !== "auth.login" && !session.apiKey) {
    throw new Error("API key is required. Please login again.");
  }

  const res = await fetch(session.apiUrl, {
    method  : "POST",
    headers : { "Content-Type": "text/plain;charset=utf-8" },
    body    : JSON.stringify({ action, api_key: session.apiKey, data }),
  });

  const json = await res.json();

  if (!json.success) {
    if (isAuthError(json.error)) {
      // Invalidate immediately so next load() re-reads from storage
      SessionCache.invalidate();
      resetSession();
      throw new Error("AUTH_ERROR: Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    }
    throw new Error(json.error || "Unknown API error");
  }

  return json.data;
}

/**
 * apiCallWithLoading – wraps an async fn with Loading show/hide.
 * Centralizes the pattern used in every page file.
 *
 * Usage:
 *   return apiCallWithLoading(async () => { ... }, "Đang tải...");
 */
async function apiCallWithLoading(fn, loadingMessage = "Đang tải...") {
  if (window.Loading) Loading.show(loadingMessage);
  try {
    return await fn();
  } finally {
    if (window.Loading) Loading.hide();
  }
}

// ─── Login ────────────────────────────────────────────────────────────────────

async function login() {
  session.apiUrl = DEFAULT_API_URL;
  session.apiKey = byId("api_key").value.trim();
  session.email  = byId("email").value.trim();
  const password = byId("password").value;

  if (!session.apiKey || !session.email || !password) {
    throw new Error("Vui lòng nhập đủ API KEY, email, password");
  }

  const data = await apiCall("auth.login", { email: session.email, password });

  session.token = data.token;
  session.email = data.email;
  session.role  = data.role;

  // ✅ SessionCache.save() updates both in-memory cache and localStorage
  SessionCache.save(session);

  if (window.CommonUtils) window.CommonUtils.session = session;

  updateSessionUI();
}

// ─── Global error boundary ───────────────────────────────────────────────────
/**
 * Catches unhandled JS errors and promise rejections.
 * Prevents white-screen-of-death; logs to console; handles auth errors.
 *
 * Pages can still use their own try/catch – this is a last-resort safety net.
 */
window.addEventListener("error", (event) => {
  const msg = event.error?.message || event.message || "";
  console.error("💥 [Global error]", event.error || msg);

  if (isAuthError(msg)) {
    alert("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    resetSession();
    window.location.reload();
    event.preventDefault();
    return;
  }

  // Non-auth errors: log but don't alert (don't spam user for every error)
  event.preventDefault();
});

window.addEventListener("unhandledrejection", (event) => {
  const msg = event.reason?.message || String(event.reason || "");
  console.error("💥 [Unhandled rejection]", event.reason);

  if (isAuthError(msg)) {
    alert("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    resetSession();
    window.location.reload();
    event.preventDefault();
    return;
  }

  // Surface auth-prefixed errors thrown by apiCall
  if (msg.startsWith("AUTH_ERROR:")) {
    alert(msg.replace("AUTH_ERROR: ", ""));
    event.preventDefault();
    return;
  }

  event.preventDefault();
});

// ─── Exports ─────────────────────────────────────────────────────────────────

window.CommonUtils = {
  DEFAULT_API_URL,
  WORKER_URL,
  sessionDefaults,
  // session getter/setter keeps live reference (page files use CommonUtils.session)
  get session()        { return session; },
  set session(value)   { session = value; },
  // Utilities
  byId,
  formatShortEmail,
  setSessionInfo,
  updateSessionUI,
  syncInputsFromSession,
  applyQueryParams,
  applyQueryParams_,    // backward compat
  resetSession,
  reloadSession,
  apiCall,
  apiCallWithLoading,
  formatPrice,
  login,
  // XSS
  escapeHtml,
  escapeAttr,
  sanitizeUrl,
  // Auth
  isAuthError,
  AUTH_ERROR_SIGNALS,
  // Session
  SessionCache,
};

// Global scope exports (page files use these directly without CommonUtils prefix)
window.byId                  = byId;
window.formatShortEmail      = formatShortEmail;
window.setSessionInfo        = setSessionInfo;
window.updateSessionUI       = updateSessionUI;
window.syncInputsFromSession = syncInputsFromSession;
window.applyQueryParams      = applyQueryParams;
window.applyQueryParams_     = applyQueryParams_;   // backward compat
window.resetSession          = resetSession;
window.reloadSession         = reloadSession;
window.apiCall               = apiCall;
window.apiCallWithLoading    = apiCallWithLoading;
window.formatPrice           = formatPrice;
window.login                 = login;
window.escapeHtml            = escapeHtml;
window.escapeAttr            = escapeAttr;
window.sanitizeUrl           = sanitizeUrl;
window.isAuthError           = isAuthError;
window.PAGINATION            = PAGINATION;

// Preserve original resetSession so page files can call
// window._originalResetSession() before their own cleanup
window._originalResetSession = resetSession;

// ─── Toast ────────────────────────────────────────────────────────────────────
// Lightweight non-blocking notification. Used by optimistic save flow.
// Usage: Toast.show("message", "info"|"success"|"error", durationMs)
//        Toast.show("Đang lưu...", "info", 0)  // 0 = persistent until hide()
//        Toast.hide()
const Toast = (() => {
  let _timer = null;

  const PALETTE = {
    info:    { bg: '#1e293b', text: '#f1f5f9', border: '#64748b' },
    success: { bg: '#14532d', text: '#dcfce7', border: '#22c55e' },
    error:   { bg: '#7f1d1d', text: '#fee2e2', border: '#ef4444' },
  };

  function _container() {
    let el = document.getElementById('_toast_wrap');
    if (!el) {
      el = document.createElement('div');
      el.id = '_toast_wrap';
      Object.assign(el.style, {
        position: 'fixed', bottom: '24px', right: '24px',
        zIndex: '99999', pointerEvents: 'none',
      });
      document.body.appendChild(el);
    }
    return el;
  }

  function show(message, type = 'info', duration = 3000) {
    hide();
    const p = PALETTE[type] || PALETTE.info;
    const el = document.createElement('div');
    el.id = '_toast_el';
    Object.assign(el.style, {
      background: p.bg, color: p.text,
      borderLeft: `4px solid ${p.border}`,
      padding: '10px 16px', borderRadius: '8px',
      fontSize: '13px', fontWeight: '500',
      boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
      maxWidth: '320px', pointerEvents: 'auto',
      opacity: '0', transform: 'translateY(6px)',
      transition: 'opacity 0.18s ease, transform 0.18s ease',
    });
    el.textContent = message;
    _container().appendChild(el);
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    });
    if (duration > 0) _timer = setTimeout(hide, duration);
  }

  function hide() {
    if (_timer) { clearTimeout(_timer); _timer = null; }
    const el = document.getElementById('_toast_el');
    if (el) el.remove();
  }

  return { show, hide };
})();

window.Toast = Toast;
window.isNetworkOrResponseError = isNetworkOrResponseError;