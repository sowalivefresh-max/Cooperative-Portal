/**
 * ============================================================
 *  COOPERATIVE SOCIETY MANAGEMENT PORTAL
 *  PdfExport.gs  -  PDF & Print Export Engine
 * ============================================================
 */

/**
 * Generates a full Member Registration Certificate / Profile as HTML.
 * Called from the client via google.script.run.
 * @param {Object} params - { token, memberId }
 */
function exportMemberProfilePdf(params) {
  try {
    var auth = authorise_(params.token, 'view_savings');
    if (auth.error) {
      var selfAuth = authorise_(params.token, 'view_own_savings');
      if (selfAuth.error) return selfAuth.error;
      auth = selfAuth;
    }

    var member   = firestoreGet_('members', params.memberId);
    if (!member) return errorResponse('Member not found.', 404);

    var savings  = firestoreGet_('savings', 'SAV-' + params.memberId) || {};
    var contribs = firestoreQuery_('contributions', [
      { field: 'memberId', op: '==', value: params.memberId },
      { field: 'status',   op: '==', value: 'Active' }
    ]);
    var totalContribs = contribs.reduce(function(s, c) { return s + (c.amount || 0); }, 0);
    var monthsPaid    = contribs.filter(function(c) { return c.type === 'Monthly'; }).length;

    var activeLoans = firestoreQuery_('loans', [
      { field: 'memberId', op: '==', value: params.memberId },
      { field: 'status',   op: '==', value: 'Disbursed' }
    ]);
    var loanBalance = activeLoans.reduce(function(s, l) { return s + (l.outstandingBalance || 0); }, 0);

    var societyName = getSetting('societyName') || 'Cooperative Society';
    var address     = getSetting('societyAddress') || '';
    var phone       = getSetting('societyPhone') || '';

    var html = buildMemberProfileHtml_(member, {
      savingsBalance:   savings.currentBalance || 0,
      interestAccrued:  savings.interestAccrued || 0,
      totalContribs:    totalContribs,
      monthsPaid:       monthsPaid,
      loanBalance:      loanBalance
    }, societyName, address, phone);

    return successResponse({ html: html });
  } catch (e) {
    logError('PdfExport', 'exportMemberProfilePdf', e);
    return errorResponse('Failed to generate member profile.', 500);
  }
}

/**
 * Generates a Loan Statement / Offer Letter for a specific loan.
 * @param {Object} params - { token, loanNumber }
 */
function exportLoanStatementPdf(params) {
  try {
    var auth = authorise_(params.token, 'view_loans');
    if (auth.error) {
      var selfAuth = authorise_(params.token, 'view_own_loans');
      if (selfAuth.error) return selfAuth.error;
      auth = selfAuth;
    }

    var loan   = firestoreGet_('loans', params.loanNumber);
    if (!loan) return errorResponse('Loan not found.', 404);

    var member = firestoreGet_('members', loan.memberId) || {};
    var repayments = firestoreQuery_('loanRepayments', [
      { field: 'loanNumber', op: '==', value: params.loanNumber }
    ]);

    var societyName = getSetting('societyName') || 'Cooperative Society';
    var html = buildLoanStatementHtml_(loan, member, repayments, societyName);

    return successResponse({ html: html });
  } catch (e) {
    logError('PdfExport', 'exportLoanStatementPdf', e);
    return errorResponse('Failed to generate loan statement.', 500);
  }
}

/**
 * Generates a Savings Statement PDF for a member.
 * @param {Object} params - { token, memberId, dateFrom?, dateTo? }
 */
function exportSavingsStatementPdf(params) {
  try {
    var auth = authorise_(params.token, 'view_savings');
    if (auth.error) {
      var selfAuth = authorise_(params.token, 'view_own_savings');
      if (selfAuth.error) return selfAuth.error;
      auth = selfAuth;
    }

    var stmtData = getSavingsStatement({ token: params.token, memberId: params.memberId,
                                         dateFrom: params.dateFrom, dateTo: params.dateTo });
    if (!stmtData.success) return stmtData;

    var d          = stmtData.data;
    var member     = d.member || {};
    var savings    = d.savings || {};
    var txns       = d.transactions || [];
    var societyName = getSetting('societyName') || 'Cooperative Society';

    var html = buildSavingsStatementHtml_(member, savings, txns, societyName,
                                          params.dateFrom, params.dateTo);
    return successResponse({ html: html });
  } catch (e) {
    logError('PdfExport', 'exportSavingsStatementPdf', e);
    return errorResponse('Failed to generate savings statement.', 500);
  }
}

