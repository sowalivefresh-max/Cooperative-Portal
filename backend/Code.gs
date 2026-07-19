/**
 * ============================================================
 *  COOPERATIVE SOCIETY MANAGEMENT PORTAL
 *  Code.gs  -  Main Entry Point, Router & API Whitelist
 * ============================================================
 *
 *  DEPLOYMENT:
 *  1. Configure Script Properties (see Database.gs for details)
 *  2. Run initPortal() once to create default super admin & settings
 *  3. Deploy as Web App:
 *       Execute as: Me
 *       Who has access: Anyone (or Anyone within your organisation)
 *  4. Share the Web App URL with your users
 * ============================================================
 */

/**
 * Run this function once from the editor to force Google Apps Script
 * to prompt for email sending authorization.
 */
function authorizeEmail() {
  var email = Session.getActiveUser().getEmail();
  if (email) {
    MailApp.sendEmail(email, "Authorization Successful", "Your cooperative portal can now send emails!");
    Logger.log("Authorization email sent to " + email);
  } else {
    Logger.log("Could not determine active user email, but authorization should be triggered.");
  }
}

/**
 * Run this function from the editor to forcibly reset your own password
 * if you accidentally get locked out. It will set your password to "admin123".
 */
function rescueAdmin() {
  Logger.log("Scanning database for administrator accounts...");
  var users = firestoreQuery_('users', []); // Fetch all users
  
  if (!users || users.length === 0) {
    Logger.log("Your database has NO users at all! You need to run initPortal() first.");
    return;
  }
  
  var foundAdmin = false;
  var newHash = hashPassword("admin123");
  
  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    Logger.log("Found user email: " + u.email + " (Role: " + u.role + ")");
    
    if (u.role === 'super_admin' || u.role === 'developer') {
      firestoreUpdate_('users', u._id, {
        passwordHash: newHash,
        failedLoginAttempts: 0,
        lockedUntil: null,
        requirePasswordChange: true
      });
      Logger.log(">> SUCCESS: Reset password for " + u.email + " to 'admin123'");
      foundAdmin = true;
    }
  }
  
  if (!foundAdmin) {
    Logger.log("WARNING: No developer or super_admin accounts found! Please run initPortal() to create them.");
  }
}

// ─── WEB APP ENTRY POINTS ─────────────────────────────────────────────────────

/**
 * Handles GET requests.
 * The frontend is now a static site hosted separately.
 * This endpoint returns a JSON health check / API info response.
 * Useful for confirming the backend is alive before the frontend calls it.
 */
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({
      success: true,
      message: 'Cooperative Society Portal API is online.',
      version: '2.0.0',
      timestamp: new Date().toISOString()
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Handles all POST requests. Routes API calls via the action whitelist.
 */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;

    if (!action) {
      return jsonResponse_({ success: false, message: 'No action specified.' });
    }

    var whitelist = getActionWhitelist_();
    if (!whitelist[action]) {
      return jsonResponse_({ success: false, message: 'Unknown action: ' + action });
    }

    // Maintenance Mode Check (allow only login and auth-less functions, unless developer)
    if (action !== 'loginUser' && action !== 'getCurrentUser') {
      var isMaintenance = getSetting('maintenanceMode') === true;
      if (isMaintenance && body.token) {
        var session = validateSession(body.token);
        if (!session || session.role !== 'developer') {
          return jsonResponse_({ success: false, message: 'System is currently in maintenance mode. Please try again later.' });
        }
      } else if (isMaintenance) {
          return jsonResponse_({ success: false, message: 'System is currently in maintenance mode. Please try again later.' });
      }
    }

    var result = whitelist[action](body);
    return jsonResponse_(result);
  } catch (err) {
    Logger.log('[Code] doPost error: ' + err.message);
    return jsonResponse_({ success: false, message: 'Server error: ' + err.message });
  }
}

// ─── ACTION WHITELIST ─────────────────────────────────────────────────────────

/**
 * Explicit whitelist of all callable API functions.
 * Only functions listed here can be invoked from the frontend.
 */
