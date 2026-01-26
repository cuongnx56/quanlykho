// Loading helper functions
const Loading = {
  overlay: null,
  
  init() {
    if (this.overlay) return;
    
    this.overlay = document.createElement('div');
    this.overlay.className = 'loading-overlay';
    this.overlay.innerHTML = `
      <div class="loading-spinner">
        <div class="spinner"></div>
        <div class="loading-text">Đang xử lý...</div>
      </div>
    `;
    document.body.appendChild(this.overlay);
  },
  
  show(message = "Đang xử lý...") {
    this.init();
    this.overlay.querySelector('.loading-text').textContent = message;
    this.overlay.classList.add('active');
  },
  
  hide() {
    if (this.overlay) {
      this.overlay.classList.remove('active');
    }
  },
  
  button(btn, loading = true) {
    if (loading) {
      btn.disabled = true;
      btn.classList.add('loading');
      btn.dataset.originalText = btn.textContent;
    } else {
      btn.disabled = false;
      btn.classList.remove('loading');
      if (btn.dataset.originalText) {
        btn.textContent = btn.dataset.originalText;
      }
    }
  }
};

// Wrapper for API calls with loading
async function apiCallWithLoading(apiCallFn, message = "Đang xử lý...") {
  Loading.show(message);
  try {
    const result = await apiCallFn();
    return result;
  } finally {
    Loading.hide();
  }
}
