/**
 * ============================================================
 *  COOPERATIVE SOCIETY MANAGEMENT PORTAL
 *  Developer.gs  -  Developer Dashboard & Diagnostics API
 * ============================================================
 */

/**
 * Returns a list of collections mapped to basic schema info.
 * @param {Object} params - { token }
 * @returns {Object}
 */
function getDatabaseSchema(params) {
  try {
    var auth = authorise_(params.token, '*');
    if (auth.error) return auth.error;
    if (auth.session.role !== 'developer') return errorResponse('Access denied. Developer action.', 403);

    // Hardcode known collections since Firestore REST doesn't easily list collections without root docs.
    var collections = ['users', 'sessions', 'members', 'contributions', 'savings', 'loans', 'repayments', 'transactions', 'settings', 'documents', 'notifications', 'announcements', 'audit_logs'];
    
    return successResponse({ collections: collections }, 'Schema fetched.');
  } catch (e) {
    logError('Developer', 'getDatabaseSchema', e);
    return errorResponse('Failed to fetch schema.', 500);
  }
}

/**
 * Browses a specific collection and returns its raw documents.
 * @param {Object} params - { token, collection, pageSize, pageToken }
 * @returns {Object}
 */
function browseCollection(params) {
  try {
    var auth = authorise_(params.token, '*');
    if (auth.error) return auth.error;
    if (auth.session.role !== 'developer') return errorResponse('Access denied. Developer action.', 403);

    var col = params.collection;
    if (!col) return errorResponse('Collection required.', 400);

    var res = firestoreQuery_(col, [], null, params.pageSize || 50);
    return successResponse({ collection: col, data: res, count: res.length }, 'Data fetched.');
  } catch (e) {
    logError('Developer', 'browseCollection', e);
    return errorResponse('Failed to browse collection.', 500);
  }
}

/**
 * Dumps core collections into a JSON file and saves to Google Drive.
 * @param {Object} params - { token }
 * @returns {Object}
 */
function executeDatabaseBackup(params) {
  try {
    var auth = authorise_(params.token, '*');
    if (auth.error) return auth.error;
    if (auth.session.role !== 'developer') return errorResponse('Access denied. Developer action.', 403);

    var cols = ['users', 'members', 'contributions', 'savings', 'loans', 'repayments', 'transactions', 'settings'];
    var backup = { timestamp: new Date().toISOString(), version: '1.0', data: {} };
    
    cols.forEach(function(c) {
      backup.data[c] = firestoreQuery_(c, []);
    });

    var blob = Utilities.newBlob(JSON.stringify(backup, null, 2), 'application/json', 'Coop_Backup_' + new Date().getTime() + '.json');
    var file = DriveApp.createFile(blob);
    
    logAction_('SYSTEM_BACKUP', 'Developer', auth.session.userId, null, null, { fileId: file.getId(), url: file.getUrl() });
    
    return successResponse({ fileId: file.getId(), url: file.getUrl() }, 'Backup completed successfully.');
  } catch (e) {
    logError('Developer', 'executeDatabaseBackup', e);
    return errorResponse('Backup failed.', 500);
  }
}

/**
 * Restores the database from a backup JSON payload. Use with caution.
 * @param {Object} params - { token, backupJson }
 * @returns {Object}
 */
function restoreDatabase(params) {
  try {
    var auth = authorise_(params.token, '*');
    if (auth.error) return auth.error;
    if (auth.session.role !== 'developer') return errorResponse('Access denied. Developer action.', 403);

    if (!params.backupJson) return errorResponse('Backup payload required.', 400);
    
    var backup = JSON.parse(params.backupJson);
    if (!backup.data) return errorResponse('Invalid backup format.', 400);

    // Note: Due to limitations in Apps Script execution time and Firestore REST API rate limits,
    // large restores should be done via batches. We do a simple iteration here.
    var collections = Object.keys(backup.data);
    var count = 0;

    collections.forEach(function(col) {
      var docs = backup.data[col];
      docs.forEach(function(doc) {
        var id = doc._id;
        if (id) {
          var cleanDoc = JSON.parse(JSON.stringify(doc));
          delete cleanDoc._id;
          // Creates or overwrites the document
          firestoreCreate_(col, cleanDoc, id);
          count++;
        }
      });
    });

    logAction_('SYSTEM_RESTORE', 'Developer', auth.session.userId, null, null, { recordsRestored: count });
    
    return successResponse({ recordsRestored: count }, 'Database restore completed successfully.');
  } catch (e) {
    logError('Developer', 'restoreDatabase', e);
    return errorResponse('Restore failed.', 500);
  }
}

/**
 * Tests Firebase connectivity by retrieving a dummy document or doing a light query.
 * @param {Object} params - { token }
 * @returns {Object}
 */
function testFirebaseConnectivity(params) {
  try {
    var auth = authorise_(params.token, '*');
    if (auth.error) return auth.error;
    if (auth.session.role !== 'developer') return errorResponse('Access denied.', 403);

    var start = new Date().getTime();
    var res = firestoreQuery_('settings', [], null, 1);
    var end = new Date().getTime();
    
    return successResponse({ latencyMs: (end - start), status: 'Connected', recordsFound: res.length }, 'Firebase connectivity OK.');
  } catch (e) {
    logError('Developer', 'testFirebaseConnectivity', e);
    return errorResponse('Firebase connectivity test failed: ' + e.message, 500);
  }
}

/**
 * Aggregates high-level system health metrics.
 * @param {Object} params - { token }
 * @returns {Object}
 */
function getSystemHealth(params) {
  try {
    var auth = authorise_(params.token, '*');
    if (auth.error) return auth.error;
    if (auth.session.role !== 'developer') return errorResponse('Access denied.', 403);

    // Approximate counts (Firestore queries on large datasets can be slow, but ok for developer diagnostics)
    var usersCount = firestoreQuery_('users', []).length;
    var activeSessions = firestoreQuery_('sessions', []).length;
    var logs = firestoreQuery_('audit_logs', [{field:'module', op:'==', value:'Error'}]);
    
    var errorRate = logs.length > 0 ? (logs.length / 100).toFixed(2) + '%' : '0%';

    var isMaintenance = getSetting('maintenanceMode') === true;

    var health = {
      status: isMaintenance ? 'MAINTENANCE' : 'ONLINE',
      usersCount: usersCount,
      activeSessions: activeSessions,
      errorRate: errorRate,
      recentErrors: logs.length,
      latency: 'N/A' // Requires testFirebaseConnectivity
    };

    return successResponse(health, 'System health fetched.');
  } catch (e) {
    logError('Developer', 'getSystemHealth', e);
    return errorResponse('Failed to fetch system health.', 500);
  }
}
