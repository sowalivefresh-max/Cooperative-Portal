/**
 * ============================================================
 *  COOPERATIVE SOCIETY MANAGEMENT PORTAL
 *  Members.gs  -  Member Registration & Profile Management
 * ============================================================
 */

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Returns a paginated list of members.
 * @param {Object} params - { token, search?, status?, page?, pageSize? }
 */
function getMembers(params) {
  try {
    var auth = authorise_(params.token, 'view_members');
    if (auth.error) return auth.error;

    var filters = [];
    if (params.status) filters.push({ field: 'status', op: '==', value: params.status });

    var members = filters.length > 0
      ? firestoreQuery_('members', filters)
      : firestoreGetAll_('members');

    if (params.search) {
      members = searchFilter(members, params.search,
        ['fullName', 'memberNumber', 'phone', 'email', 'occupation', 'employer']);
    }

    members.sort(function(a, b) {
      return (a.fullName || '').localeCompare(b.fullName || '');
    });

    return successResponse(paginate(members, params.page, params.pageSize || 20));
  } catch (e) {
    logError('Members', 'getMembers', e);
    return errorResponse('Failed to retrieve members.', 500);
  }
}

/**
 * Returns a single member's full profile.
 * @param {Object} params - { token, memberId }
 */
function getMember(params) {
  try {
    var auth = authorise_(params.token, 'view_members');
    if (auth.error) {
      // Members can view their own profile
      var selfAuth = authorise_(params.token, 'view_own_dashboard');
      if (selfAuth.error) return selfAuth.error;
      if (selfAuth.session.memberId !== params.memberId) {
        return errorResponse('Insufficient permissions.', 403);
      }
      auth = selfAuth;
    }

    var member = firestoreGet_('members', params.memberId);
    if (!member) return errorResponse('Member not found.', 404);

    // Attach financial summary
    member.financialSummary = getMemberFinancialSummary_(params.memberId);

    return successResponse(member);
  } catch (e) {
    logError('Members', 'getMember', e);
    return errorResponse('Failed to retrieve member.', 500);
  }
}

/**
 * Registers a new member.
 * @param {Object} params - { token, fullName, gender, dateOfBirth, maritalStatus,
 *                            occupation, employer, residentialAddress, phone, email,
 *                            nextOfKin, beneficiary, nationalId, bankDetails,
 *                            passportPhotoUrl?, signatureUrl? }
 */
function createMember(params) {
  try {
    var auth = authorise_(params.token, 'manage_members');
    if (auth.error) return auth.error;

    var required = ['fullName', 'gender', 'phone', 'email', 'residentialAddress'];
    var v = validateRequired(params, required);
    if (!v.valid) return errorResponse(v.errors.join(', '), 400);

    if (!isValidEmail(params.email)) return errorResponse('Invalid email address.', 400);
    if (!isValidPhone(params.phone)) return errorResponse('Invalid phone number.', 400);

    // Check for duplicate email or phone
    var existing = firestoreQuery_('members', [{ field: 'email', op: '==', value: params.email.toLowerCase() }]);
    if (existing.length > 0) return errorResponse('A member with this email already exists.', 409);

    var memberNumber = generateId('MBR', 'members');
    var now = new Date().toISOString();

    var memberData = {
      memberNumber:        memberNumber,
      fullName:            sanitise(params.fullName),
      gender:              params.gender,
      dateOfBirth:         params.dateOfBirth || null,
      maritalStatus:       params.maritalStatus || '',
      occupation:          sanitise(params.occupation || ''),
      employer:            sanitise(params.employer || ''),
      residentialAddress:  sanitise(params.residentialAddress),
      phone:               params.phone,
      email:               params.email.toLowerCase(),
      nextOfKin:           params.nextOfKin || null,
      beneficiary:         params.beneficiary || null,
      nationalId:          params.nationalId || '',
      bankDetails:         params.bankDetails || null,
      passportPhotoUrl:    params.passportPhotoUrl || '',
      signatureUrl:        params.signatureUrl || '',
      dateJoined:          params.dateJoined || now,
      status:              'Active',
      totalSavings:        0,
      totalContributions:  0,
      currentBalance:      0,
      loanBalance:         0,
      createdBy:           auth.session.userId,
      createdAt:           now,
      updatedAt:           now
    };

    firestoreCreate_('members', memberData, memberNumber);

    // Create savings ledger for this member
    var savingsId = 'SAV-' + memberNumber;
    firestoreCreate_('savings', {
      savingsId:       savingsId,
      memberId:        memberNumber,
      memberName:      memberData.fullName,
      type:            'Regular',
      openingBalance:  0,
      currentBalance:  0,
      interestAccrued: 0,
      lastInterestDate: now,
      createdAt:       now,
      updatedAt:       now
    }, savingsId);

    // Send welcome email
    var societyName = getSetting('societyName') || 'Cooperative Society';
    var emailSubject = 'Welcome to ' + societyName;
    var emailBody = 'Dear ' + memberData.fullName + ',\n\n' +
      'Welcome to ' + societyName + '!\n\n' +
      'Your membership number is: ' + memberNumber + '\n\n' +
      'You can now access your personal dashboard using your registered email.\n\n' +
      'Regards,\nThe ' + societyName + ' Team';
    sendEmail(memberData.email, emailSubject, emailBody);

    // Create notification
    createSystemNotification_(memberNumber,
      'Welcome to ' + societyName,
      'Your membership has been registered. Member Number: ' + memberNumber,
      'System');

    logAction_('CREATE_MEMBER', 'Members', auth.session.userId, memberNumber, null, memberData);
    return successResponse({ memberNumber: memberNumber }, 'Member registered successfully.');
  } catch (e) {
    logError('Members', 'createMember', e);
    return errorResponse('Failed to register member.', 500);
  }
}

