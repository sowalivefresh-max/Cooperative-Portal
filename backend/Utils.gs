/**
 * ============================================================
 *  COOPERATIVE SOCIETY MANAGEMENT PORTAL
 *  Utils.gs  -  Shared Helpers, Validators, Formatters
 * ============================================================
 */

// ─── RESPONSE HELPERS ─────────────────────────────────────────────────────────

/**
 * Returns a standardised success response object.
 * @param {*} data   - The payload to return.
 * @param {string} message - Human-readable success message.
 */
function successResponse(data, message) {
  return { success: true, data: data || null, message: message || 'OK' };
}

/**
 * Returns a standardised error response object.
 * @param {string} message - Human-readable error message.
 * @param {number} code    - Optional HTTP-style error code.
 */
function errorResponse(message, code) {
  Logger.log('[ERROR] ' + message);
  return { success: false, data: null, message: message || 'An error occurred', code: code || 500 };
}

// ─── ID & REFERENCE GENERATION ────────────────────────────────────────────────

/**
 * Generates a unique sequential document ID with a prefix.
 * Falls back to a timestamp-based ID if Firestore count fails.
 * @param {string} prefix  - e.g. "MBR", "LN", "CTB"
 * @param {string} collection - Firestore collection name for counter
 * @returns {string}
 */
function generateId(prefix, collection) {
  try {
    var counter = getNextCounter_(collection || prefix);
    var padded = String(counter).padStart(5, '0');
    return prefix + '-' + padded;
  } catch (e) {
    // Fallback to timestamp
    return prefix + '-' + Date.now();
  }
}

/**
 * Generates a unique receipt number.
 * Format: RCP-YYYY-00001
 * @returns {string}
 */
function generateReceiptNumber() {
  var year = new Date().getFullYear();
  var counter = getNextCounter_('receipts');
  return 'RCP-' + year + '-' + String(counter).padStart(5, '0');
}

/**
 * Retrieves and increments a global counter stored in Script Properties.
 * @param {string} key
 * @returns {number}
 */
function getNextCounter_(key) {
  var props = PropertiesService.getScriptProperties();
  var current = parseInt(props.getProperty('COUNTER_' + key.toUpperCase()) || '0', 10);
  var next = current + 1;
  props.setProperty('COUNTER_' + key.toUpperCase(), String(next));
  return next;
}

/**
 * Generates a secure random session token (UUID v4 style).
 * @returns {string}
 */
