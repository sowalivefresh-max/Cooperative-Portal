/**
 * ============================================================
 *  COOPERATIVE SOCIETY MANAGEMENT PORTAL
 *  Notifications.gs  -  Notifications, Announcements & Alerts
 * ============================================================
 */

// ─── ANNOUNCEMENTS ────────────────────────────────────────────────────────────

/**
 * Creates a new announcement.
 * @param {Object} params - { token, title, body, priority, targetAudience, expiresAt? }
 */
function createAnnouncement(params) {
  try {
    var auth = authorise_(params.token, 'manage_notifications');
    if (auth.error) return auth.error;

    var v = validateRequired(params, ['title', 'body']);
    if (!v.valid) return errorResponse(v.errors.join(', '), 400);

    var announcementId = generateId('ANN', 'announcements');
    var now = new Date().toISOString();

    var data = {
      announcementId:  announcementId,
      title:           sanitise(params.title),
      body:            sanitise(params.body),
      priority:        params.priority || 'Normal',
      targetAudience:  params.targetAudience || 'All',
      isPublished:     params.isPublished !== false,
      publishedAt:     now,
      expiresAt:       params.expiresAt || null,
      createdBy:       auth.session.userId,
      createdAt:       now
    };

    firestoreCreate_('announcements', data, announcementId);

    // Also create notifications for targeted members
    if (data.isPublished) {
      createBroadcastNotification_(
        data.targetAudience,
        data.title,
        data.body,
        'Announcement'
      );
    }

    logAction_('CREATE_ANNOUNCEMENT', 'Notifications', auth.session.userId, announcementId, null, data);
    return successResponse({ announcementId: announcementId }, 'Announcement created.');
  } catch (e) {
    logError('Notifications', 'createAnnouncement', e);
    return errorResponse('Failed to create announcement.', 500);
  }
}

/**
 * Returns all active announcements.
 * @param {Object} params - { token, targetAudience? }
 */
function getAnnouncements(params) {
  try {
    // Announcements are semi-public (require valid session)
    var auth = authorise_(params.token, 'view_own_notifications');
    if (auth.error) return auth.error;

    var announcements = firestoreQuery_('announcements', [
      { field: 'isPublished', op: '==', value: true }
    ]);

    // Filter by audience
    var role = auth.session.role;
    announcements = announcements.filter(function(a) {
      if (a.targetAudience === 'All') return true;
      if (a.targetAudience === 'Members' && role === 'member') return true;
      if (a.targetAudience === 'Staff' && role !== 'member') return true;
      return false;
    });

    // Filter expired
    var now = new Date();
    announcements = announcements.filter(function(a) {
      if (!a.expiresAt) return true;
      return new Date(a.expiresAt) > now;
    });

    announcements.sort(function(a, b) {
      // Sort by priority then date
      var priorityMap = { Urgent: 0, High: 1, Normal: 2 };
      var pa = priorityMap[a.priority] !== undefined ? priorityMap[a.priority] : 2;
      var pb = priorityMap[b.priority] !== undefined ? priorityMap[b.priority] : 2;
      if (pa !== pb) return pa - pb;
      return new Date(b.publishedAt) - new Date(a.publishedAt);
    });

    return successResponse(announcements);
  } catch (e) {
    logError('Notifications', 'getAnnouncements', e);
    return errorResponse('Failed to retrieve announcements.', 500);
  }
}

/**
 * Deletes/unpublishes an announcement.
 * @param {Object} params - { token, announcementId }
 */
function deleteAnnouncement(params) {
  try {
    var auth = authorise_(params.token, 'manage_notifications');
    if (auth.error) return auth.error;

    firestoreUpdate_('announcements', params.announcementId, {
      isPublished: false,
      updatedAt:   new Date().toISOString()
    });

    logAction_('DELETE_ANNOUNCEMENT', 'Notifications', auth.session.userId, params.announcementId, null, null);
    return successResponse(null, 'Announcement removed.');
  } catch (e) {
    logError('Notifications', 'deleteAnnouncement', e);
    return errorResponse('Failed to remove announcement.', 500);
  }
}

// ─── MEMBER NOTIFICATIONS ─────────────────────────────────────────────────────

/**
 * Returns notifications for the current user.
 * @param {Object} params - { token, unreadOnly?, page?, pageSize? }
 */
