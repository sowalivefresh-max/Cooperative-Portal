/**
 * ============================================================
 *  COOPERATIVE SOCIETY MANAGEMENT PORTAL
 *  Reports.gs  -  Report Generation & Export
 * ============================================================
 */

/**
 * Returns a comprehensive financial summary for the dashboard.
 * @param {Object} params - { token }
 */
function getFinancialSummary(params) {
  try {
    var auth = authorise_(params.token, 'view_reports');
    if (auth.error) return auth.error;

    var members  = firestoreGetAll_('members');
    var allSavings = firestoreGetAll_('savings');
    var allLoans   = firestoreGetAll_('loans');
    var allContribs = firestoreGetAll_('contributions');
    var allRepayments = firestoreGetAll_('loanRepayments');

    var activeMembers     = members.filter(function(m) { return m.status === 'Active'; }).length;
    var totalSavings      = allSavings.reduce(function(s, x) { return s + (x.currentBalance || 0); }, 0);
    var totalContributions = allContribs.filter(function(c) { return c.status === 'Active'; })
                                        .reduce(function(s, c) { return s + (c.amount || 0); }, 0);
    var totalLoansDisb    = allLoans.filter(function(l) { return l.status !== 'Pending' && l.status !== 'Rejected'; })
                                    .reduce(function(s, l) { return s + (l.approvedAmount || 0); }, 0);
    var totalOutstanding  = allLoans.filter(function(l) { return l.status === 'Disbursed' || l.status === 'Defaulted'; })
                                    .reduce(function(s, l) { return s + (l.outstandingBalance || 0); }, 0);
    var totalRepaid       = allRepayments.reduce(function(s, r) { return s + (r.amountPaid || 0); }, 0);
    var activeLoans       = allLoans.filter(function(l) { return l.status === 'Disbursed'; }).length;
    var defaulters        = allLoans.filter(function(l) { return l.status === 'Defaulted'; }).length;
    var pendingLoans      = allLoans.filter(function(l) { return l.status === 'Pending' || l.status === 'Recommended'; }).length;

    // Monthly contributions for chart (last 12 months)
    var monthlyContributions = {};
    var now = new Date();
    for (var i = 11; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var key = Utilities.formatDate(d, 'Africa/Lagos', 'yyyy-MM');
      monthlyContributions[key] = 0;
    }
    allContribs.forEach(function(c) {
      if (c.status !== 'Active') return;
      var mkey = c.paymentDate ? c.paymentDate.substring(0, 7) : '';
      if (monthlyContributions[mkey] !== undefined) {
        monthlyContributions[mkey] += c.amount || 0;
      }
    });

    return successResponse({
      overview: {
        totalMembers:      members.filter(function(m) { return m.status !== 'Deleted'; }).length,
        activeMembers:     activeMembers,
        totalSavings:      totalSavings,
        totalContributions: totalContributions,
        totalLoansDisb:    totalLoansDisb,
        totalOutstanding:  totalOutstanding,
        totalRepaid:       totalRepaid,
        activeLoans:       activeLoans,
        defaulters:        defaulters,
        pendingLoans:      pendingLoans,
        loanRecoveryRate:  totalLoansDisb > 0 ? Math.round((totalRepaid / totalLoansDisb) * 100) : 0
      },
      monthlyContributions: monthlyContributions
    });
  } catch (e) {
    logError('Reports', 'getFinancialSummary', e);
    return errorResponse('Failed to retrieve financial summary.', 500);
  }
}

/**
 * Generates a member register report.
 * @param {Object} params - { token, status?, dateFrom?, dateTo?, format? }
 */
