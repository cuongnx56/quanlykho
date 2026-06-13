/**
 * Shop Application - Main JavaScript
 * Uses ShopAPI for all API operations
 */

// Use common.js for configuration
let products = [];
let currentPage = 1;
let currentSearch = '';

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  // Initialize ShopAPI from common.js
  shopAPI = initShopAPI();
  
  // Load cart from localStorage
  cart = JSON.parse(localStorage.getItem('shop_cart') || '[]');
  
  // Initialize app
  init();
});

/**
 * Initialize application
 */
async function init() {
  setupEventListeners();
  await loadProducts();
}

/**
 * Setup all event listeners
 */
function setupEventListeners() {
  // Cart toggle
  const cartToggle = document.getElementById('cart-toggle');
  const cartClose = document.getElementById('cart-close');
  const cartOverlay = document.getElementById('cart-overlay');
  
  if (cartToggle) cartToggle.addEventListener('click', toggleCart);
  if (cartClose) cartClose.addEventListener('click', closeCart);
  if (cartOverlay) cartOverlay.addEventListener('click', closeCart);

  // Search
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');
  
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSearch();
  });
  searchBtn.addEventListener('click', handleSearch);

  // Clear search when input is emptied
  searchInput.addEventListener('input', () => {
    if (searchInput.value.trim() === '' && currentSearch !== '') {
      currentSearch = '';
      currentPage = 1;
      loadProducts();
    }
  });

  // Checkout
  document.getElementById('checkout-btn').addEventListener('click', openCheckoutModal);
  document.getElementById('modal-close').addEventListener('click', closeCheckoutModal);
  document.getElementById('cancel-btn').addEventListener('click', closeCheckoutModal);
  document.getElementById('checkout-form').addEventListener('submit', handleCheckout);

  // Retry button
  const retryBtn = document.getElementById('retry-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      currentSearch ? handleSearch() : loadProducts();
    });
  }
}

/**
 * Load products
 */
async function loadProducts() {
  const grid = document.getElementById('products-grid');
  const loadingState = document.getElementById('loading-state');
  const errorState = document.getElementById('error-state');
  const emptyState = document.getElementById('empty-state');
  const pagination = document.getElementById('pagination');
  
  // Show loading
  showLoading();
  
  try {
    products = await shopAPI.loadProducts({
      page: currentPage,
      limit: 20,
      inStockOnly: true
    });
    
    // Hide loading
    hideLoading();
    
    if (products.length === 0) {
      showEmpty();
      grid.innerHTML = '';
      pagination.style.display = 'none';
    } else {
      hideEmpty();
      
      // ✅ Cache products list to localStorage for fast product detail lookup (5 minutes TTL)
      try {
        const cacheData = {
          products: products,
          timestamp: Date.now(),
          ttl: 5 * 60 * 1000 // 5 minutes
        };
        localStorage.setItem('shop_products_cache', JSON.stringify(cacheData));
        console.log('✅ Cached products list to localStorage (TTL: 5 minutes)');
      } catch (err) {
        console.warn('Could not cache products to localStorage:', err);
      }
      
      renderProducts();
      updateProductsCount();
    }
    
  } catch (error) {
    console.error('Error loading products:', error);
    showError(error.message || 'Không thể tải sản phẩm. Vui lòng thử lại.');
    grid.innerHTML = '';
    pagination.style.display = 'none';
  }
}

/**
 * Render products grid
 */
function renderProducts() {
  const grid = document.getElementById('products-grid');
  
  grid.innerHTML = products.map(product => {
    const stock = getProductStock(product);
    const price = getProductPrice(product);
    const title = getProductTitle(product);
    const image = product['image link'] || product.image || '';
    const productId = product.id || product._id || '';
    
    if (!productId) {
      console.warn('Product missing ID:', product);
      return ''; // Skip products without ID
    }
    
    // Use /product?id=... so server can keep clean URL (/product) via rewrite rules
    const productUrl = `product?id=${encodeURIComponent(productId)}`;
    
    return `
      <div class="product-card" data-product-id="${productId}">
        <a href="${productUrl}" class="product-card-link">
          ${image ? `<div class="product-image">
            <img src="${getImageSource(image)}" alt="${title}" loading="lazy" onerror="this.style.display='none'">
          </div>` : ''}
          <div class="product-info">
            <h3 class="product-title">${escapeHtml(title)}</h3>
            ${product.description ? `<p class="product-description">${escapeHtml(product.description.substring(0, 100))}${product.description.length > 100 ? '...' : ''}</p>` : ''}
            <div class="product-footer">
              <div class="product-price">${formatPrice(price)}</div>
              <div class="product-stock ${stock > 0 ? 'in-stock' : 'out-of-stock'}">
                ${stock > 0 ? `Còn ${stock} sản phẩm` : 'Hết hàng'}
              </div>
            </div>
          </div>
        </a>
        <button 
          class="btn-add-to-cart" 
          onclick="addToCart('${productId}', event); event.stopPropagation(); event.preventDefault();"
          ${stock <= 0 ? 'disabled' : ''}
        >
          ${stock > 0 ? 'Thêm vào giỏ' : 'Hết hàng'}
        </button>
      </div>
    `;
  }).join('');
}