/**
 * Generates a Contribution Receipt PDF for a single contribution.
 * @param {Object} params - { token, contributionId }
 */
function exportContributionReceiptPdf(params) {
  try {
    var auth = authorise_(params.token, 'view_savings');
    if (auth.error) {
      var selfAuth = authorise_(params.token, 'view_own_savings');
      if (selfAuth.error) return selfAuth.error;
      auth = selfAuth;
    }

    var contribs = firestoreQuery_('contributions', [
      { field: 'contributionId', op: '==', value: params.contributionId }
    ]);
    if (!contribs || contribs.length === 0) return errorResponse('Contribution not found.', 404);
    var c = contribs[0];
    var member = firestoreGet_('members', c.memberId) || {};
    var societyName = getSetting('societyName') || 'Cooperative Society';
    var footer = getSetting('receiptFooterText') || '';

    var html = buildContribReceiptHtml_(c, member, societyName, footer);
    return successResponse({ html: html });
  } catch (e) {
    logError('PdfExport', 'exportContributionReceiptPdf', e);
    return errorResponse('Failed to generate receipt.', 500);
  }
}

/**
 * Generates a financial summary report as printable HTML.
 * @param {Object} params - { token }
 */
function exportFinancialReportPdf(params) {
  try {
    var auth = authorise_(params.token, 'view_reports');
    if (auth.error) return auth.error;

    var summary = getFinancialSummary({ token: params.token });
    if (!summary.success) return summary;

    var societyName = getSetting('societyName') || 'Cooperative Society';
    var html = buildFinancialReportHtml_(summary.data, societyName);
    return successResponse({ html: html });
  } catch (e) {
    logError('PdfExport', 'exportFinancialReportPdf', e);
    return errorResponse('Failed to generate financial report.', 500);
  }
}

// ─── HTML BUILDERS ────────────────────────────────────────────────────────────

function pdfStyles_() {
  return '<style>' +
    '@import url(\'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap\');' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:Inter,Arial,sans-serif;font-size:12px;color:#1a1a2e;background:#fff;padding:0}' +
    '.page{max-width:800px;margin:0 auto;padding:32px}' +
    '.header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:16px;border-bottom:3px solid #1B5E20;margin-bottom:24px}' +
    '.header-left h1{font-size:20px;font-weight:800;color:#1B5E20}' +
    '.header-left p{font-size:11px;color:#546E7A;margin-top:3px}' +
    '.header-right{text-align:right;font-size:11px;color:#546E7A}' +
    '.doc-title{text-align:center;margin-bottom:24px}' +
    '.doc-title h2{font-size:16px;font-weight:800;color:#1B5E20;text-transform:uppercase;letter-spacing:1px}' +
    '.doc-title .doc-no{font-size:11px;color:#546E7A;margin-top:4px}' +
    '.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px}' +
    '.info-box{background:#F9FBE7;border:1px solid #E8F5E9;border-radius:8px;padding:14px}' +
    '.info-box h4{font-size:11px;font-weight:700;color:#1B5E20;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;border-bottom:1px solid #C8E6C9;padding-bottom:6px}' +
    '.info-row{display:flex;margin-bottom:5px}' +
    '.info-label{width:45%;font-size:11px;color:#546E7A;font-weight:600}' +
    '.info-value{flex:1;font-size:11px;color:#212121;font-weight:500}' +
    '.stats-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}' +
    '.stat-box{background:#E8F5E9;border-radius:8px;padding:12px;text-align:center}' +
    '.stat-box .label{font-size:10px;font-weight:700;color:#2E7D32;text-transform:uppercase;margin-bottom:4px}' +
    '.stat-box .value{font-size:16px;font-weight:800;color:#1B5E20}' +
    'table{width:100%;border-collapse:collapse;margin-bottom:20px}' +
    'thead th{background:#1B5E20;color:#fff;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;font-weight:700}' +
    'tbody tr:nth-child(even){background:#F9FBE7}' +
    'tbody td{padding:7px 10px;font-size:11px;border-bottom:1px solid #E8F5E9}' +
    '.total-row td{font-weight:800;font-size:12px;background:#E8F5E9;border-top:2px solid #1B5E20}' +
    '.credit{color:#1B5E20;font-weight:700}' +
    '.debit{color:#C62828;font-weight:700}' +
    '.footer{margin-top:32px;padding-top:16px;border-top:2px solid #E8F5E9;display:flex;justify-content:space-between;align-items:flex-end}' +
    '.sig-box{text-align:center;width:160px}' +
    '.sig-line{border-top:1.5px solid #546E7A;padding-top:6px;margin-top:24px;font-size:10px;color:#546E7A}' +
    '.watermark{position:fixed;top:45%;left:50%;transform:translate(-50%,-50%) rotate(-35deg);font-size:80px;color:rgba(27,94,32,.04);font-weight:900;letter-spacing:8px;z-index:-1;pointer-events:none}' +
    '.badge{display:inline-block;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700}' +
    '.badge-green{background:#E8F5E9;color:#1B5E20}' +
    '.badge-gold{background:#FFF8E1;color:#F57F17}' +
    '.badge-red{background:#FFEBEE;color:#C62828}' +
    '.badge-blue{background:#E3F2FD;color:#1565C0}' +
    '.print-only-notice{display:none}' +
    '@media print{.no-print{display:none!important}.print-only-notice{display:block}}' +
    '</style>';
}

