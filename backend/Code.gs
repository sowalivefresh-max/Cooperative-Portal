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
    'unlockAccount':                   unlockAccount,
    'createUser':                      createUser,
    'updateUser':                      updateUser,
    'getUsers':                        getUsers,

    // ── Members ─────────────────────────────────────────────
    'getMembers':                      getMembers,
    'getMember':                       getMember,
    'createMember':                    createMember,
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

