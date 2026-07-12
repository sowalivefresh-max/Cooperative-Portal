# Cooperative Society Management Portal

A production-ready cooperative society management system with a **decoupled architecture**:

| Layer | Technology | Hosting |
|---|---|---|
| **Frontend** | Vanilla HTML / CSS / JS | GitHub Pages |
| **Backend** | Google Apps Script (REST API) | Google (GAS Web App) |
| **Database** | Firebase Firestore | Google Firebase |

---

## 🚀 Quick Start

### Step 1 — Deploy the Backend (Google Apps Script)

1. Install [clasp](https://github.com/google/clasp):
   ```bash
   npm install -g @google/clasp
   clasp login
   ```

2. Create a new GAS project:
   ```bash
   cd backend
   clasp create --title "Cooperative Society Portal" --type webapp
   clasp push
   ```

3. Deploy as a Web App in the Apps Script editor:
   - **Execute as**: Me
   - **Who has access**: Anyone
   - Copy the deployment URL (e.g. `https://script.google.com/macros/s/XXXX/exec`)

4. Run `initPortal()` once from the Apps Script editor to seed the database.

### Step 2 — Configure the Frontend

Edit `frontend/js/config.js` and paste your GAS deployment URL:

```js
window.COOP_CONFIG = {
  apiUrl: 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec',
  ...
};
```

### Step 3 — Deploy the Frontend to GitHub Pages

1. Push this repository to GitHub.
2. Go to **Settings → Pages**.
3. Set **Source**: Deploy from branch `main`, folder `/frontend`.
4. Your portal will be live at `https://<username>.github.io/<repo>/`.

---

## 📁 Project Structure

```
Cooperative Portal/
├── backend/                  ← Google Apps Script project
│   ├── appsscript.json       ← GAS manifest (clasp)
│   ├── Code.gs               ← API router & action whitelist
│   ├── Auth.gs               ← Authentication, sessions, RBAC
│   ├── Database.gs           ← Firestore helpers
│   ├── Developer.gs          ← Developer diagnostics & backup tools
│   ├── Members.gs            ← Member management
│   ├── Loans.gs              ← Loan lifecycle
│   ├── LoanProducts.gs       ← Loan product configuration
│   ├── Contributions.gs      ← Monthly contributions
│   ├── Savings.gs            ← Savings accounts
│   ├── Repayments.gs         ← Loan repayments
│   ├── Transactions.gs       ← General ledger
│   ├── Reports.gs            ← Financial reports
│   ├── Notifications.gs      ← Email/SMS notifications
│   ├── AuditLog.gs           ← Immutable audit trail
│   ├── Settings.gs           ← System configuration
│   ├── Documents.gs          ← Document management
│   ├── PdfExport.gs          ← PDF statement & receipt generation
│   └── Utils.gs              ← Shared utilities
│
├── frontend/                 ← Static site (GitHub Pages)
│   ├── index.html            ← Login page
│   ├── pages/
│   │   ├── admin.html        ← Admin / Super Admin dashboard
│   │   ├── accountant.html   ← Accountant dashboard
│   │   ├── loan-officer.html ← Loan Officer dashboard
│   │   ├── auditor.html      ← Auditor dashboard
│   │   ├── member.html       ← Member self-service portal
│   │   └── developer.html    ← Developer diagnostic console
│   ├── css/
│   │   └── styles.css        ← Global design system
│   └── js/
│       ├── config.js         ← ⚠️ Configure your GAS URL here
│       └── coop.js           ← COOP utility library (fetch-based API)
│
├── .gitignore
└── README.md
```

---

## 🔐 Default Credentials

After running `initPortal()`:

| Field | Value |
|---|---|
| **Email** | `admin@cooperativeportal.com` |
| **Password** | `Admin@1234` |

> ⚠️ **Change this password immediately on first login!**

---

## 👥 User Roles

| Role | Dashboard | Access Level |
|---|---|---|
| `developer` | Developer Console | Full system (root) |
| `super_admin` | Admin Dashboard | Full cooperative management |
| `admin` | Admin Dashboard | Full cooperative management |
| `accountant` | Accountant Dashboard | Financials only |
| `loan_officer` | Loan Officer Dashboard | Loan lifecycle only |
| `auditor` | Auditor Dashboard | Read-only access |
| `member` | Member Portal | Own records only |

---

## 🌐 API Architecture

The backend is a **pure REST JSON API** deployed as a GAS Web App.

All API calls use **HTTP POST** with `Content-Type: text/plain` to avoid CORS preflight:

```js
fetch(COOP_CONFIG.apiUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({ action: 'loginUser', email: '...', password: '...' })
});
```

Every request passes a `token` in the body for authentication. Tokens are stored in `localStorage`.

---

## 🔧 Firebase Setup

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com).
2. Enable **Firestore** in native mode.
3. Add your Firebase config to Google Apps Script **Script Properties**:
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_API_KEY`
   - `FIREBASE_CLIENT_EMAIL`
   - `FIREBASE_PRIVATE_KEY`

---

## 📜 License

This project is proprietary. All rights reserved.
