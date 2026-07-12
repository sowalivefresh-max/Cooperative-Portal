/**
 * ============================================================
 *  COOPERATIVE SOCIETY MANAGEMENT PORTAL
 *  Database.gs  -  Firebase Firestore REST API Layer
 * ============================================================
 *
 *  SETUP INSTRUCTIONS:
 *  1. In Apps Script IDE: Extensions → Apps Script
 *  2. Click "Project Settings" (gear icon)
 *  3. Under "Script Properties", add:
 *       FIREBASE_PROJECT_ID  →  your-firebase-project-id
 *       FIREBASE_API_KEY     →  your-web-api-key
 *       PASSWORD_SALT        →  a-random-secret-string
 *  4. Go to "Services" → add "Firebase" if needed
 *  5. In GCP Console linked to this Apps Script project,
 *     enable "Cloud Firestore API"
 *  6. The Apps Script OAuth token (ScriptApp.getOAuthToken())
 *     will be used for Firestore REST calls automatically
 *     as long as the GCP project matches.
 *
 *  Firestore document value format:
 *  { stringValue: "..." }  { integerValue: "0" }
 *  { booleanValue: true }  { timestampValue: "..." }
 *  { arrayValue: { values: [...] } }
 *  { mapValue: { fields: {...} } }
 *  { nullValue: null }
 * ============================================================
 */

// ─── CONFIGURATION ─────────────────────────────────────────────────────────────

function getFirebaseConfig_() {
  var props = PropertiesService.getScriptProperties();
  return {
    projectId: props.getProperty('FIREBASE_PROJECT_ID') || 'YOUR_PROJECT_ID',
    baseUrl: function() {
      var pid = props.getProperty('FIREBASE_PROJECT_ID') || 'YOUR_PROJECT_ID';
      return 'https://firestore.googleapis.com/v1/projects/' + pid + '/databases/(default)/documents';
    }
  };
}

function getFirestoreToken_() {
  return ScriptApp.getOAuthToken();
}

// ─── CORE CRUD OPERATIONS ──────────────────────────────────────────────────────

/**
 * Fetches a single document by ID.
 * @param {string} collection
 * @param {string} docId
 * @returns {Object|null} Parsed document or null if not found.
 */
function firestoreGet_(collection, docId) {
  try {
    var config = getFirebaseConfig_();
    var url = config.baseUrl() + '/' + collection + '/' + encodeURIComponent(docId);
    var response = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + getFirestoreToken_() },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() === 404) return null;
    if (response.getResponseCode() !== 200) {
      logError('Database', 'firestoreGet_', 'HTTP ' + response.getResponseCode() + ' for ' + collection + '/' + docId);
      return null;
    }
    var raw = JSON.parse(response.getContentText());
    return parseFirestoreDoc_(raw);
  } catch (e) {
    logError('Database', 'firestoreGet_', e);
    return null;
  }
}

/**
 * Fetches all documents in a collection (up to 1000 by default).
 * Use firestoreQuery_ for filtered results.
 * @param {string} collection
 * @param {number} [limit]
 * @returns {Array}
 */
function firestoreGetAll_(collection, limit) {
  try {
    var config = getFirebaseConfig_();
    var url = config.baseUrl() + '/' + collection + '?pageSize=' + (limit || 1000);
    var response = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + getFirestoreToken_() },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) return [];
    var raw = JSON.parse(response.getContentText());
    if (!raw.documents) return [];
    return raw.documents.map(parseFirestoreDoc_);
  } catch (e) {
    logError('Database', 'firestoreGetAll_', e);
    return [];
  }
}

/**
 * Creates a new document. If docId is provided, uses that as the document ID.
 * If docId is omitted, Firestore auto-generates an ID.
 * @param {string} collection
 * @param {Object} data        - Plain JS object to store.
 * @param {string} [docId]     - Optional document ID.
 * @returns {Object|null}      - The created document or null on error.
 */
function firestoreCreate_(collection, data, docId) {
  try {
    var config = getFirebaseConfig_();
    var url = config.baseUrl() + '/' + collection;
    if (docId) url += '?documentId=' + encodeURIComponent(docId);
    var body = { fields: toFirestoreFields_(data) };
    var response = UrlFetchApp.fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + getFirestoreToken_(),
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200 && response.getResponseCode() !== 201) {
      logError('Database', 'firestoreCreate_', 'HTTP ' + response.getResponseCode() + ': ' + response.getContentText());
      return null;
    }
    return parseFirestoreDoc_(JSON.parse(response.getContentText()));
  } catch (e) {
    logError('Database', 'firestoreCreate_', e);
    return null;
  }
}

/**
 * Updates (merges) specific fields in an existing document.
 * Only the fields provided will be updated (PATCH with updateMask).
 * @param {string} collection
 * @param {string} docId
 * @param {Object} data  - Fields to update.
 * @returns {Object|null}
 */
