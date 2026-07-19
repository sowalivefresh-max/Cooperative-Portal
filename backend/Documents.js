/**
 * ============================================================
 *  COOPERATIVE SOCIETY MANAGEMENT PORTAL
 *  Documents.gs  -  Document Management via Google Drive
 * ============================================================
 */

/**
 * Saves a base64-encoded file to Google Drive and returns the file URL.
 * @param {Object} params - { token, memberId, type, fileName, base64Data, mimeType }
 */
function uploadDocument(params) {
  try {
    var auth = authorise_(params.token, 'manage_documents');
    if (auth.error) return auth.error;

    var required = ['memberId', 'type', 'fileName', 'base64Data', 'mimeType'];
    var v = validateRequired(params, required);
    if (!v.valid) return errorResponse(v.errors.join(', '), 400);

    // Get or create cooperative documents folder
    var folder = getDocumentsFolder_();
    var memberFolder = getMemberFolder_(folder, params.memberId);

    // Decode base64
    var decoded;
    try {
      decoded = Utilities.base64Decode(params.base64Data.replace(/^data:[^;]+;base64,/, ''));
    } catch (e) {
      return errorResponse('Invalid file data.', 400);
    }

    var blob = Utilities.newBlob(decoded, params.mimeType, params.fileName);
    var file = memberFolder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var fileUrl = 'https://drive.google.com/uc?id=' + file.getId() + '&export=view';

    // Record in Firestore
    var docId = generateId('DOC', 'documents');
    var docData = {
      documentId:  docId,
      memberId:    params.memberId,
      type:        params.type,
      fileName:    params.fileName,
      fileUrl:     fileUrl,
      driveFileId: file.getId(),
      fileSize:    blob.getBytes().length,
      mimeType:    params.mimeType,
      uploadedBy:  auth.session.userId,
      uploadedAt:  new Date().toISOString()
    };

    firestoreCreate_('documents', docData, docId);

    // Update member record if this is a passport photo or signature
    if (params.type === 'Passport') {
      firestoreUpdate_('members', params.memberId, {
        passportPhotoUrl: fileUrl,
        updatedAt: new Date().toISOString()
      });
    } else if (params.type === 'Signature') {
      firestoreUpdate_('members', params.memberId, {
        signatureUrl: fileUrl,
        updatedAt: new Date().toISOString()
      });
    }

    logAction_('UPLOAD_DOCUMENT', 'Documents', auth.session.userId, docId, null, docData);
    return successResponse({ documentId: docId, fileUrl: fileUrl }, 'Document uploaded successfully.');
  } catch (e) {
    logError('Documents', 'uploadDocument', e);
    return errorResponse('Failed to upload document.', 500);
  }
}

/**
 * Returns all documents for a member.
 * @param {Object} params - { token, memberId, type? }
 */
function getMemberDocuments(params) {
  try {
    var auth = authorise_(params.token, 'manage_documents');
    if (auth.error) {
      var selfAuth = authorise_(params.token, 'view_own_documents');
      if (selfAuth.error) return selfAuth.error;
      if (selfAuth.session.memberId !== params.memberId) {
        return errorResponse('Insufficient permissions.', 403);
      }
      auth = selfAuth;
    }

    var filters = [{ field: 'memberId', op: '==', value: params.memberId }];
    if (params.type) filters.push({ field: 'type', op: '==', value: params.type });

    var docs = firestoreQuery_('documents', filters);
    docs.sort(function(a, b) { return new Date(b.uploadedAt) - new Date(a.uploadedAt); });
    return successResponse(docs);
  } catch (e) {
    logError('Documents', 'getMemberDocuments', e);
    return errorResponse('Failed to retrieve documents.', 500);
  }
}

/**
 * Deletes a document from Drive and Firestore.
 * @param {Object} params - { token, documentId }
 */
function deleteDocument(params) {
  try {
    var auth = authorise_(params.token, 'manage_documents');
    if (auth.error) return auth.error;

    var doc = firestoreGet_('documents', params.documentId);
    if (!doc) return errorResponse('Document not found.', 404);

    // Delete from Drive
    if (doc.driveFileId) {
      try {
        DriveApp.getFileById(doc.driveFileId).setTrashed(true);
      } catch (e) {
        Logger.log('[Documents] Could not delete Drive file: ' + e.message);
      }
    }

    firestoreDelete_('documents', params.documentId);
    logAction_('DELETE_DOCUMENT', 'Documents', auth.session.userId, params.documentId, doc, null);
    return successResponse(null, 'Document deleted.');
  } catch (e) {
    logError('Documents', 'deleteDocument', e);
    return errorResponse('Failed to delete document.', 500);
  }
}

// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

/**
 * Gets or creates the cooperative documents root folder.
 * @returns {DriveApp.Folder}
 */
function getDocumentsFolder_() {
  var societyName = getSetting('societyName') || 'Cooperative Society';
  var folderName  = societyName + ' — Documents';
  var folders     = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(folderName);
}

/**
 * Gets or creates a member-specific subfolder.
 * @param {DriveApp.Folder} parent
 * @param {string} memberId
 * @returns {DriveApp.Folder}
 */
function getMemberFolder_(parent, memberId) {
  var folders = parent.getFoldersByName(memberId);
  if (folders.hasNext()) return folders.next();
  return parent.createFolder(memberId);
}
