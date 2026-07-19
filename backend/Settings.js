/**
 * ============================================================
 *  COOPERATIVE SOCIETY MANAGEMENT PORTAL
 *  Settings.gs  -  System Configuration Management
 * ============================================================
 *
 *  Default settings are stored in Firestore 'systemSettings' collection.
 *  Each document uses the settingKey as the document ID.
 *  Settings are also cached in Script Properties for performance.
 * ============================================================
 */

// ─── DEFAULT SETTINGS SCHEMA ─────────────────────────────────────────────────

var DEFAULT_SETTINGS = {
  // General
  societyName:            { value: 'My Cooperative Society', label: 'Society Name', category: 'General' },
  societyAddress:         { value: 'Lagos, Nigeria',          label: 'Society Address', category: 'General' },
  societyPhone:           { value: '+234-800-000-0000',       label: 'Society Phone', category: 'General' },
  societyEmail:           { value: 'info@mycooperative.com',  label: 'Society Email', category: 'General' },
  societyRegNumber:       { value: 'COOP-0001',               label: 'Registration Number', category: 'General' },
  financialYear:          { value: '2024',                    label: 'Current Financial Year', category: 'General' },
  currencySymbol:         { value: '₦',                       label: 'Currency Symbol', category: 'General' },
  timezone:               { value: 'Africa/Lagos',            label: 'Timezone', category: 'General' },
  logoUrl:                { value: '',                        label: 'Society Logo URL', category: 'General' },

  // Contributions
  monthlyContributionAmount: { value: 5000, label: 'Default Monthly Contribution (₦)', category: 'Contributions' },
  contributionDueDay:        { value: 28,   label: 'Contribution Due Day of Month', category: 'Contributions' },

  // Savings
  savingsInterestRate:    { value: 3,     label: 'Annual Savings Interest Rate (%)', category: 'Savings' },
  interestPaymentFrequency: { value: 'Quarterly', label: 'Interest Payment Frequency', category: 'Savings' },
  minimumSavingsBalance:  { value: 5000,  label: 'Minimum Savings Balance (₦)', category: 'Savings' },

  // Loans
  defaultLoanInterestRate: { value: 5,    label: 'Default Monthly Loan Interest Rate (%)', category: 'Loans' },
  maxLoanMultiplier:       { value: 3,    label: 'Max Loan = N × Total Savings', category: 'Loans' },
  minContributionMonths:   { value: 3,    label: 'Min Months of Contributions for Loan', category: 'Loans' },
  loanInterestMethod:      { value: 'flat', label: 'Interest Method (flat/reducing)', category: 'Loans' },
  loanProcessingFeeRate:   { value: 1,    label: 'Loan Processing Fee (%)', category: 'Loans' },
  maxLoanDuration:         { value: 24,   label: 'Max Loan Duration (Months)', category: 'Loans' },
  loanApprovalLevels:      { value: 2,    label: 'Approval Levels Required', category: 'Loans' },

  // Penalties
  loanPenaltyRate:        { value: 2,     label: 'Monthly Penalty Rate on Overdue (%)', category: 'Penalties' },
  gracePeriodDays:        { value: 7,     label: 'Grace Period Before Penalty (Days)', category: 'Penalties' },

  // Receipts
  receiptFooterText:      { value: 'Thank you for your patronage.', label: 'Receipt Footer', category: 'Receipts' },
  showQrOnReceipt:        { value: true,  label: 'Show QR Code on Receipt', category: 'Receipts' },

  // Notifications
  enableEmailNotifications: { value: true, label: 'Enable Email Notifications', category: 'Notifications' },
  enableDueLoanAlerts:      { value: true, label: 'Enable Due Loan Alerts', category: 'Notifications' },
  dueLoanAlertDaysBefore:   { value: 7,   label: 'Days Before Due Date to Alert', category: 'Notifications' },
  enableBirthdayNotifications: { value: true, label: 'Enable Birthday Greetings', category: 'Notifications' },
  enableContributionReminders: { value: true, label: 'Enable Contribution Reminders', category: 'Notifications' }
};

// ─── INITIALISATION ───────────────────────────────────────────────────────────

/**
 * Initialises all default settings if they don't already exist.
 * Called on first deployment.
 */
