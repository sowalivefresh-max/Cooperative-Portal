/**
 * ============================================================
 *  COOPERATIVE SOCIETY MANAGEMENT PORTAL
 *  Auth.gs  -  Authentication, Sessions & Password Management
 * ============================================================
 *
 *  Sessions are stored in the Firestore 'sessions' collection:
 *  {
 *    token:     string (SHA-256 hash of raw token),
 *    userId:    string,
 *    role:      string,
 *    memberId:  string | null,
 *    fullName:  string,
 *    email:     string,
 *    expiresAt: timestamp (ISO),
 *    createdAt: timestamp
 *  }
 *
 *  The raw token is sent to the client. On every API call,
 *  the client sends it back and we validate it against Firestore.
 * ============================================================
 */

var SESSION_TTL_HOURS = 24;
var MAX_FAILED_ATTEMPTS = 5;
var LOCK_DURATION_MINUTES = 30;

// ─── PUBLIC API FUNCTIONS ─────────────────────────────────────────────────────

/**
 * Logs in a user with email and password.
 * @param {Object} params - { email, password }
 * @returns {Object} - successResponse with { token, user } or errorResponse
 */
function loginUser(params) {
  try {
    var email = String(params.email || '').trim().toLowerCase();
    var password = String(params.password || '');

    if (!email || !password) {
      return errorResponse('Email and password are required.', 400);
    }

    // Find user by email
    var users = firestoreQuery_('users', [{ field: 'email', op: '==', value: email }]);
    if (users.length === 0) {
      return errorResponse('Invalid email or password.', 401);
    }
    var user = users[0];

    // Check if account is active
    if (!user.isActive) {
      return errorResponse('Your account has been deactivated. Please contact the administrator.', 403);
    }

    // Check if account is locked
    if (user.lockedUntil) {
      var lockExpiry = new Date(user.lockedUntil);
      if (lockExpiry > new Date()) {
        var minutesLeft = Math.ceil((lockExpiry - new Date()) / 60000);
        return errorResponse('Account locked. Try again in ' + minutesLeft + ' minute(s).', 423);
      }
    }

    // Verify password
    if (!verifyPassword(password, user.passwordHash)) {
      handleFailedLogin_(user);
      var remaining = MAX_FAILED_ATTEMPTS - ((user.failedLoginAttempts || 0) + 1);
      if (remaining <= 0) {
        return errorResponse('Account locked after too many failed attempts. Try again in ' + LOCK_DURATION_MINUTES + ' minutes.', 423);
      }
      return errorResponse('Invalid email or password. ' + remaining + ' attempt(s) remaining.', 401);
    }

    // Reset failed attempts on success
    if (user.failedLoginAttempts > 0) {
      firestoreUpdate_('users', user._id, {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLogin: new Date().toISOString()
      });
    } else {
      firestoreUpdate_('users', user._id, { lastLogin: new Date().toISOString() });
    }

    // Require password change if flagged
    if (user.requirePasswordChange) {
      var tempToken = createSession_(user, true);
      return successResponse({
        token: tempToken,
        requirePasswordChange: true,
        userId: user._id
      }, 'Password change required.');
    }

    // Create session
    var token = createSession_(user, false);

    // Get member info if applicable
    var memberInfo = null;
    if (user.memberId) {
      memberInfo = firestoreGet_('members', user.memberId);
    }

    // Audit log
    logAction_('LOGIN', 'Auth', user._id, null, null, { email: email });

    return successResponse({
      token: token,
      user: {
        userId: user._id,
        email: user.email,
        role: user.role,
        fullName: user.fullName || (memberInfo ? memberInfo.fullName : email),
        memberId: user.memberId || null,
        profilePhoto: memberInfo ? memberInfo.passportPhotoUrl : null
      }
    }, 'Login successful.');

  } catch (e) {
    logError('Auth', 'loginUser', e);
    return errorResponse('Login failed. Please try again.', 500);
  }
}

/**
 * Logs out a user by invalidating their session token.
 * @param {Object} params - { token }
 * @returns {Object}
 */
