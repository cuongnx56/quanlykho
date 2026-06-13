/**
 * Common utilities and functions for shop pages
 */

// Configuration - Update these values
const SHOP_CONFIG = {
  WORKER_URL: "https://quanlykho-api.nguyenxuancuongk56.workers.dev",
  PUBLIC_API_KEY: "bb90c3e7-c5bf-4276-9539-3a509667c540" // ⚠️ Replace with your actual API key
};

// Initialize ShopAPI
let shopAPI;

// Cart management (shared across pages)
let cart = JSON.parse(localStorage.getItem('shop_cart') || '[]');

/**
 * Initialize ShopAPI
 */
function initShopAPI() {
  if (!shopAPI) {
    shopAPI = new ShopAPI({
      workerUrl: SHOP_CONFIG.WORKER_URL,
      publicApiKey: SHOP_CONFIG.PUBLIC_API_KEY
    });
  }
  return shopAPI;
}

/**
 * Save cart to localStorage
 */
function saveCart() {
  localStorage.setItem('shop_cart', JSON.stringify(cart));
}

/**
 * Get cart item count
 */
function getCartCount() {
  return cart.reduce((sum, item) => sum + item.qty, 0);
}

/**
 * Update cart badge in header
 */
function updateCartBadge() {
  const badge = document.getElementById('cart-badge');
  if (badge) {
    const count = getCartCount();
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline-block' : 'none';
  }
}

/**
 * Format price
 */
function formatPrice(price) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND'
  }).format(price);
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Get product title
 */
function getProductTitle(product) {
  return product.title || product.name || 'Sản phẩm không tên';
}

/**
 * Get product price
 */
function getProductPrice(product) {
  const raw = product.price || 0;
  if (typeof raw === 'string') {
    const cleaned = raw.replace(/[^\d.]/g, '');
    return Number(cleaned || 0);
  }
  return Number(raw || 0);
}

/**
 * Get product stock
 */
function getProductStock(product) {
  const qty = product.amount_in_stock;
  if (qty !== undefined && qty !== '') return Number(qty || 0);
  return 0;
}

/**
 * Get image source (handles both URL and Base64)
 */
