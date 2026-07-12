/**
 * ============================================================
 *  COOPERATIVE SOCIETY MANAGEMENT PORTAL
 *  Repayments.gs  -  Loan Repayment Tracking & Penalties
 * ============================================================
 */

/**
 * Records a loan repayment.
 * @param {Object} params - { token, loanNumber, amount, paymentDate, paymentMethod, notes? }
 */
function recordRepayment(params) {
  try {
    var auth = authorise_(params.token, 'manage_repayments');
    if (auth.error) return auth.error;

    var required = ['loanNumber', 'amount', 'paymentDate', 'paymentMethod'];
    var v = validateRequired(params, required);
    if (!v.valid) return errorResponse(v.errors.join(', '), 400);

    var loan = firestoreGet_('loans', params.loanNumber);
    if (!loan) return errorResponse('Loan not found.', 404);
    if (loan.status !== 'Disbursed' && loan.status !== 'Defaulted') {
      return errorResponse('Repayments can only be recorded for disbursed or defaulted loans.', 400);
    }

    var amount = parseFloat(params.amount);
    if (isNaN(amount) || amount <= 0) return errorResponse('Invalid repayment amount.', 400);
    if (amount > (loan.outstandingBalance || 0) + 0.01) {
      return errorResponse('Repayment amount (' + formatCurrency(amount) +
        ') exceeds outstanding balance (' + formatCurrency(loan.outstandingBalance) + ').', 400);
    }

    // Calculate penalty if applicable
    var penalty = 0;
    if (loan.nextDueDate) {
      var dueDate = new Date(loan.nextDueDate);
      var paidDate = new Date(params.paymentDate);
      var gracePeriod = parseInt(getSetting('gracePeriodDays') || 7, 10);
      dueDate.setDate(dueDate.getDate() + gracePeriod);
      if (paidDate > dueDate) {
        var daysOverdue = Math.ceil((paidDate - dueDate) / (1000 * 60 * 60 * 24));
        var penaltyRate = parseFloat(getSetting('loanPenaltyRate') || 2);
        // Find the instalment amount to calculate penalty on
        var schedule = loan.repaymentSchedule || [];
        var pendingInstalment = schedule.find(function(s) { return s.status === 'Pending'; });
        if (pendingInstalment) {
          penalty = calcPenalty(pendingInstalment.installmentAmount, penaltyRate, daysOverdue);
          penalty = Math.round(penalty * 100) / 100;
        }
      }
    }

    // Determine which instalments this payment covers
    var schedule = loan.repaymentSchedule || [];
    var amountLeft = amount;
    var installmentNumber = 0;
    var updatedSchedule = schedule.map(function(inst) {
      if (inst.status === 'Paid' || amountLeft <= 0) return inst;
      if (amountLeft >= inst.installmentAmount) {
        amountLeft -= inst.installmentAmount;
        installmentNumber = inst.installmentNumber;
        return Object.assign({}, inst, {
          status:    'Paid',
          paidAmount: inst.installmentAmount,
          paidDate:  params.paymentDate
        });
      } else {
        // Partial payment
        var partial = amountLeft;
        amountLeft = 0;
        return Object.assign({}, inst, {
          status:    'Partial',
          paidAmount: partial,
          paidDate:  params.paymentDate
        });
      }
    });

    var newOutstanding = Math.max(0, (loan.outstandingBalance || 0) - amount);
    var newTotalRepaid = (loan.totalRepaid || 0) + amount;

    // Find next due date from the updated schedule
    var nextDue = null;
    for (var i = 0; i < updatedSchedule.length; i++) {
      if (updatedSchedule[i].status === 'Pending' || updatedSchedule[i].status === 'Partial') {
        nextDue = updatedSchedule[i].dueDate;
        break;
      }
    }

    var isLoanComplete = newOutstanding <= 0.01;
    var repaymentId   = generateId('RPY', 'loanRepayments');
    var receiptNumber = generateReceiptNumber();
    var now           = new Date().toISOString();

    var member = firestoreGet_('members', loan.memberId);

    var repaymentData = {
      repaymentId:         repaymentId,
      loanNumber:          params.loanNumber,
      memberId:            loan.memberId,
      memberName:          loan.memberName,
      installmentNumber:   installmentNumber,
      amountDue:           installmentNumber > 0 && schedule[installmentNumber - 1]
                             ? schedule[installmentNumber - 1].installmentAmount : amount,
      amountPaid:          amount,
      penalty:             penalty,
      paymentDate:         params.paymentDate,
      paymentMethod:       params.paymentMethod,
      receiptNumber:       receiptNumber,
      notes:               sanitise(params.notes || ''),
      recordedBy:          auth.session.userId,
      createdAt:           now
    };

    firestoreCreate_('loanRepayments', repaymentData, repaymentId);

    // Update loan record
    var loanUpdates = {
      totalRepaid:        newTotalRepaid,
      outstandingBalance: newOutstanding,
      repaymentSchedule:  updatedSchedule,
      nextDueDate:        nextDue,
      updatedAt:          now
    };
    if (isLoanComplete) {
      loanUpdates.status        = 'Completed';
      loanUpdates.completedDate = now;
    } else if (loan.status === 'Defaulted') {
      loanUpdates.status = 'Disbursed'; // Restore from defaulted
    }

    firestoreUpdate_('loans', params.loanNumber, loanUpdates);

    // Record transaction
    recordTransaction_({
      memberId:    loan.memberId,
      memberName:  loan.memberName,
      type:        'Credit',
      category:    'Repayment',
      amount:      amount,
      reference:   repaymentId,
      description: 'Loan Repayment — ' + params.loanNumber +
                   (penalty > 0 ? ' (incl. penalty ' + formatCurrency(penalty) + ')' : ''),
      date:        params.paymentDate,
      recordedBy:  auth.session.userId
    });

    if (isLoanComplete) {
      createSystemNotification_(loan.memberId,
        'Loan Fully Repaid — ' + params.loanNumber,
        'Congratulations! Your loan of ' + formatCurrency(loan.approvedAmount) +
        ' has been fully repaid. Thank you!', 'LoanAlert');
    }

    logAction_('RECORD_REPAYMENT', 'Repayments', auth.session.userId, repaymentId, null, repaymentData);

    return successResponse({
      repaymentId:        repaymentId,
      receiptNumber:      receiptNumber,
      newOutstanding:     newOutstanding,
      penalty:            penalty,
      isLoanComplete:     isLoanComplete,
      receipt:            generateRepaymentReceipt_(repaymentData, loan, member)
    }, isLoanComplete ? 'Loan fully repaid!' : 'Repayment recorded successfully.');
  } catch (e) {
    logError('Repayments', 'recordRepayment', e);
    return errorResponse('Failed to record repayment.', 500);
  }
}