/**
 * Update products count
 */
function updateProductsCount() {
  const countEl = document.getElementById('products-count');
  countEl.textContent = `${products.length} sản phẩm`;
}

/**
 * Handle search using searchProducts (from all products cached in localStorage)
 */
async function handleSearch() {
  const searchInput = document.getElementById('search-input');
  const query = searchInput.value.trim();
  currentSearch = query;
  currentPage = 1;

  if (!query) {
    await loadProducts();
    return;
  }

  showLoading();
  try {
    products = await shopAPI.searchProducts(query, { limit: 100 });
    hideLoading();

    const grid = document.getElementById('products-grid');
    const pagination = document.getElementById('pagination');

    if (products.length === 0) {
      showEmpty();
      grid.innerHTML = '';
    } else {
      hideEmpty();
      renderProducts();
      updateProductsCount();
    }
    pagination.style.display = 'none';
  } catch (error) {
    console.error('Search error:', error);
    showError('Không thể tìm kiếm. Vui lòng thử lại.');
  }
}

/**
 * Add product to cart
 */
function addToCart(productId, event) {
  if (event) event.stopPropagation();
  
  const product = products.find(p => p.id === productId);
  if (!product) return;
  
  const stock = getProductStock(product);
  if (stock <= 0) {
    showToast('Sản phẩm đã hết hàng', 'error');
    return;
  }
  
  const cartItem = cart.find(item => item.id === productId);
  
  if (cartItem) {
    if (cartItem.qty < stock) {
      cartItem.qty++;
    } else {
      showToast('Không đủ hàng trong kho', 'error');
      return;
    }
  } else {
    cart.push({
      id: product.id,
      name: getProductTitle(product),
      price: getProductPrice(product),
      qty: 1,
      stock: stock,
      image: getImageSource(product['image link'] || product.image || '')
    });
  }
  
  saveCart();
  updateCart();
  updateCartBadge();
  showToast('Đã thêm vào giỏ hàng', 'success');
  
  // Open cart if closed
  const cartSidebar = document.getElementById('cart-sidebar');
  if (cartSidebar && !cartSidebar.classList.contains('active')) {
    toggleCart();
  }
}

/**
 * Remove from cart
 */
function removeFromCart(productId) {
  cart = cart.filter(item => item.id !== productId);
  saveCart();
  updateCart();
  updateCartBadge();
  showToast('Đã xóa khỏi giỏ hàng', 'info');
}

/**
 * Change quantity
 */
function changeQty(productId, delta) {
  const cartItem = cart.find(item => item.id === productId);
  if (!cartItem) return;
  
  const product = products.find(p => p.id === productId);
  const stock = product ? getProductStock(product) : cartItem.stock;
  
  cartItem.qty += delta;
  
  if (cartItem.qty <= 0) {
    removeFromCart(productId);
    return;
  }
  
  if (cartItem.qty > stock) {
    showToast('Không đủ hàng trong kho', 'error');
    cartItem.qty = stock;
  }
  
  saveCart();
  updateCart();
  updateCartBadge();
}

/**
 * Update cart UI
 */
