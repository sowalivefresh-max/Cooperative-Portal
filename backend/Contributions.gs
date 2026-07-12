/**
 * ============================================================
 *  COOPERATIVE SOCIETY MANAGEMENT PORTAL
 *  Contributions.gs  -  Contribution Management
 * ============================================================
 */

/**
 * Returns a paginated list of contributions.
 * @param {Object} params - { token, memberId?, type?, month?, dateFrom?, dateTo?, page?, pageSize? }
 */
function getContributions(params) {
  try {
    var auth = authorise_(params.token, 'view_contributions');
    if (auth.error) {
      var selfAuth = authorise_(params.token, 'view_own_contributions');
      if (selfAuth.error) return selfAuth.error;
      params.memberId = selfAuth.session.memberId;
      auth = selfAuth;
    }

    var filters = [{ field: 'status', op: '==', value: 'Active' }];
    if (params.memberId) filters.push({ field: 'memberId', op: '==', value: params.memberId });
    if (params.type)     filters.push({ field: 'type',     op: '==', value: params.type });
    if (params.month)    filters.push({ field: 'month',    op: '==', value: params.month });

    var contributions = firestoreQuery_('contributions', filters);

    if (params.dateFrom) {
      var from = new Date(params.dateFrom);
      contributions = contributions.filter(function(c) {
        return c.paymentDate && new Date(c.paymentDate) >= from;
      });
    }
    if (params.dateTo) {
      var to = new Date(params.dateTo);
      to.setHours(23, 59, 59);
      contributions = contributions.filter(function(c) {
        return c.paymentDate && new Date(c.paymentDate) <= to;
      });
    }

    if (params.search) {
      contributions = searchFilter(contributions, params.search,
        ['memberName', 'memberId', 'receiptNumber', 'type', 'paymentMethod']);
    }

    contributions.sort(function(a, b) {
      return new Date(b.paymentDate) - new Date(a.paymentDate);
    });

    return successResponse(paginate(contributions, params.page, params.pageSize || 20));
  } catch (e) {
    logError('Contributions', 'getContributions', e);
    return errorResponse('Failed to retrieve contributions.', 500);
  }
}

/**
 * Records a new contribution.
 * @param {Object} params - { token, memberId, type, amount, month,
 *                            paymentDate, paymentMethod, notes? }
 */
