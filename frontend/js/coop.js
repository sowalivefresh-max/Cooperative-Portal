/* ============================================================
   COOPERATIVE SOCIETY MANAGEMENT PORTAL
   coop.js — Global Client-Side Utilities
   (Decoupled version: uses fetch() instead of google.script.run)
   ============================================================ */

// ─── API LAYER ────────────────────────────────────────────────────────────────

var COOP = window.COOP || {};

COOP.token = localStorage.getItem('coopToken') || '';
COOP.user = JSON.parse(localStorage.getItem('coopUser') || 'null');
COOP.theme = localStorage.getItem('coopTheme') || 'light';

/**
 * Makes a POST request to the GAS backend via fetch().
 * Uses Content-Type: text/plain to avoid CORS preflight.
 * @param {string}   action   - The API action name.
 * @param {Object}   data     - Request body data.
 * @param {Function} callback - Called with (error, result).
 */
COOP.api = function (action, data, callback) {
  var cfg = window.COOP_CONFIG || {};
  var apiUrl = cfg.apiUrl;

  if (!apiUrl || apiUrl === 'PASTE_YOUR_GAS_DEPLOYMENT_URL_HERE') {
    return callback('API URL not configured. Please edit frontend/js/config.js.');
  }

  var payload = Object.assign({}, data || {}, {
    action: action,
    token: COOP.token
  });

  fetch(apiUrl, {
    method: 'POST',
    // Must use text/plain to bypass CORS preflight (GAS limitation)
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  })
    .then(function (response) {
      if (!response.ok) {
        throw new Error('HTTP ' + response.status + ': ' + response.statusText);
      }
      return response.json();
    })
    .then(function (result) {
      if (!result) return callback('Server returned empty response.');
      if (!result.success) return callback(result.message || 'Request failed.', null);
      callback(null, result.data);
    })
    .catch(function (err) {
      callback(err ? (err.message || String(err)) : 'Network error. Please try again.');
    });
};

/**
 * Makes an async-style API call returning a Promise.
 * @param {string} action
 * @param {Object} data
 * @returns {Promise}
 */
COOP.apiAsync = function (action, data) {
  return new Promise(function (resolve, reject) {
    COOP.api(action, data, function (err, result) {
      if (err) reject(err); else resolve(result);
    });
  });
};

// ─── AUTH HELPERS ─────────────────────────────────────────────────────────────

COOP.saveSession = function (token, user) {
  COOP.token = token;
  COOP.user = user;
  localStorage.setItem('coopToken', token);
  localStorage.setItem('coopUser', JSON.stringify(user));
};

COOP.clearSession = function () {
  COOP.token = '';
  COOP.user = null;
  localStorage.removeItem('coopToken');
  localStorage.removeItem('coopUser');
};

COOP.isLoggedIn = function () {
  return !!COOP.token && !!COOP.user;
};

COOP.getUserRole = function () {
  return COOP.user ? COOP.user.role : null;
};

/**
 * Resolves the login page path relative to the current page location.
 * Works whether in root (index.html) or in pages/ subdirectory.
 */
COOP.getLoginUrl = function () {
  var path = window.location.pathname;
  if (path.indexOf('/pages/') !== -1) return '../index.html';
  return 'index.html';
};

COOP.logout = function () {
  COOP.api('logoutUser', { token: COOP.token }, function () { });
  COOP.clearSession();
  window.location.href = COOP.getLoginUrl();
};

// ─── FORMATTING HELPERS ───────────────────────────────────────────────────────