function pdfHeader_(societyName, address, phone, docType) {
  return '<div class="header">' +
    '<div class="header-left">' +
    '<h1>🏦 ' + societyName + '</h1>' +
    '<p>' + (address || '') + '</p>' +
    '<p>' + (phone || '') + '</p>' +
    '</div>' +
    '<div class="header-right">' +
    '<div style="font-size:11px;font-weight:700;color:#1B5E20">' + docType + '</div>' +
    '<div>Date: ' + formatDate(new Date()) + '</div>' +
    '</div>' +
    '</div>';
}

function pdfFooter_(societyName) {
  return '<div class="footer">' +
    '<div class="sig-box">' +
    '<div class="sig-line">Member Signature</div>' +
    '</div>' +
    '<div style="text-align:center;font-size:10px;color:#90A4AE">' +
    '<div>This is a computer-generated document.</div>' +
    '<div>Generated: ' + formatDateTime(new Date()) + '</div>' +
    '<div style="margin-top:4px;font-weight:600">' + societyName + '</div>' +
    '</div>' +
    '<div class="sig-box">' +
    '<div class="sig-line">Authorised Signatory</div>' +
    '</div>' +
    '</div>';
}

function buildMemberProfileHtml_(member, fin, societyName, address, phone) {
  var m = member;
  var f = fin;
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Member Profile — ' + societyName + '</title>' +
    pdfStyles_() +
    '</head><body>' +
    '<div class="watermark">COOPERATIVE</div>' +
    '<div class="page">' +
    pdfHeader_(societyName, address, phone, 'MEMBER PROFILE') +

    '<div class="doc-title">' +
    '<h2>Member Registration Profile</h2>' +
    '<div class="doc-no">Member No: ' + m.memberNumber + ' &nbsp;|&nbsp; Status: <span class="badge badge-green">' + m.status + '</span></div>' +
    '</div>' +

    '<div class="info-grid">' +
    '<div class="info-box"><h4>Personal Information</h4>' +
    '<div class="info-row"><span class="info-label">Full Name</span><span class="info-value" style="font-weight:800">' + (m.fullName || '') + '</span></div>' +
    '<div class="info-row"><span class="info-label">Gender</span><span class="info-value">' + (m.gender || '') + '</span></div>' +
    '<div class="info-row"><span class="info-label">Date of Birth</span><span class="info-value">' + formatDate(m.dateOfBirth) + '</span></div>' +
    '<div class="info-row"><span class="info-label">State of Origin</span><span class="info-value">' + (m.stateOfOrigin || '') + '</span></div>' +
    '<div class="info-row"><span class="info-label">LGA</span><span class="info-value">' + (m.lga || '') + '</span></div>' +
    '<div class="info-row"><span class="info-label">Religion</span><span class="info-value">' + (m.religion || '') + '</span></div>' +
    '</div>' +

    '<div class="info-box"><h4>Contact Information</h4>' +
    '<div class="info-row"><span class="info-label">Phone</span><span class="info-value">' + (m.phone || '') + '</span></div>' +
    '<div class="info-row"><span class="info-label">Alt. Phone</span><span class="info-value">' + (m.altPhone || '') + '</span></div>' +
    '<div class="info-row"><span class="info-label">Email</span><span class="info-value">' + (m.email || '') + '</span></div>' +
    '<div class="info-row"><span class="info-label">Address</span><span class="info-value">' + (m.residentialAddress || '') + '</span></div>' +
    '<div class="info-row"><span class="info-label">Date Joined</span><span class="info-value">' + formatDate(m.dateJoined) + '</span></div>' +
    '</div>' +

    '<div class="info-box"><h4>Employment Information</h4>' +
    '<div class="info-row"><span class="info-label">Occupation</span><span class="info-value">' + (m.occupation || '') + '</span></div>' +
    '<div class="info-row"><span class="info-label">Employer</span><span class="info-value">' + (m.employer || '') + '</span></div>' +
    '<div class="info-row"><span class="info-label">Work Address</span><span class="info-value">' + (m.workAddress || '') + '</span></div>' +
    '<div class="info-row"><span class="info-label">Monthly Income</span><span class="info-value">' + formatCurrency(m.monthlyIncome) + '</span></div>' +
    '</div>' +

    '<div class="info-box"><h4>Next of Kin</h4>' +
    (m.nextOfKin ? [
      ['Name', m.nextOfKin.name],
      ['Relationship', m.nextOfKin.relationship],
      ['Phone', m.nextOfKin.phone],
      ['Address', m.nextOfKin.address]
    ].map(function(r) {
      return '<div class="info-row"><span class="info-label">' + r[0] + '</span><span class="info-value">' + (r[1] || '') + '</span></div>';
    }).join('') : '<div style="color:#90A4AE;font-size:11px">No next of kin recorded</div>') +
    '</div>' +
    '</div>' +

    '<div class="stats-row">' +
    '<div class="stat-box"><div class="label">Savings Balance</div><div class="value">' + formatCurrency(f.savingsBalance) + '</div></div>' +
    '<div class="stat-box"><div class="label">Total Contributions</div><div class="value">' + formatCurrency(f.totalContribs) + '</div></div>' +
    '<div class="stat-box"><div class="label">Months Paid</div><div class="value">' + f.monthsPaid + '</div></div>' +
    '<div class="stat-box" style="background:#FFEBEE"><div class="label" style="color:#C62828">Loan Balance</div><div class="value" style="color:#C62828">' + formatCurrency(f.loanBalance) + '</div></div>' +
    '</div>' +

    pdfFooter_(societyName) +
    '</div></body></html>';
}