/**
 * Updates a member's profile.
 * @param {Object} params - { token, memberId, ...fieldsToUpdate }
 */
function updateMember(params) {
  try {
    var auth = authorise_(params.token, 'manage_members');
    if (auth.error) return auth.error;

    var member = firestoreGet_('members', params.memberId);
    if (!member) return errorResponse('Member not found.', 404);

    var allowed = [
      'fullName', 'gender', 'dateOfBirth', 'maritalStatus', 'occupation',
      'employer', 'residentialAddress', 'phone', 'email', 'nextOfKin',
      'beneficiary', 'nationalId', 'bankDetails', 'passportPhotoUrl',
      'signatureUrl', 'dateJoined', 'status'
    ];

    var updates = { updatedAt: new Date().toISOString(), updatedBy: auth.session.userId };
    allowed.forEach(function(field) {
      if (params[field] !== undefined) {
        updates[field] = (typeof params[field] === 'string')
          ? sanitise(params[field]) : params[field];
      }
    });

    if (updates.email) updates.email = updates.email.toLowerCase();
    if (updates.email && !isValidEmail(updates.email)) {
      return errorResponse('Invalid email address.', 400);
    }
    if (updates.phone && !isValidPhone(updates.phone)) {
      return errorResponse('Invalid phone number.', 400);
    }

    firestoreUpdate_('members', params.memberId, updates);
    logAction_('UPDATE_MEMBER', 'Members', auth.session.userId, params.memberId, member, updates);

    return successResponse(null, 'Member profile updated successfully.');
  } catch (e) {
    logError('Members', 'updateMember', e);
    return errorResponse('Failed to update member.', 500);
  }
}

/**
 * Suspends a member account.
 * @param {Object} params - { token, memberId, reason }
 */