function getNotifications(params) {
  try {
    var auth = authorise_(params.token, 'view_own_notifications');
    if (auth.error) return auth.error;

    var recipientId = auth.session.memberId || auth.session.userId;
    var filters = [
      { field: 'recipientId', op: 'in', value: [recipientId, 'ALL'] }
    ];

    var notifications = firestoreQuery_('notifications', filters);

    if (params.unreadOnly) {
      notifications = notifications.filter(function(n) { return !n.isRead; });
    }

    notifications.sort(function(a, b) { return new Date(b.sentAt) - new Date(a.sentAt); });
    return successResponse(paginate(notifications, params.page, params.pageSize || 20));
  } catch (e) {
    logError('Notifications', 'getNotifications', e);
    return errorResponse('Failed to retrieve notifications.', 500);
  }
}

/**
 * Marks notifications as read.
 * @param {Object} params - { token, notificationIds: string[] | 'ALL' }
 */
function markNotificationsRead(params) {
  try {
    var auth = authorise_(params.token, 'view_own_notifications');
    if (auth.error) return auth.error;

    var recipientId = auth.session.memberId || auth.session.userId;
    var ids = params.notificationIds;

    if (ids === 'ALL') {
      var userNotifs = firestoreQuery_('notifications', [
        { field: 'recipientId', op: '==', value: recipientId },
        { field: 'isRead',      op: '==', value: false }
      ]);
      userNotifs.forEach(function(n) {
        firestoreUpdate_('notifications', n._id, {
          isRead:   true,
          readAt:   new Date().toISOString()
        });
      });
    } else if (Array.isArray(ids)) {
      ids.forEach(function(id) {
        firestoreUpdate_('notifications', id, {
          isRead: true,
          readAt: new Date().toISOString()
        });
      });
    }

    return successResponse(null, 'Notification(s) marked as read.');
  } catch (e) {
    logError('Notifications', 'markNotificationsRead', e);
    return errorResponse('Failed to mark notifications as read.', 500);
  }
}

/**
 * Returns count of unread notifications for the current user.
 * @param {Object} params - { token }
 */
function getUnreadNotificationCount(params) {
  try {
    var auth = authorise_(params.token, 'view_own_notifications');
    if (auth.error) return auth.error;

    var recipientId = auth.session.memberId || auth.session.userId;
    var count = firestoreCount_('notifications', [
      { field: 'recipientId', op: '==', value: recipientId },
      { field: 'isRead',      op: '==', value: false }
    ]);

    return successResponse({ count: count });
  } catch (e) {
    logError('Notifications', 'getUnreadNotificationCount', e);
    return successResponse({ count: 0 });
  }
}

/**
 * Sends birthday notifications to all members with today's birthday.
 * Designed to be called by a daily time-driven trigger.
 * @param {Object} params - { token }
 */
function sendBirthdayNotifications(params) {
  try {
    var auth = authorise_(params.token, 'manage_notifications');
    if (auth.error) return auth.error;

    if (!getSetting('enableBirthdayNotifications')) return successResponse(null, 'Birthday notifications are disabled.');

    var today = new Date();
    var todayMD = String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

    var members = firestoreQuery_('members', [{ field: 'status', op: '==', value: 'Active' }]);
    var count = 0;

    members.forEach(function(member) {
      if (!member.dateOfBirth) return;
      var dob = new Date(member.dateOfBirth);
      var memberMD = String(dob.getMonth() + 1).padStart(2, '0') + '-' + String(dob.getDate()).padStart(2, '0');

      if (memberMD === todayMD) {
        var societyName = getSetting('societyName') || 'Cooperative Society';
        createSystemNotification_(member.memberNumber,
          '🎂 Happy Birthday, ' + member.fullName.split(' ')[0] + '!',
          'On behalf of all members and staff of ' + societyName +
          ', we wish you a wonderful birthday! May this year bring you joy and prosperity.',
          'System');

        if (member.email) {
          sendEmail(member.email,
            societyName + ' — Happy Birthday!',
            'Dear ' + member.fullName + ',\n\nWishing you a very Happy Birthday from all of us at ' +
            societyName + '!\n\nMay this special day bring you much joy.\n\nWarm regards,\n' + societyName);
        }
        count++;
      }
    });

    return successResponse({ count: count }, count + ' birthday notification(s) sent.');
  } catch (e) {
    logError('Notifications', 'sendBirthdayNotifications', e);
    return errorResponse('Failed to send birthday notifications.', 500);
  }
}