function buildLoanStatementHtml_(loan, member, repayments, societyName) {
  var schedule = loan.repaymentSchedule || [];
  var totalPaid = repayments.reduce(function(s, r) { return s + (r.amountPaid || 0); }, 0);

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Loan Statement — ' + societyName + '</title>' +
    pdfStyles_() + '</head><body>' +
    '<div class="watermark">LOAN</div>' +
    '<div class="page">' +
    pdfHeader_(societyName, '', '', 'LOAN STATEMENT') +

    '<div class="doc-title">' +
    '<h2>Loan Account Statement</h2>' +
    '<div class="doc-no">Loan No: ' + loan.loanNumber +
    ' &nbsp;|&nbsp; Status: <span class="badge badge-' + (loan.status === 'Disbursed' ? 'blue' : loan.status === 'Completed' ? 'green' : 'gold') + '">' + loan.status + '</span></div>' +
    '</div>' +

    '<div class="info-grid">' +
    '<div class="info-box"><h4>Member Details</h4>' +
    '<div class="info-row"><span class="info-label">Full Name</span><span class="info-value" style="font-weight:800">' + (member.fullName || loan.memberName || '') + '</span></div>' +
    '<div class="info-row"><span class="info-label">Member No</span><span class="info-value">' + loan.memberId + '</span></div>' +
    '<div class="info-row"><span class="info-label">Phone</span><span class="info-value">' + (member.phone || '') + '</span></div>' +
    '<div class="info-row"><span class="info-label">Email</span><span class="info-value">' + (member.email || '') + '</span></div>' +
    '</div>' +

    '<div class="info-box"><h4>Loan Details</h4>' +
    '<div class="info-row"><span class="info-label">Product</span><span class="info-value">' + loan.productType + '</span></div>' +
    '<div class="info-row"><span class="info-label">Amount Approved</span><span class="info-value" style="font-weight:800">' + formatCurrency(loan.approvedAmount) + '</span></div>' +
    '<div class="info-row"><span class="info-label">Interest Rate</span><span class="info-value">' + loan.interestRate + '% p.a.</span></div>' +
    '<div class="info-row"><span class="info-label">Duration</span><span class="info-value">' + loan.duration + ' months</span></div>' +
    '<div class="info-row"><span class="info-label">Total Repayable</span><span class="info-value">' + formatCurrency(loan.totalRepayable) + '</span></div>' +
    '<div class="info-row"><span class="info-label">Disbursed On</span><span class="info-value">' + formatDate(loan.disbursedDate) + '</span></div>' +
    '</div>' +
    '</div>' +

    '<div class="stats-row">' +
    '<div class="stat-box"><div class="label">Loan Amount</div><div class="value">' + formatCurrency(loan.approvedAmount) + '</div></div>' +
    '<div class="stat-box"><div class="label">Total Repayable</div><div class="value">' + formatCurrency(loan.totalRepayable) + '</div></div>' +
    '<div class="stat-box" style="background:#E8F5E9"><div class="label" style="color:#1B5E20">Total Repaid</div><div class="value" style="color:#1B5E20">' + formatCurrency(totalPaid) + '</div></div>' +
    '<div class="stat-box" style="background:#FFEBEE"><div class="label" style="color:#C62828">Outstanding</div><div class="value" style="color:#C62828">' + formatCurrency(loan.outstandingBalance) + '</div></div>' +
    '</div>' +

    '<h3 style="font-size:13px;font-weight:800;color:#1B5E20;margin-bottom:10px">Repayment Schedule</h3>' +
    '<table><thead><tr><th>#</th><th>Due Date</th><th>Principal</th><th>Interest</th><th>Instalment</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead><tbody>' +
    schedule.map(function(s) {
      var statusClass = s.status === 'Paid' ? 'badge-green' : s.status === 'Partial' ? 'badge-gold' : 'badge-blue';
      return '<tr><td>' + s.installmentNumber + '</td>' +
        '<td>' + formatDate(s.dueDate) + '</td>' +
        '<td>' + formatCurrency(s.principalPortion) + '</td>' +
        '<td>' + formatCurrency(s.interestPortion) + '</td>' +
        '<td style="font-weight:700">' + formatCurrency(s.installmentAmount) + '</td>' +
        '<td class="credit">' + (s.paidAmount > 0 ? formatCurrency(s.paidAmount) : '—') + '</td>' +
        '<td>' + formatCurrency(s.balance) + '</td>' +
        '<td><span class="badge ' + statusClass + '">' + s.status + '</span></td></tr>';
    }).join('') +
    '<tr class="total-row"><td colspan="4">TOTALS</td><td>' + formatCurrency(loan.totalRepayable) + '</td><td class="credit">' + formatCurrency(totalPaid) + '</td><td>' + formatCurrency(loan.outstandingBalance) + '</td><td></td></tr>' +
    '</tbody></table>' +

    (repayments.length > 0 ?
    '<h3 style="font-size:13px;font-weight:800;color:#1B5E20;margin-bottom:10px;margin-top:20px">Payment History</h3>' +
    '<table><thead><tr><th>Receipt No</th><th>Date</th><th>Amount Paid</th><th>Penalty</th><th>Method</th></tr></thead><tbody>' +
    repayments.map(function(r) {
      return '<tr><td>' + r.receiptNumber + '</td><td>' + formatDate(r.paymentDate) + '</td>' +
        '<td class="credit">' + formatCurrency(r.amountPaid) + '</td>' +
        '<td class="debit">' + (r.penalty > 0 ? formatCurrency(r.penalty) : '—') + '</td>' +
        '<td>' + r.paymentMethod + '</td></tr>';
    }).join('') +
    '</tbody></table>' : '') +

    pdfFooter_(societyName) +
    '</div></body></html>';
}

