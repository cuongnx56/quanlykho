/**
 * Shop API Client
 * 
 * Architecture:
 * - READ: Shop FE → Cloudflare Worker → KV (fast, no auth)
 * - WRITE: Shop FE → Worker → GAS /exec → Sheet (validated, rate limited)
 * 
 * Usage:
 * const shopAPI = new ShopAPI({
 *   workerUrl: "https://your-worker.workers.dev",
 *   publicApiKey: "public-shop-key" // Required: for authentication
 * });
 */

class ShopAPI {
  constructor(config) {
    this.workerUrl = config.workerUrl;
    this.publicApiKey = config.publicApiKey || null;
    this.cache = new Map(); // In-memory cache
    this.cacheTTL = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Load products from Worker (fast, cached)
   * Uses products endpoint
   * @param {Object} options - { page, limit, category, search }
   * @returns {Promise<Array>} Products array
   */
  async loadProducts(options = {}) {
    const { page = 1, limit = 100, category = null, search = null, inStockOnly = true } = options;
    
    // Check cache first
    const cacheKey = `products_${page}_${limit}_${category}_${search}`;
    const cached = this.getCache(cacheKey);
    if (cached) {
      console.log("📦 Using cached products");
      return cached;
    }

    try {
      // Build Worker URL - Use products endpoint
      const url = new URL(`${this.workerUrl}/products`);
      url.searchParams.set('api_key', this.publicApiKey || 'public');
      url.searchParams.set('page', page);
      url.searchParams.set('limit', limit);
      
      const response = await fetch(url.toString());
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to load products');
      }

      let products = result.data.items || result.data || [];
      
      // Filter by stock if needed
      if (inStockOnly) {
        products = products.filter(p => {
          const stock = Number(p.amount_in_stock || 0);
          return stock > 0;
        });
      }

      // Filter by category if provided
      if (category) {
        products = products.filter(p => 
          (p.category || '').toLowerCase() === category.toLowerCase()
        );
      }

      // Filter by search if provided
      if (search) {
        const query = search.toLowerCase();
        products = products.filter(p => {
          const title = (p.title || p.name || '').toLowerCase();
          const desc = (p.description || '').toLowerCase();
          return title.includes(query) || desc.includes(query);
        });
      }

      // Cache result
      this.setCache(cacheKey, products);
      
      return products;
    } catch (error) {
      console.error("Error loading products from Worker:", error);
      // Fallback to GAS if Worker fails
      return this.loadProductsFromGAS(options);
    }
  }

  /**
   * Fallback: Load products from GAS
   * Note: This requires GAS_URL to be set in Worker environment
   */
  async loadProductsFromGAS(options = {}) {
    // Fallback removed - Worker should always be available
    // If Worker fails, throw error instead of falling back to GAS
    throw new Error("Worker unavailable. Please try again later.");
  }