function suspendMember(params) {
  try {
    var auth = authorise_(params.token, 'manage_members');
    if (auth.error) return auth.error;

    var member = firestoreGet_('members', params.memberId);
    if (!member) return errorResponse('Member not found.', 404);
    if (member.status === 'Suspended') return errorResponse('Member is already suspended.', 400);

    firestoreUpdate_('members', params.memberId, {
      status: 'Suspended',
      suspensionReason: params.reason || '',
      suspendedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // Deactivate associated user account
    var users = firestoreQuery_('users', [{ field: 'memberId', op: '==', value: params.memberId }]);
    if (users.length > 0) {
      firestoreUpdate_('users', users[0]._id, { isActive: false, updatedAt: new Date().toISOString() });
    }

    createSystemNotification_(params.memberId,
      'Account Suspended',
      'Your membership account has been suspended. Reason: ' + (params.reason || 'N/A') +
      '. Please contact the office.',
      'System');

    logAction_('SUSPEND_MEMBER', 'Members', auth.session.userId, params.memberId,
               { status: 'Active' }, { status: 'Suspended', reason: params.reason });
    return successResponse(null, 'Member suspended successfully.');
  } catch (e) {
    logError('Members', 'suspendMember', e);
    return errorResponse('Failed to suspend member.', 500);
  }
}

/**
 * Activates a suspended member.
 * @param {Object} params - { token, memberId }
 */
function activateMember(params) {
  try {
    var auth = authorise_(params.token, 'manage_members');
    if (auth.error) return auth.error;

    var member = firestoreGet_('members', params.memberId);
    if (!member) return errorResponse('Member not found.', 404);

    firestoreUpdate_('members', params.memberId, {
      status: 'Active',
      suspensionReason: null,
      suspendedAt: null,
      updatedAt: new Date().toISOString()
    });

    // Re-enable user account
    var users = firestoreQuery_('users', [{ field: 'memberId', op: '==', value: params.memberId }]);
    if (users.length > 0) {
      firestoreUpdate_('users', users[0]._id, { isActive: true, updatedAt: new Date().toISOString() });
    }

    createSystemNotification_(params.memberId,
      'Account Activated',
      'Your membership account has been reactivated. Welcome back!',
      'System');

    logAction_('ACTIVATE_MEMBER', 'Members', auth.session.userId, params.memberId,
               { status: member.status }, { status: 'Active' });
    return successResponse(null, 'Member activated successfully.');
  } catch (e) {
    logError('Members', 'activateMember', e);
    return errorResponse('Failed to activate member.', 500);
  }
}

/**
 * Soft-deletes a member by marking status as 'Deleted'.
 * @param {Object} params - { token, memberId, reason }
 */
function deleteMember(params) {
  try {
    var auth = authorise_(params.token, 'manage_members');
    if (auth.error) return auth.error;
    if (!hasPermission_(auth.session.role, 'manage_settings')) {
      return errorResponse('Only administrators can delete members.', 403);
    }

    var member = firestoreGet_('members', params.memberId);
    if (!member) return errorResponse('Member not found.', 404);

    // Check outstanding obligations
    var activeLoans = firestoreQuery_('loans', [
      { field: 'memberId', op: '==', value: params.memberId },
      { field: 'status',   op: 'in', value: ['Disbursed', 'Approved', 'Pending'] }
    ]);
    if (activeLoans.length > 0) {
      return errorResponse('Cannot delete member with active or pending loans.', 409);
    }

    firestoreUpdate_('members', params.memberId, {
      status:    'Deleted',
      deletedAt: new Date().toISOString(),
      deletedBy: auth.session.userId,
      deleteReason: params.reason || '',
      updatedAt: new Date().toISOString()
    });

    // Deactivate user account
    var users = firestoreQuery_('users', [{ field: 'memberId', op: '==', value: params.memberId }]);
    if (users.length > 0) {
      firestoreUpdate_('users', users[0]._id, { isActive: false, updatedAt: new Date().toISOString() });
    }

    logAction_('DELETE_MEMBER', 'Members', auth.session.userId, params.memberId, member, null);
    return successResponse(null, 'Member deleted successfully.');
  } catch (e) {
    logError('Members', 'deleteMember', e);
    return errorResponse('Failed to delete member.', 500);
  }
}

/**
 * Returns dashboard statistics for administrators.
 * @param {Object} params - { token }
 */
function getMemberStats(params) {
  try {
    var auth = authorise_(params.token, 'view_members');
    if (auth.error) return auth.error;

    var members = firestoreGetAll_('members');
    var total     = members.filter(function(m) { return m.status !== 'Deleted'; }).length;
    var active    = members.filter(function(m) { return m.status === 'Active'; }).length;
    var suspended = members.filter(function(m) { return m.status === 'Suspended'; }).length;

    // Growth by month (last 12 months)
    var now = new Date();
    var growth = {};
    for (var i = 11; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var key = Utilities.formatDate(d, 'Africa/Lagos', 'yyyy-MM');
      growth[key] = 0;
    }
    members.forEach(function(m) {
      if (m.dateJoined) {
        var mKey = m.dateJoined.substring(0, 7);
        if (growth[mKey] !== undefined) growth[mKey]++;
      }
    });

    return successResponse({
      total: total,
      active: active,
      suspended: suspended,
      growthByMonth: growth
    });
  } catch (e) {
    logError('Members', 'getMemberStats', e);
    return errorResponse('Failed to retrieve member stats.', 500);
  }
}

/**
 * Returns member's full financial statement.
 * @param {Object} params - { token, memberId, dateFrom?, dateTo? }
 */
function getMemberStatement(params) {
  try {
    var auth = authorise_(params.token, 'view_members');
    if (auth.error) {
      var selfAuth = authorise_(params.token, 'view_own_transactions');
      if (selfAuth.error) return selfAuth.error;
      if (selfAuth.session.memberId !== params.memberId) {
        return errorResponse('Insufficient permissions.', 403);
      }
      auth = selfAuth;
    }

    var member = firestoreGet_('members', params.memberId);
    if (!member) return errorResponse('Member not found.', 404);

    var transactions = firestoreQuery_('transactions', [
      { field: 'memberId', op: '==', value: params.memberId }
    ]);

    if (params.dateFrom) {
      var from = new Date(params.dateFrom);
      transactions = transactions.filter(function(t) {
        return t.date && new Date(t.date) >= from;
      });
    }
    if (params.dateTo) {
      var to = new Date(params.dateTo);
      to.setHours(23, 59, 59);
      transactions = transactions.filter(function(t) {
        return t.date && new Date(t.date) <= to;
      });
    }

    transactions.sort(function(a, b) { return new Date(a.date) - new Date(b.date); });

    var summary = getMemberFinancialSummary_(params.memberId);

    return successResponse({
      member: {
        memberNumber: member.memberNumber,
        fullName:     member.fullName,
        phone:        member.phone,
        email:        member.email,
        dateJoined:   member.dateJoined,
        status:       member.status
      },
      summary:      summary,
      transactions: transactions
    });
  } catch (e) {
    logError('Members', 'getMemberStatement', e);
    return errorResponse('Failed to retrieve member statement.', 500);
  }
}

/**
 * Searches members with full-text search.
 * @param {Object} params - { token, query, limit? }
 */
function searchMembers(params) {
  try {
    var auth = authorise_(params.token, 'view_members');
    if (auth.error) return auth.error;

    if (!params.query || params.query.trim().length < 2) {
      return errorResponse('Search query must be at least 2 characters.', 400);
    }

    var members = firestoreGetAll_('members');
    members = searchFilter(members, params.query,
      ['fullName', 'memberNumber', 'phone', 'email', 'nationalId', 'occupation', 'employer']);
    members = members.filter(function(m) { return m.status !== 'Deleted'; });
    members = members.slice(0, params.limit || 20);

    return successResponse(members);
  } catch (e) {
    logError('Members', 'searchMembers', e);
    return errorResponse('Search failed.', 500);
  }
}

// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

/**
 * Computes a member's financial summary from their transaction records.
 * @param {string} memberId
 * @returns {Object}
 */
function getMemberFinancialSummary_(memberId) {
  try {
    var savings = firestoreGet_('savings', 'SAV-' + memberId);
    var loansList = firestoreQuery_('loans', [
      { field: 'memberId', op: '==', value: memberId },
      { field: 'status', op: 'in', value: ['Disbursed', 'Completed', 'Defaulted'] }
    ]);
    var contributions = firestoreQuery_('contributions', [
      { field: 'memberId', op: '==', value: memberId },
      { field: 'status',   op: '==', value: 'Active' }
    ]);

    var totalContributions = contributions.reduce(function(sum, c) { return sum + (c.amount || 0); }, 0);
    var activeLoans = loansList.filter(function(l) { return l.status === 'Disbursed'; });
    var loanBalance = activeLoans.reduce(function(sum, l) { return sum + (l.outstandingBalance || 0); }, 0);
    var totalLoanRepaid = loansList.reduce(function(sum, l) { return sum + (l.totalRepaid || 0); }, 0);

    // Last contribution
    var sortedContribs = contributions.slice().sort(function(a, b) {
      return new Date(b.paymentDate) - new Date(a.paymentDate);
    });
    var lastContrib = sortedContribs.length > 0 ? sortedContribs[0] : null;

    return {
      totalSavings:       savings ? savings.currentBalance : 0,
      savingsInterest:    savings ? savings.interestAccrued : 0,
      totalContributions: totalContributions,
      currentBalance:     savings ? savings.currentBalance : 0,
      loanBalance:        loanBalance,
      totalLoanRepaid:    totalLoanRepaid,
      activeLoans:        activeLoans.length,
      lastContribution:   lastContrib ? { amount: lastContrib.amount, date: lastContrib.paymentDate } : null,
      monthlyContribution: getSetting('monthlyContributionAmount') || 0
    };
  } catch (e) {
    logError('Members', 'getMemberFinancialSummary_', e);
    return {};
  }
}