COOP.fmt = {
  currency: function (amount) {
    if (amount === null || amount === undefined || isNaN(amount)) return '₦0.00';
    return '₦' + parseFloat(amount).toLocaleString('en-NG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  },

  date: function (val) {
    if (!val) return '—';
    var d = new Date(val);
    if (isNaN(d.getTime())) return val;
    return d.toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' });
  },

  datetime: function (val) {
    if (!val) return '—';
    var d = new Date(val);
    if (isNaN(d.getTime())) return val;
    return d.toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
  },

  number: function (n) {
    if (n === null || n === undefined) return '0';
    return parseInt(n).toLocaleString();
  },

  percent: function (n, decimals) {
    return parseFloat(n || 0).toFixed(decimals !== undefined ? decimals : 1) + '%';
  },

  monthLabel: function (monthStr) {
    if (!monthStr) return '—';
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var parts = monthStr.split('-');
    return months[parseInt(parts[1], 10) - 1] + ' ' + parts[0];
  },

  initials: function (name) {
    if (!name) return '?';
    return name.split(' ').slice(0, 2).map(function (p) { return p[0]; }).join('').toUpperCase();
  },

  statusBadge: function (status) {
    var map = {
      Active: '<span class="badge-status badge-active">● Active</span>',
      Suspended: '<span class="badge-status badge-suspended">⚠ Suspended</span>',
      Inactive: '<span class="badge-status badge-suspended">○ Inactive</span>',
      Deleted: '<span class="badge-status badge-deleted">✕ Deleted</span>',
      Pending: '<span class="badge-status badge-pending">◑ Pending</span>',
      Recommended: '<span class="badge-status badge-recommended">★ Recommended</span>',
      Approved: '<span class="badge-status badge-approved">✓ Approved</span>',
      Rejected: '<span class="badge-status badge-rejected">✕ Rejected</span>',
      Disbursed: '<span class="badge-status badge-disbursed">💰 Disbursed</span>',
      Completed: '<span class="badge-status badge-completed">✔ Completed</span>',
      Defaulted: '<span class="badge-status badge-defaulted">⚠ Defaulted</span>',
      Reversed: '<span class="badge-status badge-reversed">↩ Reversed</span>',
      Processed: '<span class="badge-status badge-approved">✓ Processed</span>',
      Paid: '<span class="badge-status badge-active">✓ Paid</span>',
      Partial: '<span class="badge-status badge-recommended">◑ Partial</span>'
    };
    return map[status] || '<span class="badge-status badge-pending">' + (status || '—') + '</span>';
  }
};

// ─── TOAST NOTIFICATIONS ─────────────────────────────────────────────────────

COOP.toast = (function () {
  var container;
  function getContainer() {
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  function show(message, type, duration) {
    var icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    var t = type || 'success';
    var el = document.createElement('div');
    el.className = 'toast-item toast-' + t;
    el.innerHTML =
      '<div class="toast-icon">' + (icons[t] || '📢') + '</div>' +
      '<div class="toast-msg">' + COOP.escHtml(message) + '</div>' +
      '<button class="toast-close" onclick="this.parentElement.remove()">✕</button>';
    getContainer().appendChild(el);
    setTimeout(function () {
      el.style.animation = 'toastOut 0.3s ease forwards';
      setTimeout(function () { if (el.parentNode) el.remove(); }, 300);
    }, duration || 4500);
  }

  return {
    success: function (msg) { show(msg, 'success'); },
    error: function (msg) { show(msg, 'error', 6000); },
    warning: function (msg) { show(msg, 'warning'); },
    info: function (msg) { show(msg, 'info'); }
  };
})();

// ─── LOADING ──────────────────────────────────────────────────────────────────

COOP.loader = (function () {
  var el;
  return {
    show: function (text) {
      if (!el) {
        el = document.createElement('div');
        el.className = 'page-loader';
        el.innerHTML =
          '<div class="page-loader-ring"></div>' +
          '<div class="page-loader-text" id="loaderText">Loading…</div>';
        document.body.appendChild(el);
      }
      document.getElementById('loaderText').textContent = text || 'Loading…';
      el.style.display = 'flex';
    },
    hide: function () {
      if (el) el.style.display = 'none';
    }
  };
})();

// ─── MODAL HELPERS ────────────────────────────────────────────────────────────

COOP.modal = {
  open: function (id) {
    var backdrop = document.getElementById(id);
    if (!backdrop) return;
    backdrop.style.display = 'flex';
    requestAnimationFrame(function () {
      backdrop.classList.add('show');
      var box = backdrop.querySelector('.modal-box');
      if (box) box.classList.add('show');
    });
    document.body.style.overflow = 'hidden';
  },
  close: function (id) {
    var backdrop = document.getElementById(id);
    if (!backdrop) return;
    backdrop.classList.remove('show');
    var box = backdrop.querySelector('.modal-box');
    if (box) box.classList.remove('show');
    setTimeout(function () {
      backdrop.style.display = 'none';
      document.body.style.overflow = '';
    }, 220);
  },
  closeAll: function () {
    document.querySelectorAll('.modal-backdrop-coop.show').forEach(function (m) {
      COOP.modal.close(m.id);
    });
  }
};

// Close modal on backdrop click
document.addEventListener('click', function (e) {
  if (e.target.classList.contains('modal-backdrop-coop')) {
    COOP.modal.close(e.target.id);
  }
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') COOP.modal.closeAll();
});

// ─── SIDEBAR ─────────────────────────────────────────────────────────────────

COOP.sidebar = {
  init: function () {
    var toggle = document.getElementById('sidebarToggle');
    var sidebar = document.getElementById('mainSidebar');
    var overlay = document.getElementById('sidebarOverlay');
    if (!toggle || !sidebar) return;

    toggle.addEventListener('click', function () {
      sidebar.classList.toggle('open');
      if (overlay) overlay.classList.toggle('show');
    });
    if (overlay) {
      overlay.addEventListener('click', function () {
        sidebar.classList.remove('open');
        overlay.classList.remove('show');
      });
    }
  },
  setActive: function (page) {
    document.querySelectorAll('.nav-link').forEach(function (link) {
      link.classList.toggle('active', link.dataset.page === page);
    });
  }
};

// ─── DARK MODE ────────────────────────────────────────────────────────────────

COOP.darkMode = {
  init: function () {
    if (COOP.theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  },
  toggle: function () {
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    COOP.theme = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', COOP.theme);
    localStorage.setItem('coopTheme', COOP.theme);
    var btn = document.getElementById('darkModeToggle');
    if (btn) btn.innerHTML = COOP.theme === 'dark' ? '☀️' : '🌙';
  }
};

COOP.pagination = (function () {
  var _cb = null; // shared callback slot — one pagination per page view

  return {
    render: function (containerId, page, pages, onPageCallback) {
      var container = document.getElementById(containerId);
      if (!container) return;
      if (!pages || pages <= 1) { container.innerHTML = ''; return; }

      _cb = onPageCallback; // store for onclick
      COOP.pagination._cb = _cb;

      function btn(label, p, disabled, active) {
        return '<button class="page-btn' + (active ? ' active' : '') + '"' +
          (disabled ? ' disabled' : ' onclick="COOP.pagination._cb(' + p + ')"') +
          '>' + label + '</button>';
      }

      var html = '<div class="pagination-coop">';
      html += btn('‹', page - 1, page <= 1, false);

      var start = Math.max(1, page - 2);
      var end   = Math.min(pages, page + 2);
      if (start > 1) {
        html += btn('1', 1, false, false);
        if (start > 2) html += '<span style="padding:0 4px;color:var(--text-muted)">…</span>';
      }
      for (var i = start; i <= end; i++) {
        html += btn(i, i, false, i === page);
      }
      if (end < pages) {
        if (end < pages - 1) html += '<span style="padding:0 4px;color:var(--text-muted)">…</span>';
        html += btn(pages, pages, false, false);
      }
      html += btn('›', page + 1, page >= pages, false);
      html += '</div>';
      container.innerHTML = html;
    },
    _cb: null
  };
})();


// ─── SEARCH DEBOUNCE ─────────────────────────────────────────────────────────

COOP.debounce = function (fn, delay) {
  var timer;
  return function () {
    clearTimeout(timer);
    timer = setTimeout(fn.apply.bind(fn, this, arguments), delay || 400);
  };
};

// ─── SECURITY ─────────────────────────────────────────────────────────────────

COOP.escHtml = function (str) {
  return String(str || '').replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
};

// ─── CSV DOWNLOAD ─────────────────────────────────────────────────────────────

COOP.downloadCsv = function (csv, filename) {
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename || 'export.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// ─── PDF EXPORT / PRINT ────────────────────────────────────────────────────────
COOP.pdf = {
  _print: function (action, payload) {
    COOP.loader.show('Generating Document…');
    COOP.api(action, payload, function (err, data) {
      COOP.loader.hide();
      if (err) { COOP.toast.error(err); return; }
      if (data && data.html) COOP.printHtml(data.html);
      else COOP.toast.error('Failed to generate document.');
    });
  },
  exportFinancial: function () {
    this._print('exportFinancialReportPdf', {});
  },
  contributionReceipt: function (id) {
    this._print('exportContributionReceiptPdf', { contributionId: id });
  },
  savingsStatement: function (memberId, dateFrom, dateTo) {
    this._print('exportSavingsStatementPdf', { memberId: memberId, dateFrom: dateFrom, dateTo: dateTo });
  },
  loanStatement: function (loanNo) {
    this._print('exportLoanStatementPdf', { loanNumber: loanNo });
  },
  memberProfile: function (memberId) {
    this._print('exportMemberProfilePdf', { memberId: memberId });
  }
};

// ─── PRINT HTML HELPER ────────────────────────────────────────────────────────

COOP.printHtml = function (html) {
  var win = window.open('', '_blank', 'width=800,height=900');
  if (!win) { COOP.toast.error('Pop-up blocked. Please allow pop-ups for this site.'); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(function () { win.print(); }, 500);
};

// ─── FORM HELPERS ─────────────────────────────────────────────────────────────

COOP.form = {
  getValue: function (id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  },
  setValue: function (id, val) {
    var el = document.getElementById(id);
    if (el) el.value = val !== null && val !== undefined ? val : '';
  },
  clear: function (formId) {
    var form = document.getElementById(formId);
    if (form) form.reset();
  },
  validate: function (fields) {
    var errors = [];
    fields.forEach(function (f) {
      var el = document.getElementById(f.id);
      if (!el) return;
      var val = el.value.trim();
      if (f.required && !val) errors.push(f.label + ' is required');
      if (f.type === 'email' && val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) errors.push('Invalid email: ' + f.label);
      if (f.min !== undefined && parseFloat(val) < f.min) errors.push(f.label + ' must be at least ' + f.min);
      el.style.borderColor = (!f.required || val) ? '' : 'var(--danger)';
    });
    return errors;
  },
  serializeToObj: function (formId) {
    var form = document.getElementById(formId);
    if (!form) return {};
    var data = {};
    var elements = form.querySelectorAll('[name]');
    elements.forEach(function (el) {
      if (el.type === 'checkbox') data[el.name] = el.checked;
      else data[el.name] = el.value;
    });
    return data;
  }
};

// ─── CHART DEFAULTS ──────────────────────────────────────────────────────────

COOP.chartDefaults = {
  font: { family: 'Inter, sans-serif', size: 12 },
  green: { bg: 'rgba(27,94,32,0.15)', border: 'rgba(27,94,32,1)' },
  gold: { bg: 'rgba(245,127,23,0.15)', border: 'rgba(245,127,23,1)' },
  blue: { bg: 'rgba(2,119,189,0.15)', border: 'rgba(2,119,189,1)' },
  red: { bg: 'rgba(198,40,40,0.15)', border: 'rgba(198,40,40,1)' },
  teal: { bg: 'rgba(0,137,123,0.15)', border: 'rgba(0,137,123,1)' },
  palette: ['#1B5E20', '#F57F17', '#0277BD', '#C62828', '#00897B', '#6A1B9A', '#E65100', '#1565C0']
};

COOP.buildLineChart = function (canvasId, labels, datasets, title) {
  var ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  if (ctx._coopChart) ctx._coopChart.destroy();
  var chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: datasets.map(function (ds, i) {
        var color = COOP.chartDefaults.palette[i % COOP.chartDefaults.palette.length];
        return Object.assign({
          fill: true, tension: 0.4, borderWidth: 2.5, pointRadius: 4, pointHoverRadius: 6,
          backgroundColor: color.replace(')', ',0.1)').replace('rgb', 'rgba'),
          borderColor: color
        }, ds);
      })
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { font: COOP.chartDefaults.font, boxWidth: 12 } },
        title: title ? { display: true, text: title, font: { size: 13, weight: 'bold' } } : { display: false }
      },
      scales: {
        x: { grid: { color: 'rgba(0,0,0,.05)' }, ticks: { font: COOP.chartDefaults.font } },
        y: {
          grid: { color: 'rgba(0,0,0,.05)' }, ticks: {
            font: COOP.chartDefaults.font,
            callback: function (v) { return '₦' + v.toLocaleString(); }
          }
        }
      }
    }
  });
  ctx._coopChart = chart;
  return chart;
};

COOP.buildDoughnutChart = function (canvasId, labels, data, title) {
  var ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  if (ctx._coopChart) ctx._coopChart.destroy();
  var chart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{ data: data, backgroundColor: COOP.chartDefaults.palette, borderWidth: 2, hoverOffset: 8 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: COOP.chartDefaults.font, padding: 16 } },
        title: title ? { display: true, text: title, font: { size: 13, weight: 'bold' } } : { display: false }
      },
      cutout: '65%'
    }
  });
  ctx._coopChart = chart;
  return chart;
};

