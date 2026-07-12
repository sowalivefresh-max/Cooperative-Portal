/**
 * config.js
 * ─────────────────────────────────────────────────────────
 * Cooperative Society Management Portal — Frontend Config
 *
 * HOW TO CONFIGURE:
 *   1. Deploy your Google Apps Script project as a Web App:
 *        - Execute as: Me
 *        - Who has access: Anyone
 *   2. Copy the deployment URL (looks like:
 *      https://script.google.com/macros/s/XXXXXXXXX/exec)
 *   3. Paste it as the value for `apiUrl` below.
 *   4. Set your society name and preferred settings.
 * ─────────────────────────────────────────────────────────
 */
window.COOP_CONFIG = {
  /**
   * Your Google Apps Script Web App deployment URL.
   * REQUIRED — the app will not function without this.
   */
  apiUrl: 'https://script.google.com/macros/s/AKfycbyMsaJ1nIdIt4z43NZX6LqHm1LHYX1ThzXHKZXduGi20XJtwOW2YHt7_E_Nq3d2xYPQ/exec',

  /**
   * Base path for page navigation.
   * If running from the root of GitHub Pages, leave as '/'.
   * If deployed to a subdirectory (e.g., /cooperative-portal/), set accordingly.
   */
  basePath: '/',

  /**
   * Society name displayed in the browser title.
   * This will be overridden at runtime by the value stored in your Firestore settings.
   */
  societyName: 'Cooperative Society Portal',

  /**
   * Role-to-page routing map.
   * Maps user roles to their respective dashboard HTML pages.
   */
  dashboardMap: {
    developer:    'pages/developer.html',
    super_admin:  'pages/admin.html',
    admin:        'pages/admin.html',
    accountant:   'pages/accountant.html',
    loan_officer: 'pages/loan-officer.html',
    auditor:      'pages/auditor.html',
    member:       'pages/member.html'
  }
};
