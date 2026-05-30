/**
 * worker-api.js - Cloudflare Worker API client (READ operations only)
 *
 * Architecture:
 *   READ  → Web → Cloudflare Worker → KV cache → (miss) → GAS
 *   WRITE → Web → GAS /exec → Sheet → snapshot → KV
 *
 * Optimizations vs original:
 *  1. Explicit error types: WorkerCacheMissError vs WorkerNetworkError
 *     Original returned null for BOTH cases → callers couldn't distinguish
 *     "KV cache miss (expected, fallback to GAS)" from "Worker down (alert)"
 *  2. cache: "no-cache" on fetch: prevents the browser's HTTP cache from
 *     returning a stale null response from a previous Worker miss
 *  3. Request timeout via AbortController (5 s): Worker calls that hang
 *     no longer block the page indefinitely
 *  4. Circuit breaker: after FAILURE_THRESHOLD consecutive failures the
 *     Worker is bypassed entirely for RECOVERY_WINDOW ms.  This prevents
 *     a flapping Worker from adding 5 s latency to every page load.
 *  5. All resource-specific methods (productsList, ordersList, …) collapsed
 *     to thin wrappers around the generic list().  Same behaviour, ~60 fewer
 *     lines, one place to change the calling convention.
 *  6. isConfigured() guard moved inside call() – callers no longer need to
 *     check it before every use.
 */

// ─── Error types ─────────────────────────────────────────────────────────────

class WorkerCacheMissError extends Error {
  constructor(endpoint) {
    super(`Worker cache miss: ${endpoint}`);
    this.name = "WorkerCacheMissError";
  }
}

class WorkerNetworkError extends Error {
  constructor(message, endpoint) {
    super(`Worker network error on ${endpoint}: ${message}`);
    this.name = "WorkerNetworkError";
  }
}

class WorkerNotConfiguredError extends Error {
  constructor() {
    super("WorkerAPI not configured. Call WorkerAPI.init(url) first.");
    this.name = "WorkerNotConfiguredError";
  }
}

// ─── Circuit breaker ─────────────────────────────────────────────────────────

const CircuitBreaker = (() => {
  const FAILURE_THRESHOLD = 3;       // failures per endpoint before opening
  const RECOVERY_WINDOW   = 30_000;  // ms before half-open retry
  const REQUEST_TIMEOUT   = 8_000;   // ms — tăng lên 8s vì GAS cold start ~4-5s

  // Per-endpoint state: Map<endpoint, { failures, openedAt }>
  const _state = new Map();

  function _get(endpoint) {
    if (!_state.has(endpoint)) _state.set(endpoint, { failures: 0, openedAt: null });
    return _state.get(endpoint);
  }

  return {
    REQUEST_TIMEOUT,

    isOpen(endpoint) {
      const s = _get(endpoint);
      if (s.openedAt === null) return false;
      if (Date.now() - s.openedAt >= RECOVERY_WINDOW) {
        // Half-open: reset và cho 1 request qua thử
        this.reset(endpoint);
        return false;
      }
      return true;
    },

    recordSuccess(endpoint) {
      this.reset(endpoint);
    },

    recordFailure(endpoint) {
      const s = _get(endpoint);
      s.failures++;
      if (s.failures >= FAILURE_THRESHOLD && s.openedAt === null) {
        s.openedAt = Date.now();
        console.warn(
          `⚡ WorkerAPI circuit OPEN for "${endpoint}" after ${s.failures} failures. ` +
          `Bypassing for ${RECOVERY_WINDOW / 1000}s.`
        );
      }
    },

    reset(endpoint) {
      if (endpoint) {
        _state.set(endpoint, { failures: 0, openedAt: null });
      } else {
        _state.clear(); // reset tất cả (dùng khi logout/reload)
      }
    },

    // Debug helper
    status() {
      const out = {};
      _state.forEach((v, k) => { if (v.failures > 0 || v.openedAt) out[k] = v; });
      return out;
    },
  };
})();