function generateToken() {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var token = '';
  for (var i = 0; i < 64; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token + '_' + Date.now();
}

/**
 * Generates a UUID v4.
 * @returns {string}
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0;
    var v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ─── PASSWORD & SECURITY ───────────────────────────────────────────────────────

/**
 * Hashes a password using SHA-256 with a fixed salt stored in Script Properties.
 * @param {string} password - Plain text password.
 * @returns {string} Hex digest.
 */
function hashPassword(password) {
  var salt = PropertiesService.getScriptProperties().getProperty('PASSWORD_SALT') || 'COOP_SALT_2024';
  var input = salt + password + salt;
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input);
  return digest.map(function(b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('');
}

/**
 * Verifies a plain-text password against a stored hash.
 * @param {string} plain  - Plain text password input.
 * @param {string} stored - Stored hash from database.
 * @returns {boolean}
 */
function verifyPassword(plain, stored) {
  return hashPassword(plain) === stored;
}

/**
 * Generates a temporary password of given length.
 * @param {number} length
 * @returns {string}
 */
function generateTempPassword(length) {
  var len = length || 10;
  var chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#';
  var pw = '';
  for (var i = 0; i < len; i++) {
    pw += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pw;
}

// ─── FORMATTING HELPERS ────────────────────────────────────────────────────────

/**
 * Formats a number as Nigerian Naira currency.
 * @param {number} amount
 * @returns {string}
 */
function formatCurrency(amount) {
  if (isNaN(amount) || amount === null || amount === undefined) return '₦0.00';
  return '₦' + parseFloat(amount).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Formats a JavaScript Date or ISO string to DD/MM/YYYY.
 * @param {Date|string} date
 * @returns {string}
 */
function formatDate(date) {
  if (!date) return '';
  var d = (date instanceof Date) ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  var day   = String(d.getDate()).padStart(2, '0');
  var month = String(d.getMonth() + 1).padStart(2, '0');
  var year  = d.getFullYear();
  return day + '/' + month + '/' + year;
}

/**
 * Formats a Date to a human-readable datetime string.
 * @param {Date|string} date
 * @returns {string}
 */
function formatDateTime(date) {
  if (!date) return '';
  var d = (date instanceof Date) ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  return formatDate(d) + ' ' + d.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Returns the current date in YYYY-MM format (for monthly contributions).
 * @returns {string}
 */
function getCurrentMonth() {
  var now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
}

/**
 * Returns the month name from a YYYY-MM string.
 * @param {string} monthStr - e.g. "2024-01"
 * @returns {string} e.g. "January 2024"
 */
function formatMonthLabel(monthStr) {
  if (!monthStr) return '';
  var parts = monthStr.split('-');
  var months = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
  return months[parseInt(parts[1], 10) - 1] + ' ' + parts[0];
}

/**
 * Calculates the number of months between two dates.
 * @param {Date} from
 * @param {Date} to
 * @returns {number}
 */
function monthsBetween(from, to) {
  var d1 = new Date(from);
  var d2 = new Date(to);
  return (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
}

/**
 * Adds N months to a date and returns new Date.
 * @param {Date} date
 * @param {number} months
 * @returns {Date}
 */
function addMonths(date, months) {
  var d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

// ─── VALIDATION ────────────────────────────────────────────────────────────────

/**
 * Validates an email address format.
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

/**
 * Validates a Nigerian phone number (basic).
 * @param {string} phone
 * @returns {boolean}
 */
function isValidPhone(phone) {
  return /^(\+234|0)[789][01]\d{8}$/.test(String(phone || '').replace(/\s/g, ''));
}

/**
 * Validates that a required field is not empty.
 * @param {*} value
 * @returns {boolean}
 */
function isRequired(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

/**
 * Validates an object against a set of required fields.
 * @param {Object} data        - The object to validate.
 * @param {string[]} required  - List of required field names.
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateRequired(data, required) {
  var errors = [];
  required.forEach(function(field) {
    if (!isRequired(data[field])) {
      errors.push(field + ' is required');
    }
  });
  return { valid: errors.length === 0, errors: errors };
}

/**
 * Sanitises a string to prevent injection attacks.
 * @param {string} str
 * @returns {string}
 */
function sanitise(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/[<>"'&]/g, function(c) {
    return { '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;' }[c];
  });
}

// ─── FINANCIAL CALCULATIONS ────────────────────────────────────────────────────

/**
 * Calculates flat-rate loan interest.
 * @param {number} principal
 * @param {number} ratePercent - Monthly interest rate (%).
 * @param {number} months
 * @returns {number} Total interest amount.
 */
function calcFlatInterest(principal, ratePercent, months) {
  return (principal * (ratePercent / 100)) * months;
}

/**
 * Calculates reducing balance loan interest for a given month.
 * @param {number} outstanding
 * @param {number} monthlyRate - Monthly interest rate (%).
 * @returns {number}
 */
function calcReducingInterest(outstanding, monthlyRate) {
  return outstanding * (monthlyRate / 100);
}

/**
 * Calculates monthly instalment (flat rate).
 * @param {number} principal
 * @param {number} ratePercent
 * @param {number} months
 * @returns {number}
 */
function calcMonthlyInstalment(principal, ratePercent, months) {
  var totalInterest = calcFlatInterest(principal, ratePercent, months);
  return Math.ceil((principal + totalInterest) / months);
}

/**
 * Generates a full loan repayment schedule.
 * @param {number} principal
 * @param {number} ratePercent - Monthly rate
 * @param {number} months
 * @param {Date} startDate - First repayment date
 * @param {string} method - 'flat' or 'reducing'
 * @returns {Array} Array of repayment schedule objects.
 */
function generateRepaymentSchedule(principal, ratePercent, months, startDate, method) {
  var schedule = [];
  var method_ = method || 'flat';
  var start = startDate ? new Date(startDate) : new Date();
  var totalInterest = calcFlatInterest(principal, ratePercent, months);
  var monthlyPrincipal = principal / months;
  var outstanding = principal;

  for (var i = 1; i <= months; i++) {
    var dueDate = addMonths(start, i);
    var interest = 0;
    var instalment = 0;

    if (method_ === 'reducing') {
      interest = calcReducingInterest(outstanding, ratePercent);
      instalment = monthlyPrincipal + interest;
      outstanding -= monthlyPrincipal;
    } else {
      interest = totalInterest / months;
      instalment = calcMonthlyInstalment(principal, ratePercent, months);
      outstanding -= monthlyPrincipal;
    }

    schedule.push({
      installmentNumber: i,
      dueDate: Utilities.formatDate(dueDate, 'Africa/Lagos', 'yyyy-MM-dd'),
      principal: Math.round(monthlyPrincipal * 100) / 100,
      interest: Math.round(interest * 100) / 100,
      installmentAmount: Math.round(instalment * 100) / 100,
      outstanding: Math.max(0, Math.round(outstanding * 100) / 100),
      status: 'Pending',
      paidAmount: 0,
      paidDate: null
    });
  }
  return schedule;
}

/**
 * Calculates savings interest (simple interest per annum).
 * @param {number} balance
 * @param {number} annualRate - Annual rate in percent.
 * @param {number} days       - Number of days to calculate for.
 * @returns {number}
 */
function calcSavingsInterest(balance, annualRate, days) {
  return (balance * (annualRate / 100) * days) / 365;
}

/**
 * Calculates loan penalty for overdue instalments.
 * @param {number} overdueAmount
 * @param {number} penaltyRate - Monthly penalty rate (%).
 * @param {number} daysOverdue
 * @returns {number}
 */
function calcPenalty(overdueAmount, penaltyRate, daysOverdue) {
  var monthsOverdue = Math.ceil(daysOverdue / 30);
  return overdueAmount * (penaltyRate / 100) * monthsOverdue;
}

// ─── PAGINATION ────────────────────────────────────────────────────────────────

/**
 * Paginates an array of results.
 * @param {Array}  arr      - Full results array.
 * @param {number} page     - 1-indexed page number.
 * @param {number} pageSize - Items per page.
 * @returns {{data: Array, total: number, page: number, pages: number, pageSize: number}}
 */
function paginate(arr, page, pageSize) {
  var pg = parseInt(page, 10) || 1;
  var ps = parseInt(pageSize, 10) || 20;
  var total = arr.length;
  var pages = Math.ceil(total / ps);
  var start = (pg - 1) * ps;
  return {
    data: arr.slice(start, start + ps),
    total: total,
    page: pg,
    pages: pages,
    pageSize: ps
  };
}

// ─── SEARCH ────────────────────────────────────────────────────────────────────

/**
 * Filters an array of objects by a search term across specified fields.
 * @param {Array}    arr    - Array of objects.
 * @param {string}   term   - Search term.
 * @param {string[]} fields - Fields to search in.
 * @returns {Array}
 */
function searchFilter(arr, term, fields) {
  if (!term) return arr;
  var lower = term.toLowerCase();
  return arr.filter(function(item) {
    return fields.some(function(f) {
      var val = item[f];
      return val && String(val).toLowerCase().indexOf(lower) !== -1;
    });
  });
}

// ─── LOGGING ──────────────────────────────────────────────────────────────────

/**
 * Logs an error to Apps Script Logger.
 * @param {string} module   - The module/file name.
 * @param {string} fn       - The function name.
 * @param {Error}  err      - The caught error.
 */
function logError(module, fn, err) {
  Logger.log('[' + module + '] ' + fn + ': ' + (err.message || err));
}

// ─── CSV EXPORT ────────────────────────────────────────────────────────────────

/**
 * Converts an array of objects to a CSV string.
 * @param {Array}    rows    - Array of plain objects.
 * @param {string[]} headers - Column headers.
 * @param {string[]} fields  - Object keys matching header order.
 * @returns {string}
 */
function toCsv(rows, headers, fields) {
  var lines = [headers.map(csvEscape_).join(',')];
  rows.forEach(function(row) {
    lines.push(fields.map(function(f) {
      return csvEscape_(row[f] !== undefined ? row[f] : '');
    }).join(','));
  });
  return lines.join('\n');
}

function csvEscape_(val) {
  var s = String(val === null || val === undefined ? '' : val);
  if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ─── EMAIL ────────────────────────────────────────────────────────────────────

/**
 * Sends a plain-text or HTML email safely.
 * @param {string} to      - Recipient email.
 * @param {string} subject - Email subject.
 * @param {string} body    - Plain text body.
 * @param {string} htmlBody - Optional HTML body.
 */
function sendEmail(to, subject, body, htmlBody) {
  try {
    var societyName = getSystemSetting_('societyName') || 'Cooperative Society';
    var opts = { name: societyName };
    if (htmlBody) opts.htmlBody = htmlBody;
    MailApp.sendEmail(to, subject, body, opts);
    return true;
  } catch (e) {
    logError('Utils', 'sendEmail', e);
    return false;
  }
}

// ─── MISC ──────────────────────────────────────────────────────────────────────

/**
 * Deep-clones a plain JavaScript object.
 * @param {Object} obj
 * @returns {Object}
 */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Returns a system setting by key (shortcut — delegates to Settings module).
 * @param {string} key
 * @returns {*}
 */
function getSystemSetting_(key) {
  try {
    var cached = PropertiesService.getScriptProperties().getProperty('SETTING_' + key.toUpperCase());
    if (cached) return cached;
    var doc = firestoreGet_('systemSettings', key);
    return doc ? doc.value : null;
  } catch (e) {
    return null;
  }
}