COOP.buildBarChart = function (canvasId, labels, datasets, title) {
  var ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  if (ctx._coopChart) ctx._coopChart.destroy();
  var chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: datasets.map(function (ds, i) {
        var color = COOP.chartDefaults.palette[i % COOP.chartDefaults.palette.length];
        return Object.assign({ borderRadius: 6, borderWidth: 0, backgroundColor: color }, ds);
      })
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { font: COOP.chartDefaults.font, boxWidth: 12 } },
        title: title ? { display: true, text: title, font: { size: 13, weight: 'bold' } } : { display: false }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: COOP.chartDefaults.font } },
        y: {
          grid: { color: 'rgba(0,0,0,.05)' }, ticks: {
            font: COOP.chartDefaults.font,
            callback: function (v) { return '₦' + v.toLocaleString(); }
          }
        }
      }
    }
  });
  ctx._coopChart = chart;
  return chart;
};

// ─── NOTIFICATIONS BADGE ─────────────────────────────────────────────────────

COOP.refreshNotifBadge = function () {
  if (!COOP.token) return;
  COOP.api('getUnreadNotificationCount', {}, function (err, data) {
    var badge = document.getElementById('notifBadge');
    if (!badge) return;
    if (!err && data && data.count > 0) {
      badge.textContent = data.count > 99 ? '99+' : data.count;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  });
};

// ─── SESSION GUARD ────────────────────────────────────────────────────────────

/**
 * Call at the top of every dashboard page to guard access.
 * Verifies token, checks role, and redirects to login on failure.
 * @param {string|string[]} allowedRoles - Role or roles allowed on this page.
 * @param {Function} onSuccess - Called with (user) on successful auth.
 */
COOP.guardPage = function (allowedRoles, onSuccess) {
  if (!COOP.token) {
    window.location.href = COOP.getLoginUrl();
    return;
  }
  COOP.api('getCurrentUser', {}, function (err, user) {
    if (err || !user) {
      COOP.clearSession();
      window.location.href = COOP.getLoginUrl();
      return;
    }
    var roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    if (roles.indexOf(user.role) === -1) {
      COOP.clearSession();
      window.location.href = COOP.getLoginUrl();
      return;
    }
    if (typeof onSuccess === 'function') {
      onSuccess(user);
      
      // Impersonation Banner Logic
      if (localStorage.getItem('coopOriginalToken')) {
        var banner = document.createElement('div');
        banner.style.position = 'fixed';
        banner.style.top = '0';
        banner.style.left = '0';
        banner.style.right = '0';
        banner.style.backgroundColor = '#d32f2f';
        banner.style.color = '#fff';
        banner.style.textAlign = 'center';
        banner.style.padding = '10px';
        banner.style.zIndex = '10000';
        banner.style.fontWeight = 'bold';
        banner.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
        banner.innerHTML = '🎭 You are impersonating ' + COOP.escHtml(user.fullName) + ' (' + COOP.escHtml(user.email) + '). ' +
          '<button onclick="COOP.endImpersonation()" style="margin-left:15px;padding:5px 12px;cursor:pointer;border:none;border-radius:4px;background:#fff;color:#d32f2f;font-weight:bold;font-size:13px">Return to Super Admin</button>';
        document.body.appendChild(banner);
        // Adjust main wrapper if exists
        var mw = document.querySelector('.main-wrapper');
        if (mw) { mw.style.paddingTop = '40px'; } else { document.body.style.paddingTop = '40px'; }
      }
    }
  });
};

COOP.endImpersonation = function() {
  var originalToken = localStorage.getItem('coopOriginalToken');
  if (originalToken) {
    localStorage.setItem('coopToken', originalToken);
    localStorage.removeItem('coopOriginalToken');
    // We assume the admin dashboard URL or simply redirecting to root works
    window.location.href = COOP.getAppUrl() ? COOP.getAppUrl() + '?page=admin' : '/?page=admin';
  }
};

// ─── USER PROFILE MODAL ───────────────────────────────────────────────────────

COOP.openEditProfile = function() {
  var modalId = 'globalEditProfileModal';
  var modal = document.getElementById(modalId);
  if (!modal) {
    modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal-backdrop-coop';
    modal.style.display = 'none';
    document.body.appendChild(modal);
  }

  var isMember = !!(COOP.user && COOP.user.memberId);
  var html = 
    '<div class="modal-box large" style="max-width:800px; max-height: 90vh; display: flex; flex-direction: column;">' +
      '<div class="modal-header-coop" style="flex-shrink:0">' +
        '<span style="font-size:22px">👤</span>' +
        '<div class="modal-title-coop">Edit Profile</div>' +
        '<button class="modal-close" onclick="COOP.modal.close(\'' + modalId + '\')">✕</button>' +
      '</div>' +
      '<div class="modal-body-coop" style="overflow-y:auto; flex-grow: 1; padding: 20px;">' +
        '<form id="globalEditProfileForm">' +
        '<h4 style="margin:0 0 16px 0;font-size:14px;color:var(--primary);border-bottom:1px solid var(--border);padding-bottom:8px">Account Information</h4>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">' +
          '<div class="form-group">' +
            '<label class="form-label">Full Name</label>' +
            '<input type="text" id="prof_fullName" class="form-control">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Email Address</label>' +
            '<input type="email" id="prof_email" class="form-control">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">New Password</label>' +
            '<input type="password" id="prof_password" class="form-control" placeholder="Leave blank to keep current">' +
            '<small style="color:var(--text-muted);font-size:11px">Must be at least 8 characters</small>' +
          '</div>' +
        '</div>';

  if (isMember) {
    html += 
        '<h4 style="margin:24px 0 16px 0;font-size:14px;color:var(--primary);border-bottom:1px solid var(--border);padding-bottom:8px">Contact & Demographics</h4>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">' +
          '<div class="form-group"><label class="form-label">Phone Number</label><input type="text" id="prof_phone" class="form-control"></div>' +
          '<div class="form-group"><label class="form-label">Alt Phone</label><input type="text" id="prof_altPhone" class="form-control"></div>' +
          '<div class="form-group"><label class="form-label">Gender</label><select id="prof_gender" class="form-control form-select"><option value="Male">Male</option><option value="Female">Female</option></select></div>' +
          '<div class="form-group"><label class="form-label">Date of Birth</label><input type="date" id="prof_dob" class="form-control"></div>' +
        '</div>' +
        '<div class="form-group" style="margin-bottom:24px">' +
          '<label class="form-label">Residential Address</label>' +
          '<textarea id="prof_address" class="form-control" rows="2"></textarea>' +
        '</div>' +
        
        '<h4 style="margin:24px 0 16px 0;font-size:14px;color:var(--primary);border-bottom:1px solid var(--border);padding-bottom:8px">Employment</h4>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">' +
          '<div class="form-group"><label class="form-label">Marital Status</label><select id="prof_marital" class="form-control form-select"><option value="Single">Single</option><option value="Married">Married</option><option value="Divorced">Divorced</option><option value="Widowed">Widowed</option></select></div>' +
          '<div class="form-group"><label class="form-label">Occupation</label><input type="text" id="prof_occupation" class="form-control"></div>' +
          '<div class="form-group"><label class="form-label">Employer</label><input type="text" id="prof_employer" class="form-control"></div>' +
        '</div>' +
        
        '<h4 style="margin:24px 0 16px 0;font-size:14px;color:var(--primary);border-bottom:1px solid var(--border);padding-bottom:8px">Next of Kin</h4>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">' +
          '<div class="form-group"><label class="form-label">Name</label><input type="text" id="prof_nok_name" class="form-control"></div>' +
          '<div class="form-group"><label class="form-label">Relationship</label><input type="text" id="prof_nok_rel" class="form-control"></div>' +
          '<div class="form-group"><label class="form-label">Phone</label><input type="text" id="prof_nok_phone" class="form-control"></div>' +
          '<div class="form-group"><label class="form-label">Address</label><input type="text" id="prof_nok_address" class="form-control"></div>' +
        '</div>';
  }

  html += 
        '</form>' +
      '</div>' +
      '<div class="modal-footer-coop" style="flex-shrink:0">' +
        '<button class="btn-outline-coop" onclick="COOP.modal.close(\'' + modalId + '\')">Cancel</button>' +
        '<button class="btn-primary-coop" id="saveProfileBtn" onclick="COOP.submitEditProfile()">💾 Save Profile</button>' +
      '</div>' +
    '</div>';

  modal.innerHTML = html;

  // Pre-fill fields
  document.getElementById('prof_fullName').value = COOP.user ? (COOP.user.fullName || '') : '';
  document.getElementById('prof_email').value = COOP.user ? (COOP.user.email || '') : '';
  document.getElementById('prof_password').value = '';

  if (isMember && COOP.user.memberDetails) {
    var m = COOP.user.memberDetails;
    document.getElementById('prof_phone').value = m.phone || '';
    document.getElementById('prof_altPhone').value = m.altPhone || '';
    document.getElementById('prof_gender').value = m.gender || 'Male';
    document.getElementById('prof_dob').value = m.dateOfBirth ? m.dateOfBirth.substring(0,10) : '';
    document.getElementById('prof_address').value = m.residentialAddress || '';
    document.getElementById('prof_marital').value = m.maritalStatus || 'Single';
    document.getElementById('prof_occupation').value = m.occupation || '';
    document.getElementById('prof_employer').value = m.employer || '';
    document.getElementById('prof_nok_name').value = m.nextOfKinName || '';
    document.getElementById('prof_nok_rel').value = m.nextOfKinRelationship || '';
    document.getElementById('prof_nok_phone').value = m.nextOfKinPhone || '';
    document.getElementById('prof_nok_address').value = m.nextOfKinAddress || '';
  }

  COOP.modal.open(modalId);
};

COOP.submitEditProfile = function() {
  var fullName = document.getElementById('prof_fullName').value.trim();
  var email = document.getElementById('prof_email').value.trim();
  var password = document.getElementById('prof_password').value;

  if (!fullName || !email) {
    COOP.toast.warning('Full name and email are required.');
    return;
  }
  
  if (password && password.length > 0 && password.length < 8) {
    COOP.toast.warning('Password must be at least 8 characters.');
    return;
  }

  var btn = document.getElementById('saveProfileBtn');
  btn.disabled = true;
  COOP.loader.show('Updating profile...');

  var payload = { fullName: fullName, email: email };
  if (password) payload.password = password;

  var isMember = !!(COOP.user && COOP.user.memberId);
  if (isMember) {
    payload.phone = document.getElementById('prof_phone').value.trim();
    payload.altPhone = document.getElementById('prof_altPhone').value.trim();
    payload.gender = document.getElementById('prof_gender').value;
    payload.dateOfBirth = document.getElementById('prof_dob').value;
    payload.residentialAddress = document.getElementById('prof_address').value.trim();
    payload.maritalStatus = document.getElementById('prof_marital').value;
    payload.occupation = document.getElementById('prof_occupation').value.trim();
    payload.employer = document.getElementById('prof_employer').value.trim();
    payload.nextOfKinName = document.getElementById('prof_nok_name').value.trim();
    payload.nextOfKinRelationship = document.getElementById('prof_nok_rel').value.trim();
    payload.nextOfKinPhone = document.getElementById('prof_nok_phone').value.trim();
    payload.nextOfKinAddress = document.getElementById('prof_nok_address').value.trim();
  }

  COOP.api('updateProfile', payload, function(err) {
    btn.disabled = false;
    COOP.loader.hide();
    if (err) { COOP.toast.error(err); return; }
    
    COOP.toast.success('Profile updated successfully!');
    COOP.modal.close('globalEditProfileModal');
    
    // Update local user object
    if (COOP.user) {
      COOP.user.fullName = fullName;
      COOP.user.email = email;
      if (isMember) {
        if (!COOP.user.memberDetails) COOP.user.memberDetails = {};
        for (var key in payload) {
          if (key !== 'password' && payload.hasOwnProperty(key)) {
            COOP.user.memberDetails[key] = payload[key];
          }
        }
      }
      COOP.saveSession(COOP.token, COOP.user);
      
      // Update UI greeting if it exists
      var greeting = document.getElementById('dashboardGreeting');
      if (greeting) greeting.textContent = 'Welcome back, ' + fullName + '!';
      var topNavName = document.querySelector('.topbar-user-info div');
      if (topNavName) topNavName.textContent = fullName;
    }
  });
};

// ─── INIT ON LOAD ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  COOP.darkMode.init();
  COOP.sidebar.init();
  COOP.refreshNotifBadge();
  setInterval(COOP.refreshNotifBadge, 60000);
});
