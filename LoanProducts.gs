/**
 * ============================================================
 *  COOPERATIVE SOCIETY MANAGEMENT PORTAL
 *  LoanProducts.gs  -  Loan Product Catalogue & Utility Functions
 * ============================================================
 */

/**
 * Returns all active loan products.
 * @param {Object} params - { token }
 */
function getLoanProducts(params) {
  try {
    var auth = authorise_(params.token, 'view_loans');
    if (auth.error) {
      var selfAuth = authorise_(params.token, 'view_own_loans');
      if (selfAuth.error) return selfAuth.error;
      auth = selfAuth;
    }

    var products = firestoreGetAll_('loanProducts');
    if (!products || products.length === 0) {
      products = getDefaultLoanProducts_();
    }
    products.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
    return successResponse(products);
  } catch (e) {
    logError('LoanProducts', 'getLoanProducts', e);
    return errorResponse('Failed to retrieve loan products.', 500);
  }
}

/**
 * Creates or updates a loan product.
 * @param {Object} params - { token, productId?, name, description, interestRate,
 *                            minAmount, maxAmount, minDuration, maxDuration, isActive }
 */
function saveLoanProduct(params) {
  try {
    var auth = authorise_(params.token, 'manage_settings');
    if (auth.error) return auth.error;

    var v = validateRequired(params, ['name', 'interestRate', 'minAmount', 'maxAmount']);
    if (!v.valid) return errorResponse(v.errors.join(', '), 400);

    var productId = params.productId || sanitise(params.name).toLowerCase().replace(/\s+/g, '_');
    var now = new Date().toISOString();

    var data = {
      productId:    productId,
      name:         sanitise(params.name),
      description:  sanitise(params.description || ''),
      interestRate: parseFloat(params.interestRate),
      minAmount:    parseFloat(params.minAmount),
      maxAmount:    parseFloat(params.maxAmount),
      minDuration:  parseInt(params.minDuration || 1, 10),
      maxDuration:  parseInt(params.maxDuration || 24, 10),
      isActive:     params.isActive !== false,
      updatedAt:    now
    };

    var existing = firestoreGet_('loanProducts', productId);
    if (existing) {
      firestoreUpdate_('loanProducts', productId, data);
    } else {
      data.createdAt = now;
      firestoreCreate_('loanProducts', data, productId);
    }

    logAction_('SAVE_LOAN_PRODUCT', 'LoanProducts', auth.session.userId, productId, existing, data);
    return successResponse({ productId: productId }, 'Loan product saved.');
  } catch (e) {
    logError('LoanProducts', 'saveLoanProduct', e);
    return errorResponse('Failed to save loan product.', 500);
  }
}

/**
 * Deactivates/soft-deletes a loan product.
 * @param {Object} params - { token, productId }
 */
function deleteLoanProduct(params) {
  try {
    var auth = authorise_(params.token, 'manage_settings');
    if (auth.error) return auth.error;

    firestoreUpdate_('loanProducts', params.productId, {
      isActive:  false,
      updatedAt: new Date().toISOString()
    });

    logAction_('DELETE_LOAN_PRODUCT', 'LoanProducts', auth.session.userId, params.productId, null, null);
    return successResponse(null, 'Loan product deactivated.');
  } catch (e) {
    logError('LoanProducts', 'deleteLoanProduct', e);
    return errorResponse('Failed to deactivate loan product.', 500);
  }
}

/**
 * Returns the default seeded loan products.
 * @returns {Array}
 */
function getDefaultLoanProducts_() {
  return [
    {
      productId:    'emergency',
      name:         'Emergency Loan',
      description:  'Short-term loan for urgent financial needs.',
      interestRate: 5,
      minAmount:    10000,
      maxAmount:    200000,
      minDuration:  1,
      maxDuration:  6,
      isActive:     true
    },
    {
      productId:    'soft',
      name:         'Soft Loan',
      description:  'Low-interest loan for members in good standing.',
      interestRate: 3,
      minAmount:    20000,
      maxAmount:    500000,
      minDuration:  3,
      maxDuration:  12,
      isActive:     true
    },
    {
      productId:    'regular',
      name:         'Regular Loan',
      description:  'Standard cooperative loan for general needs.',
      interestRate: 5,
      minAmount:    50000,
      maxAmount:    1000000,
      minDuration:  6,
      maxDuration:  24,
      isActive:     true
    },
    {
      productId:    'commodity',
      name:         'Commodity Loan',
      description:  'Loan for purchasing goods or equipment.',
      interestRate: 7,
      minAmount:    100000,
      maxAmount:    2000000,
      minDuration:  6,
      maxDuration:  36,
      isActive:     true
    },
    {
      productId:    'education',
      name:         'Education Loan',
      description:  'Loan for educational expenses.',
      interestRate: 4,
      minAmount:    30000,
      maxAmount:    500000,
      minDuration:  3,
      maxDuration:  12,
      isActive:     true
    },
    {
      productId:    'housing',
      name:         'Housing Loan',
      description:  'Long-term loan for housing improvements.',
      interestRate: 8,
      minAmount:    200000,
      maxAmount:    5000000,
      minDuration:  12,
      maxDuration:  60,
      isActive:     true
    }
  ];
}