function getMemberRegisterReport(params) {
  try {
    var auth = authorise_(params.token, 'view_reports');
    if (auth.error) return auth.error;

    var members = firestoreGetAll_('members');
    if (params.status) {
      members = members.filter(function(m) { return m.status === params.status; });
    }
    members = members.filter(function(m) { return m.status !== 'Deleted'; });
    members.sort(function(a, b) { return (a.memberNumber || '').localeCompare(b.memberNumber || ''); });

    if (params.format === 'csv') {
      var csv = toCsv(members,
        ['Member No', 'Full Name', 'Gender', 'Phone', 'Email', 'Occupation', 'Date Joined', 'Status',
         'Total Savings', 'Total Contributions', 'Loan Balance'],
        ['memberNumber', 'fullName', 'gender', 'phone', 'email', 'occupation', 'dateJoined', 'status',
         'totalSavings', 'totalContributions', 'loanBalance']);
      return successResponse({ csv: csv, count: members.length });
    }

    return successResponse({ members: members, count: members.length });
  } catch (e) {
    logError('Reports', 'getMemberRegisterReport', e);
    return errorResponse('Failed to generate member register.', 500);
  }
}

/**
 * Generates a contribution report.
 * @param {Object} params - { token, memberId?, type?, month?, year?,
 *                            dateFrom?, dateTo?, format? }
 */
function getContributionReport(params) {
  try {
    var auth = authorise_(params.token, 'view_reports');
    if (auth.error) return auth.error;

    var filters = [{ field: 'status', op: '==', value: 'Active' }];
    if (params.memberId) filters.push({ field: 'memberId', op: '==', value: params.memberId });
    if (params.type)     filters.push({ field: 'type',     op: '==', value: params.type });
    if (params.month)    filters.push({ field: 'month',    op: '==', value: params.month });

    var contributions = firestoreQuery_('contributions', filters);

    if (params.year) {
      contributions = contributions.filter(function(c) {
        return c.paymentDate && c.paymentDate.startsWith(String(params.year));
      });
    }
    if (params.dateFrom) {
      var from = new Date(params.dateFrom);
      contributions = contributions.filter(function(c) { return c.paymentDate && new Date(c.paymentDate) >= from; });
    }
    if (params.dateTo) {
      var to = new Date(params.dateTo);
      contributions = contributions.filter(function(c) { return c.paymentDate && new Date(c.paymentDate) <= to; });
    }

    var total = contributions.reduce(function(s, c) { return s + (c.amount || 0); }, 0);
    contributions.sort(function(a, b) { return new Date(b.paymentDate) - new Date(a.paymentDate); });

    if (params.format === 'csv') {
      var csv = toCsv(contributions,
        ['Contribution ID', 'Member No', 'Member Name', 'Type', 'Amount', 'Month', 'Payment Date',
         'Payment Method', 'Receipt No'],
        ['contributionId', 'memberId', 'memberName', 'type', 'amount', 'month', 'paymentDate',
         'paymentMethod', 'receiptNumber']);
      return successResponse({ csv: csv, total: total, count: contributions.length });
    }

    return successResponse({ contributions: contributions, total: total, count: contributions.length });
  } catch (e) {
    logError('Reports', 'getContributionReport', e);
    return errorResponse('Failed to generate contribution report.', 500);
  }
}

/**
 * Generates a loan report.
 * @param {Object} params - { token, status?, memberId?, productType?,
 *                            dateFrom?, dateTo?, format? }
 */