function getActionWhitelist_() {
  return {
    // ── System ──────────────────────────────────────────────
    'getPublicSystemInfo':             getPublicSystemInfo,

    // ── Auth ────────────────────────────────────────────────
    'loginUser':                       loginUser,
    'logoutUser':                      logoutUser,
    'getCurrentUser':                  getCurrentUser,
    'changePassword':                  changePassword,
    'forgotPassword':                  forgotPassword,
    'adminResetPassword':              adminResetPassword,
    'adminSetManualPassword':          adminSetManualPassword,
    'unlockAccount':                   unlockAccount,
    'createUser':                      createUser,
    'updateUser':                      updateUser,
    'updateProfile':                   updateProfile,
    'getUsers':                        getUsers,
    'impersonateUser':                 impersonateUser,

    // ── Members ─────────────────────────────────────────────
    'getMembers':                      getMembers,
    'getMember':                       getMember,
    'createMember':                    createMember,
    'bulkCreateMembers':               bulkCreateMembers,
    'updateMember':                    updateMember,
    'suspendMember':                   suspendMember,
    'activateMember':                  activateMember,
    'deleteMember':                    deleteMember,
    'getMemberStats':                  getMemberStats,
    'getMemberStatement':              getMemberStatement,
    'searchMembers':                   searchMembers,

    // ── Contributions ────────────────────────────────────────
    'getContributions':                getContributions,
    'addContribution':                 addContribution,
    'editContribution':                editContribution,
    'reverseContribution':             reverseContribution,
    'bulkImportContributions':         bulkImportContributions,
    'getContributionStats':            getContributionStats,

    // ── Savings ──────────────────────────────────────────────
    'getSavings':                      getSavings,
    'getSavingsStatement':             getSavingsStatement,
    'depositSavings':                  depositSavings,
    'withdrawSavings':                 withdrawSavings,
    'applyQuarterlySavingsInterest':   applyQuarterlySavingsInterest,
    'getSavingsStats':                 getSavingsStats,
    'getWithdrawals':                  getWithdrawals,

    // ── Loans ────────────────────────────────────────────────
    'getLoans':                        getLoans,
    'getLoan':                         getLoan,
    'applyForLoan':                    applyForLoan,
    'recommendLoan':                   recommendLoan,
    'approveLoan':                     approveLoan,
    'rejectLoan':                      rejectLoan,
    'disburseLoan':                    disburseLoan,
    'getLoanStats':                    getLoanStats,
    'getLoanDefaulters':               getLoanDefaulters,
    'getLoanProducts':                 getLoanProducts,
    'saveLoanProduct':                 saveLoanProduct,
    'deleteLoanProduct':               deleteLoanProduct,

    // ── Repayments ───────────────────────────────────────────
    'recordRepayment':                 recordRepayment,
    'getRepayments':                   getRepayments,
    'getRepaymentSchedule':            getRepaymentSchedule,
    'getRepaymentStats':               getRepaymentStats,
    'sendDueLoanAlerts':               sendDueLoanAlerts,

    // ── Transactions ─────────────────────────────────────────
    'getTransactions':                 getTransactions,
    'getTransaction':                  getTransaction,
    'getCashFlow':                     getCashFlow,
    'getTransactionStats':             getTransactionStats,
    'getJournalEntries':               getJournalEntries,

    // ── Reports ──────────────────────────────────────────────
    'getFinancialSummary':             getFinancialSummary,
    'getMemberRegisterReport':         getMemberRegisterReport,
    'getContributionReport':           getContributionReport,
    'getLoanReport':                   getLoanReport,
    'getRepaymentReport':              getRepaymentReport,
    'getSavingsReport':                getSavingsReport,
    'getTopContributors':              getTopContributors,
    'getIncomeExpenseReport':          getIncomeExpenseReport,

    // ── Notifications ────────────────────────────────────────
    'getNotifications':                getNotifications,
    'markNotificationsRead':           markNotificationsRead,
    'getUnreadNotificationCount':      getUnreadNotificationCount,
    'getAnnouncements':                getAnnouncements,
    'createAnnouncement':              createAnnouncement,
    'deleteAnnouncement':              deleteAnnouncement,
    'sendBirthdayNotifications':       sendBirthdayNotifications,
    'sendContributionReminders':       sendContributionReminders,

    // ── Documents ────────────────────────────────────────────
    'uploadDocument':                  uploadDocument,
    'getMemberDocuments':              getMemberDocuments,
    'deleteDocument':                  deleteDocument,

    // ── Settings ─────────────────────────────────────────────
    'getSettings':                     getSettings,
    'updateSetting':                   updateSetting,
    'updateSettings':                  updateSettings,
    'getContributionTypes':            getContributionTypes,
    'saveContributionType':            saveContributionType,

    // ── Audit Log ────────────────────────────────────────────
    'getAuditLogs':                    getAuditLogs,
    'getAuditActionTypes':             getAuditActionTypes,
    'getRecordAuditHistory':           getRecordAuditHistory,
    'getAuditStats':                   getAuditStats,
    'exportAuditLogs':                 exportAuditLogs,

    // ── Developer / System ───────────────────────────────────
    'forceLogoutUser':                 forceLogoutUser,
    'getActiveSessions':               getActiveSessions,
    'getDatabaseSchema':               getDatabaseSchema,
    'browseCollection':                browseCollection,
    'executeDatabaseBackup':           executeDatabaseBackup,
    'restoreDatabase':                 restoreDatabase,
    'testFirebaseConnectivity':        testFirebaseConnectivity,
    'getSystemHealth':                 getSystemHealth
  };
}