/**
 * Returns repayment history for a loan or member.
 * @param {Object} params - { token, loanNumber?, memberId?, page?, pageSize? }
 */
function getRepayments(params) {
  try {
    var auth = authorise_(params.token, 'view_repayments');
    if (auth.error) {
      var selfAuth = authorise_(params.token, 'view_own_repayments');
      if (selfAuth.error) return selfAuth.error;
      params.memberId = selfAuth.session.memberId;
      auth = selfAuth;
    }

    var filters = [];
    if (params.loanNumber) filters.push({ field: 'loanNumber', op: '==', value: params.loanNumber });
    if (params.memberId)   filters.push({ field: 'memberId',   op: '==', value: params.memberId });

    var repayments = filters.length > 0
      ? firestoreQuery_('loanRepayments', filters)
      : firestoreGetAll_('loanRepayments');

    repayments.sort(function(a, b) { return new Date(b.paymentDate) - new Date(a.paymentDate); });
    return successResponse(paginate(repayments, params.page, params.pageSize || 20));
  } catch (e) {
    logError('Repayments', 'getRepayments', e);
    return errorResponse('Failed to retrieve repayments.', 500);
  }
}

/**
 * Returns repayment schedule with status for a specific loan.
 * @param {Object} params - { token, loanNumber }
 */
function getRepaymentSchedule(params) {
  try {
    var auth = authorise_(params.token, 'view_repayments');
    if (auth.error) {
      var selfAuth = authorise_(params.token, 'view_own_repayments');
      if (selfAuth.error) return selfAuth.error;
      auth = selfAuth;
    }

    var loan = firestoreGet_('loans', params.loanNumber);
    if (!loan) return errorResponse('Loan not found.', 404);

    if (auth.session.role === 'member' && loan.memberId !== auth.session.memberId) {
      return errorResponse('Access denied.', 403);
    }

    return successResponse({
      loanNumber:       loan.loanNumber,
      memberName:       loan.memberName,
      approvedAmount:   loan.approvedAmount,
      totalRepayable:   loan.totalRepayable,
      totalRepaid:      loan.totalRepaid,
      outstandingBalance: loan.outstandingBalance,
      nextDueDate:      loan.nextDueDate,
      status:           loan.status,
      schedule:         loan.repaymentSchedule || []
    });
  } catch (e) {
    logError('Repayments', 'getRepaymentSchedule', e);
    return errorResponse('Failed to retrieve repayment schedule.', 500);
  }
}

/**
 * Returns repayment statistics.
 * @param {Object} params - { token }
 */
function getRepaymentStats(params) {
  try {
    var auth = authorise_(params.token, 'view_repayments');
    if (auth.error) return auth.error;

    var repayments = firestoreGetAll_('loanRepayments');
    var total = repayments.reduce(function(s, r) { return s + (r.amountPaid || 0); }, 0);
    var penalties = repayments.reduce(function(s, r) { return s + (r.penalty || 0); }, 0);
    var thisMonth = repayments.filter(function(r) {
      return r.paymentDate && r.paymentDate.startsWith(getCurrentMonth());
    }).reduce(function(s, r) { return s + (r.amountPaid || 0); }, 0);

    return successResponse({
      totalCollected: total,
      totalPenalties: penalties,
      thisMonth:      thisMonth,
      totalCount:     repayments.length
    });
  } catch (e) {
    logError('Repayments', 'getRepaymentStats', e);
    return errorResponse('Failed to retrieve repayment stats.', 500);
  }
}