function getLoanReport(params) {
  try {
    var auth = authorise_(params.token, 'view_reports');
    if (auth.error) return auth.error;

    var filters = [];
    if (params.status)   filters.push({ field: 'status',   op: '==', value: params.status });
    if (params.memberId) filters.push({ field: 'memberId', op: '==', value: params.memberId });

    var loans = filters.length > 0
      ? firestoreQuery_('loans', filters)
      : firestoreGetAll_('loans');

    if (params.productType) {
      loans = loans.filter(function(l) { return l.productType === params.productType; });
    }
    if (params.dateFrom) {
      var from = new Date(params.dateFrom);
      loans = loans.filter(function(l) { return l.createdAt && new Date(l.createdAt) >= from; });
    }
    if (params.dateTo) {
      var to = new Date(params.dateTo);
      loans = loans.filter(function(l) { return l.createdAt && new Date(l.createdAt) <= to; });
    }

    var totalDisbursed   = loans.reduce(function(s, l) { return s + (l.approvedAmount || 0); }, 0);
    var totalRepaid      = loans.reduce(function(s, l) { return s + (l.totalRepaid || 0); }, 0);
    var totalOutstanding = loans.reduce(function(s, l) { return s + (l.outstandingBalance || 0); }, 0);

    loans.sort(function(a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });

    if (params.format === 'csv') {
      var csv = toCsv(loans,
        ['Loan No', 'Member No', 'Member', 'Product', 'Requested', 'Approved', 'Interest Rate',
         'Duration', 'Status', 'Total Repaid', 'Outstanding', 'Created'],
        ['loanNumber', 'memberId', 'memberName', 'productType', 'requestedAmount', 'approvedAmount',
         'interestRate', 'duration', 'status', 'totalRepaid', 'outstandingBalance', 'createdAt']);
      return successResponse({ csv: csv, totalDisbursed: totalDisbursed,
                               totalRepaid: totalRepaid, totalOutstanding: totalOutstanding });
    }

    return successResponse({
      loans: loans,
      totalDisbursed: totalDisbursed,
      totalRepaid: totalRepaid,
      totalOutstanding: totalOutstanding
    });
  } catch (e) {
    logError('Reports', 'getLoanReport', e);
    return errorResponse('Failed to generate loan report.', 500);
  }
}

/**
 * Generates a repayment report.
 * @param {Object} params - { token, loanNumber?, memberId?, dateFrom?, dateTo?, format? }
 */
function getRepaymentReport(params) {
  try {
    var auth = authorise_(params.token, 'view_reports');
    if (auth.error) return auth.error;

    var filters = [];
    if (params.loanNumber) filters.push({ field: 'loanNumber', op: '==', value: params.loanNumber });
    if (params.memberId)   filters.push({ field: 'memberId',   op: '==', value: params.memberId });

    var repayments = filters.length > 0
      ? firestoreQuery_('loanRepayments', filters)
      : firestoreGetAll_('loanRepayments');

    if (params.dateFrom) {
      var from = new Date(params.dateFrom);
      repayments = repayments.filter(function(r) { return r.paymentDate && new Date(r.paymentDate) >= from; });
    }
    if (params.dateTo) {
      var to = new Date(params.dateTo);
      repayments = repayments.filter(function(r) { return r.paymentDate && new Date(r.paymentDate) <= to; });
    }

    var total    = repayments.reduce(function(s, r) { return s + (r.amountPaid || 0); }, 0);
    var penalties = repayments.reduce(function(s, r) { return s + (r.penalty || 0); }, 0);
    repayments.sort(function(a, b) { return new Date(b.paymentDate) - new Date(a.paymentDate); });

    if (params.format === 'csv') {
      var csv = toCsv(repayments,
        ['Repayment ID', 'Loan No', 'Member No', 'Member', 'Amount Paid', 'Penalty',
         'Payment Date', 'Method', 'Receipt No'],
        ['repaymentId', 'loanNumber', 'memberId', 'memberName', 'amountPaid', 'penalty',
         'paymentDate', 'paymentMethod', 'receiptNumber']);
      return successResponse({ csv: csv, total: total, penalties: penalties });
    }

    return successResponse({ repayments: repayments, total: total, penalties: penalties });
  } catch (e) {
    logError('Reports', 'getRepaymentReport', e);
    return errorResponse('Failed to generate repayment report.', 500);
  }
}

/**
 * Returns savings report across all members.
 * @param {Object} params - { token, format? }
 */
