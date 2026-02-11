// Pagination Helper - Reusable pagination utilities
const Pagination = {
  // Default config (use PAGINATION constants if available, otherwise fallback)
  defaultLimit: typeof PAGINATION !== 'undefined' ? PAGINATION.DEFAULT_LIMIT : 20,
  maxLimit: typeof PAGINATION !== 'undefined' ? PAGINATION.MAX_LIMIT : 20,
  
  // Store callbacks for each pagination instance
  callbacks: {},
  
  // Create pagination HTML
  render(containerId, currentPage, totalPages, totalItems, onPageChange, itemLabel = 'items') {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    if (totalPages <= 1) {
      container.innerHTML = '';
      return;
    }
    
    // Store callback
    this.callbacks[containerId] = onPageChange;
    
    let html = '<div class="pagination">';
    
    // Previous button
    if (currentPage > 1) {
      html += `<button class="pagination-btn" data-page="${currentPage - 1}" data-container="${containerId}">‹ Trước</button>`;
    } else {
      html += `<button class="pagination-btn" disabled>‹ Trước</button>`;
    }
    
    // Page numbers
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, currentPage + 2);
    
    if (startPage > 1) {
      html += `<button class="pagination-btn" data-page="1" data-container="${containerId}">1</button>`;
      if (startPage > 2) {
        html += `<span class="pagination-ellipsis">...</span>`;
      }
    }
    
    for (let i = startPage; i <= endPage; i++) {
      if (i === currentPage) {
        html += `<button class="pagination-btn active">${i}</button>`;
      } else {
        html += `<button class="pagination-btn" data-page="${i}" data-container="${containerId}">${i}</button>`;
      }
    }
    
    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        html += `<span class="pagination-ellipsis">...</span>`;
      }
      html += `<button class="pagination-btn" data-page="${totalPages}" data-container="${containerId}">${totalPages}</button>`;
    }
    
    // Next button
    if (currentPage < totalPages) {
      html += `<button class="pagination-btn" data-page="${currentPage + 1}" data-container="${containerId}">Sau ›</button>`;
    } else {
      html += `<button class="pagination-btn" disabled>Sau ›</button>`;
    }
    
    html += '</div>';
    html += `<div class="pagination-info">Trang ${currentPage}/${totalPages} (${totalItems} ${itemLabel})</div>`;
    
    container.innerHTML = html;
    
    // Attach event listeners
    container.querySelectorAll('.pagination-btn[data-page]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const page = parseInt(e.target.getAttribute('data-page'));
        const containerId = e.target.getAttribute('data-container');
        this.goToPage(page, containerId);
      });
    });
  },
  
  // Go to specific page
  goToPage(page, containerId) {
    const callback = this.callbacks[containerId];
    if (typeof callback === 'function') {
      callback(page);
    }
  },
  
  // Parse pagination params from URL
  getParamsFromURL() {
    const params = new URLSearchParams(window.location.search);
    return {
      page: Math.max(1, parseInt(params.get('page')) || 1),
      limit: Math.min(this.maxLimit, Math.max(10, parseInt(params.get('limit')) || this.defaultLimit))
    };
  },
  
  // Update URL with pagination params
  updateURL(page, limit) {
    const params = new URLSearchParams(window.location.search);
    params.set('page', page);
    params.set('limit', limit);
    window.history.pushState({}, '', `${window.location.pathname}?${params.toString()}`);
  }
};
