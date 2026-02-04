/**
 * Common utilities for admin pages
 * Shared functions across all admin pages
 */

// Constants
const DEFAULT_API_URL = "https://script.google.com/macros/s/AKfycbzs7FiPxCy0Offo90kG3MqrfkgjilhI25AsrEh09TzF7A_PPsxs3C_Xq4ifCLKiQdIR/exec";

const sessionDefaults = {
  apiUrl: DEFAULT_API_URL,
  apiKey: "",
  token: "",
  email: "",
  role: ""
};

// Initialize session from AuthSession or defaults
let session = window.AuthSession ? window.AuthSession.load(sessionDefaults) : { ...sessionDefaults };

/**
 * Reload session from localStorage
 * Call this when page loads to ensure session is up to date
 */
function reloadSession() {
  session = window.AuthSession ? window.AuthSession.load(sessionDefaults) : { ...sessionDefaults };
  return session;
}

/**
 * Get element by ID
 */
function byId(id) {
  return document.getElementById(id);
}

/**
 * Format email to short format: cuo...gmail.com
 */
function formatShortEmail(email) {
  if (!email) return "";
  const atIndex = email.indexOf("@");
  if (atIndex === -1) return email;
  
  const localPart = email.substring(0, atIndex);
  const domain = email.substring(atIndex + 1);
  
  if (localPart.length <= 3) {
    return email; // Email quá ngắn, không cần rút gọn
  }
  
  // Lấy 3 ký tự đầu + ... + domain
  return `${localPart.substring(0, 3)}...${domain}`;
}

/**
 * Set session info text
 */
function setSessionInfo(text) {
  const el = byId("session-info");
  if (el) el.textContent = text;
}

/**
 * Update session UI (login/logout state)
 */
function updateSessionUI() {
  const logoutBtn = byId("btn-logout");
  const loginSection = byId("login-section");
  
  if (session.token) {
    const shortEmail = formatShortEmail(session.email);
    setSessionInfo(`${shortEmail} (${session.role})`);
    if (logoutBtn) logoutBtn.classList.remove("hidden");
    if (loginSection) loginSection.classList.add("hidden");
  } else {
    setSessionInfo("Chưa đăng nhập");
    if (logoutBtn) logoutBtn.classList.add("hidden");
    if (loginSection) loginSection.classList.remove("hidden");
  }
}

/**
 * Sync inputs from session
 */
function syncInputsFromSession() {
  const apiUrlInput = document.getElementById("api_url");
  if (apiUrlInput) apiUrlInput.value = session.apiUrl || DEFAULT_API_URL;
  
  const apiKeyInput = byId("api_key");
  if (apiKeyInput) apiKeyInput.value = session.apiKey || "";
  
  const emailInput = byId("email");
  if (emailInput) emailInput.value = session.email || "";
}

/**
 * Apply query parameters to inputs
 */
function applyQueryParams_() {
  const params = new URLSearchParams(window.location.search);
  const apiUrl = params.get("api_url");
  const apiKey = params.get("api_key");
  const email = params.get("email");
  
  const apiUrlInput = document.getElementById("api_url");
  if (apiUrl && apiUrlInput) apiUrlInput.value = apiUrl;
  
  if (apiKey) {
    const apiKeyInput = byId("api_key");
    if (apiKeyInput) apiKeyInput.value = apiKey;
  }
  
  if (email) {
    const emailInput = byId("email");
    if (emailInput) emailInput.value = email;
  }
}

/**
 * Reset session (logout)
 */
function resetSession() {
  session = window.AuthSession ? window.AuthSession.defaults(sessionDefaults) : { ...sessionDefaults };
  if (window.AuthSession) {
    window.AuthSession.clear();
  }
  
  // Clear cache when logout
  if (window.CacheManager) {
    CacheManager.invalidateAll();
  }
  
  syncInputsFromSession();
  updateSessionUI();
}

/**
 * API call helper
 */
async function apiCall(action, data = {}) {
  // ✅ Reload session from localStorage before each API call to ensure token is fresh
  // BUT: Skip reload for auth.login (apiKey is not yet saved to localStorage)
  if (action !== "auth.login") {
    reloadSession();
  }
  
  if (!session.apiUrl) {
    session.apiUrl = DEFAULT_API_URL;
  }
  
  // ✅ Ensure apiKey is available (skip check for auth.login as it's provided in form)
  if (action !== "auth.login" && !session.apiKey) {
    throw new Error("API key is required. Please login again.");
  }
  
  const res = await fetch(session.apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify({
      action,
      api_key: session.apiKey,
      data
    })
  });
  
  const json = await res.json();
  if (!json.success) {
    // ✅ Handle token expiration errors
    if (json.error && (json.error.includes("Token expired") || json.error.includes("Unauthorized"))) {
      // Clear session and prompt user to login again
      resetSession();
      throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    }
    throw new Error(json.error);
  }
  return json.data;
}

/**
 * Format price to VND currency
 */
function formatPrice(price) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND'
  }).format(price || 0);
}

/**
 * Login function - shared across all pages
 */
async function login() {
  session.apiUrl = DEFAULT_API_URL;
  session.apiKey = byId("api_key").value.trim();
  session.email = byId("email").value.trim();
  const password = byId("password").value;

  if (!session.apiKey || !session.email || !password) {
    throw new Error("Vui lòng nhập đủ API KEY, email, password");
  }

  const data = await apiCall("auth.login", {
    email: session.email,
    password
  });

  session.token = data.token;
  session.email = data.email;
  session.role = data.role;
  
  // Save to AuthSession
  if (window.AuthSession) {
    window.AuthSession.save(session);
  }
  
  // Update common session
  if (window.CommonUtils) {
    window.CommonUtils.session = session;
  }
  
  updateSessionUI();
}

// Cloudflare Worker URL for READ operations
// Set this to your deployed Cloudflare Worker URL
// Example: https://products-api.your-subdomain.workers.dev
// Leave null to disable Worker (will use GAS only)
const WORKER_URL = "https://quanlykho-api.nguyenxuancuongk56.workers.dev"; // TODO: Set your Cloudflare Worker URL here

// Export to window for global access
// Note: DEFAULT_API_URL, sessionDefaults, and session are already in global scope
// We export them to CommonUtils for reference, but they're also available directly
window.CommonUtils = {
  DEFAULT_API_URL,
  WORKER_URL,
  sessionDefaults,
  get session() { return session; }, // Getter to always return current session
  set session(value) { session = value; }, // Setter to update session
  byId,
  formatShortEmail,
  setSessionInfo,
  updateSessionUI,
  syncInputsFromSession,
  applyQueryParams_,
  resetSession,
  apiCall,
  formatPrice,
  login,
  reloadSession
};

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  if (text == null) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

// Make functions globally available
// Note: resetSession is exported but can be overridden by individual pages
window.byId = byId;
window.formatShortEmail = formatShortEmail;
window.setSessionInfo = setSessionInfo;
window.updateSessionUI = updateSessionUI;
window.syncInputsFromSession = syncInputsFromSession;
window.applyQueryParams_ = applyQueryParams_;
window.resetSession = resetSession;
window.apiCall = apiCall;
window.formatPrice = formatPrice;
window.escapeHtml = escapeHtml;
window.login = login;
window.reloadSession = reloadSession;

// Store original resetSession for pages that want to extend it
window._originalResetSession = resetSession;