function logoutUser(params) {
  try {
    var token = params.token || '';
    if (!token) return errorResponse('No token provided.', 400);

    var sessions = firestoreQuery_('sessions', [{ field: 'token', op: '==', value: hashToken_(token) }]);
    if (sessions.length > 0) {
      firestoreDelete_('sessions', sessions[0]._id);
    }
    return successResponse(null, 'Logged out successfully.');
  } catch (e) {
    logError('Auth', 'logoutUser', e);
    return errorResponse('Logout failed.', 500);
  }
}

/**
 * Validates a session token and returns session data.
 * Called by Code.gs before every API operation.
 * @param {string} token - The raw session token from the client.
 * @returns {Object|null} Session object or null if invalid/expired.
 */
function validateSession(token) {
  try {
    if (!token) return null;
    var hashed = hashToken_(token);
    var sessions = firestoreQuery_('sessions', [{ field: 'token', op: '==', value: hashed }]);
    if (sessions.length === 0) return null;

    var session = sessions[0];
    var expiry = new Date(session.expiresAt);
    if (expiry < new Date()) {
      // Session expired — clean up
      firestoreDelete_('sessions', session._id);
      return null;
    }

    // Slide the session TTL on activity
    var newExpiry = new Date();
    newExpiry.setHours(newExpiry.getHours() + SESSION_TTL_HOURS);
    firestoreUpdate_('sessions', session._id, { expiresAt: newExpiry.toISOString() });

    return session;
  } catch (e) {
    logError('Auth', 'validateSession', e);
    return null;
  }
}

/**
 * Returns the current user's profile information.
 * @param {Object} params - { token }
 * @returns {Object}
 */
function getCurrentUser(params) {
  try {
    var session = validateSession(params.token);
    if (!session) return errorResponse('Unauthorised.', 401);

    var user = firestoreGet_('users', session.userId);
    if (!user) return errorResponse('User not found.', 404);

    var result = {
      userId: user._id,
      email: user.email,
      role: user.role,
      fullName: user.fullName,
      memberId: user.memberId || null,
      lastLogin: user.lastLogin || null,
      isActive: user.isActive
    };

    if (user.memberId) {
      var member = firestoreGet_('members', user.memberId);
      if (member) {
        result.memberDetails = {
          memberNumber: member.memberNumber,
          fullName: member.fullName,
          passportPhotoUrl: member.passportPhotoUrl,
          phone: member.phone,
          status: member.status
        };
      }
    }

    return successResponse(result);
  } catch (e) {
    logError('Auth', 'getCurrentUser', e);
    return errorResponse('Failed to retrieve user.', 500);
  }
}

/**
 * Updates the current user's own profile.
 * @param {Object} params - { token, fullName, email, password? }
 * @returns {Object}
 */
function updateProfile(params) {
  try {
    var session = validateSession(params.token);
    if (!session) return errorResponse('Unauthorised.', 401);

    var user = firestoreGet_('users', session.userId);
    if (!user) return errorResponse('User not found.', 404);

    var updates = { updatedAt: new Date().toISOString() };
    
    if (params.fullName) {
      updates.fullName = String(params.fullName).trim();
    }
    
    if (params.email) {
      var newEmail = String(params.email).trim().toLowerCase();
      if (!isValidEmail(newEmail)) return errorResponse('Invalid email address.', 400);
      
      if (newEmail !== user.email) {
        // Check for duplicate
        var existing = firestoreQuery_('users', [{ field: 'email', op: '==', value: newEmail }]);
        if (existing.length > 0) return errorResponse('Email already in use.', 409);
        updates.email = newEmail;
      }
    }
    
    if (params.password && params.password.length >= 8) {
      updates.passwordHash = hashPassword(params.password);
    } else if (params.password && params.password.length < 8) {
      return errorResponse('Password must be at least 8 characters long.', 400);
    }

    firestoreUpdate_('users', user._id, updates);

    // If the user is also a member, we might want to sync their email/phone, 
    // but the request was "edit everything including email addresses" on the user dashboard.
    // Syncing member profile is optional but good practice if memberId exists.
    if (user.memberId && updates.email) {
       firestoreUpdate_('members', user.memberId, { email: updates.email, updatedAt: new Date().toISOString() });
    }

    logAction_('UPDATE_PROFILE', 'Auth', session.userId, session.userId, user, updates);
    return successResponse(null, 'Profile updated successfully.');
  } catch (e) {
    logError('Auth', 'updateProfile', e);
    return errorResponse('Failed to update profile.', 500);
  }
}