/**
 * Sends contribution reminders to members with no contribution this month.
 * @param {Object} params - { token }
 */
function sendContributionReminders(params) {
  try {
    var auth = authorise_(params.token, 'manage_notifications');
    if (auth.error) return auth.error;

    if (!getSetting('enableContributionReminders')) {
      return successResponse(null, 'Contribution reminders are disabled.');
    }

    var currentMonth = getCurrentMonth();
    var activeMembers = firestoreQuery_('members', [{ field: 'status', op: '==', value: 'Active' }]);

    var count = 0;
    activeMembers.forEach(function(member) {
      var existing = firestoreQuery_('contributions', [
        { field: 'memberId', op: '==', value: member.memberNumber },
        { field: 'month',    op: '==', value: currentMonth },
        { field: 'type',     op: '==', value: 'Monthly' },
        { field: 'status',   op: '==', value: 'Active' }
      ]);

      if (existing.length === 0) {
        var dueDay    = getSetting('contributionDueDay') || 28;
        var societyName = getSetting('societyName') || 'Cooperative Society';
        var amount    = getSetting('monthlyContributionAmount') || 5000;

        createSystemNotification_(member.memberNumber,
          'Monthly Contribution Reminder',
          'Your monthly contribution of ' + formatCurrency(parseFloat(amount)) +
          ' for ' + formatMonthLabel(currentMonth) + ' is due by the ' + dueDay +
          'th. Please ensure prompt payment.', 'System');

        if (member.email) {
          sendEmail(member.email,
            societyName + ' — Monthly Contribution Reminder',
            'Dear ' + member.fullName + ',\n\nThis is a reminder that your monthly contribution of ' +
            formatCurrency(parseFloat(amount)) + ' for ' + formatMonthLabel(currentMonth) +
            ' is due by the ' + dueDay + 'th.\n\nPlease visit the office or make payment promptly.\n\nRegards,\n' +
            societyName);
        }
        count++;
      }
    });

    return successResponse({ count: count }, count + ' contribution reminder(s) sent.');
  } catch (e) {
    logError('Notifications', 'sendContributionReminders', e);
    return errorResponse('Failed to send contribution reminders.', 500);
  }
}

// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

/**
 * Creates a system notification for a specific member.
 * @param {string} memberId
 * @param {string} title
 * @param {string} message
 * @param {string} type
 */
function createSystemNotification_(memberId, title, message, type) {
  try {
    var notifId = generateId('NTF', 'notifications');
    firestoreCreate_('notifications', {
      notificationId: notifId,
      recipientId:    memberId,
      type:           type || 'System',
      title:          title,
      message:        message,
      isRead:         false,
      sentAt:         new Date().toISOString(),
      expiresAt:      null
    }, notifId);
  } catch (e) {
    Logger.log('[Notifications] createSystemNotification_ failed: ' + e.message);
  }
}

/**
 * Creates broadcast notifications for all members or staff.
 * @param {string} audience - 'All' | 'Members' | 'Staff'
 * @param {string} title
 * @param {string} message
 * @param {string} type
 */
function createBroadcastNotification_(audience, title, message, type) {
  try {
    // Use 'ALL' as a special recipientId that all users see
    var notifId = generateId('NTF', 'notifications');
    firestoreCreate_('notifications', {
      notificationId: notifId,
      recipientId:    'ALL',
      audience:       audience,
      type:           type || 'Announcement',
      title:          title,
      message:        message,
      isRead:         false,
      sentAt:         new Date().toISOString(),
      expiresAt:      null
    }, notifId);
  } catch (e) {
    Logger.log('[Notifications] createBroadcastNotification_ failed: ' + e.message);
  }
}

/**
 * Sends a notification to all users with a specific role.
 * @param {string} role
 * @param {string} title
 * @param {string} message
 */
function notifyByRole_(role, title, message) {
  try {
    var users = firestoreQuery_('users', [
      { field: 'role',     op: '==', value: role },
      { field: 'isActive', op: '==', value: true }
    ]);
    users.forEach(function(user) {
      var notifId = generateId('NTF', 'notifications');
      firestoreCreate_('notifications', {
        notificationId: notifId,
        recipientId:    user._id,
        type:           'System',
        title:          title,
        message:        message,
        isRead:         false,
        sentAt:         new Date().toISOString()
      }, notifId);
    });
  } catch (e) {
    Logger.log('[Notifications] notifyByRole_ failed: ' + e.message);
  }
}
