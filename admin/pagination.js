/**
 * pagination.js - Reusable pagination utilities
 *
 * Optimizations vs original:
 *  1. Event delegation: 1 listener on the container instead of N listeners
 *     (one per button).  Cheaper to attach, and auto-works after innerHTML
 *     is replaced.
 *  2. Map for callbacks: structured entries with timestamp, enabling stale
 *     cleanup (prevents unbounded growth in SPA navigation).
 *  3. popstate support: browser Back / Forward buttons now correctly
 *     re-trigger the page's load function.  The original used
 *     history.pushState but never listened to popstate, so the URL changed
 *     but the table didn't.
 *  4. State stored in pushState: { page, limit, containerId } so popstate
 *     can reconstruct which container to update.
 *  5. destroy(containerId): explicit cleanup called on beforeunload or when
 *     a page component is torn down.
 *  6. render() is idempotent: re-calling with the same args is safe; the
 *     delegated listener is set only once via a flag on the container.
 */

const Pagination = (() => {
  // ─── Config ────────────────────────────────────────────────────────────────
  const defaultLimit = typeof PAGINATION !== "undefined" ? PAGINATION.DEFAULT_LIMIT : 20;
  const maxLimit     = typeof PAGINATION !== "undefined" ? PAGINATION.MAX_LIMIT     : 20;

  // ─── Callback registry ─────────────────────────────────────────────────────
  // Map<containerId, { callback: fn, limit: number, timestamp: number }>
  const registry = new Map();

  const STALE_TTL = 5 * 60 * 1000; // 5 minutes

  function registerCallback(containerId, callback, limit) {
    registry.set(containerId, {
      callback,
      limit,
      timestamp: Date.now(),
    });
    cleanupStale();
  }

  function cleanupStale() {
    const now = Date.now();
    for (const [id, entry] of registry) {
      if (now - entry.timestamp > STALE_TTL) {
        _destroyListeners(id);
        registry.delete(id);
      }
    }
  }

  // ─── Event delegation ──────────────────────────────────────────────────────
  // Each container gets exactly ONE click listener (flagged via dataset).
  // The listener reads data-page / data-container from the clicked button.

  function attachDelegatedListener(container) {
    if (container.dataset.paginationInit === "1") return; // already attached
    container.dataset.paginationInit = "1";

    container.addEventListener("click", handleContainerClick);
  }

  function handleContainerClick(e) {
    const btn = e.target.closest(".pagination-btn[data-page]");
    if (!btn) return;

    const page        = parseInt(btn.dataset.page, 10);
    const containerId = btn.dataset.container;
    if (!isNaN(page) && containerId) {
      goToPage(page, containerId, { updateURL: true });
    }
  }

  function _destroyListeners(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.removeEventListener("click", handleContainerClick);
    delete container.dataset.paginationInit;
  }

  // ─── popstate ──────────────────────────────────────────────────────────────
  // Listen once at module init; route Back/Forward to the right container.

  window.addEventListener("popstate", (event) => {
    const state = event.state;
    if (!state || !state._pagination) return; // not our state

    const { page, containerId } = state._pagination;
    if (containerId && registry.has(containerId)) {
      goToPage(page, containerId, { updateURL: false });
    }
  });

  // ─── HTML builder ──────────────────────────────────────────────────────────

  function buildHTML(currentPage, totalPages, totalItems, containerId, itemLabel) {
    const startPage = Math.max(1, currentPage - 2);
    const endPage   = Math.min(totalPages, currentPage + 2);
    const cid       = containerId; // shorthand

    let html = '<div class="pagination">';

    // Previous
    if (currentPage > 1) {
      html += `<button class="pagination-btn" data-page="${currentPage - 1}" data-container="${cid}">‹ Trước</button>`;
    } else {
      html += `<button class="pagination-btn" disabled aria-disabled="true">‹ Trước</button>`;
    }

    // First page + ellipsis
    if (startPage > 1) {
      html += `<button class="pagination-btn" data-page="1" data-container="${cid}">1</button>`;
      if (startPage > 2) html += `<span class="pagination-ellipsis" aria-hidden="true">…</span>`;
    }

    // Page window
    for (let i = startPage; i <= endPage; i++) {
      if (i === currentPage) {
        html += `<button class="pagination-btn active" aria-current="page">${i}</button>`;
      } else {
        html += `<button class="pagination-btn" data-page="${i}" data-container="${cid}">${i}</button>`;
      }
    }

    // Last page + ellipsis
    if (endPage < totalPages) {
      if (endPage < totalPages - 1) html += `<span class="pagination-ellipsis" aria-hidden="true">…</span>`;
      html += `<button class="pagination-btn" data-page="${totalPages}" data-container="${cid}">${totalPages}</button>`;
    }

    // Next
    if (currentPage < totalPages) {
      html += `<button class="pagination-btn" data-page="${currentPage + 1}" data-container="${cid}">Sau ›</button>`;
    } else {
      html += `<button class="pagination-btn" disabled aria-disabled="true">Sau ›</button>`;
    }

    html += "</div>";
    html += `<div class="pagination-info">Trang ${currentPage}/${totalPages} (${totalItems} ${itemLabel})</div>`;
    return html;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * render – Draw pagination UI inside containerId.
   *
   * @param {string}   containerId   - ID of the wrapping element
   * @param {number}   currentPage
   * @param {number}   totalPages
   * @param {number}   totalItems
   * @param {Function} onPageChange  - Called with (page) when user clicks
   * @param {string}   [itemLabel]   - Label shown in info text (default "items")
   */
  function render(containerId, currentPage, totalPages, totalItems, onPageChange, itemLabel = "items") {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (totalPages <= 1) {
      container.innerHTML = "";
      return;
    }

    // Register callback (refreshes timestamp each call)
    const entry = registry.get(containerId);
    const limit = entry?.limit ?? defaultLimit;
    registerCallback(containerId, onPageChange, limit);

    // ✅ Build HTML then set once → single reflow
    container.innerHTML = buildHTML(currentPage, totalPages, totalItems, containerId, itemLabel);

    // ✅ Attach delegated listener once (noop if already attached)
    attachDelegatedListener(container);
  }

  /**
   * goToPage – invoke registered callback and optionally update URL.
   *
   * @param {number}  page
   * @param {string}  containerId
   * @param {object}  [options]
   * @param {boolean} [options.updateURL=true]
   */
  function goToPage(page, containerId, options = {}) {
    const entry = registry.get(containerId);
    if (!entry) return;

    const shouldUpdateURL = options.updateURL !== false;

    if (shouldUpdateURL) {
      updateURL(page, entry.limit ?? defaultLimit, containerId);
    }

    // Refresh timestamp so entry isn't GC'd mid-session
    entry.timestamp = Date.now();

    if (typeof entry.callback === "function") {
      entry.callback(page);
    }
  }

  /**
   * getParamsFromURL – parse page + limit from current URL.
   */
  function getParamsFromURL() {
    const params = new URLSearchParams(window.location.search);
    return {
      page  : Math.max(1, parseInt(params.get("page"), 10)  || 1),
      limit : Math.min(maxLimit, Math.max(1, parseInt(params.get("limit"), 10) || defaultLimit)),
    };
  }

  /**
   * updateURL – push new URL with page + limit, storing pagination state
   * in history.state so popstate can reconstruct context.
   *
   * @param {number} page
   * @param {number} limit
   * @param {string} containerId - stored in state for popstate handler
   */
  function updateURL(page, limit, containerId = "") {
    const params = new URLSearchParams(window.location.search);
    params.set("page",  page);
    params.set("limit", limit);

    // ✅ Store pagination context in history state
    const state = {
      _pagination: { page, limit, containerId },
    };

    window.history.pushState(
      state,
      "",
      `${window.location.pathname}?${params.toString()}`
    );
  }

  /**
   * destroy – clean up listeners and registry entry.
   * Call on page unload or when a component is removed from the DOM.
   *
   * @param {string} containerId
   */
  function destroy(containerId) {
    _destroyListeners(containerId);
    registry.delete(containerId);
  }

  // ─── Return public surface ─────────────────────────────────────────────────
  return {
    // config (read-only for external use)
    defaultLimit,
    maxLimit,
    // methods
    render,
    goToPage,
    getParamsFromURL,
    updateURL,
    destroy,
  };
})();

// Export
window.Pagination = Pagination;