function updateCart() {
  const cartItems = document.getElementById('cart-items');
  const cartTotal = document.getElementById('cart-total');
  const checkoutBtn = document.getElementById('checkout-btn');
  
  if (!cartItems) return;
  
  const totalPrice = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  
  // Update total
  if (cartTotal) cartTotal.textContent = formatPrice(totalPrice);
  
  // Update items
  if (cart.length === 0) {
    cartItems.innerHTML = '<div class="cart-empty"><p>Giỏ hàng trống</p></div>';
    if (checkoutBtn) checkoutBtn.disabled = true;
  } else {
    cartItems.innerHTML = cart.map(item => `
      <div class="cart-item">
        ${item.image ? `<img src="${item.image}" alt="${escapeHtml(item.name)}" class="cart-item-image">` : ''}
        <div class="cart-item-info">
          <div class="cart-item-name">${escapeHtml(item.name)}</div>
          <div class="cart-item-price">${formatPrice(item.price)}</div>
        </div>
        <div class="cart-item-controls">
          <button class="qty-btn" onclick="changeQty('${item.id}', -1)">−</button>
          <span class="qty-value">${item.qty}</span>
          <button class="qty-btn" onclick="changeQty('${item.id}', 1)">+</button>
          <button class="remove-btn" onclick="removeFromCart('${item.id}')" title="Xóa">🗑️</button>
        </div>
      </div>
    `).join('');
    if (checkoutBtn) checkoutBtn.disabled = false;
  }
}

/**
 * Toggle cart sidebar
 */
function toggleCart() {
  const sidebar = document.getElementById('cart-sidebar');
  const overlay = document.getElementById('cart-overlay');
  
  sidebar.classList.toggle('active');
  overlay.classList.toggle('active');
  document.body.style.overflow = sidebar.classList.contains('active') ? 'hidden' : '';
}

/**
 * Close cart sidebar
 */
function closeCart() {
  const sidebar = document.getElementById('cart-sidebar');
  const overlay = document.getElementById('cart-overlay');
  
  sidebar.classList.remove('active');
  overlay.classList.remove('active');
  document.body.style.overflow = '';
}

/**
 * Open checkout modal
 */
function openCheckoutModal() {
  if (cart.length === 0) return;
  document.getElementById('checkout-modal').classList.add('active');
}

/**
 * Close checkout modal
 */
function closeCheckoutModal() {
  document.getElementById('checkout-modal').classList.remove('active');
  document.getElementById('checkout-form').reset();
}

/**
 * Handle checkout
 */
async function handleCheckout(e) {
  e.preventDefault();
  
  const name = document.getElementById('customer-name').value.trim();
  const phone = document.getElementById('customer-phone').value.trim();
  const email = document.getElementById('customer-email').value.trim();
  
  if (!name || !phone) {
    showToast('Vui lòng nhập đầy đủ thông tin', 'error');
    return;
  }
  
  // Disable form
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Đang xử lý...';
  
  try {
    // 1. Create customer
    const customer = await shopAPI.createCustomer({ name, phone, email });
    
    // 2. Create order
    const orderItems = cart.map(item => ({
      product_id: item.id,
      price: item.price,
      qty: item.qty
    }));
    
    const order = await shopAPI.createOrder({
      customer_id: customer.id,
      items: orderItems,
      created_at: formatDateForGAS(new Date())
    });
    
    // Success! Redirect to success page
    const orderId = order.id || 'N/A';
    window.location.href = `success.html?order_id=${orderId}`;
    
  } catch (error) {
    console.error('Checkout error:', error);
    showToast(error.message || 'Đặt hàng thất bại. Vui lòng thử lại.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Xác nhận đặt hàng';
  }
}

/**
 * Show loading state
 */
function showLoading() {
  document.getElementById('loading-state').style.display = 'flex';
  document.getElementById('error-state').style.display = 'none';
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('products-grid').style.display = 'none';
}

/**
 * Hide loading state
 */
function hideLoading() {
  document.getElementById('loading-state').style.display = 'none';
  document.getElementById('products-grid').style.display = 'grid';
}

/**
 * Show error state
 */
function showError(message) {
  document.getElementById('error-state').style.display = 'flex';
  document.getElementById('error-message').textContent = message;
  document.getElementById('loading-state').style.display = 'none';
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('products-grid').style.display = 'none';
}

/**
 * Show empty state
 */
function showEmpty() {
  document.getElementById('empty-state').style.display = 'flex';
  document.getElementById('error-state').style.display = 'none';
}

/**
 * Hide empty state
 */
function hideEmpty() {
  document.getElementById('empty-state').style.display = 'none';
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast toast-${type} show`;
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// Helper functions are now in common.js