// ─── WorkerAPI ───────────────────────────────────────────────────────────────

const WorkerAPI = (() => {
  let _workerUrl = null;

  /**
   * init – set the Worker base URL once on page load.
   */
  function init(workerUrl) {
    _workerUrl = workerUrl ? workerUrl.replace(/\/$/, "") : null;
    if (_workerUrl) console.log("✅ WorkerAPI initialized:", _workerUrl);
  }

  function isConfigured() {
    return !!_workerUrl;
  }

  /**
   * call – low-level fetch against Worker endpoint.
   *
   * Throws:
   *   WorkerNotConfiguredError  – init() was not called
   *   WorkerCacheMissError      – Worker responded with { fallback: true }
   *   WorkerNetworkError        – HTTP error, timeout, or parse failure
   *
   * Callers should catch WorkerCacheMissError and fall back to GAS.
   * WorkerNetworkError should also fall back but may warrant a console.warn.
   *
   * @param {string} endpoint  - e.g. "/products"
   * @param {Object} [params]  - query-string parameters
   * @returns {Promise<any>}   - json.data on success
   */
  async function call(endpoint, params = {}) {
    if (!isConfigured()) throw new WorkerNotConfiguredError();

    // ✅ Circuit breaker: bypass Worker entirely when it's been flapping
    if (CircuitBreaker.isOpen(endpoint)) {
      throw new WorkerNetworkError("circuit open — too many recent failures", endpoint);
    }

    const apiKey = window.CommonUtils?.session?.apiKey || window.session?.apiKey;
    if (!apiKey) throw new WorkerNetworkError("no API key in session", endpoint);

    // Build URL
    const url = new URL(endpoint, _workerUrl + "/");
    url.searchParams.set("api_key", apiKey);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }

    // ✅ AbortController for request timeout
    const controller = new AbortController();
    const timeoutId  = setTimeout(
      () => controller.abort(),
      CircuitBreaker.REQUEST_TIMEOUT
    );

    try {
      const response = await fetch(url.toString(), {
        method  : "GET",
        // ✅ Bypass browser HTTP cache – prevents a cached null/miss from
        //    being returned on repeat calls during the same session
        cache   : "no-cache",
        headers : { "Accept": "application/json" },
        signal  : controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new WorkerNetworkError(`HTTP ${response.status}`, endpoint);
      }

      let json;
      try {
        json = await response.json();
      } catch (e) {
        throw new WorkerNetworkError("invalid JSON response", endpoint);
      }

      // Worker signals GAS fallback needed (KV miss)
      if (!json.success && json.fallback) {
        CircuitBreaker.recordSuccess(endpoint);
        throw new WorkerCacheMissError(endpoint);
      }

      if (!json.success) {
        throw new WorkerNetworkError(json.error || "API error", endpoint);
      }

      CircuitBreaker.recordSuccess(endpoint);
      return json.data;

    } catch (err) {
      clearTimeout(timeoutId);

      // Re-throw our typed errors as-is
      if (err instanceof WorkerCacheMissError) throw err;
      if (err instanceof WorkerNetworkError)   throw err;

      // Timeout
      if (err.name === "AbortError") {
        CircuitBreaker.recordFailure(endpoint);
        throw new WorkerNetworkError(`timeout after ${CircuitBreaker.REQUEST_TIMEOUT}ms`, endpoint);
      }

      // Network / CORS / other
      CircuitBreaker.recordFailure(endpoint);
      throw new WorkerNetworkError(err.message, endpoint);
    }
  }

  /**
   * list – generic list helper used by all resource-specific methods.
   * Returns null (signals caller to fall back to GAS) instead of throwing,
   * making the fallback pattern ergonomic at the call site:
   *
   *   const data = await WorkerAPI.list("/orders", params) ?? await gasCall();
   *
   * WorkerCacheMissError and WorkerNetworkError are both treated as "use GAS"
   * from the caller's perspective; the difference is logged for observability.
   *
   * @param {string} endpoint
   * @param {Object} [params]
   * @returns {Promise<any|null>}  null → caller should fall back to GAS
   */
  async function list(endpoint, params = {}) {
    try {
      return await call(endpoint, params);
    } catch (err) {
      if (err instanceof WorkerCacheMissError) {
        console.log(`⚠️  Worker cache miss [${endpoint}] → GAS fallback`);
      } else if (err instanceof WorkerNetworkError) {
        console.warn(`⚠️  Worker error [${endpoint}] → GAS fallback:`, err.message);
      } else {
        console.error(`❌ WorkerAPI unexpected error [${endpoint}]:`, err);
      }
      return null; // signal: fall back to GAS
    }
  }

  // ─── Resource-specific helpers ─────────────────────────────────────────────
  // All collapse to list() with the correct endpoint.
  // New resources: add one line here.

  const productsList   = (p = {}) => list("/products",   p);
  const categoriesList = (p = {}) => list("/categories", p);
  const ordersList     = (p = {}) => list("/orders",     p);

  /**
   * ordersUpdateStatus — PATCH /orders/:id/status
   * Gọi Worker route thay vì GAS trực tiếp → fast queue response
   */
  const ordersUpdateStatus = async (orderId, newStatus, token) => {
    _ensureConfigured();
    const url = `${_baseUrl}/orders/${encodeURIComponent(orderId)}/status`;
    try {
      const resp = await fetch(url, {
        method  : 'PATCH',
        headers : {
          'Content-Type': 'application/json',
          'X-API-Key'   : _apiKey,
        },
        body: JSON.stringify({ new_status: newStatus, token }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new WorkerNetworkError(`PATCH /orders status: ${resp.status} ${err.message || ''}`);
      }
      return await resp.json();
    } catch (e) {
      if (e instanceof WorkerNetworkError) throw e;
      throw new WorkerNetworkError(`ordersUpdateStatus: ${e.message}`);
    }
  };

  /**
   * invoicesCreate — POST /invoices qua Worker
   */
  const invoicesCreate = async (data) => {
    _ensureConfigured();
    const url = `${_baseUrl}/invoices`;
    try {
      const resp = await fetch(url, {
        method  : 'POST',
        headers : {
          'Content-Type': 'application/json',
          'X-API-Key'   : _apiKey,
        },
        body: JSON.stringify(data),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new WorkerNetworkError(`POST /invoices: ${resp.status} ${err.message || ''}`);
      }
      const result = await resp.json();
      return result.data ?? result;
    } catch (e) {
      if (e instanceof WorkerNetworkError) throw e;
      throw new WorkerNetworkError(`invoicesCreate: ${e.message}`);
    }
  };
  const invoicesList   = (p = {}) => list("/invoices",   p);
  const customersList  = (p = {}) => list("/customers",  p);
  const inventoryList  = (p = {}) => list("/inventory",  p);
  const leadsList      = (p = {}) => list("/leads",      p);
  const reports        = (p = {}) => list("/reports",    p);
  const settingsList   = (p = {}) => list("/settings",   p);

  // ─── Public surface ────────────────────────────────────────────────────────
  return {
    // Setup
    init,
    isConfigured,
    // Core
    call,
    list,
    // Resources
    productsList,
    categoriesList,
    ordersList,
    ordersUpdateStatus,
    invoicesCreate,
    invoicesList,
    customersList,
    inventoryList,
    leadsList,
    reports,
    settingsList,
    // Error types (exported so callers can instanceof-check if needed)
    WorkerCacheMissError,
    WorkerNetworkError,
    WorkerNotConfiguredError,
    // Internals exposed for testing / monitoring
    _circuitBreaker: CircuitBreaker,
  };
})();

window.WorkerAPI = WorkerAPI;