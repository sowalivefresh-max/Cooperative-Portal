/**
 * ============================================================
 *  COOPERATIVE SOCIETY MANAGEMENT PORTAL
 *  Transactions.gs  -  Transaction Ledger & Cash Flow
 * ============================================================
 */

/**
 * Returns paginated transaction ledger.
 * @param {Object} params - { token, memberId?, type?, category?,
 *                            dateFrom?, dateTo?, page?, pageSize?, search? }
 */
function getTransactions(params) {
  try {
    var auth = authorise_(params.token, 'view_transactions');
    if (auth.error) {
      var selfAuth = authorise_(params.token, 'view_own_transactions');
      if (selfAuth.error) return selfAuth.error;
      params.memberId = selfAuth.session.memberId;
      auth = selfAuth;
    }

    var filters = [];
    if (params.memberId) filters.push({ field: 'memberId', op: '==', value: params.memberId });
    if (params.type)     filters.push({ field: 'type',     op: '==', value: params.type });
    if (params.category) filters.push({ field: 'category', op: '==', value: params.category });

    var transactions = filters.length > 0
      ? firestoreQuery_('transactions', filters)
      : firestoreGetAll_('transactions');

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
    if (params.search) {
      transactions = searchFilter(transactions, params.search,
        ['memberName', 'memberId', 'transactionId', 'description', 'reference', 'category']);
    }

    transactions.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
    return successResponse(paginate(transactions, params.page, params.pageSize || 30));
  } catch (e) {
    logError('Transactions', 'getTransactions', e);
    return errorResponse('Failed to retrieve transactions.', 500);
  }
}

/**
 * Returns a single transaction by ID.
 * @param {Object} params - { token, transactionId }
 */
function getTransaction(params) {
  try {
    var auth = authorise_(params.token, 'view_transactions');
    if (auth.error) return auth.error;

    var txn = firestoreGet_('transactions', params.transactionId);
    if (!txn) return errorResponse('Transaction not found.', 404);
    return successResponse(txn);
  } catch (e) {
    logError('Transactions', 'getTransaction', e);
    return errorResponse('Failed to retrieve transaction.', 500);
  }
}

/**
 * Returns cash flow summary for a date range.
 * @param {Object} params - { token, dateFrom?, dateTo?, groupBy? }
 *   groupBy: 'day' | 'month' | 'year' (default: 'month')
 */
function getCashFlow(params) {
  try {
    var auth = authorise_(params.token, 'view_transactions');
    if (auth.error) return auth.error;

    var transactions = firestoreGetAll_('transactions');

    if (params.dateFrom) {
      var from = new Date(params.dateFrom);
      transactions = transactions.filter(function(t) { return t.date && new Date(t.date) >= from; });
    }
    if (params.dateTo) {
      var to = new Date(params.dateTo);
      to.setHours(23, 59, 59);
      transactions = transactions.filter(function(t) { return t.date && new Date(t.date) <= to; });
    }

    var groupBy = params.groupBy || 'month';
    var flow = {};

    transactions.forEach(function(t) {
      var key = '';
      if (!t.date) return;
      var d = new Date(t.date);
      if (groupBy === 'day')   key = Utilities.formatDate(d, 'Africa/Lagos', 'yyyy-MM-dd');
      else if (groupBy === 'year') key = String(d.getFullYear());
      else key = Utilities.formatDate(d, 'Africa/Lagos', 'yyyy-MM');

      if (!flow[key]) flow[key] = { credits: 0, debits: 0, net: 0 };
      if (t.type === 'Credit') {
        flow[key].credits += t.amount || 0;
      } else {
        flow[key].debits += t.amount || 0;
      }
      flow[key].net = flow[key].credits - flow[key].debits;
    });

    // Summary totals
    var totalCredits = transactions.filter(function(t) { return t.type === 'Credit'; })
                                   .reduce(function(s, t) { return s + (t.amount || 0); }, 0);
    var totalDebits  = transactions.filter(function(t) { return t.type === 'Debit'; })
                                   .reduce(function(s, t) { return s + (t.amount || 0); }, 0);

    return successResponse({
      summary: { totalCredits: totalCredits, totalDebits: totalDebits, netCashFlow: totalCredits - totalDebits },
      flow:    flow
    });
  } catch (e) {
    logError('Transactions', 'getCashFlow', e);
    return errorResponse('Failed to retrieve cash flow.', 500);
  }
}