function buildSavingsStatementHtml_(member, savings, txns, societyName, dateFrom, dateTo) {
  var totalCredits = txns.filter(function(t) { return t.type === 'Credit'; }).reduce(function(s, t) { return s + (t.amount || 0); }, 0);
  var totalDebits  = txns.filter(function(t) { return t.type === 'Debit';  }).reduce(function(s, t) { return s + (t.amount || 0); }, 0);

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Savings Statement — ' + societyName + '</title>' +
    pdfStyles_() + '</head><body>' +
    '<div class="watermark">SAVINGS</div>' +
    '<div class="page">' +
    pdfHeader_(societyName, '', '', 'SAVINGS STATEMENT') +

    '<div class="doc-title">' +
    '<h2>Savings Account Statement</h2>' +
    '<div class="doc-no">Member: ' + (member.fullName || '') + ' (' + (member.memberNumber || '') + ')' +
    (dateFrom || dateTo ? ' &nbsp;|&nbsp; Period: ' + (dateFrom || 'All') + ' to ' + (dateTo || 'Present') : '') +
    '</div>' +
    '</div>' +

    '<div class="stats-row">' +
    '<div class="stat-box"><div class="label">Current Balance</div><div class="value">' + formatCurrency(savings.currentBalance) + '</div></div>' +
    '<div class="stat-box" style="background:#E8F5E9"><div class="label" style="color:#1B5E20">Total Credits</div><div class="value" style="color:#1B5E20">' + formatCurrency(totalCredits) + '</div></div>' +
    '<div class="stat-box" style="background:#FFEBEE"><div class="label" style="color:#C62828">Total Debits</div><div class="value" style="color:#C62828">' + formatCurrency(totalDebits) + '</div></div>' +
    '<div class="stat-box"><div class="label">Interest Accrued</div><div class="value">' + formatCurrency(savings.interestAccrued) + '</div></div>' +
    '</div>' +

    '<h3 style="font-size:13px;font-weight:800;color:#1B5E20;margin-bottom:10px">Transaction History</h3>' +
    '<table><thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Type</th><th>Amount</th><th>Balance</th></tr></thead><tbody>' +
    txns.map(function(t) {
      return '<tr><td>' + formatDate(t.date) + '</td>' +
        '<td style="max-width:180px">' + (t.description || '').substring(0, 40) + '</td>' +
        '<td>' + (t.category || '') + '</td>' +
        '<td><span class="badge ' + (t.type === 'Credit' ? 'badge-green' : 'badge-red') + '">' + t.type + '</span></td>' +
        '<td class="' + (t.type === 'Credit' ? 'credit' : 'debit') + '">' + formatCurrency(t.amount) + '</td>' +
        '<td>' + formatCurrency(t.balance) + '</td></tr>';
    }).join('') +
    '<tr class="total-row"><td colspan="3">TOTALS</td><td></td><td class="credit">' + formatCurrency(totalCredits) + '</td><td>' + formatCurrency(savings.currentBalance) + '</td></tr>' +
    '</tbody></table>' +
    pdfFooter_(societyName) +
    '</div></body></html>';
}

