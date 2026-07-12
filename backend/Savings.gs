/**
 * ============================================================
 *  COOPERATIVE SOCIETY MANAGEMENT PORTAL
 *  Savings.gs  -  Savings Ledger, Interest & Withdrawals
 * ============================================================
 */

/**
 * Returns savings record(s).
 * @param {Object} params - { token, memberId? }
 */
function getSavings(params) {
  try {
    var auth = authorise_(params.token, 'view_savings');
    if (auth.error) {
      var selfAuth = authorise_(params.token, 'view_own_savings');
      if (selfAuth.error) return selfAuth.error;
      params.memberId = selfAuth.session.memberId;
      auth = selfAuth;
    }

    if (params.memberId) {
      var savings = firestoreGet_('savings', 'SAV-' + params.memberId);
      return successResponse(savings || { currentBalance: 0, interestAccrued: 0 });
    }

    // Admin — get all savings
    var all = firestoreGetAll_('savings');
    if (params.search) {
      all = searchFilter(all, params.search, ['memberId', 'memberName']);
    }
    all.sort(function(a, b) { return (b.currentBalance || 0) - (a.currentBalance || 0); });
    return successResponse(paginate(all, params.page, params.pageSize || 20));
  } catch (e) {
    logError('Savings', 'getSavings', e);
    return errorResponse('Failed to retrieve savings.', 500);
  }
}

/**
 * Returns savings statement/history for a member.
 * @param {Object} params - { token, memberId, dateFrom?, dateTo? }
 */
function getSavingsStatement(params) {
  try {
    var auth = authorise_(params.token, 'view_savings');
    if (auth.error) {
      var selfAuth = authorise_(params.token, 'view_own_savings');
      if (selfAuth.error) return selfAuth.error;
      if (selfAuth.session.memberId !== params.memberId) {
        return errorResponse('Insufficient permissions.', 403);
      }
      auth = selfAuth;
    }

    var savings = firestoreGet_('savings', 'SAV-' + params.memberId);
    var member  = firestoreGet_('members', params.memberId);

    var txns = firestoreQuery_('transactions', [
      { field: 'memberId', op: '==', value: params.memberId }
    ]);

    if (params.dateFrom) {
      var from = new Date(params.dateFrom);
      txns = txns.filter(function(t) { return t.date && new Date(t.date) >= from; });
    }
    if (params.dateTo) {
      var to = new Date(params.dateTo);
      to.setHours(23, 59, 59);
      txns = txns.filter(function(t) { return t.date && new Date(t.date) <= to; });
    }

    txns.sort(function(a, b) { return new Date(a.date) - new Date(b.date); });

    return successResponse({
      savings:      savings,
      member:       member ? { memberNumber: member.memberNumber, fullName: member.fullName } : null,
      transactions: txns,
      generatedAt:  new Date().toISOString()
    });
  } catch (e) {
    logError('Savings', 'getSavingsStatement', e);
    return errorResponse('Failed to retrieve savings statement.', 500);
  }
}

/**
 * Records a manual savings deposit (e.g. voluntary savings outside contribution).
 * @param {Object} params - { token, memberId, amount, paymentDate, paymentMethod, notes? }
 */
function depositSavings(params) {
  try {
    var auth = authorise_(params.token, 'manage_savings');
    if (auth.error) return auth.error;

    var required = ['memberId', 'amount', 'paymentDate', 'paymentMethod'];
    var v = validateRequired(params, required);
    if (!v.valid) return errorResponse(v.errors.join(', '), 400);

    var member = firestoreGet_('members', params.memberId);
    if (!member) return errorResponse('Member not found.', 404);
    if (member.status !== 'Active') return errorResponse('Member is not active.', 400);

    var amount = parseFloat(params.amount);
    if (isNaN(amount) || amount <= 0) return errorResponse('Invalid amount.', 400);

    var receiptNumber = generateReceiptNumber();
    updateSavingsBalance_(params.memberId, amount, 'credit');

    recordTransaction_({
      memberId:    params.memberId,
      memberName:  member.fullName,
      type:        'Credit',
      category:    'SavingsDeposit',
      amount:      amount,
      reference:   receiptNumber,
      description: 'Savings Deposit — ' + (params.notes || params.paymentMethod),
      date:        params.paymentDate,
      recordedBy:  auth.session.userId
    });

    logAction_('DEPOSIT_SAVINGS', 'Savings', auth.session.userId, 'SAV-' + params.memberId,
               null, { amount: amount });
    return successResponse({ receiptNumber: receiptNumber }, 'Savings deposit recorded.');
  } catch (e) {
    logError('Savings', 'depositSavings', e);
    return errorResponse('Failed to record savings deposit.', 500);
  }
}