// ─── FINANCIAL CALCULATION HELPERS ────────────────────────────────────────────

/**
 * Calculates flat interest.
 * Formula: Principal × Rate × Duration / 12
 * @param {number} principal
 * @param {number} annualRatePercent
 * @param {number} durationMonths
 * @returns {number}
 */
function calcFlatInterest(principal, annualRatePercent, durationMonths) {
  return (principal * (annualRatePercent / 100) * (durationMonths / 12));
}

/**
 * Calculates a penalty for late payment.
 * @param {number} amount
 * @param {number} penaltyRatePercent - Monthly rate
 * @param {number} daysOverdue
 * @returns {number}
 */
function calcPenalty(amount, penaltyRatePercent, daysOverdue) {
  return amount * (penaltyRatePercent / 100) * (daysOverdue / 30);
}

/**
 * Generates a full repayment schedule.
 * @param {number} principal
 * @param {number} annualRatePercent
 * @param {number} durationMonths
 * @param {Date}   firstRepaymentDate
 * @param {string} method - 'flat' | 'reducing'
 * @returns {Array}
 */
function generateRepaymentSchedule(principal, annualRatePercent, durationMonths, firstRepaymentDate, method) {
  var schedule = [];
  var totalInterest = calcFlatInterest(principal, annualRatePercent, durationMonths);
  var totalRepayable = principal + totalInterest;
  var installmentAmount = Math.round((totalRepayable / durationMonths) * 100) / 100;

  var balance = totalRepayable;

  for (var i = 1; i <= durationMonths; i++) {
    var dueDate = new Date(firstRepaymentDate);
    dueDate.setMonth(dueDate.getMonth() + (i - 1));

    var isLast = i === durationMonths;
    var amount  = isLast ? Math.round(balance * 100) / 100 : installmentAmount;
    balance     = Math.round((balance - amount) * 100) / 100;

    schedule.push({
      installmentNumber: i,
      dueDate:           Utilities.formatDate(dueDate, 'Africa/Lagos', 'yyyy-MM-dd'),
      installmentAmount: amount,
      principalPortion:  Math.round((principal / durationMonths) * 100) / 100,
      interestPortion:   Math.round((totalInterest / durationMonths) * 100) / 100,
      balance:           balance < 0 ? 0 : balance,
      status:            'Pending',
      paidAmount:        0,
      paidDate:          null
    });
  }
  return schedule;
}

/**
 * Adds months to a Date object.
 * @param {Date} date
 * @param {number} months
 * @returns {Date}
 */