function firestoreUpdate_(collection, docId, data) {
  try {
    var config = getFirebaseConfig_();
    var fields = toFirestoreFields_(data);
    var fieldPaths = Object.keys(fields).map(function(k) {
      return 'updateMask.fieldPaths=' + encodeURIComponent(k);
    }).join('&');
    var url = config.baseUrl() + '/' + collection + '/' + encodeURIComponent(docId) + '?' + fieldPaths;
    var body = { fields: fields };
    var response = UrlFetchApp.fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + getFirestoreToken_(),
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) {
      logError('Database', 'firestoreUpdate_', 'HTTP ' + response.getResponseCode() + ': ' + response.getContentText());
      return null;
    }
    return parseFirestoreDoc_(JSON.parse(response.getContentText()));
  } catch (e) {
    logError('Database', 'firestoreUpdate_', e);
    return null;
  }
}

/**
 * Deletes a document by ID.
 * @param {string} collection
 * @param {string} docId
 * @returns {boolean}
 */
function firestoreDelete_(collection, docId) {
  try {
    var config = getFirebaseConfig_();
    var url = config.baseUrl() + '/' + collection + '/' + encodeURIComponent(docId);
    var response = UrlFetchApp.fetch(url, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + getFirestoreToken_() },
      muteHttpExceptions: true
    });
    return response.getResponseCode() === 200;
  } catch (e) {
    logError('Database', 'firestoreDelete_', e);
    return false;
  }
}

// ─── QUERY (RunQuery) ─────────────────────────────────────────────────────────

/**
 * Runs a Firestore structured query.
 * @param {string} collection
 * @param {Array}  filters   - Array of {field, op, value} objects.
 *   Supported ops: '==', '<', '<=', '>', '>=', 'array-contains', 'in'
 * @param {Object} [orderBy] - { field, direction: 'ASCENDING'|'DESCENDING' }
 * @param {number} [limit]
 * @returns {Array}
 */
function firestoreQuery_(collection, filters, orderBy, limit) {
  try {
    var config = getFirebaseConfig_();
    var url = 'https://firestore.googleapis.com/v1/projects/' + config.projectId +
              '/databases/(default)/documents:runQuery';

    var where = buildWhereClause_(filters || []);
    var query = {
      structuredQuery: {
        from: [{ collectionId: collection }],
        limit: limit || 500
      }
    };
    if (where) query.structuredQuery.where = where;
    if (orderBy) {
      query.structuredQuery.orderBy = [{
        field: { fieldPath: orderBy.field },
        direction: orderBy.direction || 'ASCENDING'
      }];
    }

    var response = UrlFetchApp.fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + getFirestoreToken_(),
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(query),
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) return [];
    var results = JSON.parse(response.getContentText());
    return results
      .filter(function(r) { return r.document; })
      .map(function(r) { return parseFirestoreDoc_(r.document); });
  } catch (e) {
    logError('Database', 'firestoreQuery_', e);
    return [];
  }
}

/**
 * Builds a Firestore WHERE clause from an array of filter objects.
 * @param {Array} filters
 * @returns {Object|null}
 */
function buildWhereClause_(filters) {
  if (!filters || filters.length === 0) return null;

  var opMap = {
    '==': 'EQUAL',
    '<':  'LESS_THAN',
    '<=': 'LESS_THAN_OR_EQUAL',
    '>':  'GREATER_THAN',
    '>=': 'GREATER_THAN_OR_EQUAL',
    '!=': 'NOT_EQUAL',
    'in': 'IN',
    'array-contains': 'ARRAY_CONTAINS'
  };

  var clauses = filters.map(function(f) {
    var fv = toFirestoreValue_(f.value);
    if (f.op === 'in' && Array.isArray(f.value)) {
      fv = { arrayValue: { values: f.value.map(toFirestoreValue_) } };
    }
    return {
      fieldFilter: {
        field: { fieldPath: f.field },
        op: opMap[f.op] || 'EQUAL',
        value: fv
      }
    };
  });

  if (clauses.length === 1) return clauses[0];
  return { compositeFilter: { op: 'AND', filters: clauses } };
}

// ─── BATCH WRITE ──────────────────────────────────────────────────────────────

/**
 * Performs multiple write operations in a single batch.
 * @param {Array} writes - Array of {type, collection, docId, data} objects.
 *   type: 'create' | 'update' | 'delete'
 * @returns {boolean}
 */