/**
 * Changes a user's own password.
 * @param {Object} params - { token, currentPassword, newPassword, confirmPassword }
 * @returns {Object}
 */
function changePassword(params) {
  try {
    var session = validateSession(params.token);
    if (!session) return errorResponse('Unauthorised.', 401);

    var current = String(params.currentPassword || '');
    var newPw   = String(params.newPassword || '');
    var confirm = String(params.confirmPassword || '');

    if (!current || !newPw || !confirm) {
      return errorResponse('All password fields are required.', 400);
    }
    if (newPw !== confirm) {
      return errorResponse('New password and confirmation do not match.', 400);
    }
    if (newPw.length < 8) {
      return errorResponse('Password must be at least 8 characters long.', 400);
    }

    var user = firestoreGet_('users', session.userId);
    if (!user) return errorResponse('User not found.', 404);

    if (!verifyPassword(current, user.passwordHash)) {
      return errorResponse('Current password is incorrect.', 400);
    }

    firestoreUpdate_('users', user._id, {
      passwordHash: hashPassword(newPw),
      requirePasswordChange: false,
      updatedAt: new Date().toISOString()
    });

    logAction_('CHANGE_PASSWORD', 'Auth', session.userId, session.userId, null, null);
    return successResponse(null, 'Password changed successfully.');
  } catch (e) {
    logError('Auth', 'changePassword', e);
    return errorResponse('Password change failed.', 500);
  }
}

/**
 * Initiates a password reset for a user (sends a temporary password via email).
 * @param {Object} params - { email }
 * @returns {Object}
 */
function forgotPassword(params) {
  try {
    var email = String(params.email || '').trim().toLowerCase();
    if (!isValidEmail(email)) return errorResponse('Please provide a valid email address.', 400);

    var users = firestoreQuery_('users', [{ field: 'email', op: '==', value: email }]);
    // Always return success even if email not found (security)
    if (users.length === 0) {
      return successResponse(null, 'If this email exists in our system, a reset link has been sent.');
    }
    var user = users[0];

    var tempPw = generateTempPassword(10);
    firestoreUpdate_('users', user._id, {
      passwordHash: hashPassword(tempPw),
      requirePasswordChange: true,
      updatedAt: new Date().toISOString()
    });

    var societyName = getSystemSetting_('societyName') || 'Cooperative Society';
    var subject = societyName + ' — Password Reset';
    var body = 'Dear ' + (user.fullName || 'Member') + ',\n\n' +
               'Your temporary password is: ' + tempPw + '\n\n' +
               'Please log in and change your password immediately.\n\n' +
               'If you did not request this, please contact the administrator immediately.\n\n' +
               'Regards,\n' + societyName;
    sendEmail(email, subject, body);

    logAction_('FORGOT_PASSWORD', 'Auth', null, user._id, null, { email: email });
    return successResponse(null, 'If this email exists in our system, a reset link has been sent.');
  } catch (e) {
    logError('Auth', 'forgotPassword', e);
    return errorResponse('Password reset failed.', 500);
  }
}

/**
 * Admin resets another user's password.
 * @param {Object} params - { token, userId }
 * @returns {Object}
 */