function addContribution(params) {
  try {
    var auth = authorise_(params.token, 'manage_contributions');
    if (auth.error) return auth.error;

    var required = ['memberId', 'type', 'amount', 'paymentDate', 'paymentMethod'];
    var v = validateRequired(params, required);
    if (!v.valid) return errorResponse(v.errors.join(', '), 400);

    var member = firestoreGet_('members', params.memberId);
    if (!member) return errorResponse('Member not found.', 404);
    if (member.status !== 'Active') {
      return errorResponse('Cannot add contribution for a ' + member.status + ' member.', 400);
    }

    var amount = parseFloat(params.amount);
    if (isNaN(amount) || amount <= 0) return errorResponse('Invalid contribution amount.', 400);

    // For monthly contributions, check for duplicates in the same month
    if (params.type === 'Monthly' && params.month) {
      var existing = firestoreQuery_('contributions', [
        { field: 'memberId', op: '==', value: params.memberId },
        { field: 'type',     op: '==', value: 'Monthly' },
        { field: 'month',    op: '==', value: params.month },
        { field: 'status',   op: '==', value: 'Active' }
      ]);
      if (existing.length > 0) {
        return errorResponse('A monthly contribution for ' + formatMonthLabel(params.month) +
          ' has already been recorded for this member.', 409);
      }
    }

    var contributionId = generateId('CTB', 'contributions');
    var receiptNumber  = generateReceiptNumber();
    var now            = new Date().toISOString();

    var contributionData = {
      contributionId: contributionId,
      memberId:       params.memberId,
      memberName:     member.fullName,
      type:           params.type,
      amount:         amount,
      month:          params.month || params.paymentDate.substring(0, 7),
      paymentDate:    params.paymentDate,
      paymentMethod:  params.paymentMethod,
      receiptNumber:  receiptNumber,
      notes:          sanitise(params.notes || ''),
      recordedBy:     auth.session.userId,
      status:         'Active',
      createdAt:      now,
      updatedAt:      now
    };

    firestoreCreate_('contributions', contributionData, contributionId);

    // Update member total contributions
    firestoreUpdate_('members', params.memberId, {
      totalContributions: (member.totalContributions || 0) + amount,
      updatedAt: now
    });

    // Update savings balance (contributions go to savings)
    updateSavingsBalance_(params.memberId, amount, 'credit');

    // Record in transaction ledger
    recordTransaction_({
      memberId:    params.memberId,
      memberName:  member.fullName,
      type:        'Credit',
      category:    'Contribution',
      amount:      amount,
      reference:   contributionId,
      description: params.type + ' Contribution — ' + formatMonthLabel(params.month || params.paymentDate.substring(0, 7)),
      date:        params.paymentDate,
      recordedBy:  auth.session.userId
    });

    logAction_('ADD_CONTRIBUTION', 'Contributions', auth.session.userId, contributionId, null, contributionData);

    return successResponse({
      contributionId: contributionId,
      receiptNumber:  receiptNumber,
      receipt:        generateContributionReceipt_(contributionData, member)
    }, 'Contribution recorded successfully.');
  } catch (e) {
    logError('Contributions', 'addContribution', e);
    return errorResponse('Failed to record contribution.', 500);
  }
}

/**
 * Edits a contribution record (before reversing/correcting).
 * @param {Object} params - { token, contributionId, amount?, paymentDate?, paymentMethod?, notes? }
 */
function editContribution(params) {
  try {
    var auth = authorise_(params.token, 'manage_contributions');
    if (auth.error) return auth.error;

    var contrib = firestoreGet_('contributions', params.contributionId);
    if (!contrib) return errorResponse('Contribution not found.', 404);
    if (contrib.status === 'Reversed') return errorResponse('Cannot edit a reversed contribution.', 400);

    var oldAmount = contrib.amount;
    var newAmount = params.amount ? parseFloat(params.amount) : oldAmount;

    if (isNaN(newAmount) || newAmount <= 0) return errorResponse('Invalid contribution amount.', 400);

    var updates = {
      amount:        newAmount,
      paymentDate:   params.paymentDate    || contrib.paymentDate,
      paymentMethod: params.paymentMethod  || contrib.paymentMethod,
      notes:         params.notes !== undefined ? sanitise(params.notes) : contrib.notes,
      updatedAt:     new Date().toISOString(),
      updatedBy:     auth.session.userId
    };

    firestoreUpdate_('contributions', params.contributionId, updates);

    // Adjust member balance and savings for the difference
    var diff = newAmount - oldAmount;
    if (diff !== 0) {
      var member = firestoreGet_('members', contrib.memberId);
      if (member) {
        firestoreUpdate_('members', contrib.memberId, {
          totalContributions: (member.totalContributions || 0) + diff,
          updatedAt: new Date().toISOString()
        });
        updateSavingsBalance_(contrib.memberId, Math.abs(diff), diff >= 0 ? 'credit' : 'debit');
      }
    }

    logAction_('EDIT_CONTRIBUTION', 'Contributions', auth.session.userId, params.contributionId, contrib, updates);
    return successResponse(null, 'Contribution updated successfully.');
  } catch (e) {
    logError('Contributions', 'editContribution', e);
    return errorResponse('Failed to update contribution.', 500);
  }
}

/**
 * Reverses a contribution (soft delete).
 * @param {Object} params - { token, contributionId, reason }
 */