/**
 * Wraps a result object as a JSON ContentService TextOutput.
 * @param {Object} result
 * @returns {ContentService.TextOutput}
 */
function jsonResponse_(result) {
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── FIRST-TIME INITIALISATION ────────────────────────────────────────────────

/**
 * Run this function ONCE after deployment to bootstrap the system.
 *
 * SECURITY MODEL — order of provisioning matters:
 *   1. initPortal()   → Creates ONLY the developer account + system config
 *   2. Developer logs in, changes password, verifies system health
 *   3. initSuperAdmin() → Developer runs this manually from the GAS editor
 *   4. Super Admin logs in, changes password, creates all other role accounts
 *
 * DO NOT call initSuperAdmin() here. The super_admin credentials would
 * exist with a default password before the developer has secured the system.
 *
 * Go to Apps Script Editor → select 'initPortal' → ▶ Run
 */
function initPortal() {
  Logger.log('=== Cooperative Portal Initialisation ===');
  Logger.log('Security model: Developer account created first.');
  Logger.log('Super Admin must be provisioned manually by the developer after first login.');
  Logger.log('');

  Logger.log('1/4 Initialising system settings...');
  initSystemSettings();

  Logger.log('2/4 Creating developer account...');
  initDeveloper();

  Logger.log('3/4 Seeding default loan products...');
  var products = getDefaultLoanProducts_();
  products.forEach(function(p) {
    if (!firestoreExists_('loanProducts', p.productId)) {
      p.createdAt = new Date().toISOString();
      p.updatedAt = new Date().toISOString();
      firestoreCreate_('loanProducts', p, p.productId);
    }
  });

  Logger.log('4/4 Seeding default contribution types...');
  var types = getDefaultContributionTypes_();
  types.forEach(function(t) {
    if (!firestoreExists_('contributionTypes', t.typeId)) {
      t.createdAt = new Date().toISOString();
      firestoreCreate_('contributionTypes', t, t.typeId);
    }
  });

  Logger.log('');
  Logger.log('=== Initialisation Complete ===');
  Logger.log('NEXT STEP: Log in as developer@cooperativeportal.com / Dev@Portal2026!');
  Logger.log('THEN:      Change password. Verify system. Run initSuperAdmin() when ready.');
}

function forceResetDeveloper() {
  var existing = firestoreQuery_('users', [{ field: 'role', op: '==', value: 'developer' }]);
  if (existing.length === 0) {
    Logger.log('No developer account found. Run initPortal() first.');
    return;
  }
  
  var dev = existing[0];
  var newPassword = 'Dev@Portal2026!';
  
  firestoreUpdate_('users', dev._id, {
    email: 'faith4grtns@gmail.com',
    passwordHash: hashPassword(newPassword),
    requirePasswordChange: false,
    failedLoginAttempts: 0,
    lockedUntil: null
  });
  
  Logger.log('=========================================');
  Logger.log('DEVELOPER ACCOUNT RESCUED SUCCESSFULLY!');
  Logger.log('New Email: faith4grtns@gmail.com');
  Logger.log('New Password: ' + newPassword);
  Logger.log('You can now log in immediately. Your password reset emails will now arrive properly!');
  Logger.log('=========================================');
}

// ─── TIME-DRIVEN TRIGGER SETUP ────────────────────────────────────────────────

/**
 * Sets up automated time-driven triggers.
 * Run once from Apps Script Editor to schedule automated tasks.
 */
function setupTriggers() {
  // Delete existing triggers first
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    ScriptApp.deleteTrigger(trigger);
  });

  // Daily: Due loan alerts (runs at 8am Lagos time)
  ScriptApp.newTrigger('triggerDueLoanAlerts')
    .timeBased().everyDays(1).atHour(8).create();

  // Monthly: Contribution reminders (28th of each month at 9am)
  ScriptApp.newTrigger('triggerContributionReminders')
    .timeBased().onMonthDay(28).atHour(9).create();

  // Daily: Birthday notifications (7am)
  ScriptApp.newTrigger('triggerBirthdayNotifications')
    .timeBased().everyDays(1).atHour(7).create();

  Logger.log('Triggers set up successfully.');
}

// Trigger wrapper functions (must be top-level, no parameters)
function triggerDueLoanAlerts() {
  // Triggers run as the script owner — bypass client auth entirely
  sendDueLoanAlerts({ _systemTrigger: true });
}

function triggerContributionReminders() {
  sendContributionReminders({ _systemTrigger: true });
}

function triggerBirthdayNotifications() {
  sendBirthdayNotifications({ _systemTrigger: true });
}

// ─── DIAGNOSTIC TOOLS ─────────────────────────────────────────────────────────