function firestoreBatchWrite_(writes) {
  try {
    var config = getFirebaseConfig_();
    var url = 'https://firestore.googleapis.com/v1/projects/' + config.projectId +
              '/databases/(default)/documents:batchWrite';

    var batchWrites = writes.map(function(w) {
      var name = 'projects/' + config.projectId + '/databases/(default)/documents/' +
                 w.collection + '/' + w.docId;
      if (w.type === 'delete') return { delete: name };
      var fields = toFirestoreFields_(w.data);
      if (w.type === 'update') {
        return {
          update: { name: name, fields: fields },
          updateMask: { fieldPaths: Object.keys(fields) }
        };
      }
      // create
      return { update: { name: name, fields: fields } };
    });

    var response = UrlFetchApp.fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + getFirestoreToken_(),
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({ writes: batchWrites }),
      muteHttpExceptions: true
    });
    return response.getResponseCode() === 200;
  } catch (e) {
    logError('Database', 'firestoreBatchWrite_', e);
    return false;
  }
}

// ─── DOCUMENT PARSING ─────────────────────────────────────────────────────────

/**
 * Converts a Firestore REST API document to a plain JS object.
 * Extracts the document ID from the `name` path.
 * @param {Object} fsDoc - Raw Firestore document object.
 * @returns {Object}
 */
function parseFirestoreDoc_(fsDoc) {
  if (!fsDoc || !fsDoc.fields) return null;
  var obj = parseFirestoreFields_(fsDoc.fields);
  // Extract document ID from the full resource name path
  if (fsDoc.name) {
    var parts = fsDoc.name.split('/');
    obj._id = parts[parts.length - 1];
  }
  if (fsDoc.createTime) obj._createdAt = fsDoc.createTime;
  if (fsDoc.updateTime) obj._updatedAt = fsDoc.updateTime;
  return obj;
}

/**
 * Recursively parses Firestore field value objects.
 * @param {Object} fields
 * @returns {Object}
 */
function parseFirestoreFields_(fields) {
  var obj = {};
  Object.keys(fields).forEach(function(key) {
    obj[key] = parseFirestoreValue_(fields[key]);
  });
  return obj;
}

/**
 * Converts a single Firestore value object to a native JS value.
 * @param {Object} val - Firestore typed value.
 * @returns {*}
 */
function parseFirestoreValue_(val) {
  if (val === null || val === undefined) return null;
  if ('stringValue'    in val) return val.stringValue;
  if ('integerValue'   in val) return parseInt(val.integerValue, 10);
  if ('doubleValue'    in val) return parseFloat(val.doubleValue);
  if ('booleanValue'   in val) return val.booleanValue;
  if ('nullValue'      in val) return null;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue'     in val) {
    var arr = val.arrayValue;
    if (!arr.values) return [];
    return arr.values.map(parseFirestoreValue_);
  }
  if ('mapValue' in val) {
    if (!val.mapValue.fields) return {};
    return parseFirestoreFields_(val.mapValue.fields);
  }
  if ('referenceValue' in val) return val.referenceValue;
  return null;
}

// ─── VALUE CONVERSION (JS → FIRESTORE) ────────────────────────────────────────

/**
 * Converts a plain JS object into Firestore fields format.
 * @param {Object} data
 * @returns {Object}
 */
function toFirestoreFields_(data) {
  var fields = {};
  Object.keys(data).forEach(function(key) {
    if (data[key] !== undefined) {
      fields[key] = toFirestoreValue_(data[key]);
    }
  });
  return fields;
}

/**
 * Converts a native JS value to a Firestore typed value object.
 * @param {*} val
 * @returns {Object}
 */
function toFirestoreValue_(val) {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (typeof val === 'string') {
    // Detect ISO timestamps
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val)) {
      return { timestampValue: val };
    }
    return { stringValue: val };
  }
  if (val instanceof Date) {
    return { timestampValue: val.toISOString() };
  }
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.map(toFirestoreValue_)
      }
    };
  }
  if (typeof val === 'object') {
    return {
      mapValue: {
        fields: toFirestoreFields_(val)
      }
    };
  }
  return { stringValue: String(val) };
}

// ─── UTILITY WRAPPERS ─────────────────────────────────────────────────────────

/**
 * Checks if a Firestore document exists.
 * @param {string} collection
 * @param {string} docId
 * @returns {boolean}
 */
function firestoreExists_(collection, docId) {
  return firestoreGet_(collection, docId) !== null;
}

/**
 * Counts documents in a collection matching filters.
 * (Achieved by querying and counting results – Firestore count queries
 *  require Firestore v1beta2; this is the GAS-compatible approach.)
 * @param {string} collection
 * @param {Array}  filters
 * @returns {number}
 */
function firestoreCount_(collection, filters) {
  return firestoreQuery_(collection, filters || []).length;
}

/**
 * Adds a server timestamp field value object for use in Firestore writes.
 * @returns {Object}
 */
function serverTimestamp_() {
  return { timestampValue: new Date().toISOString() };
}