/**
 * Returns transaction statistics for admin dashboard.
 * @param {Object} params - { token }
 */
function getTransactionStats(params) {
  try {
    var auth = authorise_(params.token, 'view_transactions');
    if (auth.error) return auth.error;

    var all = firestoreGetAll_('transactions');
    var thisMonth = getCurrentMonth();

    var monthTxns = all.filter(function(t) {
      return t.date && t.date.startsWith(thisMonth);
    });

    var totalCredits = all.filter(function(t) { return t.type === 'Credit'; })
                          .reduce(function(s, t) { return s + (t.amount || 0); }, 0);
    var totalDebits  = all.filter(function(t) { return t.type === 'Debit'; })
                          .reduce(function(s, t) { return s + (t.amount || 0); }, 0);

    var byCategory = {};
    all.forEach(function(t) {
      byCategory[t.category] = (byCategory[t.category] || 0) + (t.amount || 0);
    });

    return successResponse({
      totalTransactions: all.length,
      totalCredits:      totalCredits,
      totalDebits:       totalDebits,
      netBalance:        totalCredits - totalDebits,
      thisMonthCount:    monthTxns.length,
      thisMonthCredits:  monthTxns.filter(function(t) { return t.type === 'Credit'; })
                                  .reduce(function(s, t) { return s + (t.amount || 0); }, 0),
      byCategory:        byCategory
    });
  } catch (e) {
    logError('Transactions', 'getTransactionStats', e);
    return errorResponse('Failed to retrieve transaction stats.', 500);
  }
}

/**
 * Returns journal entries (grouped daily summary).
 * @param {Object} params - { token, dateFrom, dateTo }
 */
function getJournalEntries(params) {
  try {
    var auth = authorise_(params.token, 'view_transactions');
    if (auth.error) return auth.error;

    var transactions = firestoreGetAll_('transactions');

    if (params.dateFrom) {
      var from = new Date(params.dateFrom);
      transactions = transactions.filter(function(t) { return t.date && new Date(t.date) >= from; });
    }
    if (params.dateTo) {
      var to = new Date(params.dateTo);
      to.setHours(23, 59, 59);
      transactions = transactions.filter(function(t) { return t.date && new Date(t.date) <= to; });
    }

    // Group by date
    var journals = {};
    transactions.forEach(function(t) {
      var day = t.date ? t.date.substring(0, 10) : 'Unknown';
      if (!journals[day]) journals[day] = { date: day, entries: [], totalCredits: 0, totalDebits: 0 };
      journals[day].entries.push(t);
      if (t.type === 'Credit') journals[day].totalCredits += t.amount || 0;
      else                      journals[day].totalDebits  += t.amount || 0;
    });

    var result = Object.values(journals).sort(function(a, b) {
      return new Date(b.date) - new Date(a.date);
    });

    return successResponse(paginate(result, params.page, params.pageSize || 30));
  } catch (e) {
    logError('Transactions', 'getJournalEntries', e);
    return errorResponse('Failed to retrieve journal entries.', 500);
  }
}

// ─── PRIVATE HELPER ───────────────────────────────────────────────────────────

/**
 * Records a transaction entry. Called internally by all other modules.
 * @param {Object} data - { memberId, memberName, type, category, amount,
 *                          reference, description, date, recordedBy }
 */
function recordTransaction_(data) {
  try {
    var txnId = generateId('TXN', 'transactions');

    // Calculate running balance for this member
    var existingTxns = firestoreQuery_('transactions', [
      { field: 'memberId', op: '==', value: data.memberId }
    ]);
    var currentBalance = existingTxns.reduce(function(bal, t) {
      return t.type === 'Credit' ? bal + (t.amount || 0) : bal - (t.amount || 0);
    }, 0);
    var newBalance = data.type === 'Credit'
      ? currentBalance + data.amount
      : currentBalance - data.amount;

    firestoreCreate_('transactions', {
      transactionId: txnId,
      memberId:      data.memberId,
      memberName:    data.memberName || '',
      type:          data.type,
      category:      data.category,
      amount:        data.amount,
      reference:     data.reference || '',
      description:   data.description || '',
      balance:       newBalance,
      date:          data.date || new Date().toISOString(),
      recordedBy:    data.recordedBy || 'system',
      createdAt:     new Date().toISOString()
    }, txnId);

    return txnId;
  } catch (e) {
    logError('Transactions', 'recordTransaction_', e);
    return null;
  }
}