function reverseContribution(params) {
  try {
    var auth = authorise_(params.token, 'manage_contributions');
    if (auth.error) return auth.error;
    if (!hasPermission_(auth.session.role, 'manage_settings')) {
      return errorResponse('Only administrators can reverse contributions.', 403);
    }

    if (!params.reason) return errorResponse('Reversal reason is required.', 400);

    var contrib = firestoreGet_('contributions', params.contributionId);
    if (!contrib) return errorResponse('Contribution not found.', 404);
    if (contrib.status === 'Reversed') return errorResponse('This contribution is already reversed.', 400);

    firestoreUpdate_('contributions', params.contributionId, {
      status:        'Reversed',
      reversalReason: sanitise(params.reason),
      reversedBy:    auth.session.userId,
      reversedAt:    new Date().toISOString(),
      updatedAt:     new Date().toISOString()
    });

    // Reverse savings balance and member totals
    var member = firestoreGet_('members', contrib.memberId);
    if (member) {
      firestoreUpdate_('members', contrib.memberId, {
        totalContributions: Math.max(0, (member.totalContributions || 0) - contrib.amount),
        updatedAt: new Date().toISOString()
      });
      updateSavingsBalance_(contrib.memberId, contrib.amount, 'debit');
    }

    // Reverse the transaction
    recordTransaction_({
      memberId:    contrib.memberId,
      memberName:  contrib.memberName,
      type:        'Debit',
      category:    'Reversal',
      amount:      contrib.amount,
      reference:   params.contributionId,
      description: 'Reversal of Contribution ' + contrib.contributionId + ': ' + params.reason,
      date:        new Date().toISOString(),
      recordedBy:  auth.session.userId
    });

    logAction_('REVERSE_CONTRIBUTION', 'Contributions', auth.session.userId,
               params.contributionId, { status: 'Active' }, { status: 'Reversed', reason: params.reason });
    return successResponse(null, 'Contribution reversed successfully.');
  } catch (e) {
    logError('Contributions', 'reverseContribution', e);
    return errorResponse('Failed to reverse contribution.', 500);
  }
}

/**
 * Bulk imports contributions from an array.
 * @param {Object} params - { token, contributions: Array }
 */
function bulkImportContributions(params) {
  try {
    var auth = authorise_(params.token, 'manage_contributions');
    if (auth.error) return auth.error;

    var records = params.contributions || [];
    if (records.length === 0) return errorResponse('No contributions to import.', 400);

    var results = { success: 0, failed: 0, errors: [] };

    records.forEach(function(record, idx) {
      var r = addContribution(Object.assign({}, record, { token: params.token }));
      if (r.success) {
        results.success++;
      } else {
        results.failed++;
        results.errors.push('Row ' + (idx + 1) + ': ' + r.message);
      }
    });

    return successResponse(results,
      results.success + ' contribution(s) imported. ' + results.failed + ' failed.');
  } catch (e) {
    logError('Contributions', 'bulkImportContributions', e);
    return errorResponse('Bulk import failed.', 500);
  }
}

/**
 * Returns contribution summary statistics.
 * @param {Object} params - { token, memberId?, year? }
 */