  /**
   * Load shop settings from Worker
   * @returns {Promise<Object>} Settings object
   */
  async loadSettings() {
    // Check cache
    const cached = this.getCache('settings');
    if (cached) {
      return cached;
    }

    try {
      const url = new URL(`${this.workerUrl}/settings`);
      url.searchParams.set('api_key', this.publicApiKey || 'public');

      const response = await fetch(url.toString());
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to load settings');
      }

      const settings = result.data;
      this.setCache('settings', settings);
      
      return settings;
    } catch (error) {
      console.error("Error loading settings from Worker:", error);
      // Fallback to GAS
      return this.loadSettingsFromGAS();
    }
  }

  /**
   * Fallback: Load settings from GAS
   * Note: This requires GAS_URL to be set in Worker environment
   */
  async loadSettingsFromGAS() {
    // Fallback removed - Worker should always be available
    throw new Error("Worker unavailable. Please try again later.");
  }

  /**
   * Create order (via Worker → GAS)
   * Worker validates, rate limits, and forwards to GAS
   * @param {Object} orderData - { customer_id, items, created_at }
   * @returns {Promise<Object>} Created order
   */
  async createOrder(orderData) {
    try {
      // ✅ Use Worker POST /orders endpoint
      // Worker will: validate, rate limit, forward to GAS
      const url = new URL(`${this.workerUrl}/orders`);
      url.searchParams.set('api_key', this.publicApiKey || 'public');
      
      // ✅ Include customer info for queue processing (if customer_id is temp)
      // This helps GAS resolve customer_id when processing queue
      const requestBody = {
        customer_id: orderData.customer_id,
        items: orderData.items,
        created_at: orderData.created_at || formatDateForGAS(new Date()),
        note: orderData.note,
        shipping_info: orderData.shipping_info // Must be an object, not a string
      };
      
      // If customer info is provided, include it for resolution
      if (orderData.customer_name || orderData.customer_phone || orderData.customer_email) {
        requestBody.customer_name = orderData.customer_name;
        requestBody.customer_phone = orderData.customer_phone;
        requestBody.customer_email = orderData.customer_email;
      }
      
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to create order');
      }

      return result.data;
    } catch (error) {
      console.error("Error creating order:", error);
      throw error;
    }
  }

  /**
   * Create customer (via Worker → GAS)
   * Worker validates, rate limits, and forwards to GAS
   * @param {Object} customerData - { name, phone, email }
   * @returns {Promise<Object>} Created customer
   */
  async createCustomer(customerData) {
    try {
      // ✅ Use Worker POST /customers endpoint
      // Worker will: validate, rate limit, forward to GAS
      const url = new URL(`${this.workerUrl}/customers`);
      url.searchParams.set('api_key', this.publicApiKey || 'public');
      
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: customerData.name,
          phone: customerData.phone,
          email: customerData.email || ''
        })
      });

      const result = await response.json();
      console.log('Customer creation response:', result);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to create customer');
      }

      // ✅ Ensure we return customer data (should have id, name, phone, email)
      if (!result.data) {
        throw new Error('No customer data returned from server');
      }
      
      console.log('Customer created successfully:', result.data);
      return result.data;
    } catch (error) {
      console.error("Error creating customer:", error);
      throw error;
    }
  }

  /**
   * Create lead (for newsletter subscription, contact form, etc.)
   * @param {Object} leadData - { email, name?, phone? }
   * @returns {Promise<Object>} Lead creation result
   */
  async createLead(leadData) {
    try {
      // ✅ Use Worker POST /leads endpoint
      // Worker will: validate, rate limit, queue to KV
      const url = new URL(`${this.workerUrl}/leads`);
      url.searchParams.set('api_key', this.publicApiKey || 'public');
      
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: leadData.email,
          name: leadData.name || '',
          phone: leadData.phone || ''
        })
      });

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to create lead');
      }

      return result.data;
    } catch (error) {
      console.error("Error creating lead:", error);
      throw error;
    }
  }

  /**
   * Get single product by slug
   * Slug can be product id or generated from title
   * @param {string} slug - Product slug/identifier
   * @returns {Promise<Object|null>} Product object or null if not found
   */
  async getProductBySlug(slug) {
    // ✅ Step 1: Check in-memory cache first
    const cacheKey = `product_${slug}`;
    const cached = this.getCache(cacheKey);
    if (cached) {
      console.log("📦 Using cached product (in-memory)");
      return cached;
    }
    
    // ✅ Step 2: Check localStorage cache (products list) with TTL check
    try {
      const cacheDataStr = localStorage.getItem('shop_products_cache');
      if (cacheDataStr) {
        const cacheData = JSON.parse(cacheDataStr);
        const now = Date.now();
        const ttl = cacheData.ttl || (5 * 60 * 1000); // Default 5 minutes
        
        // Check if cache is still valid (within TTL)
        if (cacheData.timestamp && (now - cacheData.timestamp) < ttl) {
          const cachedProducts = Array.isArray(cacheData.products) ? cacheData.products : 
                                 (Array.isArray(cacheData) ? cacheData : []);
          
          if (cachedProducts.length > 0) {
            // Try to find by ID
            let product = cachedProducts.find(p => (p.id === slug || p._id === slug));
            
            // If not found by ID, try to find by slug (generate from title)
            if (!product) {
              const slugLower = slug.toLowerCase().replace(/[^a-z0-9]+/g, '-');
              product = cachedProducts.find(p => {
                const title = (p.title || p.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
                return title === slugLower || title.includes(slugLower);
              });
            }
            
            if (product) {
              console.log("📦 Using cached product (localStorage, TTL: 5 minutes)");
              // Cache to in-memory as well
              this.setCache(cacheKey, product);
              return product;
            }
          }
        } else {
          // Cache expired, remove it
          console.log("⚠️ localStorage cache expired, removing...");
          localStorage.removeItem('shop_products_cache');
        }
      }
    } catch (err) {
      console.warn('Error reading from localStorage cache:', err);
    }

    try {
      // Build Worker URL - Use /products/:slug endpoint
      const url = new URL(`${this.workerUrl}/products/${encodeURIComponent(slug)}`);
      url.searchParams.set('api_key', this.publicApiKey || 'public');

      const response = await fetch(url.toString());
      const result = await response.json();

      if (!result.success) {
        if (result.fallback) {
          // Fallback to GAS
          return this.getProductBySlugFromGAS(slug);
        }
        throw new Error(result.error || 'Product not found');
      }

      const product = result.data;
      
      // Cache result
      this.setCache(cacheKey, product);
      
      return product;
    } catch (error) {
      console.error("Error loading product from Worker:", error);
      // Fallback to GAS
      return this.getProductBySlugFromGAS(slug);
    }
  }

  /**
   * Fallback: Get product by slug from GAS
   */
  async getProductBySlugFromGAS(slug) {
    try {
      // Load all products and find by slug
      const products = await this.loadProductsFromGAS({ limit: 1000 });
      
      // Helper to generate slug
      function generateSlug(product) {
        if (product.id) {
          const idSlug = String(product.id).toLowerCase().trim();
          if (idSlug) return idSlug;
        }
        if (product.title) {
          return String(product.title)
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        }
        return null;
      }
      
      const product = products.find(p => {
        const productSlug = generateSlug(p);
        return productSlug === slug || p.id === slug;
      });
      
      return product || null;
    } catch (error) {
      console.error("Error loading product from GAS:", error);
      return null;
    }
  }

  /**
   * Load categories from products
   * @returns {Promise<Array>} Categories array
   */
  async loadCategories() {
    // Check cache
    const cached = this.getCache('categories');
    if (cached) {
      return cached;
    }

    try {
      // Build Worker URL - Use /categories endpoint
      const url = new URL(`${this.workerUrl}/categories`);
      url.searchParams.set('api_key', this.publicApiKey || 'public');

      const response = await fetch(url.toString());
      const result = await response.json();

      if (!result.success) {
        if (result.fallback) {
          // Fallback: Extract from products
          return this.loadCategoriesFromProducts();
        }
        throw new Error(result.error || 'Failed to load categories');
      }

      // ✅ Handle both array and object response formats
      let categories = [];
      if (Array.isArray(result.data)) {
        // Direct array response
        categories = result.data;
      } else if (result.data && Array.isArray(result.data.items)) {
        // Paginated response with items array
        categories = result.data.items;
      } else {
        // Empty or invalid response
        categories = [];
      }
      
      // Cache result
      this.setCache('categories', categories);
      
      return categories;
    } catch (error) {
      console.error("Error loading categories from Worker:", error);
      // Fallback: Extract from products
      return this.loadCategoriesFromProducts();
    }
  }

  /**
   * Fallback: Extract categories from products
   */
  async loadCategoriesFromProducts() {
    try {
      const products = await this.loadProducts({ limit: 1000 });
      const categorySet = new Set();
      
      products.forEach(product => {
        const category = product.category || product.category_name || product.categories;
        if (category && typeof category === 'string' && category.trim()) {
          categorySet.add(category.trim());
        }
      });
      
      const categories = Array.from(categorySet).sort();
      this.setCache('categories', categories);
      return categories;
    } catch (error) {
      console.error("Error extracting categories from products:", error);
      return [];
    }
  }

  /**
   * Check product stock
   * @param {string} productId - Product ID
   * @returns {Promise<number>} Stock quantity
   */
  async checkStock(productId) {
    try {
      const products = await this.loadProducts({ limit: 1000 });
      const product = products.find(p => p.id === productId);
      return product ? Number(product.amount_in_stock || 0) : 0;
    } catch (error) {
      console.error("Error checking stock:", error);
      return 0;
    }
  }

  // ─── localStorage cache helpers (for products-all, 15 min TTL) ───────────

  _lsGet(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const { data, ts } = JSON.parse(raw);
      if (Date.now() - ts > 15 * 60 * 1000) {
        localStorage.removeItem(key);
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  _lsSet(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
    } catch (e) {
      console.warn('localStorage write failed:', e);
    }
  }

  /**
   * Get ALL products from R2 via Worker.
   * Cached in localStorage for 15 minutes to avoid repeated API calls.
   * @returns {Promise<Array>} Full products array
   */
  async getAllProducts() {
    const lsKey = `products_all_${this.publicApiKey || 'default'}`;

    const cached = this._lsGet(lsKey);
    if (cached) {
      console.log('📦 Using localStorage cached products-all');
      return cached;
    }

    try {
      const url = new URL(`${this.workerUrl}/products-all`);
      url.searchParams.set('api_key', this.publicApiKey || 'public');

      const response = await fetch(url.toString());
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to load all products');
      }

      const products = result.data || [];
      this._lsSet(lsKey, products);
      console.log(`✅ Loaded ${products.length} products-all from Worker, cached in localStorage`);
      return products;
    } catch (error) {
      console.error('Error loading all products:', error);
      return [];
    }
  }

  /**
   * Search products by code or name from the full product list.
   * Automatically uses localStorage-cached data (15 min TTL).
   * @param {string} query - Search query (product code or name)
   * @param {Object} options - { limit: 20 }
   * @returns {Promise<Array>} Matching products
   */
  async searchProducts(query, options = {}) {
    const { limit = 20 } = options;

    if (!query || !query.trim()) return [];

    const q = query.trim().toLowerCase();
    const allProducts = await this.getAllProducts();

    const matched = allProducts.filter(p => {
      const code = (p.id || p.code || p.product_code || '').toLowerCase();
      const name = (p.title || p.name || p.product_name || '').toLowerCase();
      return code.includes(q) || name.includes(q);
    });

    return matched.slice(0, limit);
  }

  /**
   * Cache management
   */
  getCache(key) {
    const cached = this.cache.get(key);
    if (!cached) return null;
    
    if (Date.now() - cached.timestamp > this.cacheTTL) {
      this.cache.delete(key);
      return null;
    }
    
    return cached.data;
  }

  setCache(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  clearCache(pattern = null) {
    if (!pattern) {
      this.cache.clear();
      return;
    }
    
    // Clear matching keys
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
  }
}

// Export for use in shop.js
window.ShopAPI = ShopAPI;
