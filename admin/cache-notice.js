/**
 * Cache Notice - Thông báo cache và nút refresh
 * 
 * Features:
 * - Hiển thị thông báo về cache 5 phút
 * - Nút refresh để xóa cache và reload trang
 */

(function() {
  'use strict';

  /**
   * Initialize cache notice
   */
  function initCacheNotice() {
    const btnRefresh = document.getElementById('btn-cache-refresh');
    if (!btnRefresh) {
      console.warn('⚠️ Cache refresh button not found');
      return;
    }

    btnRefresh.addEventListener('click', handleRefresh);
  }

  /**
   * Handle refresh button click
   */
  function handleRefresh() {
    const btnRefresh = document.getElementById('btn-cache-refresh');
    if (!btnRefresh) return;

    // Disable button during refresh
    btnRefresh.disabled = true;
    const originalText = btnRefresh.textContent;
    btnRefresh.textContent = '⏳ Đang refresh...';

    try {
      // Clear all cache using CacheManager if available
      if (window.CacheManager && typeof window.CacheManager.clearAllCache === 'function') {
        const clearedCount = window.CacheManager.clearAllCache();
        console.log(`✅ Cleared ${clearedCount} cache keys`);
      } else {
        // Fallback: clear all localStorage except auth session
        clearAllCacheFallback();
      }

      // Small delay to show feedback, then reload
      setTimeout(() => {
        window.location.reload();
      }, 300);

    } catch (err) {
      console.error('❌ Error clearing cache:', err);
      alert('Lỗi khi xóa cache: ' + err.message);
      btnRefresh.disabled = false;
      btnRefresh.textContent = originalText;
    }
  }

  /**
   * Fallback method to clear cache if CacheManager is not available
   */
  function clearAllCacheFallback() {
    const keysToRemove = [];
    
    // Get all localStorage keys
    Object.keys(localStorage).forEach(key => {
      // Only clear cache keys, not auth session or other app data
      if (key.startsWith('products_') || 
          key.startsWith('orders_') || 
          key.startsWith('inventory_') || 
          key.startsWith('customers_') ||
          key.startsWith('reports_') ||
          key.startsWith('dashboard_') ||
          key.startsWith('invoices_') ||
          key.startsWith('invoice_') ||
          key.startsWith('categories_') ||
          key.startsWith('leads_') ||
          key.endsWith('_ts')) {
        keysToRemove.push(key);
      }
    });
    
    // Remove all cache keys
    keysToRemove.forEach(key => {
      localStorage.removeItem(key);
    });
    
    console.log(`✅ Cleared ${keysToRemove.length} cache keys (fallback)`);
    return keysToRemove.length;
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCacheNotice);
  } else {
    initCacheNotice();
  }
})();
