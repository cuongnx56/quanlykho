/**
 * Settings Management
 */

let currentSettings = {};

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
      await loadSettings();
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
  
  byId("settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    await saveSettings();
  });
  
  byId("btn-cancel").addEventListener("click", () => {
    loadSettings(); // Reload to reset form
  });
  
  // Initialize WorkerAPI if configured
  if (window.WorkerAPI && window.CommonUtils && window.CommonUtils.WORKER_URL) {
    WorkerAPI.init(window.CommonUtils.WORKER_URL);
    console.log("✅ WorkerAPI initialized for READ operations");
  } else if (window.WorkerAPI) {
    console.log("ℹ️ WorkerAPI available but WORKER_URL not configured. Using GAS only.");
  }
  
  // Load settings if already logged in
  if (session.token && session.apiKey) {
    await loadSettings();
  }
});

async function loadSettings() {
  if (!session.token || !session.apiKey) {
    byId("login-section").classList.remove("hidden");
    byId("settings-section").style.display = "none";
    return;
  }
  
  byId("login-section").classList.add("hidden");
  byId("settings-section").style.display = "block";
  
  Loading.show("Đang tải cài đặt...");
  try {
    // ✅ Step 1: Check frontend cache first (localStorage)
    const cacheKey = CacheManager.key("settings", "list");
    let settings = CacheManager.get(cacheKey);
    
    if (settings) {
      console.log("📦 Using cached settings data (localStorage)");
      currentSettings = settings;
      populateForm(settings);
      Loading.hide();
      return;
    }
    
    // ✅ Step 2: Try Cloudflare Worker first (fast, edge network)
    if (WorkerAPI && WorkerAPI.isConfigured()) {
      try {
        console.log("🚀 Trying Cloudflare Worker for settings.list...");
        const result = await WorkerAPI.settingsList();
        
        if (result && result.data) {
          console.log("✅ Worker cache HIT! Loaded from Cloudflare KV");
          settings = result.data;
        } else {
          console.log("⚠️ Worker cache MISS, falling back to GAS");
        }
      } catch (error) {
        console.error("⚠️ Worker error:", error);
        console.log("Falling back to GAS...");
      }
    }
    
    // ✅ Step 3: Fallback to GAS if Worker fails or cache miss
    if (!settings) {
      console.log("📡 Fetching from GAS /exec endpoint...");
      settings = await apiCall("settings.list", {
        token: session.token
      });
    }
    
    currentSettings = settings;
    
    // Save to frontend cache
    CacheManager.set(cacheKey, settings);
    
    populateForm(settings);
  } catch (err) {
    alert(`❌ Lỗi: ${err.message}`);
  } finally {
    Loading.hide();
  }
}

function populateForm(settings) {
  // Shop info
  byId("shop_name").value = settings.shop_name || "";
  byId("shop_address").value = settings.shop_address || "";
  byId("shop_phone").value = settings.shop_phone || "";
  byId("shop_email").value = settings.shop_email || "";
  byId("shop_tax_code").value = settings.shop_tax_code || "";
  byId("currency").value = settings.currency || "VND";
}

async function saveSettings() {
  if (!session.token || !session.apiKey) {
    alert("Vui lòng đăng nhập trước");
    return;
  }
  
  const btn = byId("btn-save");
  Loading.button(btn, true);
  
  try {
    const formData = {
      shop_name: byId("shop_name").value.trim(),
      shop_address: byId("shop_address").value.trim(),
      shop_phone: byId("shop_phone").value.trim(),
      shop_email: byId("shop_email").value.trim(),
      shop_tax_code: byId("shop_tax_code").value.trim(),
      currency: byId("currency").value
    };
    
    // Validate required fields
    if (!formData.shop_name) {
      alert("Vui lòng nhập tên cửa hàng");
      return;
    }
    
    // ✅ Reload session from localStorage to ensure token is up to date
    reloadSession();
    
    const updatedSettings = await apiCall("settings.update", {
      token: session.token,
      settings: formData
    });
    
    // ✅ Clear ALL cache after write action (update settings)
    CacheManager.clearAllCache();
    
    // ✅ Also invalidate all caches to be thorough
    CacheManager.invalidateAll();
    
    // Update current settings
    currentSettings = updatedSettings;
    
    // Show success message
    showSuccessMessage("✅ Đã lưu cài đặt thành công!");
    
    // Reload to ensure consistency
    setTimeout(() => {
      loadSettings();
    }, 1000);
    
  } catch (err) {
    // ✅ Handle token expiration - prompt user to login again
    if (err.message && (err.message.includes("Token expired") || err.message.includes("Unauthorized") || err.message.includes("hết hạn"))) {
      alert("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
      resetSession();
      window.location.reload();
    } else {
      alert(`❌ Lỗi: ${err.message}`);
    }
  } finally {
    Loading.button(btn, false);
  }
}

function showSuccessMessage(message) {
  // Create or update success message element
  let successMsg = byId("success-message");
  if (!successMsg) {
    successMsg = document.createElement("div");
    successMsg.id = "success-message";
    successMsg.className = "success-message";
    const form = byId("settings-form");
    form.insertBefore(successMsg, form.firstChild);
  }
  
  successMsg.textContent = message;
  successMsg.classList.add("show");
  
  // Hide after 3 seconds
  setTimeout(() => {
    successMsg.classList.remove("show");
  }, 3000);
}

// Reset session function
function resetSession() {
  if (window._originalResetSession) {
    window._originalResetSession();
  }
  CacheManager.invalidateAll();
}