function getContributionStats(params) {
  try {
    var auth = authorise_(params.token, 'view_contributions');
    if (auth.error) return auth.error;

    var filters = [{ field: 'status', op: '==', value: 'Active' }];
    if (params.memberId) filters.push({ field: 'memberId', op: '==', value: params.memberId });

    var contributions = firestoreQuery_('contributions', filters);

    // Filter by year
    var year = parseInt(params.year || new Date().getFullYear(), 10);
    var yearContribs = contributions.filter(function(c) {
      return c.paymentDate && c.paymentDate.startsWith(String(year));
    });

    // Monthly breakdown for current year
    var monthly = {};
    for (var m = 1; m <= 12; m++) {
      var key = year + '-' + String(m).padStart(2, '0');
      monthly[key] = 0;
    }
    yearContribs.forEach(function(c) {
      var mkey = c.paymentDate.substring(0, 7);
      if (monthly[mkey] !== undefined) monthly[mkey] += c.amount || 0;
    });

    // By type
    var byType = {};
    contributions.forEach(function(c) {
      byType[c.type] = (byType[c.type] || 0) + (c.amount || 0);
    });

    return successResponse({
      total:          contributions.reduce(function(s, c) { return s + (c.amount || 0); }, 0),
      thisYear:       yearContribs.reduce(function(s, c) { return s + (c.amount || 0); }, 0),
      thisMonth:      yearContribs.filter(function(c) {
                        return c.month === getCurrentMonth();
                      }).reduce(function(s, c) { return s + (c.amount || 0); }, 0),
      count:          contributions.length,
      monthlyChart:   monthly,
      byType:         byType
    });
  } catch (e) {
    logError('Contributions', 'getContributionStats', e);
    return errorResponse('Failed to retrieve contribution stats.', 500);
  }
}

// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

/**
 * Generates a printable contribution receipt HTML.
 * @param {Object} contrib - Contribution record.
 * @param {Object} member  - Member record.
 * @returns {string}
 */
function generateContributionReceipt_(contrib, member) {
  var societyName = getSetting('societyName') || 'Cooperative Society';
  var footer      = getSetting('receiptFooterText') || '';

  return '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<title>Contribution Receipt</title>' +
    '<style>' +
    'body{font-family:Arial,sans-serif;max-width:420px;margin:0 auto;padding:20px;color:#222}' +
    '.header{text-align:center;border-bottom:2px solid #1B5E20;padding-bottom:10px;margin-bottom:15px}' +
    '.header h2{color:#1B5E20;margin:0;font-size:16px}' +
    '.header h3{color:#F57F17;margin:4px 0;font-size:14px}' +
    '.receipt-no{text-align:center;background:#f0f7f0;padding:8px;border-radius:4px;margin:10px 0;font-weight:bold;color:#1B5E20}' +
    'table{width:100%;border-collapse:collapse;margin:10px 0}' +
    'td{padding:6px 0;font-size:13px;border-bottom:1px dotted #ddd}' +
    'td:first-child{color:#555;width:45%}' +
    'td:last-child{font-weight:600;text-align:right}' +
    '.total-row td{font-size:15px;color:#1B5E20;border-top:2px solid #1B5E20;border-bottom:none;padding-top:10px}' +
    '.footer{text-align:center;margin-top:15px;font-size:11px;color:#888;border-top:1px solid #ddd;padding-top:10px}' +
    '@media print{body{margin:0;padding:10px}}' +
    '</style></head><body>' +
    '<div class="header">' +
    '<h2>' + societyName + '</h2>' +
    '<h3>CONTRIBUTION RECEIPT</h3>' +
    '</div>' +
    '<div class="receipt-no">Receipt No: ' + contrib.receiptNumber + '</div>' +
    '<table>' +
    '<tr><td>Member No</td><td>' + contrib.memberId + '</td></tr>' +
    '<tr><td>Member Name</td><td>' + contrib.memberName + '</td></tr>' +
    '<tr><td>Type</td><td>' + contrib.type + ' Contribution</td></tr>' +
    '<tr><td>Period</td><td>' + formatMonthLabel(contrib.month) + '</td></tr>' +
    '<tr><td>Payment Method</td><td>' + contrib.paymentMethod + '</td></tr>' +
    '<tr><td>Date</td><td>' + formatDate(contrib.paymentDate) + '</td></tr>' +
    (contrib.notes ? '<tr><td>Notes</td><td>' + contrib.notes + '</td></tr>' : '') +
    '<tr class="total-row"><td>Amount Paid</td><td>' + formatCurrency(contrib.amount) + '</td></tr>' +
    '</table>' +
    '<div class="footer">' + footer + '<br>Generated: ' + formatDateTime(new Date()) + '</div>' +
    '</body></html>';
}