function addMonths(date, months) {
  var d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

/**
 * Returns the current month in yyyy-MM format.
 * @returns {string}
 */
function getCurrentMonth() {
  return Utilities.formatDate(new Date(), 'Africa/Lagos', 'yyyy-MM');
}

/**
 * Returns a label for a month string (e.g., "January 2024").
 * @param {string} monthStr - yyyy-MM
 * @returns {string}
 */
function formatMonthLabel(monthStr) {
  if (!monthStr) return '';
  var parts = monthStr.split('-');
  var months = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
  return months[parseInt(parts[1], 10) - 1] + ' ' + parts[0];
}

/**
 * Returns a formatted date string.
 * @param {Date|string} date
 * @returns {string}
 */
function formatDate(date) {
  if (!date) return '';
  var d = typeof date === 'string' ? new Date(date) : date;
  return Utilities.formatDate(d, 'Africa/Lagos', 'dd MMM yyyy');
}

/**
 * Returns a formatted date-time string.
 * @param {Date|string} date
 * @returns {string}
 */
function formatDateTime(date) {
  if (!date) return '';
  var d = typeof date === 'string' ? new Date(date) : date;
  return Utilities.formatDate(d, 'Africa/Lagos', 'dd MMM yyyy HH:mm');
}

/**
 * Generates a receipt number.
 * @returns {string}
 */
function generateReceiptNumber() {
  return 'RCP-' + Utilities.formatDate(new Date(), 'Africa/Lagos', 'yyyyMMdd') +
         '-' + Math.random().toString(36).substring(2, 7).toUpperCase();
}

/**
 * Generates a unique entity ID.
 * @param {string} prefix
 * @param {string} collection  (unused here, but provided for context)
 * @returns {string}
 */
function generateId(prefix, collection) {
  return prefix + '-' + Utilities.formatDate(new Date(), 'Africa/Lagos', 'yyyyMMdd') +
         '-' + Utilities.getUuid().replace(/-/g, '').substring(0, 8).toUpperCase();
}

/**
 * Paginates an array.
 * @param {Array}  arr
 * @param {number} page
 * @param {number} pageSize
 * @returns {{ data, page, pages, total }}
 */
function paginate(arr, page, pageSize) {
  page     = Math.max(1, parseInt(page || 1, 10));
  pageSize = Math.min(100, parseInt(pageSize || 20, 10));
  var total = arr.length;
  var pages = Math.ceil(total / pageSize);
  var data  = arr.slice((page - 1) * pageSize, page * pageSize);
  return { data: data, page: page, pages: pages, total: total };
}

/**
 * Filters an array by a search string across multiple fields.
 * @param {Array}    arr
 * @param {string}   query
 * @param {string[]} fields
 * @returns {Array}
 */
function searchFilter(arr, query, fields) {
  if (!query || !query.trim()) return arr;
  var q = query.toLowerCase().trim();
  return arr.filter(function(item) {
    return fields.some(function(field) {
      var val = String(item[field] || '').toLowerCase();
      return val.indexOf(q) !== -1;
    });
  });
}

/**
 * Validates required fields in a params object.
 * @param {Object}   params
 * @param {string[]} fields
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateRequired(params, fields) {
  var errors = [];
  fields.forEach(function(f) {
    if (!params[f] && params[f] !== 0 && params[f] !== false) {
      errors.push(f + ' is required');
    }
  });
  return { valid: errors.length === 0, errors: errors };
}

/**
 * Sanitises a string to prevent XSS/injection.
 * @param {string} str
 * @returns {string}
 */
function sanitise(str) {
  if (!str) return '';
  return String(str)
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .trim();
}

/**
 * Returns a success response object.
 * @param {*}      data
 * @param {string} message
 */
function successResponse(data, message) {
  return { success: true, data: data, message: message || null };
}

/**
 * Returns an error response object.
 * @param {string} message
 * @param {number} code
 */
function errorResponse(message, code) {
  return { success: false, message: message, code: code || 400 };
}

/**
 * Converts an array of objects to CSV.
 * @param {Array}    data
 * @param {string[]} headers
 * @param {string[]} keys
 * @returns {string}
 */
function toCsv(data, headers, keys) {
  var rows = [headers.join(',')];
  data.forEach(function(item) {
    rows.push(keys.map(function(k) {
      var val = item[k];
      if (val === null || val === undefined) return '';
      val = String(val).replace(/"/g, '""');
      return '"' + val + '"';
    }).join(','));
  });
  return rows.join('\n');
}

/**
 * Logs an error to Apps Script Logger.
 * @param {string} module
 * @param {string} fn
 * @param {Error}  err
 */
function logError(module, fn, err) {
  Logger.log('[ERROR][' + module + '][' + fn + '] ' + (err.message || err));
}

/**
 * Retrieves a public system information (no auth required).
 * @param {Object} params
 */
function getPublicSystemInfo(params) {
  try {
    var name     = getSetting('societyName')    || 'Cooperative Society Portal';
    var motto    = getSetting('societyMotto')   || '';
    var address  = getSetting('societyAddress') || '';
    var logo     = getSetting('societyLogoUrl') || '';
    return successResponse({
      societyName:    name,
      societyMotto:   motto,
      societyAddress: address,
      societyLogoUrl: logo
    });
  } catch (e) {
    return successResponse({ societyName: 'Cooperative Society Portal' });
  }
}