/**
 * Run this from the Apps Script editor to diagnose dashboard loading problems.
 * Select "diagnosticCheck" from the function dropdown, then click Run.
 * View results in Execution Log (View > Logs).
 */
function diagnosticCheck() {
  Logger.log('========================================');
  Logger.log('COOPERATIVE PORTAL — DIAGNOSTIC CHECK');
  Logger.log('========================================');

  // 1. Maintenance Mode — #1 suspect when login works but dashboard doesn't
  Logger.log('\n--- [1] MAINTENANCE MODE CHECK ---');
  try {
    var maintenanceDoc = firestoreGet_('systemSettings', 'maintenanceMode');
    var maintenanceValue = maintenanceDoc ? maintenanceDoc.value : null;
    Logger.log('maintenanceMode value: ' + JSON.stringify(maintenanceValue));
    if (maintenanceValue === true) {
      Logger.log('*** MAINTENANCE MODE IS ON! This blocks getFinancialSummary, getAuditLogs, etc. for non-developers. Run fixMaintenanceMode() to fix it. ***');
    } else {
      Logger.log('Maintenance mode is OFF. Not the issue.');
    }
  } catch (e) {
    Logger.log('Error checking maintenance mode: ' + e.message);
  }

  // 2. All systemSettings values
  Logger.log('\n--- [2] All System Settings ---');
  try {
    var allSettings = firestoreGetAll_('systemSettings');
    Logger.log('Total settings: ' + allSettings.length);
    allSettings.forEach(function(s) {
      Logger.log('  ' + (s.settingKey || s._id) + ' = ' + JSON.stringify(s.value));
    });
  } catch (e) {
    Logger.log('Error: ' + e.message);
  }

  // 3. getFinancialSummary logic (bypasses auth)
  Logger.log('\n--- [3] getFinancialSummary Simulation ---');
  try {
    var members     = firestoreGetAll_('members');
    var allSavings  = firestoreGetAll_('savings');
    var allLoans    = firestoreGetAll_('loans');
    var allContribs = firestoreGetAll_('contributions');
    var allRepay    = firestoreGetAll_('loanRepayments');
    var totalMembers  = members.filter(function(m) { return m.status !== 'Deleted'; }).length;
    var activeMembers = members.filter(function(m) { return m.status === 'Active'; }).length;
    var totalSavings  = allSavings.reduce(function(s, x) { return s + (x.currentBalance || 0); }, 0);
    var totalContrib  = allContribs.reduce(function(s, c) { return s + (c.amount || 0); }, 0);
    Logger.log('totalMembers:  ' + totalMembers);
    Logger.log('activeMembers: ' + activeMembers);
    Logger.log('totalSavings:  ' + totalSavings);
    Logger.log('totalContrib:  ' + totalContrib);
    Logger.log('Member statuses: ' + members.map(function(m) { return m.status; }).join(', '));
    Logger.log('Result: getFinancialSummary would SUCCEED with this data.');
  } catch (e) {
    Logger.log('getFinancialSummary simulation FAILED: ' + e.message);
  }

  // 4. Valid sessions right now
  Logger.log('\n--- [4] Currently Valid Sessions ---');
  try {
    var sessions = firestoreGetAll_('sessions');
    var now = new Date();
    var valid = sessions.filter(function(s) {
      return s.expiresAt && new Date(s.expiresAt) > now;
    });
    Logger.log('Total sessions in DB: ' + sessions.length + ' | Valid now: ' + valid.length);
    valid.forEach(function(s) {
      Logger.log('  VALID -> ' + s.email + ' | role: ' + s.role + ' | expires: ' + s.expiresAt);
    });
  } catch (e) {
    Logger.log('Error: ' + e.message);
  }

  Logger.log('\n========================================');
  Logger.log('DIAGNOSTIC COMPLETE');
  Logger.log('========================================');
}

/**
 * Run this function if diagnosticCheck shows maintenanceMode = true.
 * It will immediately disable maintenance mode so the dashboard loads.
 * No deployment needed — runs directly from the editor.
 */
function fixMaintenanceMode() {
  try {
    var existing = firestoreGet_('systemSettings', 'maintenanceMode');
    if (existing) {
      firestoreUpdate_('systemSettings', 'maintenanceMode', {
        value: false,
        updatedAt: new Date().toISOString()
      });
    } else {
      firestoreCreate_('systemSettings', {
        settingKey: 'maintenanceMode',
        value: false,
        updatedAt: new Date().toISOString()
      }, 'maintenanceMode');
    }
    Logger.log('SUCCESS: maintenanceMode has been set to FALSE.');
    Logger.log('Refresh the portal dashboard — it should now load correctly.');
  } catch (e) {
    Logger.log('ERROR: ' + e.message);
  }
}