function adminResetPassword(params) {
  try {
    var session = validateSession(params.token);
    if (!session) return errorResponse('Unauthorised.', 401);
    if (!hasPermission_(session.role, 'reset_password')) {
      return errorResponse('Insufficient permissions.', 403);
    }

    var targetUser = firestoreGet_('users', params.userId);
    if (!targetUser) return errorResponse('User not found.', 404);

    var tempPw = generateTempPassword(10);
    firestoreUpdate_('users', params.userId, {
      passwordHash: hashPassword(tempPw),
      requirePasswordChange: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: new Date().toISOString()
    });

    // Email the temp password
    var societyName = getSystemSetting_('societyName') || 'Cooperative Society';
    sendEmail(targetUser.email,
      societyName + ' — Password Reset by Administrator',
      'Your password has been reset by an administrator.\n\nTemporary password: ' + tempPw +
      '\n\nPlease log in and change it immediately.\n\nRegards,\n' + societyName);

    logAction_('ADMIN_RESET_PASSWORD', 'Auth', session.userId, params.userId, null, null);
    return successResponse({ tempPassword: tempPw }, 'Password reset successfully.');
  } catch (e) {
    logError('Auth', 'adminResetPassword', e);
    return errorResponse('Password reset failed.', 500);
  }
}

/**
 * Unlocks a locked user account.
 * @param {Object} params - { token, userId }
 * @returns {Object}
 */
function unlockAccount(params) {
  try {
    var session = validateSession(params.token);
    if (!session) return errorResponse('Unauthorised.', 401);
    if (!hasPermission_(session.role, 'manage_users')) {
      return errorResponse('Insufficient permissions.', 403);
    }

    firestoreUpdate_('users', params.userId, {
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: new Date().toISOString()
    });

    logAction_('UNLOCK_ACCOUNT', 'Auth', session.userId, params.userId, null, null);
    return successResponse(null, 'Account unlocked.');
  } catch (e) {
    logError('Auth', 'unlockAccount', e);
    return errorResponse('Failed to unlock account.', 500);
  }
}

// ─── USER MANAGEMENT ─────────────────────────────────────────────────────────

/**
 * Creates a new user account (admin only).
 * @param {Object} params - { token, email, password, role, fullName, memberId? }
 * @returns {Object}
 */
function createUser(params) {
  try {
    var session = validateSession(params.token);
    if (!session) return errorResponse('Unauthorised.', 401);
    if (!hasPermission_(session.role, 'manage_users')) {
      return errorResponse('Insufficient permissions.', 403);
    }

    var email = String(params.email || '').trim().toLowerCase();
    if (!isValidEmail(email)) return errorResponse('Invalid email address.', 400);

    // Check for duplicate email
    var existing = firestoreQuery_('users', [{ field: 'email', op: '==', value: email }]);
    if (existing.length > 0) return errorResponse('A user with this email already exists.', 409);

    var password = params.password || generateTempPassword(10);
    var userId = generateId('USR', 'users');

    var userData = {
      email:                email,
      fullName:             String(params.fullName || ''),
      role:                 String(params.role || 'member'),
      passwordHash:         hashPassword(password),
      memberId:             params.memberId || null,
      isActive:             true,
      requirePasswordChange: true,
      failedLoginAttempts:  0,
      lockedUntil:          null,
      lastLogin:            null,
      createdBy:            session.userId,
      createdAt:            new Date().toISOString(),
      updatedAt:            new Date().toISOString()
    };

    firestoreCreate_('users', userData, userId);

    logAction_('CREATE_USER', 'Auth', session.userId, userId, null, { email: email, role: params.role });
    return successResponse({ userId: userId, tempPassword: password }, 'User created successfully.');
  } catch (e) {
    logError('Auth', 'createUser', e);
    return errorResponse('Failed to create user.', 500);
  }
}

/**
 * Updates a user account.
 * @param {Object} params - { token, userId, role?, isActive?, fullName? }
 * @returns {Object}
 */