function buildContribReceiptHtml_(c, member, societyName, footer) {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Receipt — ' + societyName + '</title>' +
    pdfStyles_() +
    '<style>.receipt-page{max-width:420px;margin:20px auto;padding:24px;border:2px solid #1B5E20;border-radius:12px}' +
    '.receipt-title{text-align:center;background:#1B5E20;color:#fff;padding:12px;border-radius:8px;margin-bottom:16px}' +
    '.receipt-title h2{font-size:15px;font-weight:800}' +
    '.receipt-no{text-align:center;background:#E8F5E9;padding:8px;border-radius:6px;margin-bottom:14px;font-weight:800;color:#1B5E20;font-size:14px}' +
    '.receipt-row{display:flex;border-bottom:1px dotted #E0E0E0;padding:6px 0}' +
    '.receipt-label{width:50%;color:#546E7A;font-size:12px;font-weight:600}' +
    '.receipt-value{flex:1;font-size:12px;font-weight:700;text-align:right}' +
    '.amount-row .receipt-label{font-size:15px;font-weight:800;color:#1B5E20;border-top:2px solid #1B5E20;padding-top:10px}' +
    '.amount-row .receipt-value{font-size:15px;font-weight:800;color:#1B5E20;border-top:2px solid #1B5E20;padding-top:10px}' +
    '.receipt-footer{text-align:center;margin-top:16px;font-size:10px;color:#90A4AE;border-top:1px solid #E0E0E0;padding-top:12px}' +
    '</style>' +
    '</head><body>' +
    '<div class="receipt-page">' +
    '<div class="receipt-title"><h2>🏦 ' + societyName + '</h2><div style="font-size:11px;opacity:.8">OFFICIAL RECEIPT</div></div>' +
    '<div class="receipt-no">Receipt No: ' + c.receiptNumber + '</div>' +
    '<div class="receipt-row"><span class="receipt-label">Member Name</span><span class="receipt-value">' + (member.fullName || c.memberName || '') + '</span></div>' +
    '<div class="receipt-row"><span class="receipt-label">Member No</span><span class="receipt-value">' + c.memberId + '</span></div>' +
    '<div class="receipt-row"><span class="receipt-label">Contribution Type</span><span class="receipt-value">' + c.type + '</span></div>' +
    '<div class="receipt-row"><span class="receipt-label">Period</span><span class="receipt-value">' + formatMonthLabel(c.month) + '</span></div>' +
    '<div class="receipt-row"><span class="receipt-label">Payment Method</span><span class="receipt-value">' + c.paymentMethod + '</span></div>' +
    '<div class="receipt-row"><span class="receipt-label">Payment Date</span><span class="receipt-value">' + formatDate(c.paymentDate) + '</span></div>' +
    '<div class="receipt-row amount-row"><span class="receipt-label">AMOUNT PAID</span><span class="receipt-value">' + formatCurrency(c.amount) + '</span></div>' +
    '<div class="receipt-footer">' + (footer || '') + '<br>Generated: ' + formatDateTime(new Date()) + '</div>' +
    '</div></body></html>';
}

