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
    const cacheKey = "settings_list";
    let settings = CacheManager.get(cacheKey);
    
    if (!settings) {
      settings = await apiCall("settings.list", {
        token: session.token
      });
      CacheManager.set(cacheKey, settings, 300); // 5 minutes
    }
    
    currentSettings = settings;
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
    
    const updatedSettings = await apiCall("settings.update", {
      token: session.token,
      settings: formData
    });
    
    // Invalidate cache
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
    alert(`❌ Lỗi: ${err.message}`);
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
