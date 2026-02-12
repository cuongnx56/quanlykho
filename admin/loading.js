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

// Expose globally so common.js apiCallWithLoading and other pages can show spinner
window.Loading = Loading;