function getSavingsReport(params) {
  try {
    var auth = authorise_(params.token, 'view_reports');
    if (auth.error) return auth.error;

    var allSavings = firestoreGetAll_('savings');
    var members    = firestoreGetAll_('members');
    var memberMap  = {};
    members.forEach(function(m) { memberMap[m.memberNumber] = m; });

    var report = allSavings.map(function(sav) {
      var member = memberMap[sav.memberId] || {};
      return {
        memberId:        sav.memberId,
        memberName:      member.fullName || sav.memberName,
        status:          member.status || '',
        currentBalance:  sav.currentBalance || 0,
        interestAccrued: sav.interestAccrued || 0,
        updatedAt:       sav.updatedAt
      };
    });

    report.sort(function(a, b) { return (b.currentBalance || 0) - (a.currentBalance || 0); });
    var totalSavings  = report.reduce(function(s, r) { return s + (r.currentBalance  || 0); }, 0);
    var totalInterest = report.reduce(function(s, r) { return s + (r.interestAccrued || 0); }, 0);

    if (params.format === 'csv') {
      var csv = toCsv(report,
        ['Member No', 'Member Name', 'Status', 'Current Balance', 'Interest Accrued', 'Last Updated'],
        ['memberId', 'memberName', 'status', 'currentBalance', 'interestAccrued', 'updatedAt']);
      return successResponse({ csv: csv, totalSavings: totalSavings, totalInterest: totalInterest });
    }

    return successResponse({ savings: report, totalSavings: totalSavings, totalInterest: totalInterest });
  } catch (e) {
    logError('Reports', 'getSavingsReport', e);
    return errorResponse('Failed to generate savings report.', 500);
  }
}

/**
 * Returns top contributors.
 * @param {Object} params - { token, limit?, year? }
 */
function getTopContributors(params) {
  try {
    var auth = authorise_(params.token, 'view_reports');
    if (auth.error) return auth.error;

    var contributions = firestoreQuery_('contributions', [{ field: 'status', op: '==', value: 'Active' }]);

    if (params.year) {
      contributions = contributions.filter(function(c) {
        return c.paymentDate && c.paymentDate.startsWith(String(params.year));
      });
    }

    var byMember = {};
    contributions.forEach(function(c) {
      if (!byMember[c.memberId]) byMember[c.memberId] = { memberId: c.memberId, memberName: c.memberName, total: 0, count: 0 };
      byMember[c.memberId].total += c.amount || 0;
      byMember[c.memberId].count++;
    });

    var result = Object.values(byMember)
      .sort(function(a, b) { return b.total - a.total; })
      .slice(0, params.limit || 10);

    return successResponse(result);
  } catch (e) {
    logError('Reports', 'getTopContributors', e);
    return errorResponse('Failed to retrieve top contributors.', 500);
  }
}

/**
 * Returns income and expense breakdown.
 * @param {Object} params - { token, year? }
 */
function getIncomeExpenseReport(params) {
  try {
    var auth = authorise_(params.token, 'view_reports');
    if (auth.error) return auth.error;

    var year = params.year || new Date().getFullYear();
    var transactions = firestoreGetAll_('transactions');

    var yearTxns = transactions.filter(function(t) {
      return t.date && t.date.startsWith(String(year));
    });

    var income = { total: 0, byCategory: {} };
    var expense = { total: 0, byCategory: {} };

    yearTxns.forEach(function(t) {
      if (t.type === 'Credit') {
        income.total += t.amount || 0;
        income.byCategory[t.category] = (income.byCategory[t.category] || 0) + (t.amount || 0);
      } else {
        expense.total += t.amount || 0;
        expense.byCategory[t.category] = (expense.byCategory[t.category] || 0) + (t.amount || 0);
      }
    });

    return successResponse({
      year:    year,
      income:  income,
      expense: expense,
      net:     income.total - expense.total
    });
  } catch (e) {
    logError('Reports', 'getIncomeExpenseReport', e);
    return errorResponse('Failed to generate income/expense report.', 500);
  }
}