function initSystemSettings() {
  try {
    Object.keys(DEFAULT_SETTINGS).forEach(function(key) {
      var existing = firestoreGet_('systemSettings', key);
      if (!existing) {
        var def = DEFAULT_SETTINGS[key];
        firestoreCreate_('systemSettings', {
          settingKey: key,
          value:      def.value,
          label:      def.label,
          category:   def.category,
          updatedBy:  'system',
          updatedAt:  new Date().toISOString()
        }, key);
      }
    });
    Logger.log('[Settings] System settings initialised.');
  } catch (e) {
    logError('Settings', 'initSystemSettings', e);
  }
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Returns all system settings, optionally filtered by category.
 * @param {Object} params - { token, category? }
 * @returns {Object}
 */
function getSettings(params) {
  try {
    var auth = authorise_(params.token, 'view_settings');
    if (auth.error) return auth.error;

    var settings = firestoreGetAll_('systemSettings');
    if (params.category) {
      settings = settings.filter(function(s) { return s.category === params.category; });
    }
    settings.sort(function(a, b) { return (a.label || '').localeCompare(b.label || ''); });
    return successResponse(settings);
  } catch (e) {
    logError('Settings', 'getSettings', e);
    return errorResponse('Failed to retrieve settings.', 500);
  }
}

/**
 * Returns a single setting value by key (public — no auth needed for some keys).
 * @param {string} key
 * @returns {*}
 */
function getSetting(key) {
  try {
    var doc = firestoreGet_('systemSettings', key);
    return doc ? doc.value : (DEFAULT_SETTINGS[key] ? DEFAULT_SETTINGS[key].value : null);
  } catch (e) {
    return DEFAULT_SETTINGS[key] ? DEFAULT_SETTINGS[key].value : null;
  }
}

/**
 * Updates a system setting value.
 * @param {Object} params - { token, key, value }
 * @returns {Object}
 */
function updateSetting(params) {
  try {
    var auth = authorise_(params.token, 'manage_settings');
    if (auth.error) return auth.error;

    if (!params.key) return errorResponse('Setting key is required.', 400);

    var old = firestoreGet_('systemSettings', params.key);
    var data = {
      settingKey: params.key,
      value:      params.value,
      updatedBy:  auth.session.userId,
      updatedAt:  new Date().toISOString()
    };

    if (old) {
      data.label    = old.label;
      data.category = old.category;
      firestoreUpdate_('systemSettings', params.key, data);
    } else {
      var def = DEFAULT_SETTINGS[params.key];
      data.label    = def ? def.label    : params.key;
      data.category = def ? def.category : 'General';
      firestoreCreate_('systemSettings', data, params.key);
    }

    // Invalidate cache
    PropertiesService.getScriptProperties()
      .deleteProperty('SETTING_' + params.key.toUpperCase());

    logAction_('UPDATE_SETTING', 'Settings', auth.session.userId, params.key,
               old ? { value: old.value } : null, { value: params.value });

    return successResponse(null, 'Setting updated successfully.');
  } catch (e) {
    logError('Settings', 'updateSetting', e);
    return errorResponse('Failed to update setting.', 500);
  }
}

/**
 * Updates multiple settings in one call.
 * @param {Object} params - { token, settings: { key: value, ... } }
 * @returns {Object}
 */
function updateSettings(params) {
  try {
    var auth = authorise_(params.token, 'manage_settings');
    if (auth.error) return auth.error;

    var settings = params.settings || {};
    var keys = Object.keys(settings);
    if (keys.length === 0) return errorResponse('No settings provided.', 400);

    keys.forEach(function(key) {
      updateSetting({ token: params.token, key: key, value: settings[key] });
    });

    return successResponse(null, keys.length + ' setting(s) updated successfully.');
  } catch (e) {
    logError('Settings', 'updateSettings', e);
    return errorResponse('Failed to update settings.', 500);
  }
}

// ─── LOAN PRODUCTS ────────────────────────────────────────────────────────────

/**
 * Returns all configured loan products.
 * @param {Object} params - { token }
 * @returns {Object}
 */
function getLoanProducts(params) {
  try {
    var auth = authorise_(params.token, 'view_settings');
    if (auth.error) return auth.error;

    var products = firestoreGetAll_('loanProducts');
    if (products.length === 0) {
      // Return defaults if none configured
      products = getDefaultLoanProducts_();
    }
    return successResponse(products);
  } catch (e) {
    logError('Settings', 'getLoanProducts', e);
    return errorResponse('Failed to retrieve loan products.', 500);
  }
}

/**
 * Creates or updates a loan product.
 * @param {Object} params - { token, productId?, name, interestRate, maxAmount,
 *                            minAmount, maxDuration, description, isActive }
 * @returns {Object}
 */
function saveLoanProduct(params) {
  try {
    var auth = authorise_(params.token, 'manage_settings');
    if (auth.error) return auth.error;

    var v = validateRequired(params, ['name', 'interestRate', 'maxDuration']);
    if (!v.valid) return errorResponse(v.errors.join(', '), 400);

    var productId = params.productId || generateId('PROD', 'loanProducts');
    var data = {
      productId:    productId,
      name:         params.name,
      description:  params.description || '',
      interestRate: parseFloat(params.interestRate),
      maxAmount:    parseFloat(params.maxAmount || 0),
      minAmount:    parseFloat(params.minAmount || 0),
      maxDuration:  parseInt(params.maxDuration, 10),
      minDuration:  parseInt(params.minDuration || 1, 10),
      isActive:     params.isActive !== false,
      updatedBy:    auth.session.userId,
      updatedAt:    new Date().toISOString()
    };

    if (params.productId && firestoreExists_('loanProducts', params.productId)) {
      firestoreUpdate_('loanProducts', productId, data);
      logAction_('UPDATE_LOAN_PRODUCT', 'Settings', auth.session.userId, productId, null, data);
    } else {
      data.createdAt = new Date().toISOString();
      firestoreCreate_('loanProducts', data, productId);
      logAction_('CREATE_LOAN_PRODUCT', 'Settings', auth.session.userId, productId, null, data);
    }

    return successResponse({ productId: productId }, 'Loan product saved.');
  } catch (e) {
    logError('Settings', 'saveLoanProduct', e);
    return errorResponse('Failed to save loan product.', 500);
  }
}

/**
 * Deletes a loan product.
 * @param {Object} params - { token, productId }
 * @returns {Object}
 */
function deleteLoanProduct(params) {
  try {
    var auth = authorise_(params.token, 'manage_settings');
    if (auth.error) return auth.error;

    // Check if any loans use this product
    var loans = firestoreQuery_('loans', [{ field: 'productId', op: '==', value: params.productId }]);
    if (loans.length > 0) {
      return errorResponse('Cannot delete a loan product that is in use.', 409);
    }

    firestoreDelete_('loanProducts', params.productId);
    logAction_('DELETE_LOAN_PRODUCT', 'Settings', auth.session.userId, params.productId, null, null);
    return successResponse(null, 'Loan product deleted.');
  } catch (e) {
    logError('Settings', 'deleteLoanProduct', e);
    return errorResponse('Failed to delete loan product.', 500);
  }
}

// ─── CONTRIBUTION TYPES ───────────────────────────────────────────────────────

/**
 * Returns all contribution types.
 * @param {Object} params - { token }
 * @returns {Object}
 */
function getContributionTypes(params) {
  try {
    var auth = authorise_(params.token, 'view_settings');
    if (auth.error) return auth.error;

    var types = firestoreGetAll_('contributionTypes');
    if (types.length === 0) {
      types = getDefaultContributionTypes_();
    }
    return successResponse(types);
  } catch (e) {
    logError('Settings', 'getContributionTypes', e);
    return errorResponse('Failed to retrieve contribution types.', 500);
  }
}

/**
 * Creates or updates a contribution type.
 * @param {Object} params - { token, typeId?, name, description, isRequired, defaultAmount, isActive }
 * @returns {Object}
 */
function saveContributionType(params) {
  try {
    var auth = authorise_(params.token, 'manage_settings');
    if (auth.error) return auth.error;

    if (!params.name) return errorResponse('Type name is required.', 400);

    var typeId = params.typeId || generateId('CTYPE', 'contributionTypes');
    var data = {
      typeId:        typeId,
      name:          params.name,
      description:   params.description || '',
      isRequired:    params.isRequired || false,
      defaultAmount: parseFloat(params.defaultAmount || 0),
      isActive:      params.isActive !== false,
      updatedBy:     auth.session.userId,
      updatedAt:     new Date().toISOString()
    };

    if (params.typeId && firestoreExists_('contributionTypes', params.typeId)) {
      firestoreUpdate_('contributionTypes', typeId, data);
    } else {
      data.createdAt = new Date().toISOString();
      firestoreCreate_('contributionTypes', data, typeId);
    }

    logAction_('SAVE_CONTRIBUTION_TYPE', 'Settings', auth.session.userId, typeId, null, data);
    return successResponse({ typeId: typeId }, 'Contribution type saved.');
  } catch (e) {
    logError('Settings', 'saveContributionType', e);
    return errorResponse('Failed to save contribution type.', 500);
  }
}

/**
 * Returns public system info for the login page (no auth needed).
 * @returns {Object}
 */
function getPublicSystemInfo() {
  return successResponse({
    societyName: getSetting('societyName'),
    logoUrl:     getSetting('logoUrl'),
    societyEmail:getSetting('societyEmail')
  });
}

// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

function getDefaultLoanProducts_() {
  return [
    { productId: 'emergency', name: 'Emergency Loan',  interestRate: 3, maxAmount: 500000,  minAmount: 10000,  maxDuration: 6,  minDuration: 1, isActive: true },
    { productId: 'personal',  name: 'Personal Loan',   interestRate: 5, maxAmount: 1000000, minAmount: 50000,  maxDuration: 24, minDuration: 3, isActive: true },
    { productId: 'business',  name: 'Business Loan',   interestRate: 4, maxAmount: 5000000, minAmount: 100000, maxDuration: 36, minDuration: 6, isActive: true },
    { productId: 'education', name: 'Education Loan',  interestRate: 3, maxAmount: 500000,  minAmount: 20000,  maxDuration: 12, minDuration: 3, isActive: true }
  ];
}

function getDefaultContributionTypes_() {
  return [
    { typeId: 'monthly',   name: 'Monthly Contribution',   isRequired: true,  defaultAmount: 5000, isActive: true },
    { typeId: 'special',   name: 'Special Contribution',   isRequired: false, defaultAmount: 0,    isActive: true },
    { typeId: 'emergency', name: 'Emergency Contribution', isRequired: false, defaultAmount: 0,    isActive: true },
    { typeId: 'voluntary', name: 'Voluntary Savings',      isRequired: false, defaultAmount: 0,    isActive: true },
    { typeId: 'fixed',     name: 'Fixed Savings',          isRequired: false, defaultAmount: 0,    isActive: true }
  ];
}