/**
 * Generates and sends due loan payment alerts.
 * Meant to be called by a daily time-driven trigger.
 * @param {Object} params - { token }
 */
function sendDueLoanAlerts(params) {
  try {
    var auth = authorise_(params.token, 'manage_notifications');
    if (auth.error) return auth.error;

    var alertDays = parseInt(getSetting('dueLoanAlertDaysBefore') || 7, 10);
    var today = new Date();
    var alertDate = new Date();
    alertDate.setDate(alertDate.getDate() + alertDays);

    var activeLoans = firestoreQuery_('loans', [
      { field: 'status', op: '==', value: 'Disbursed' }
    ]);

    var alerted = 0;
    activeLoans.forEach(function(loan) {
      if (!loan.nextDueDate) return;
      var dueDate = new Date(loan.nextDueDate);
      var diffDays = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));

      if (diffDays >= 0 && diffDays <= alertDays) {
        // Find pending instalment
        var schedule = loan.repaymentSchedule || [];
        var nextInst = schedule.find(function(s) { return s.status === 'Pending'; });
        var dueAmount = nextInst ? nextInst.installmentAmount : loan.outstandingBalance;

        createSystemNotification_(loan.memberId,
          'Loan Repayment Due Soon',
          'Your loan repayment of ' + formatCurrency(dueAmount) +
          ' for loan ' + loan.loanNumber + ' is due on ' +
          formatDate(dueDate) + ' (' + diffDays + ' day(s) remaining).',
          'LoanAlert');

        // Also email
        var member = firestoreGet_('members', loan.memberId);
        if (member && member.email) {
          var societyName = getSetting('societyName') || 'Cooperative Society';
          sendEmail(member.email,
            societyName + ' — Loan Repayment Reminder',
            'Dear ' + member.fullName + ',\n\nYour loan repayment of ' +
            formatCurrency(dueAmount) + ' for loan ' + loan.loanNumber +
            ' is due on ' + formatDate(dueDate) + '.\n\nPlease ensure payment is made on time.\n\nRegards,\n' +
            societyName);
        }

        alerted++;
      }
    });

    return successResponse({ alertsSent: alerted }, alerted + ' loan alert(s) sent.');
  } catch (e) {
    logError('Repayments', 'sendDueLoanAlerts', e);
    return errorResponse('Failed to send loan alerts.', 500);
  }
}

// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

/**
 * Generates a printable loan repayment receipt HTML.
 * @param {Object} repayment
 * @param {Object} loan
 * @param {Object} member
 * @returns {string}
 */
function generateRepaymentReceipt_(repayment, loan, member) {
  var societyName = getSetting('societyName') || 'Cooperative Society';
  var footer      = getSetting('receiptFooterText') || '';

  return '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<title>Loan Repayment Receipt</title>' +
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
    '.outstanding{background:#fff8e1;padding:8px;border-radius:4px;text-align:center;font-size:13px;color:#e65100}' +
    '.footer{text-align:center;margin-top:15px;font-size:11px;color:#888;border-top:1px solid #ddd;padding-top:10px}' +
    '@media print{body{margin:0;padding:10px}}' +
    '</style></head><body>' +
    '<div class="header">' +
    '<h2>' + societyName + '</h2>' +
    '<h3>LOAN REPAYMENT RECEIPT</h3>' +
    '</div>' +
    '<div class="receipt-no">Receipt No: ' + repayment.receiptNumber + '</div>' +
    '<table>' +
    '<tr><td>Loan Number</td><td>' + repayment.loanNumber + '</td></tr>' +
    '<tr><td>Member</td><td>' + repayment.memberName + '</td></tr>' +
    '<tr><td>Member No</td><td>' + repayment.memberId + '</td></tr>' +
    '<tr><td>Payment Method</td><td>' + repayment.paymentMethod + '</td></tr>' +
    '<tr><td>Payment Date</td><td>' + formatDate(repayment.paymentDate) + '</td></tr>' +
    (repayment.penalty > 0 ? '<tr><td>Penalty</td><td>' + formatCurrency(repayment.penalty) + '</td></tr>' : '') +
    '<tr class="total-row"><td>Amount Paid</td><td>' + formatCurrency(repayment.amountPaid) + '</td></tr>' +
    '</table>' +
    '<div class="outstanding">Outstanding Balance: ' + formatCurrency(loan.outstandingBalance) + '</div>' +
    '<div class="footer">' + footer + '<br>Generated: ' + formatDateTime(new Date()) + '</div>' +
    '</body></html>';
}
