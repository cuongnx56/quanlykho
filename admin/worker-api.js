/**
 * Cloudflare Worker API Client
 * 
 * Reusable client for calling Cloudflare Worker for READ operations.
 * WRITE operations still use GAS apiCall().
 * 
 * Architecture:
 * - READ: Web → Cloudflare Worker → KV → JSON (fast, edge network)
 * - WRITE: Web → GAS /exec → Sheet → Snapshot → KV (unchanged)
 */

const WorkerAPI = {
  /**
   * Worker URL - Set this to your deployed Cloudflare Worker URL
   * Example: https://products-api.your-subdomain.workers.dev
   */
  WORKER_URL: null, // Will be set from config or environment

  /**
   * Initialize worker URL
   * Call this once on page load
   */
  init(workerUrl) {
    this.WORKER_URL = workerUrl;
    console.log('✅ WorkerAPI initialized:', workerUrl);
  },

  /**
   * Check if worker is configured
   */
  isConfigured() {
    return !!this.WORKER_URL;
  },

  /**
   * Call worker endpoint
   * @param {string} endpoint - Endpoint path (e.g., '/products')
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} Response data
   */
  async call(endpoint, params = {}) {
    if (!this.isConfigured()) {
      throw new Error('WorkerAPI not configured. Please set WORKER_URL.');
    }

    // Get API key from session
    const apiKey = window.CommonUtils?.session?.apiKey || session?.apiKey;
    
    if (!apiKey) {
      throw new Error('API key not found in session');
    }

    // Build URL with query params
    const url = new URL(endpoint, this.WORKER_URL);
    url.searchParams.set('api_key', apiKey);
    
    // Add other params
    Object.keys(params).forEach(key => {
      if (params[key] !== undefined && params[key] !== null) {
        url.searchParams.set(key, params[key]);
      }
    });

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const json = await response.json();

      // Handle fallback case (cache miss)
      if (!json.success && json.fallback) {
        console.log('⚠️ Worker cache miss, falling back to GAS');
        return null; // Signal to fallback to GAS
      }

      if (!json.success) {
        throw new Error(json.error || 'Worker API error');
      }

      return json.data;
    } catch (error) {
      console.error('WorkerAPI error:', error);
      // Return null to signal fallback to GAS
      return null;
    }
  },

  /**
   * Generic list method - Read from Worker
   * Falls back to GAS if worker fails or cache miss
   * 
   * @param {string} endpoint - Endpoint path (e.g., '/products', '/orders')
   * @param {Object} params - { page, limit }
   * @returns {Promise<Object>} { items, total, page, limit, totalPages }
   */
  async list(endpoint, params = {}) {
    return this.call(endpoint, params);
  },

  /**
   * Products list - Read from Worker
   * Falls back to GAS if worker fails or cache miss
   * 
   * @param {Object} params - { page, limit }
   * @returns {Promise<Object>} { items, total, page, limit, totalPages }
   */
  async productsList(params = {}) {
    return this.call('/products', params);
  },

  /**
   * Orders list - Read from Worker
   * Falls back to GAS if worker fails or cache miss
   * 
   * @param {Object} params - { page, limit }
   * @returns {Promise<Object>} { items, total, page, limit, totalPages }
   */
  async ordersList(params = {}) {
    return this.call('/orders', params);
  },

  /**
   * Invoices list - Read from Worker
   * Falls back to GAS if worker fails or cache miss
   * 
   * @param {Object} params - { page, limit }
   * @returns {Promise<Object>} { items, total, page, limit, totalPages }
   */
  async invoicesList(params = {}) {
    return this.call('/invoices', params);
  },

  /**
   * Customers list - Read from Worker
   * Falls back to GAS if worker fails or cache miss
   * 
   * @param {Object} params - { page, limit }
   * @returns {Promise<Object>} { items, total, page, limit, totalPages }
   */
  async customersList(params = {}) {
    return this.call('/customers', params);
  },

  /**
   * Inventory list - Read from Worker
   * Falls back to GAS if worker fails or cache miss
   * 
   * @param {Object} params - { page, limit }
   * @returns {Promise<Object>} { items, total, page, limit, totalPages }
   */
  async inventoryList(params = {}) {
    return this.call('/inventory', params);
  },

  /**
   * Reports - Read from Worker
   * Falls back to GAS if worker fails or cache miss
   * 
   * @param {Object} params - { page, limit, type, ... }
   * @returns {Promise<Object>} Report data
   */
  async reports(params = {}) {
    return this.call('/reports', params);
  },

  async settingsList(params = {}) {
    return this.call('/settings', params);
  }
};

// Export to window
window.WorkerAPI = WorkerAPI;