/**
 * Processes a withdrawal request.
 * @param {Object} params - { token, memberId, amount, reason, paymentMethod }
 */
function withdrawSavings(params) {
  try {
    var auth = authorise_(params.token, 'manage_savings');
    if (auth.error) return auth.error;

    var required = ['memberId', 'amount', 'reason'];
    var v = validateRequired(params, required);
    if (!v.valid) return errorResponse(v.errors.join(', '), 400);

    var amount = parseFloat(params.amount);
    if (isNaN(amount) || amount <= 0) return errorResponse('Invalid withdrawal amount.', 400);

    var savings = firestoreGet_('savings', 'SAV-' + params.memberId);
    if (!savings) return errorResponse('Savings record not found.', 404);

    var minBalance = parseFloat(getSetting('minimumSavingsBalance') || 5000);
    if ((savings.currentBalance - amount) < minBalance) {
      return errorResponse(
        'Withdrawal would reduce balance below the minimum of ' + formatCurrency(minBalance) +
        '. Available for withdrawal: ' + formatCurrency(savings.currentBalance - minBalance), 400);
    }

    // Check no outstanding loans prevent withdrawal
    var activeLoans = firestoreQuery_('loans', [
      { field: 'memberId', op: '==', value: params.memberId },
      { field: 'status',   op: '==', value: 'Disbursed' }
    ]);
    if (activeLoans.length > 0) {
      var loanBalance = activeLoans.reduce(function(s, l) { return s + (l.outstandingBalance || 0); }, 0);
      if ((savings.currentBalance - amount) < loanBalance) {
        return errorResponse('Savings balance after withdrawal must cover outstanding loan balance of ' +
          formatCurrency(loanBalance) + '.', 400);
      }
    }

    var withdrawalId = generateId('WDR', 'withdrawals');
    var receiptNumber = generateReceiptNumber();
    var member = firestoreGet_('members', params.memberId);

    var withdrawalData = {
      withdrawalId:  withdrawalId,
      memberId:      params.memberId,
      memberName:    member ? member.fullName : '',
      amount:        amount,
      reason:        sanitise(params.reason),
      paymentMethod: params.paymentMethod || 'Cash',
      receiptNumber: receiptNumber,
      status:        'Processed',
      processedBy:   auth.session.userId,
      processedAt:   new Date().toISOString(),
      createdAt:     new Date().toISOString()
    };

    firestoreCreate_('withdrawals', withdrawalData, withdrawalId);
    updateSavingsBalance_(params.memberId, amount, 'debit');

    recordTransaction_({
      memberId:    params.memberId,
      memberName:  member ? member.fullName : '',
      type:        'Debit',
      category:    'Withdrawal',
      amount:      amount,
      reference:   withdrawalId,
      description: 'Savings Withdrawal — ' + params.reason,
      date:        new Date().toISOString(),
      recordedBy:  auth.session.userId
    });

    logAction_('WITHDRAWAL', 'Savings', auth.session.userId, withdrawalId, null, withdrawalData);
    return successResponse({
      withdrawalId:  withdrawalId,
      receiptNumber: receiptNumber,
      newBalance:    savings.currentBalance - amount
    }, 'Withdrawal processed successfully.');
  } catch (e) {
    logError('Savings', 'withdrawSavings', e);
    return errorResponse('Failed to process withdrawal.', 500);
  }
}

/**
 * Calculates and applies quarterly savings interest to all active members.
 * Should be triggered by a time-driven trigger (quarterly).
 * @param {Object} params - { token }
 */
