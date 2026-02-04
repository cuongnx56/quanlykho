/**
 * Sidebar Navigation - Common for all admin pages
 * Handles sidebar initialization, active state, and mobile toggle
 */

(function() {
  'use strict';

  // Initialize sidebar when DOM is ready
  function initSidebar() {
    // Mark current page as active
    const currentPage = getCurrentPage();
    if (currentPage) {
      const navItem = document.querySelector(`.nav-item[data-page="${currentPage}"]`);
      if (navItem) {
        navItem.classList.add('active');
      }
    }

    // Add has-sidebar class to body
    document.body.classList.add('has-sidebar');

    // Mobile menu toggle
    const mobileToggle = document.getElementById('mobile-menu-toggle');
    if (mobileToggle) {
      mobileToggle.addEventListener('click', function() {
        const sidebar = document.getElementById('admin-sidebar');
        if (sidebar) {
          sidebar.classList.toggle('open');
        }
      });
    }

    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', function(e) {
      if (window.innerWidth <= 768) {
        const sidebar = document.getElementById('admin-sidebar');
        const toggle = document.getElementById('mobile-menu-toggle');
        
        if (sidebar && !sidebar.contains(e.target) && !toggle?.contains(e.target)) {
          sidebar.classList.remove('open');
        }
      }
    });
  }

  /**
   * Get current page name from URL
   */
  function getCurrentPage() {
    const path = window.location.pathname;
    const match = path.match(/\/([^\/]+)\.html$/);
    if (match) {
      return match[1];
    }
    return null;
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSidebar);
  } else {
    initSidebar();
  }
})();
