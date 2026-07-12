/**
 * ============================================================
 *  COOPERATIVE SOCIETY MANAGEMENT PORTAL
 *  Loans.gs  -  Loan Products, Applications & Approval Workflow
 * ============================================================
 */

/**
 * Returns paginated loan list.
 * @param {Object} params - { token, memberId?, status?, dateFrom?, dateTo?, page?, pageSize?, search? }
 */
function getLoans(params) {
  try {
    var auth = authorise_(params.token, 'view_loans');
    if (auth.error) {
      var selfAuth = authorise_(params.token, 'view_own_loans');
      if (selfAuth.error) return selfAuth.error;
      params.memberId = selfAuth.session.memberId;
      auth = selfAuth;
    }

    var filters = [];
    if (params.memberId) filters.push({ field: 'memberId', op: '==', value: params.memberId });
    if (params.status)   filters.push({ field: 'status',   op: '==', value: params.status });

    var loans = filters.length > 0
      ? firestoreQuery_('loans', filters)
      : firestoreGetAll_('loans');

    if (params.dateFrom) {
      var from = new Date(params.dateFrom);
      loans = loans.filter(function(l) { return l.createdAt && new Date(l.createdAt) >= from; });
    }
    if (params.dateTo) {
      var to = new Date(params.dateTo);
      to.setHours(23, 59, 59);
      loans = loans.filter(function(l) { return l.createdAt && new Date(l.createdAt) <= to; });
    }
    if (params.search) {
      loans = searchFilter(loans, params.search,
        ['memberName', 'memberId', 'loanNumber', 'productType', 'purpose']);
    }

    loans.sort(function(a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
    return successResponse(paginate(loans, params.page, params.pageSize || 20));
  } catch (e) {
    logError('Loans', 'getLoans', e);
    return errorResponse('Failed to retrieve loans.', 500);
  }
}

/**
 * Returns a single loan with full details and repayment schedule.
 * @param {Object} params - { token, loanNumber }
 */
function getLoan(params) {
  try {
    var auth = authorise_(params.token, 'view_loans');
    if (auth.error) {
      var selfAuth = authorise_(params.token, 'view_own_loans');
      if (selfAuth.error) return selfAuth.error;
      auth = selfAuth;
    }

    var loan = firestoreGet_('loans', params.loanNumber);
    if (!loan) return errorResponse('Loan not found.', 404);

    // Self-service access check
    if (auth.session.role === 'member' && loan.memberId !== auth.session.memberId) {
      return errorResponse('Access denied.', 403);
    }

    // Attach repayment schedule
    var schedule = loan.repaymentSchedule || [];
    var repayments = firestoreQuery_('loanRepayments', [
      { field: 'loanNumber', op: '==', value: params.loanNumber }
    ]);

    return successResponse({ loan: loan, schedule: schedule, repayments: repayments });
  } catch (e) {
    logError('Loans', 'getLoan', e);
    return errorResponse('Failed to retrieve loan.', 500);
  }
}

/**
 * Submits a new loan application.
 * @param {Object} params - { token, memberId, productType, requestedAmount, duration,
 *                            purpose, guarantors, repaymentFrequency? }
 */
function applyForLoan(params) {
  try {
    var auth = authorise_(params.token, 'manage_loans');
    if (auth.error) {
      // Members can also apply for their own loans
      var selfAuth = authorise_(params.token, 'apply_loan');
      if (selfAuth.error) return selfAuth.error;
      params.memberId = selfAuth.session.memberId;
      auth = selfAuth;
    }

    var required = ['memberId', 'productType', 'requestedAmount', 'duration', 'purpose'];
    var v = validateRequired(params, required);
    if (!v.valid) return errorResponse(v.errors.join(', '), 400);

    var member = firestoreGet_('members', params.memberId);
    if (!member) return errorResponse('Member not found.', 404);
    if (member.status !== 'Active') return errorResponse('Only active members can apply for loans.', 400);

    var eligibility = checkLoanEligibility_(params.memberId, parseFloat(params.requestedAmount));
    if (!eligibility.eligible) return errorResponse(eligibility.reason, 400);

    // Check no existing pending/approved loan
    var existingLoans = firestoreQuery_('loans', [
      { field: 'memberId', op: '==', value: params.memberId },
      { field: 'status',   op: 'in', value: ['Pending', 'Recommended', 'Approved', 'Disbursed'] }
    ]);
    if (existingLoans.length > 0) {
      return errorResponse('Member already has an active or pending loan application.', 409);
    }

    // Get loan product details
    var product = getProductDetails_(params.productType);
    var interestRate = product ? product.interestRate : parseFloat(getSetting('defaultLoanInterestRate') || 5);
    var requestedAmount = parseFloat(params.requestedAmount);
    var duration = parseInt(params.duration, 10);

    var loanNumber = generateId('LN', 'loans');
    var now = new Date().toISOString();

    var loanData = {
      loanNumber:          loanNumber,
      memberId:            params.memberId,
      memberName:          member.fullName,
      productType:         params.productType,
      productId:           params.productType.toLowerCase(),
      requestedAmount:     requestedAmount,
      approvedAmount:      0,
      interestRate:        interestRate,
      duration:            duration,
      repaymentFrequency:  params.repaymentFrequency || 'Monthly',
      purpose:             sanitise(params.purpose),
      guarantors:          params.guarantors || [],
      status:              'Pending',
      approvalChain:       [],
      repaymentSchedule:   [],
      processingFee:       Math.ceil(requestedAmount * ((parseFloat(getSetting('loanProcessingFeeRate') || 1)) / 100)),
      totalRepayable:      0,
      totalRepaid:         0,
      outstandingBalance:  0,
      nextDueDate:         null,
      disbursedDate:       null,
      completedDate:       null,
      createdBy:           auth.session.userId,
      createdAt:           now,
      updatedAt:           now
    };

    firestoreCreate_('loans', loanData, loanNumber);

    // Record guarantors
    if (params.guarantors && params.guarantors.length > 0) {
      params.guarantors.forEach(function(g) {
        var gId = generateId('GTR', 'guarantors');
        firestoreCreate_('guarantors', {
          guarantorId:      gId,
          loanNumber:       loanNumber,
          guarantorMemberId: g.memberId,
          guarantorName:    g.name || '',
          agreedAmount:     parseFloat(g.amount || requestedAmount),
          status:           'Pending',
          createdAt:        now
        }, gId);
      });
    }

    // Notify loan officers
    notifyByRole_('loan_officer',
      'New Loan Application — ' + loanNumber,
      member.fullName + ' has applied for a ' + params.productType + ' loan of ' +
      formatCurrency(requestedAmount) + '. Application: ' + loanNumber);

    logAction_('APPLY_LOAN', 'Loans', auth.session.userId, loanNumber, null, loanData);
    return successResponse({ loanNumber: loanNumber }, 'Loan application submitted successfully.');
  } catch (e) {
    logError('Loans', 'applyForLoan', e);
    return errorResponse('Failed to submit loan application.', 500);
  }
}

/**
 * Loan Officer recommends a loan (first approval level).
 * @param {Object} params - { token, loanNumber, approvedAmount, note }
 */
function recommendLoan(params) {
  try {
    var auth = authorise_(params.token, 'recommend_loans');
    if (auth.error) return auth.error;

    var loan = firestoreGet_('loans', params.loanNumber);
    if (!loan) return errorResponse('Loan not found.', 404);
    if (loan.status !== 'Pending') {
      return errorResponse('Only pending loans can be recommended. Current status: ' + loan.status, 400);
    }

    var chain = loan.approvalChain || [];
    chain.push({
      role:     auth.session.role,
      userId:   auth.session.userId,
      action:   'Recommended',
      note:     sanitise(params.note || ''),
      date:     new Date().toISOString()
    });

    firestoreUpdate_('loans', params.loanNumber, {
      status:        'Recommended',
      approvalChain: chain,
      updatedAt:     new Date().toISOString()
    });

    // Notify admins
    notifyByRole_('admin',
      'Loan Recommended — ' + params.loanNumber,
      'Loan ' + params.loanNumber + ' for ' + loan.memberName + ' has been recommended by ' +
      auth.session.fullName + ' and is awaiting your approval.');

    logAction_('RECOMMEND_LOAN', 'Loans', auth.session.userId, params.loanNumber,
               { status: 'Pending' }, { status: 'Recommended' });
    return successResponse(null, 'Loan recommended for approval.');
  } catch (e) {
    logError('Loans', 'recommendLoan', e);
    return errorResponse('Failed to recommend loan.', 500);
  }
}

/**
 * Administrator approves a loan.
 * @param {Object} params - { token, loanNumber, approvedAmount, note }
 */
function approveLoan(params) {
  try {
    var auth = authorise_(params.token, 'approve_loans');
    if (auth.error) return auth.error;

    var loan = firestoreGet_('loans', params.loanNumber);
    if (!loan) return errorResponse('Loan not found.', 404);

    var allowedStatuses = ['Pending', 'Recommended'];
    if (allowedStatuses.indexOf(loan.status) === -1) {
      return errorResponse('Loan cannot be approved at this stage. Status: ' + loan.status, 400);
    }

    var approvedAmount = parseFloat(params.approvedAmount || loan.requestedAmount);
    if (isNaN(approvedAmount) || approvedAmount <= 0) {
      return errorResponse('Invalid approved amount.', 400);
    }

    var interestMethod = getSetting('loanInterestMethod') || 'flat';
    var totalRepayable = approvedAmount + calcFlatInterest(approvedAmount, loan.interestRate, loan.duration);
    if (interestMethod === 'reducing') {
      // Approximate for reducing balance
      totalRepayable = approvedAmount * (1 + ((loan.interestRate / 100) * loan.duration * 0.6));
    }
    totalRepayable = Math.round(totalRepayable * 100) / 100;

    var chain = loan.approvalChain || [];
    chain.push({
      role:     auth.session.role,
      userId:   auth.session.userId,
      action:   'Approved',
      note:     sanitise(params.note || ''),
      date:     new Date().toISOString()
    });

    firestoreUpdate_('loans', params.loanNumber, {
      status:             'Approved',
      approvedAmount:     approvedAmount,
      totalRepayable:     totalRepayable,
      outstandingBalance: totalRepayable,
      approvalChain:      chain,
      updatedAt:          new Date().toISOString()
    });

    // Notify member
    createSystemNotification_(loan.memberId,
      'Loan Approved — ' + params.loanNumber,
      'Your loan application of ' + formatCurrency(approvedAmount) + ' has been approved. ' +
      'Disbursement will be processed shortly.', 'LoanAlert');

    logAction_('APPROVE_LOAN', 'Loans', auth.session.userId, params.loanNumber,
               { status: loan.status, approvedAmount: 0 },
               { status: 'Approved', approvedAmount: approvedAmount });
    return successResponse(null, 'Loan approved successfully.');
  } catch (e) {
    logError('Loans', 'approveLoan', e);
    return errorResponse('Failed to approve loan.', 500);
  }
}

/**
 * Rejects a loan application.
 * @param {Object} params - { token, loanNumber, reason }
 */
function rejectLoan(params) {
  try {
    var auth = authorise_(params.token, 'approve_loans');
    if (auth.error) return auth.error;
    if (!params.reason) return errorResponse('Rejection reason is required.', 400);

    var loan = firestoreGet_('loans', params.loanNumber);
    if (!loan) return errorResponse('Loan not found.', 404);

    if (['Disbursed', 'Completed'].indexOf(loan.status) !== -1) {
      return errorResponse('Cannot reject a ' + loan.status + ' loan.', 400);
    }

    var chain = loan.approvalChain || [];
    chain.push({
      role:     auth.session.role,
      userId:   auth.session.userId,
      action:   'Rejected',
      note:     sanitise(params.reason),
      date:     new Date().toISOString()
    });

    firestoreUpdate_('loans', params.loanNumber, {
      status:        'Rejected',
      rejectionReason: sanitise(params.reason),
      approvalChain:  chain,
      updatedAt:      new Date().toISOString()
    });

    createSystemNotification_(loan.memberId,
      'Loan Application Rejected — ' + params.loanNumber,
      'Your loan application has been rejected. Reason: ' + params.reason +
      '. Please contact the office for more information.', 'LoanAlert');

    logAction_('REJECT_LOAN', 'Loans', auth.session.userId, params.loanNumber,
               { status: loan.status }, { status: 'Rejected', reason: params.reason });
    return successResponse(null, 'Loan rejected.');
  } catch (e) {
    logError('Loans', 'rejectLoan', e);
    return errorResponse('Failed to reject loan.', 500);
  }
}

/**
 * Disburses an approved loan.
 * @param {Object} params - { token, loanNumber, disbursedDate, paymentMethod, note? }
 */
function disburseLoan(params) {
  try {
    var auth = authorise_(params.token, 'approve_loans');
    if (auth.error) return auth.error;

    var loan = firestoreGet_('loans', params.loanNumber);
    if (!loan) return errorResponse('Loan not found.', 404);
    if (loan.status !== 'Approved') {
      return errorResponse('Only approved loans can be disbursed. Status: ' + loan.status, 400);
    }

    var disbursedDate = params.disbursedDate || new Date().toISOString();
    var firstRepayDate = addMonths(new Date(disbursedDate), 1);

    // Generate repayment schedule
    var interestMethod = getSetting('loanInterestMethod') || 'flat';
    var schedule = generateRepaymentSchedule(
      loan.approvedAmount, loan.interestRate, loan.duration,
      firstRepayDate, interestMethod
    );

    var chain = loan.approvalChain || [];
    chain.push({
      role:    auth.session.role,
      userId:  auth.session.userId,
      action:  'Disbursed',
      note:    sanitise(params.note || ''),
      date:    new Date().toISOString()
    });

    firestoreUpdate_('loans', params.loanNumber, {
      status:             'Disbursed',
      disbursedDate:      disbursedDate,
      disbursementMethod: params.paymentMethod || 'Bank Transfer',
      repaymentSchedule:  schedule,
      nextDueDate:        schedule.length > 0 ? schedule[0].dueDate : null,
      outstandingBalance: loan.totalRepayable,
      approvalChain:      chain,
      updatedAt:          new Date().toISOString()
    });

    // Record disbursement as a debit transaction for the cooperative
    recordTransaction_({
      memberId:    loan.memberId,
      memberName:  loan.memberName,
      type:        'Debit',
      category:    'LoanDisbursement',
      amount:      loan.approvedAmount,
      reference:   params.loanNumber,
      description: loan.productType + ' Loan Disbursement — ' + params.loanNumber,
      date:        disbursedDate,
      recordedBy:  auth.session.userId
    });

    createSystemNotification_(loan.memberId,
      'Loan Disbursed — ' + params.loanNumber,
      formatCurrency(loan.approvedAmount) + ' has been disbursed to you for your ' +
      loan.productType + ' loan. First repayment due: ' +
      formatDate(firstRepayDate), 'LoanAlert');

    logAction_('DISBURSE_LOAN', 'Loans', auth.session.userId, params.loanNumber,
               { status: 'Approved' }, { status: 'Disbursed', disbursedDate: disbursedDate });
    return successResponse({ repaymentSchedule: schedule }, 'Loan disbursed successfully.');
  } catch (e) {
    logError('Loans', 'disburseLoan', e);
    return errorResponse('Failed to disburse loan.', 500);
  }
}

/**
 * Returns loan summary statistics.
 * @param {Object} params - { token }
 */
function getLoanStats(params) {
  try {
    var auth = authorise_(params.token, 'view_loans');
    if (auth.error) return auth.error;

    var allLoans = firestoreGetAll_('loans');

    var totalDisbursed  = 0, totalRepaid = 0, totalOutstanding = 0;
    var byStatus = {}, byProduct = {};

    allLoans.forEach(function(l) {
      byStatus[l.status] = (byStatus[l.status] || 0) + 1;
      byProduct[l.productType] = (byProduct[l.productType] || 0) + (l.approvedAmount || 0);
      if (l.status === 'Disbursed' || l.status === 'Completed') {
        totalDisbursed  += l.approvedAmount || 0;
        totalRepaid     += l.totalRepaid || 0;
        totalOutstanding += l.outstandingBalance || 0;
      }
    });

    var defaulters = allLoans.filter(function(l) { return l.status === 'Defaulted'; }).length;

    return successResponse({
      totalLoans:      allLoans.length,
      totalDisbursed:  totalDisbursed,
      totalRepaid:     totalRepaid,
      totalOutstanding:totalOutstanding,
      defaulters:      defaulters,
      byStatus:        byStatus,
      byProduct:       byProduct
    });
  } catch (e) {
    logError('Loans', 'getLoanStats', e);
    return errorResponse('Failed to retrieve loan stats.', 500);
  }
}

/**
 * Returns a list of loan defaulters.
 * @param {Object} params - { token, page?, pageSize? }
 */
function getLoanDefaulters(params) {
  try {
    var auth = authorise_(params.token, 'view_loans');
    if (auth.error) return auth.error;

    var disbursed = firestoreQuery_('loans', [
      { field: 'status', op: '==', value: 'Disbursed' }
    ]);

    var today = new Date();
    var defaulters = disbursed.filter(function(loan) {
      if (!loan.nextDueDate) return false;
      var dueDate = new Date(loan.nextDueDate);
      var gracePeriod = parseInt(getSetting('gracePeriodDays') || 7, 10);
      dueDate.setDate(dueDate.getDate() + gracePeriod);
      return dueDate < today;
    });

    // Mark as defaulted
    defaulters.forEach(function(loan) {
      if (loan.status !== 'Defaulted') {
        firestoreUpdate_('loans', loan.loanNumber, {
          status: 'Defaulted',
          updatedAt: new Date().toISOString()
        });
      }
    });

    defaulters.sort(function(a, b) { return (b.outstandingBalance || 0) - (a.outstandingBalance || 0); });
    return successResponse(paginate(defaulters, params.page, params.pageSize || 20));
  } catch (e) {
    logError('Loans', 'getLoanDefaulters', e);
    return errorResponse('Failed to retrieve defaulters.', 500);
  }
}

// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

/**
 * Checks if a member is eligible for a loan.
 * @param {string} memberId
 * @param {number} amount
 * @returns {{ eligible: boolean, reason: string }}
 */
function checkLoanEligibility_(memberId, amount) {
  var minMonths = parseInt(getSetting('minContributionMonths') || 3, 10);
  var maxMultiplier = parseFloat(getSetting('maxLoanMultiplier') || 3);

  // Check contribution months
  var contribs = firestoreQuery_('contributions', [
    { field: 'memberId', op: '==', value: memberId },
    { field: 'type',     op: '==', value: 'Monthly' },
    { field: 'status',   op: '==', value: 'Active' }
  ]);

  if (contribs.length < minMonths) {
    return { eligible: false, reason: 'Member must have at least ' + minMonths +
      ' months of contributions. Current: ' + contribs.length };
  }

  // Check savings
  var savings = firestoreGet_('savings', 'SAV-' + memberId);
  var savingsBalance = savings ? (savings.currentBalance || 0) : 0;
  var maxLoan = savingsBalance * maxMultiplier;

  if (amount > maxLoan) {
    return { eligible: false, reason: 'Requested amount ' + formatCurrency(amount) +
      ' exceeds maximum eligible amount of ' + formatCurrency(maxLoan) +
      ' (' + maxMultiplier + '× savings balance of ' + formatCurrency(savingsBalance) + ')' };
  }

  return { eligible: true, reason: 'Eligible' };
}

/**
 * Gets loan product details by productType/Id.
 * @param {string} productType
 * @returns {Object|null}
 */
function getProductDetails_(productType) {
  try {
    var id = productType.toLowerCase();
    var product = firestoreGet_('loanProducts', id);
    if (!product) {
      var defaults = getDefaultLoanProducts_();
      return defaults.find(function(p) {
        return p.productId === id || p.name.toLowerCase() === productType.toLowerCase();
      }) || null;
    }
    return product;
  } catch (e) {
    return null;
  }
}