function applyQuarterlySavingsInterest(params) {
  try {
    var auth = authorise_(params.token, 'manage_savings');
    if (auth.error) return auth.error;
    if (!hasPermission_(auth.session.role, 'manage_settings')) {
      return errorResponse('Only administrators can apply interest.', 403);
    }

    var annualRate = parseFloat(getSetting('savingsInterestRate') || 3);
    var quarterlyRate = annualRate / 4; // Approximate quarterly rate
    var allSavings = firestoreGetAll_('savings');
    var applied = 0;

    allSavings.forEach(function(sav) {
      if (!sav.memberId || (sav.currentBalance || 0) <= 0) return;
      var member = firestoreGet_('members', sav.memberId);
      if (!member || member.status !== 'Active') return;

      var interest = (sav.currentBalance * (quarterlyRate / 100));
      interest = Math.round(interest * 100) / 100;

      firestoreUpdate_('savings', sav._id, {
        interestAccrued:  (sav.interestAccrued || 0) + interest,
        currentBalance:   (sav.currentBalance || 0) + interest,
        lastInterestDate: new Date().toISOString(),
        updatedAt:        new Date().toISOString()
      });

      recordTransaction_({
        memberId:    sav.memberId,
        memberName:  member.fullName,
        type:        'Credit',
        category:    'Interest',
        amount:      interest,
        reference:   'SAV-' + sav.memberId,
        description: 'Quarterly Savings Interest (' + quarterlyRate.toFixed(2) + '% on ' + formatCurrency(sav.currentBalance) + ')',
        date:        new Date().toISOString(),
        recordedBy:  auth.session.userId
      });

      applied++;
    });

    logAction_('APPLY_SAVINGS_INTEREST', 'Savings', auth.session.userId, 'BULK',
               null, { rate: quarterlyRate, membersProcessed: applied });
    return successResponse({ membersProcessed: applied },
      'Quarterly interest applied to ' + applied + ' savings accounts.');
  } catch (e) {
    logError('Savings', 'applyQuarterlySavingsInterest', e);
    return errorResponse('Failed to apply savings interest.', 500);
  }
}

/**
 * Returns savings summary stats for admin dashboard.
 * @param {Object} params - { token }
 */
function getSavingsStats(params) {
  try {
    var auth = authorise_(params.token, 'view_savings');
    if (auth.error) return auth.error;

    var allSavings = firestoreGetAll_('savings');
    var totalSavings   = allSavings.reduce(function(s, x) { return s + (x.currentBalance || 0); }, 0);
    var totalInterest  = allSavings.reduce(function(s, x) { return s + (x.interestAccrued || 0); }, 0);
    var withBalance    = allSavings.filter(function(x) { return (x.currentBalance || 0) > 0; }).length;

    return successResponse({
      totalSavings:   totalSavings,
      totalInterest:  totalInterest,
      accountsWithBalance: withBalance,
      totalAccounts:  allSavings.length
    });
  } catch (e) {
    logError('Savings', 'getSavingsStats', e);
    return errorResponse('Failed to retrieve savings stats.', 500);
  }
}

/**
 * Returns all withdrawals (paginated).
 * @param {Object} params - { token, memberId?, page?, pageSize? }
 */
function getWithdrawals(params) {
  try {
    var auth = authorise_(params.token, 'view_savings');
    if (auth.error) return auth.error;

    var withdrawals = firestoreGetAll_('withdrawals');
    if (params.memberId) {
      withdrawals = withdrawals.filter(function(w) { return w.memberId === params.memberId; });
    }
    withdrawals.sort(function(a, b) { return new Date(b.processedAt) - new Date(a.processedAt); });
    return successResponse(paginate(withdrawals, params.page, params.pageSize || 20));
  } catch (e) {
    logError('Savings', 'getWithdrawals', e);
    return errorResponse('Failed to retrieve withdrawals.', 500);
  }
}

// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

/**
 * Credits or debits a member's savings balance.
 * Called from Contributions, Repayments, Withdrawals modules.
 * @param {string} memberId
 * @param {number} amount
 * @param {string} direction - 'credit' or 'debit'
 */
function updateSavingsBalance_(memberId, amount, direction) {
  try {
    var savId = 'SAV-' + memberId;
    var savings = firestoreGet_('savings', savId);
    var current = savings ? (savings.currentBalance || 0) : 0;
    var newBalance = direction === 'credit' ? current + amount : Math.max(0, current - amount);

    if (savings) {
      firestoreUpdate_('savings', savId, {
        currentBalance: newBalance,
        updatedAt:      new Date().toISOString()
      });
    } else {
      // Create savings record if it doesn't exist
      var member = firestoreGet_('members', memberId);
      firestoreCreate_('savings', {
        savingsId:        savId,
        memberId:         memberId,
        memberName:       member ? member.fullName : '',
        type:             'Regular',
        openingBalance:   0,
        currentBalance:   direction === 'credit' ? amount : 0,
        interestAccrued:  0,
        lastInterestDate: new Date().toISOString(),
        createdAt:        new Date().toISOString(),
        updatedAt:        new Date().toISOString()
      }, savId);
      newBalance = direction === 'credit' ? amount : 0;
    }

    // Sync to member record
    firestoreUpdate_('members', memberId, {
      totalSavings: newBalance,
      currentBalance: newBalance,
      updatedAt: new Date().toISOString()
    });

    return newBalance;
  } catch (e) {
    logError('Savings', 'updateSavingsBalance_', e);
    return 0;
  }
}
