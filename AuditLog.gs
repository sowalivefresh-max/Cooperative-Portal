/**
 * ============================================================
 *  COOPERATIVE SOCIETY MANAGEMENT PORTAL
 *  AuditLog.gs  -  Audit Trail Recording & Retrieval
 * ============================================================
 */

/**
 * Records an audit log entry in Firestore.
 * Called internally by all modules via logAction_().
 *
 * @param {string} action         - e.g. 'CREATE_MEMBER', 'APPROVE_LOAN'
 * @param {string} module         - e.g. 'Members', 'Loans', 'Auth'
 * @param {string} actorId        - userId performing the action
 * @param {string} affectedRecord - The ID of the affected document
 * @param {*}      oldValue       - Snapshot before change (null for creates)
 * @param {*}      newValue       - Snapshot after change (null for deletes)
 */
function logAction_(action, module, actorId, affectedRecord, oldValue, newValue) {
  try {
    var logId = generateId('AUD', 'auditLogs');
    var entry = {
      logId:          logId,
      action:         String(action || ''),
      module:         String(module || ''),
      actorId:        String(actorId || 'system'),
      affectedRecord: String(affectedRecord || ''),
      oldValue:       oldValue ? JSON.stringify(oldValue) : null,
      newValue:       newValue ? JSON.stringify(newValue) : null,
      timestamp:      new Date().toISOString()
    };

    // Try to get actor name for human-readable logs
    try {
      if (actorId && actorId !== 'system') {
        var actor = firestoreGet_('users', actorId);
        if (actor) entry.actorName = actor.fullName || actor.email;
      }
    } catch (e2) {
      // Non-critical — skip if user lookup fails
    }

    firestoreCreate_('auditLogs', entry, logId);
  } catch (e) {
    // Audit logging must never break the main flow
    Logger.log('[AuditLog] Failed to log action: ' + action + ' — ' + e.message);
  }
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Returns a paginated list of audit logs.
 * Accessible by super_admin, admin, auditor.
 * @param {Object} params - { token, module?, action?, actorId?,
 *                            dateFrom?, dateTo?, page?, pageSize? }
 * @returns {Object}
 */
function getAuditLogs(params) {
  try {
    var auth = authorise_(params.token, 'view_audit');
    if (auth.error) return auth.error;

    var logs = firestoreGetAll_('auditLogs');

    // Filter by module
    if (params.module) {
      logs = logs.filter(function(l) {
        return l.module === params.module;
      });
    }

    // Filter by action
    if (params.action) {
      logs = logs.filter(function(l) {
        return l.action === params.action;
      });
    }

    // Filter by actor
    if (params.actorId) {
      logs = logs.filter(function(l) {
        return l.actorId === params.actorId;
      });
    }

    // Filter by date range
    if (params.dateFrom) {
      var from = new Date(params.dateFrom);
      logs = logs.filter(function(l) {
        return l.timestamp && new Date(l.timestamp) >= from;
      });
    }
    if (params.dateTo) {
      var to = new Date(params.dateTo);
      to.setHours(23, 59, 59);
      logs = logs.filter(function(l) {
        return l.timestamp && new Date(l.timestamp) <= to;
      });
    }

    // Search
    if (params.search) {
      logs = searchFilter(logs, params.search, ['action', 'module', 'actorName', 'actorId', 'affectedRecord']);
    }

    // Sort by most recent first
    logs.sort(function(a, b) {
      return new Date(b.timestamp) - new Date(a.timestamp);
    });

    return successResponse(paginate(logs, params.page, params.pageSize || 50));
  } catch (e) {
    logError('AuditLog', 'getAuditLogs', e);
    return errorResponse('Failed to retrieve audit logs.', 500);
  }
}

/**
 * Returns all unique action types for the filter dropdown.
 * @param {Object} params - { token }
 * @returns {Object}
 */
function getAuditActionTypes(params) {
  try {
    var auth = authorise_(params.token, 'view_audit');
    if (auth.error) return auth.error;

    var logs = firestoreGetAll_('auditLogs');
    var actions = {};
    logs.forEach(function(l) { if (l.action) actions[l.action] = true; });
    return successResponse(Object.keys(actions).sort());
  } catch (e) {
    logError('AuditLog', 'getAuditActionTypes', e);
    return errorResponse('Failed to retrieve action types.', 500);
  }
}

/**
 * Returns the audit history for a specific record.
 * @param {Object} params - { token, recordId }
 * @returns {Object}
 */
function getRecordAuditHistory(params) {
  try {
    var auth = authorise_(params.token, 'view_audit');
    if (auth.error) return auth.error;

    var logs = firestoreQuery_('auditLogs', [
      { field: 'affectedRecord', op: '==', value: params.recordId }
    ]);
    logs.sort(function(a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
    return successResponse(logs);
  } catch (e) {
    logError('AuditLog', 'getRecordAuditHistory', e);
    return errorResponse('Failed to retrieve record history.', 500);
  }
}

/**
 * Returns audit summary statistics for the dashboard.
 * @param {Object} params - { token }
 * @returns {Object}
 */
function getAuditStats(params) {
  try {
    var auth = authorise_(params.token, 'view_audit');
    if (auth.error) return auth.error;

    var allLogs = firestoreGetAll_('auditLogs');
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var todayLogs = allLogs.filter(function(l) {
      return l.timestamp && new Date(l.timestamp) >= today;
    });

    // Module breakdown
    var byModule = {};
    allLogs.forEach(function(l) {
      byModule[l.module] = (byModule[l.module] || 0) + 1;
    });

    // Top actors
    var byActor = {};
    allLogs.forEach(function(l) {
      var key = l.actorName || l.actorId;
      byActor[key] = (byActor[key] || 0) + 1;
    });

    return successResponse({
      totalLogs:  allLogs.length,
      todayCount: todayLogs.length,
      byModule:   byModule,
      byActor:    byActor
    });
  } catch (e) {
    logError('AuditLog', 'getAuditStats', e);
    return errorResponse('Failed to retrieve audit stats.', 500);
  }
}

/**
 * Exports audit logs as CSV for download.
 * @param {Object} params - { token, dateFrom?, dateTo? }
 * @returns {Object} - { csvContent, filename }
 */
function exportAuditLogs(params) {
  try {
    var auth = authorise_(params.token, 'view_audit');
    if (auth.error) return auth.error;

    var logs = firestoreGetAll_('auditLogs');
    logs.sort(function(a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });

    var csv = toCsv(
      logs,
      ['Date/Time', 'Actor', 'Action', 'Module', 'Affected Record', 'Old Value', 'New Value'],
      ['timestamp', 'actorName', 'action', 'module', 'affectedRecord', 'oldValue', 'newValue']
    );

    return successResponse({
      csvContent: csv,
      filename:   'AuditLog_' + Utilities.formatDate(new Date(), 'Africa/Lagos', 'yyyyMMdd') + '.csv'
    });
  } catch (e) {
    logError('AuditLog', 'exportAuditLogs', e);
    return errorResponse('Failed to export audit logs.', 500);
  }
}