function buildFinancialReportHtml_(data, societyName) {
  var o = data.overview || {};
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Financial Report — ' + societyName + '</title>' +
    pdfStyles_() + '</head><body>' +
    '<div class="watermark">CONFIDENTIAL</div>' +
    '<div class="page">' +
    pdfHeader_(societyName, '', '', 'FINANCIAL REPORT') +

    '<div class="doc-title"><h2>Financial Summary Report</h2>' +
    '<div class="doc-no">As at ' + formatDate(new Date()) + '</div></div>' +

    '<div class="stats-row">' +
    '<div class="stat-box"><div class="label">Total Members</div><div class="value">' + (o.totalMembers || 0) + '</div></div>' +
    '<div class="stat-box"><div class="label">Active Members</div><div class="value">' + (o.activeMembers || 0) + '</div></div>' +
    '<div class="stat-box"><div class="label">Active Loans</div><div class="value">' + (o.activeLoans || 0) + '</div></div>' +
    '<div class="stat-box" style="background:#FFEBEE"><div class="label" style="color:#C62828">Defaulters</div><div class="value" style="color:#C62828">' + (o.defaulters || 0) + '</div></div>' +
    '</div>' +

    '<div class="info-grid" style="margin-bottom:20px">' +
    '<div class="info-box"><h4>Savings & Contributions</h4>' +
    '<div class="info-row"><span class="info-label">Total Savings</span><span class="info-value" style="font-weight:800;color:#1B5E20">' + formatCurrency(o.totalSavings) + '</span></div>' +
    '<div class="info-row"><span class="info-label">Total Contributions</span><span class="info-value" style="font-weight:800">' + formatCurrency(o.totalContributions) + '</span></div>' +
    '</div>' +
    '<div class="info-box"><h4>Loan Portfolio</h4>' +
    '<div class="info-row"><span class="info-label">Total Disbursed</span><span class="info-value" style="font-weight:800">' + formatCurrency(o.totalLoansDisb) + '</span></div>' +
    '<div class="info-row"><span class="info-label">Total Repaid</span><span class="info-value" style="font-weight:800;color:#1B5E20">' + formatCurrency(o.totalRepaid) + '</span></div>' +
    '<div class="info-row"><span class="info-label">Outstanding Balance</span><span class="info-value" style="font-weight:800;color:#C62828">' + formatCurrency(o.totalOutstanding) + '</span></div>' +
    '<div class="info-row"><span class="info-label">Recovery Rate</span><span class="info-value" style="font-weight:800">' + (o.loanRecoveryRate || 0) + '%</span></div>' +
    '</div></div>' +

    pdfFooter_(societyName) +
    '</div></body></html>';
}

/**
 * Formats a currency value for PDF output (server-side).
 * @param {number} amount
 * @returns {string}
 */
function formatCurrency(amount) {
  if (!amount && amount !== 0) return '₦0.00';
  var parts = parseFloat(amount).toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return '₦' + parts.join('.');
}