function updateUser(params) {
  try {
    var session = validateSession(params.token);
    if (!session) return errorResponse('Unauthorised.', 401);
    if (!hasPermission_(session.role, 'manage_users')) {
      return errorResponse('Insufficient permissions.', 403);
    }

    var user = firestoreGet_('users', params.userId);
    if (!user) return errorResponse('User not found.', 404);

    var updates = { updatedAt: new Date().toISOString() };
    if (params.role     !== undefined) updates.role     = params.role;
    if (params.isActive !== undefined) updates.isActive = params.isActive;
    if (params.fullName !== undefined) updates.fullName = params.fullName;
    if (params.memberId !== undefined) updates.memberId = params.memberId;

    firestoreUpdate_('users', params.userId, updates);
    logAction_('UPDATE_USER', 'Auth', session.userId, params.userId, user, updates);
    return successResponse(null, 'User updated successfully.');
  } catch (e) {
    logError('Auth', 'updateUser', e);
    return errorResponse('Failed to update user.', 500);
  }
}

/**
 * Gets all users (admin only).
 * @param {Object} params - { token, page?, pageSize?, search? }
 * @returns {Object}
 */
function getUsers(params) {
  try {
    var session = validateSession(params.token);
    if (!session) return errorResponse('Unauthorised.', 401);
    if (!hasPermission_(session.role, 'view_users')) {
      return errorResponse('Insufficient permissions.', 403);
    }

    var users = firestoreGetAll_('users');
    
    // Filter out developer and super_admin unless the requester is one of them
    if (session.role !== 'developer' && session.role !== 'super_admin') {
      users = users.filter(function(u) {
        return u.role !== 'developer' && u.role !== 'super_admin';
      });
    }

    // Mask password hashes
    users = users.map(function(u) {
      delete u.passwordHash;
      return u;
    });

    if (params.search) {
      users = searchFilter(users, params.search, ['email', 'fullName', 'role']);
    }
    users.sort(function(a, b) { return (a.fullName || '').localeCompare(b.fullName || ''); });
    return successResponse(paginate(users, params.page, params.pageSize));
  } catch (e) {
    logError('Auth', 'getUsers', e);
    return errorResponse('Failed to retrieve users.', 500);
  }
}

// ─── INITIALISATION ───────────────────────────────────────────────────────────

/**
 * Creates the initial Developer account.
 * Called ONCE by initPortal() at first deployment.
 *
 * SECURITY MODEL:
 * - The developer is ALWAYS the first account created.
 * - The developer must log in and change this password before any other
 *   accounts are created. This prevents the super_admin default credentials
 *   from being exposed before the system is properly secured.
 * - After the developer logs in and confirms the system is working,
 *   they should call initSuperAdmin() from the Apps Script editor
 *   to provision the Super Administrator.
 */
function initDeveloper() {
  try {
    var existing = firestoreQuery_('users', [{ field: 'role', op: '==', value: 'developer' }]);
    if (existing.length > 0) {
      Logger.log('Developer account already exists. Skipping.');
      return;
    }

    var devId  = 'developer-001';
    var devPw  = 'Dev@Portal2026!'; // Must be changed on first login
    firestoreCreate_('users', {
      email:                 'developer@cooperativeportal.com',
      fullName:              'System Developer',
      role:                  'developer',
      passwordHash:          hashPassword(devPw),
      memberId:              null,
      isActive:              true,
      requirePasswordChange: true,   // Forces password change on first login
      failedLoginAttempts:   0,
      lockedUntil:           null,
      lastLogin:             null,
      createdBy:             'system',
      createdAt:             new Date().toISOString(),
      updatedAt:             new Date().toISOString()
    }, devId);

    Logger.log('Developer account created.');
    Logger.log('  Email:    developer@cooperativeportal.com');
    Logger.log('  Password: Dev@Portal2026!');
    Logger.log('  >>> LOG IN AS DEVELOPER FIRST. Change password. Then run initSuperAdmin().');
  } catch (e) {
    logError('Auth', 'initDeveloper', e);
    throw e;
  }
}

/**
 * Creates the Super Administrator account.
 *
 * SECURITY MODEL:
 * - This function must ONLY be run by the developer AFTER they have:
 *   1. Logged in to the developer dashboard successfully.
 *   2. Changed the developer account password.
 *   3. Verified that Firebase connectivity is working.
 * - Do NOT call this from initPortal(). It is intentionally decoupled.
 *
 * HOW TO RUN:
 *   Apps Script Editor → select 'initSuperAdmin' from the function dropdown → ▶ Run
 *   — or —
 *   Developer Dashboard → Dev Tools → Run Server Function (if implemented)
 */