function getImageSource(imageLink) {
  if (!imageLink) return '';
  if (imageLink.startsWith('data:image') || imageLink.startsWith('base64:')) {
    return imageLink.replace('base64:', 'data:image/jpeg;base64,');
  }
  return imageLink;
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  
  toast.textContent = message;
  toast.className = `toast toast-${type} show`;
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

/**
 * Format date to yyyy-MM-dd HH:mm:ss (GAS format)
 * @param {Date|string} date - Date object or ISO string
 * @returns {string} Formatted date string
 */
function formatDateForGAS(date) {
  const d = date instanceof Date ? date : new Date(date);
  
  // Get local date components
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Initialize footer subscribe form
 * Call this after footer is loaded
 */
function initFooterSubscribeForm() {
  const subscribeForm = document.getElementById('footer-subscribe-form');
  if (!subscribeForm) {
    setTimeout(initFooterSubscribeForm, 100);
    return;
  }
  
  if (subscribeForm.dataset.initialized === 'true') {
    return;
  }
  subscribeForm.dataset.initialized = 'true';
  
  const subscribeEmail = document.getElementById('subscribe-email');
  const subscribeBtn = document.getElementById('subscribe-btn');
  const subscribeBtnText = subscribeBtn?.querySelector('.subscribe-btn-text');
  const subscribeBtnLoading = subscribeBtn?.querySelector('.subscribe-btn-loading');
  const subscribeMessage = document.getElementById('subscribe-message');
  
  function setSubscribeLoading(loading) {
    if (!subscribeBtn || !subscribeBtnText || !subscribeBtnLoading) return;
    
    subscribeBtn.disabled = loading;
    if (loading) {
      subscribeBtnText.style.display = 'none';
      subscribeBtnLoading.style.display = 'inline-block';
    } else {
      subscribeBtnText.style.display = 'inline-block';
      subscribeBtnLoading.style.display = 'none';
    }
  }
  
  function showSubscribeMessage(message, type = 'info') {
    if (!subscribeMessage) return;
    
    subscribeMessage.textContent = message;
    subscribeMessage.className = `subscribe-message ${type}`;
    
    if (type === 'success') {
      setTimeout(() => {
        if (subscribeMessage.textContent === message) {
          subscribeMessage.textContent = '';
          subscribeMessage.className = 'subscribe-message';
        }
      }, 5000);
    }
  }
  
  async function handleSubmit(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    const email = subscribeEmail.value.trim();
    
    if (!email) {
      showSubscribeMessage('Vui lòng nhập email của bạn', 'error');
      return false;
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      showSubscribeMessage('Email không hợp lệ', 'error');
      return false;
    }
    
    setSubscribeLoading(true);
    showSubscribeMessage('Đang xử lý...', 'info');
    
    try {
      if (typeof initShopAPI === 'function') {
        initShopAPI();
      }
      
      if (typeof shopAPI !== 'undefined' && shopAPI.createLead) {
        await shopAPI.createLead({ email: email });
        
        showSubscribeMessage('✅ Đăng ký thành công! Cảm ơn bạn đã quan tâm.', 'success');
        subscribeForm.reset();
        
        if (typeof showToast === 'function') {
          showToast('Đăng ký nhận tin thành công!', 'success');
        }
      } else {
        throw new Error('ShopAPI không khả dụng');
      }
    } catch (error) {
      console.error('Error subscribing:', error);
      showSubscribeMessage('❌ Có lỗi xảy ra. Vui lòng thử lại sau.', 'error');
      
      if (typeof showToast === 'function') {
        showToast('Đăng ký thất bại. Vui lòng thử lại.', 'error');
      }
    } finally {
      setSubscribeLoading(false);
    }
    
    return false;
  }
  
  subscribeForm.addEventListener('submit', handleSubmit, true);
  
  if (subscribeBtn) {
    subscribeBtn.addEventListener('click', handleSubmit, false);
  }
}

/**
 * Initialize footer contact form
 * Call this after footer is loaded
 */
function initFooterContactForm() {
  const contactForm = document.getElementById('footer-contact-form');
  if (!contactForm) {
    setTimeout(initFooterContactForm, 100);
    return;
  }
  
  if (contactForm.dataset.initialized === 'true') {
    return;
  }
  contactForm.dataset.initialized = 'true';
  
  const contactName = document.getElementById('contact-name');
  const contactEmail = document.getElementById('contact-email');
  const contactMessage = document.getElementById('contact-message');
  const contactSubmitBtn = contactForm.querySelector('button[type="submit"]');
  
  async function handleSubmit(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    const name = contactName.value.trim();
    const email = contactEmail.value.trim();
    const message = contactMessage.value.trim();
    
    if (!name) {
      if (typeof showToast === 'function') {
        showToast('Vui lòng nhập họ tên', 'error');
      }
      return false;
    }
    
    if (!email) {
      if (typeof showToast === 'function') {
        showToast('Vui lòng nhập email', 'error');
      }
      return false;
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      if (typeof showToast === 'function') {
        showToast('Email không hợp lệ', 'error');
      }
      return false;
    }
    
    if (!message) {
      if (typeof showToast === 'function') {
        showToast('Vui lòng nhập tin nhắn', 'error');
      }
      return false;
    }
    
    if (contactSubmitBtn) {
      contactSubmitBtn.disabled = true;
      const originalText = contactSubmitBtn.textContent;
      contactSubmitBtn.textContent = 'Đang gửi...';
      
      try {
        if (typeof initShopAPI === 'function') {
          initShopAPI();
        }
        
        if (typeof shopAPI !== 'undefined' && shopAPI.createLead) {
          await shopAPI.createLead({
            name: name,
            email: email,
            phone: '',
            note: message
          });
          
          if (typeof showToast === 'function') {
            showToast('✅ Cảm ơn bạn đã liên hệ! Chúng tôi sẽ phản hồi sớm nhất.', 'success');
          }
          contactForm.reset();
        } else {
          throw new Error('ShopAPI không khả dụng');
        }
      } catch (error) {
        console.error('Error submitting contact form:', error);
        if (typeof showToast === 'function') {
          showToast('❌ Có lỗi xảy ra. Vui lòng thử lại sau.', 'error');
        }
      } finally {
        if (contactSubmitBtn) {
          contactSubmitBtn.disabled = false;
          contactSubmitBtn.textContent = originalText;
        }
      }
    }
    
    return false;
  }
  
  contactForm.addEventListener('submit', handleSubmit, true);
  
  if (contactSubmitBtn) {
    contactSubmitBtn.addEventListener('click', handleSubmit, false);
  }
}

/**
 * Render categories into dropdown menu
 * @param {Array|Object} categories - Categories array or object with items
 * @param {HTMLElement} menu - Menu element (optional, will find by ID if not provided)
 */
function renderCategoriesMenu(categories, menu = null) {
  const menuElement = menu || document.getElementById('categories-menu');
  if (!menuElement || !categories) return;
  
  // Handle both array and object response formats
  let items = [];
  if (Array.isArray(categories)) {
    items = categories;
  } else if (categories.items && Array.isArray(categories.items)) {
    items = categories.items;
  } else if (categories.data && Array.isArray(categories.data.items)) {
    items = categories.data.items;
  } else {
    return;
  }
  
  // Clear existing category items (keep "Tất cả sản phẩm" and divider)
  const divider = menuElement.querySelector('.dropdown-divider');
  if (divider) {
    // Remove all items after divider (these are the category items)
    let next = divider.nextElementSibling;
    while (next) {
      const toRemove = next;
      next = next.nextElementSibling;
      toRemove.remove();
    }
  } else {
    // If no divider, remove all items except first one ("Tất cả sản phẩm")
    const allItems = menuElement.querySelectorAll('.dropdown-item');
    for (let i = 1; i < allItems.length; i++) {
      allItems[i].remove();
    }
  }
  
  items.forEach(category => {
    // Handle both object and string formats
    const categoryName = typeof category === 'string' 
      ? category 
      : (category.name || category.id || String(category));
    const categoryValue = typeof category === 'string'
      ? category
      : (category.id || category.name || String(category));
    
    if (!categoryName) return;
    
    const link = document.createElement('a');
    link.href = `index.html?category=${encodeURIComponent(categoryValue)}`;
    link.className = 'dropdown-item';
    link.textContent = categoryName;
    menuElement.appendChild(link);
  });
}

/**
 * Load and render categories menu
 * Call this after ShopAPI is initialized
 * Will retry if menu element is not ready
 */
async function loadAndRenderCategories(retryCount = 0) {
  const maxRetries = 10;
  const retryDelay = 100;
  
  try {
    // Check if menu element exists
    const menu = document.getElementById('categories-menu');
    if (!menu) {
      if (retryCount < maxRetries) {
        setTimeout(() => loadAndRenderCategories(retryCount + 1), retryDelay);
        return;
      }
      console.warn('Categories menu element not found after retries');
      return;
    }
    
    if (typeof shopAPI === 'undefined' || !shopAPI.loadCategories) {
      if (typeof initShopAPI === 'function') {
        initShopAPI();
      }
    }
    
    if (typeof shopAPI !== 'undefined' && shopAPI.loadCategories) {
      const categories = await shopAPI.loadCategories();
      if (categories) {
        renderCategoriesMenu(categories, menu);
      }
    }
  } catch (error) {
    console.error('Error loading categories:', error);
    // Retry on error if haven't exceeded max retries
    if (retryCount < maxRetries) {
      setTimeout(() => loadAndRenderCategories(retryCount + 1), retryDelay);
    }
  }
}

/**
 * Setup dropdown toggle for categories menu
 * Call this after DOM is ready
 * Will retry if elements are not ready
 */
function setupCategoriesDropdown(retryCount = 0) {
  const maxRetries = 10;
  const retryDelay = 100;
  
  const dropdown = document.getElementById('categories-dropdown');
  const menu = document.getElementById('categories-menu');
  
  if (!dropdown || !menu) {
    if (retryCount < maxRetries) {
      setTimeout(() => setupCategoriesDropdown(retryCount + 1), retryDelay);
      return;
    }
    console.warn('Categories dropdown elements not found');
    return;
  }
  
  // Check if already initialized
  if (dropdown.dataset.initialized === 'true') {
    return;
  }
  dropdown.dataset.initialized = 'true';
  
  // Toggle dropdown on button click
  dropdown.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    menu.classList.toggle('show');
  });
  
  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && !menu.contains(e.target)) {
      menu.classList.remove('show');
    }
  });
  
  // Close dropdown when clicking on a category link
  menu.addEventListener('click', (e) => {
    if (e.target.classList.contains('dropdown-item')) {
      menu.classList.remove('show');
    }
  });
}

/**
 * Initialize on page load
 */
document.addEventListener('DOMContentLoaded', () => {
  initShopAPI();
  updateCartBadge();
  
  // Setup categories dropdown after a short delay to ensure DOM is ready
  setTimeout(() => {
    setupCategoriesDropdown();
  }, 50);
});
