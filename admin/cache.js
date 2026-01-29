/**
 * Cache Manager - Quản lý cache cho frontend
 * 
 * Features:
 * - Cache data với TTL (Time To Live)
 * - Invalidate cache khi có thay đổi
 * - Smart cache keys
 * - Clear related caches
 */

const CacheManager = {
  // Cache TTL (Time To Live) - milliseconds
  TTL: {
    PRODUCTS: 15 * 60 * 1000,      // 15 phút
    ORDERS: 15 * 60 * 1000,         // 15 phút
    INVENTORY: 15 * 60 * 1000,      // 15 phút
    CUSTOMERS: 15 * 60 * 1000,      // 15 phút
    REPORTS: 15 * 60 * 1000,        // 15 phút
    DASHBOARD: 15 * 60 * 1000       // 15 phút
  },

  /**
   * Generate cache key
   */
  key(prefix, ...parts) {
    return `${prefix}_${parts.join('_')}`;
  },

  /**
   * Get cached data
   */
  get(key) {
    try {
      const cached = localStorage.getItem(key);
      if (!cached) return null;

      const data = JSON.parse(cached);
      const timestamp = localStorage.getItem(`${key}_ts`);
      
      if (!timestamp) return null;

      // Check if expired
      const age = Date.now() - parseInt(timestamp);
      const ttl = this.getTTL(key);
      
      if (age > ttl) {
        // Expired, remove it
        this.remove(key);
        return null;
      }

      return data;
    } catch (err) {
      console.error("Cache get error:", err);
      return null;
    }
  },

  /**
   * Set cache data
   */
  set(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
      localStorage.setItem(`${key}_ts`, Date.now().toString());
    } catch (err) {
      console.error("Cache set error:", err);
      // If storage is full, clear old caches
      this.clearOldCaches();
    }
  },

  /**
   * Remove cache
   */
  remove(key) {
    localStorage.removeItem(key);
    localStorage.removeItem(`${key}_ts`);
  },

  /**
   * Get TTL for cache key
   */
  getTTL(key) {
    if (key.startsWith('products_')) return this.TTL.PRODUCTS;
    if (key.startsWith('orders_')) return this.TTL.ORDERS;
    if (key.startsWith('inventory_')) return this.TTL.INVENTORY;
    if (key.startsWith('customers_')) return this.TTL.CUSTOMERS;
    if (key.startsWith('reports_')) return this.TTL.REPORTS;
    if (key.startsWith('dashboard_')) return this.TTL.DASHBOARD;
    return 5 * 60 * 1000; // Default 5 minutes
  },

  /**
   * Clear cache by pattern
   */
  clear(pattern) {
    const regex = new RegExp(pattern);
    const keysToRemove = [];
    
    Object.keys(localStorage).forEach(key => {
      if (regex.test(key)) {
        keysToRemove.push(key);
      }
    });
    
    keysToRemove.forEach(key => {
      localStorage.removeItem(key);
    });
    
    return keysToRemove.length;
  },

  /**
   * Clear all cache
   */
  clearAll() {
    const keysToRemove = [];
    
    Object.keys(localStorage).forEach(key => {
      // Only clear cache keys, not auth session
      if (key.startsWith('products_') || 
          key.startsWith('orders_') || 
          key.startsWith('inventory_') || 
          key.startsWith('customers_') ||
          key.startsWith('reports_') ||
          key.startsWith('dashboard_') ||
          key.endsWith('_ts')) {
        keysToRemove.push(key);
      }
    });
    
    keysToRemove.forEach(key => {
      localStorage.removeItem(key);
    });
    
    return keysToRemove.length;
  },

  /**
   * Clear old caches (older than max age)
   */
  clearOldCaches() {
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    const now = Date.now();
    const keysToRemove = [];
    
    Object.keys(localStorage).forEach(key => {
      if (key.endsWith('_ts')) {
        const timestamp = parseInt(localStorage.getItem(key) || '0');
        if (now - timestamp > maxAge) {
          const dataKey = key.replace('_ts', '');
          keysToRemove.push(dataKey);
          keysToRemove.push(key);
        }
      }
    });
    
    keysToRemove.forEach(key => {
      localStorage.removeItem(key);
    });
    
    return keysToRemove.length;
  },

  /**
   * Invalidate caches when product changes
   */
  invalidateOnProductChange() {
    this.clear('^products_');
    // Reports có thể bị ảnh hưởng (stock value, low stock)
    this.clear('^reports_stock_value');
    this.clear('^reports_low_stock');
    this.clear('^reports_dashboard');
    console.log("✅ Cache invalidated: Products changed");
  },

  /**
   * Invalidate caches when order changes
   */
  invalidateOnOrderChange() {
    this.clear('^orders_');
    // Orders ảnh hưởng inventory và reports
    this.clear('^inventory_');
    this.clear('^reports_sales');
    this.clear('^reports_dashboard');
    console.log("✅ Cache invalidated: Orders changed");
  },

  /**
   * Invalidate caches when inventory changes
   */
  invalidateOnInventoryChange() {
    this.clear('^inventory_');
    // Inventory ảnh hưởng reports
    this.clear('^reports_stock_value');
    this.clear('^reports_inventory_movement');
    this.clear('^reports_dashboard');
    console.log("✅ Cache invalidated: Inventory changed");
  },

  /**
   * Invalidate caches when invoice changes
   */
  invalidateOnInvoiceChange() {
    this.clear('^invoices_');
    this.clear('^invoice_'); // Single invoice cache
    console.log("✅ Cache invalidated: Invoices changed");
  },

  /**
   * Invalidate all reports cache
   */
  invalidateReports() {
    this.clear('^reports_');
    this.clear('^dashboard_');
    console.log("✅ Cache invalidated: Reports");
  },

  /**
   * Invalidate all caches (use when logout)
   */
  invalidateAll() {
    const count = this.clearAll();
    console.log(`✅ Cache invalidated: ${count} keys cleared`);
  }
};

// Export for use in other files
window.CacheManager = CacheManager;