function initSuperAdmin() {
  try {
    var existing = firestoreQuery_('users', [{ field: 'role', op: '==', value: 'super_admin' }]);
    if (existing.length > 0) {
      Logger.log('Super Admin already exists. Skipping.');
      return;
    }

    var adminId   = 'super-admin-001';
    var defaultPw = 'Admin@1234'; // Super Admin MUST change this on first login
    firestoreCreate_('users', {
      email:                 'admin@cooperativeportal.com',
      fullName:              'Super Administrator',
      role:                  'super_admin',
      passwordHash:          hashPassword(defaultPw),
      memberId:              null,
      isActive:              true,
      requirePasswordChange: true,
      failedLoginAttempts:   0,
      lockedUntil:           null,
      lastLogin:             null,
      createdBy:             'developer',
      createdAt:             new Date().toISOString(),
      updatedAt:             new Date().toISOString()
    }, adminId);

    Logger.log('Super Admin account created.');
    Logger.log('  Email:    admin@cooperativeportal.com');
    Logger.log('  Password: Admin@1234');
    Logger.log('  >>> Super Admin must change password on first login.');
  } catch (e) {
    logError('Auth', 'initSuperAdmin', e);
    throw e;
  }
}

// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

/**
 * Creates a session in Firestore and returns the raw token.
 * @param {Object}  user          - User document from Firestore.
 * @param {boolean} tempSession   - If true, marks session as temporary.
 * @returns {string} Raw token (sent to client).
 */
function createSession_(user, tempSession) {
  var rawToken = generateToken();
  var hashedToken = hashToken_(rawToken);
  var expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + (tempSession ? 1 : SESSION_TTL_HOURS));

  var sessionId = generateId('SES', 'sessions');
  firestoreCreate_('sessions', {
    token:      hashedToken,
    userId:     user._id,
    role:       user.role,
    memberId:   user.memberId || null,
    fullName:   user.fullName || '',
    email:      user.email,
    isTemp:     tempSession || false,
    expiresAt:  expiresAt.toISOString(),
    createdAt:  new Date().toISOString()
  }, sessionId);

  return rawToken;
}

/**
 * Hashes a session token for secure storage.
 * @param {string} token
 * @returns {string}
 */
function hashToken_(token) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token);
  return digest.map(function(b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('');
}

/**
 * Handles a failed login attempt — increments counter and locks if needed.
 * @param {Object} user - User document.
 */
function handleFailedLogin_(user) {
  var attempts = (user.failedLoginAttempts || 0) + 1;
  var updates = { failedLoginAttempts: attempts, updatedAt: new Date().toISOString() };

  if (attempts >= MAX_FAILED_ATTEMPTS) {
    var lockUntil = new Date();
    lockUntil.setMinutes(lockUntil.getMinutes() + LOCK_DURATION_MINUTES);
    updates.lockedUntil = lockUntil.toISOString();
  }
  firestoreUpdate_('users', user._id, updates);
}

// ─── PERMISSION SYSTEM ────────────────────────────────────────────────────────

/**
 * Checks if a role has a specific permission.
 * Centralised RBAC map for the entire application.
 * @param {string} role
 * @param {string} permission
 * @returns {boolean}
 */
function hasPermission_(role, permission) {
  var PERMISSIONS = {
    developer: ['*'], // Complete system access
    super_admin: ['*'], // All permissions
    admin: [
      'view_dashboard', 'manage_members', 'view_members',
      'manage_contributions', 'view_contributions',
      'manage_savings', 'view_savings',
      'manage_loans', 'view_loans', 'approve_loans',
      'manage_repayments', 'view_repayments',
      'view_transactions', 'manage_transactions',
      'view_reports', 'export_reports',
      'view_notifications', 'manage_notifications',
      'view_audit', 'manage_settings', 'view_settings',
      'manage_users', 'view_users', 'reset_password',
      'manage_documents', 'generate_receipts'
    ],
    accountant: [
      'view_dashboard', 'view_members',
      'manage_contributions', 'view_contributions',
      'manage_savings', 'view_savings',
      'manage_repayments', 'view_repayments',
      'view_transactions', 'manage_transactions',
      'view_reports', 'export_reports',
      'view_settings', 'generate_receipts'
    ],
    loan_officer: [
      'view_dashboard', 'view_members',
      'view_contributions', 'view_savings',
      'manage_loans', 'view_loans', 'recommend_loans',
      'view_repayments', 'view_transactions',
      'view_reports', 'export_reports', 'view_settings'
    ],
    auditor: [
      'view_dashboard', 'view_members',
      'view_contributions', 'view_savings',
      'view_loans', 'view_repayments',
      'view_transactions', 'view_reports',
      'export_reports', 'view_audit', 'view_settings'
    ],
    member: [
      'view_own_dashboard', 'view_own_contributions',
      'view_own_savings', 'view_own_loans',
      'view_own_repayments', 'view_own_transactions',
      'view_own_notifications', 'view_own_documents',
      'apply_loan', 'view_own_receipts'
    ]
  };

  if (!role || !PERMISSIONS[role]) return false;
  var perms = PERMISSIONS[role];
  if (perms.indexOf('*') !== -1) return true;
  return perms.indexOf(permission) !== -1;
}

/**
 * Authorisation middleware.
 * Use at the top of every API function.
 * @param {string} token
 * @param {string} requiredPermission
 * @returns {{ session: Object|null, error: Object|null }}
 */
function authorise_(token, requiredPermission) {
  var session = validateSession(token);
  if (!session) return { session: null, error: errorResponse('Unauthorised. Please log in.', 401) };
  if (requiredPermission && !hasPermission_(session.role, requiredPermission)) {
    return { session: null, error: errorResponse('You do not have permission to perform this action.', 403) };
  }
  return { session: session, error: null };
}

/**
 * Developer/Admin action: Forces a specific user's sessions to end.
 * @param {Object} params - { token, targetEmail }
 * @returns {Object}
 */
function forceLogoutUser(params) {
  try {
    var auth = authorise_(params.token, '*'); // Only developer or super_admin
    if (auth.error) return auth.error;
    if (auth.session.role !== 'developer' && auth.session.role !== 'super_admin') {
      return errorResponse('Access denied. Developer action.', 403);
    }
    
    var email = String(params.targetEmail || '').trim().toLowerCase();
    if (!email) return errorResponse('Target email required.', 400);

    var sessions = firestoreQuery_('sessions', [{ field: 'email', op: '==', value: email }]);
    var count = 0;
    for (var i = 0; i < sessions.length; i++) {
      firestoreDelete_('sessions', sessions[i]._id);
      count++;
    }

    logAction_('FORCE_LOGOUT', 'Auth', auth.session.userId, null, null, { targetEmail: email, sessionsTerminated: count });
    return successResponse({ sessionsTerminated: count }, 'Forced logout applied.');
  } catch (e) {
    logError('Auth', 'forceLogoutUser', e);
    return errorResponse('Failed to force logout.', 500);
  }
}

/**
 * Developer action: Get active sessions.
 * @param {Object} params - { token }
 * @returns {Object}
 */
function getActiveSessions(params) {
  try {
    var auth = authorise_(params.token, '*');
    if (auth.error) return auth.error;
    if (auth.session.role !== 'developer' && auth.session.role !== 'super_admin') {
      return errorResponse('Access denied.', 403);
    }

    var sessions = firestoreQuery_('sessions', []);
    var active = sessions.map(function(s) {
      return {
        email: s.email,
        role: s.role,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        isTemp: s.isTemp
      };
    });

    return successResponse(active);
  } catch (e) {
    logError('Auth', 'getActiveSessions', e);
    return errorResponse('Failed to get sessions.', 500);
  }
}
