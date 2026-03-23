/**
 * app.js -- Demo Orchestration & UI
 *
 * This is the application glue layer. It imports the two integration
 * modules (ishield.js and umfa.js) and wires them to the UI.
 *
 * A partner integrating iShield + Passkeys+ into their own app would
 * primarily study ishield.js and umfa.js. This file is demo-specific
 * and handles screens, flash messages, popups, and event listeners.
 *
 * FLOW:
 *   1. Trust Device  -- webauthnEnroll() then enroll() with Passkeys+
 *   2. Login         -- authenticate() with Passkeys+ (no USB key needed)
 *   3. Actions       -- step-up authenticate() per protected action
 *   4. Suspend       -- flag device as suspended, require iShield to reactivate
 *
 * NOTE: state.js is loaded as a classic script (non-module) so that the
 * State class is available as a global. The stateChange custom events it
 * dispatches are available but unused in this demo.
 */

import {
  hasLocalEnrollmentMarker,
  ENROLLMENT_MARKER_PREFIX,
  isSuspended,
  setSuspended,
  getPasskeysToggle,
  setPasskeysToggle,
  webauthnEnroll,
  webauthnAuthenticate
} from './ishield.js';

import {
  initializeZSMClient,
  checkAllEnrollment,
  enroll,
  authenticate,
  resetClient
} from './umfa.js';

// ---------------------------------------------------------------------------
// Shared UI helpers
// ---------------------------------------------------------------------------

function showFlash(elementId, message, state, duration = 3000) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = message;
  el.className = 'flash ' + state;
  setTimeout(() => { el.textContent = ''; el.className = 'flash'; }, duration);
}

function getUsername() {
  return document.getElementById('username')?.value?.trim().toLowerCase() || '';
}

// ---------------------------------------------------------------------------
// Confirmation Popup helpers
// ---------------------------------------------------------------------------
let popupResolve = null;
let popupPreviousFocus = null;

function showPopup(message) {
  return new Promise((resolve) => {
    popupPreviousFocus = document.activeElement;
    document.getElementById('popup-message').textContent = message;
    const popup = document.getElementById('confirm-popup');
    popup.style.display = 'flex';
    popupResolve = resolve;
    document.getElementById('popup-continue').focus();
    document.addEventListener('keydown', popupKeyHandler);
  });
}

function popupKeyHandler(e) {
  if (e.key === 'Escape') {
    hidePopup('cancel');
    return;
  }
  if (e.key === 'Tab') {
    const cancelBtn = document.getElementById('popup-cancel');
    const continueBtn = document.getElementById('popup-continue');
    if (e.shiftKey && document.activeElement === cancelBtn) {
      e.preventDefault();
      continueBtn.focus();
    } else if (!e.shiftKey && document.activeElement === continueBtn) {
      e.preventDefault();
      cancelBtn.focus();
    }
  }
}

function hidePopup(action) {
  document.removeEventListener('keydown', popupKeyHandler);
  document.getElementById('confirm-popup').style.display = 'none';
  if (popupPreviousFocus) {
    popupPreviousFocus.focus();
    popupPreviousFocus = null;
  }
  if (popupResolve) {
    popupResolve(action);
    popupResolve = null;
  }
}

// ---------------------------------------------------------------------------
// Challenge display helpers (UI-only -- not called from ishield.js or umfa.js)
// ---------------------------------------------------------------------------

function updateChallengeDisplay(challenge, signedChallenge) {
  const PREVIEW_LEN = 15;
  const isReset = challenge === '--';
  const container = document.getElementById('passkeys-challenge-display');
  const prev = document.getElementById('challenge-preview');
  const full = document.getElementById('challenge-full');
  const sPrev = document.getElementById('signed-challenge-preview');
  const sFull = document.getElementById('signed-challenge-full');
  if (prev && full) {
    prev.textContent = challenge.substring(0, PREVIEW_LEN) + (challenge.length > PREVIEW_LEN ? '...' : '');
    full.textContent = challenge;
  }
  if (sPrev && sFull) {
    sPrev.textContent = signedChallenge.substring(0, PREVIEW_LEN) + (signedChallenge.length > PREVIEW_LEN ? '...' : '');
    sFull.textContent = signedChallenge;
  }
  if (container) container.hidden = isReset;
  document.getElementById('challenge-details')?.removeAttribute('open');
  document.getElementById('signed-challenge-details')?.removeAttribute('open');
}

function updateIShieldChallengeDisplay(challenge, signedChallenge) {
  const PREVIEW_LEN = 15;
  const container = document.getElementById('ishield-challenge-display');
  const prev = document.getElementById('ishield-challenge-preview');
  const full = document.getElementById('ishield-challenge-full');
  const sPrev = document.getElementById('ishield-signed-challenge-preview');
  const sFull = document.getElementById('ishield-signed-challenge-full');
  if (prev && full) {
    prev.textContent = challenge.substring(0, PREVIEW_LEN) + (challenge.length > PREVIEW_LEN ? '...' : '');
    full.textContent = challenge;
  }
  if (sPrev && sFull) {
    sPrev.textContent = signedChallenge.substring(0, PREVIEW_LEN) + (signedChallenge.length > PREVIEW_LEN ? '...' : '');
    sFull.textContent = signedChallenge;
  }
  if (container) container.hidden = false;
  document.getElementById('ishield-challenge-details')?.removeAttribute('open');
  document.getElementById('ishield-signed-challenge-details')?.removeAttribute('open');
}

function updateAuthIcons({ ishield = false, zsm = false, passkeys = false } = {}) {
  document.getElementById('icon-ishield').hidden = !ishield;
  document.getElementById('icon-zsm').hidden = !zsm;
  document.getElementById('icon-passkeys').hidden = !passkeys;
  const ishieldDisplay = document.getElementById('ishield-challenge-display');
  if (ishieldDisplay) ishieldDisplay.hidden = !ishield;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const STATE = new State({
  loginID: null
});

// ---------------------------------------------------------------------------
// Action labels for protected actions
// ---------------------------------------------------------------------------
const PROTECTED_ACTION_LABELS = {
  'make-payment': 'Make Payment',
  'transfer-money': 'Transfer Money',
  'change-setting': 'Change Setting',
  'add-beneficiary': 'Add Beneficiary'
};

// ---------------------------------------------------------------------------
// Wave mode — fetch user profile from backend
// ---------------------------------------------------------------------------
async function fetchWaveProfile(email) {
  if (!email || email === '--') return;
  try {
    const res = await fetch(`/api/user?email=${encodeURIComponent(email)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const name = [data.firstName, data.lastName].filter(Boolean).join(' ') || '--';
    document.getElementById('wave-name').textContent = name;
    document.getElementById('wave-email').textContent = data.email || email;
    document.getElementById('wave-balance').textContent = data.balance != null ? `$${data.balance.toLocaleString()}` : '--';
  } catch (err) {
    console.error('[Wave] Failed to fetch profile:', err);
  }
}

// ---------------------------------------------------------------------------
// showScreen — simple screen switcher
// ---------------------------------------------------------------------------
const SCREEN_ANNOUNCEMENTS = {
  'SETUP': 'Setup screen. Enter your user ID and trust this device.',
  'LOGIN': 'Login screen. Authenticate to continue.',
  'ACTIONS': 'Actions screen. You are logged in.'
};

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    s.setAttribute('aria-hidden', 'true');
  });
  const target = document.getElementById(screenId);
  if (target) {
    target.classList.add('active');
    target.setAttribute('aria-hidden', 'false');
  }

  // Username field is readonly on ACTIONS screen, and on LOGIN when "New" is off (existing user)
  const usernameEl = document.getElementById('username');
  const isNew = document.getElementById('new-user-toggle').checked;
  usernameEl.readOnly = (screenId === 'ACTIONS') || (screenId === 'LOGIN' && !isNew);

  // Hide "New" toggle on ACTIONS screen (irrelevant once logged in)
  const newToggle = document.getElementById('new-user-toggle-container');
  if (newToggle) newToggle.hidden = (screenId === 'ACTIONS');

  // Wave mode: update banner text based on screen
  const isWaveMode = document.body.dataset.waveMode === 'true';
  if (isWaveMode) {
    const headline = document.getElementById('wave-banner-headline');
    const subtitle = document.getElementById('wave-banner-subtitle');
    if (screenId === 'ACTIONS') {
      headline.textContent = 'ONE AUTHENTICATION. ALL NIGHT ACCESS.';
      subtitle.textContent = 'Your iShield trust is active and extended to this device.';
      subtitle.hidden = false;
    } else {
      headline.textContent = 'Use your iShield Key and email provided at the booth';
      subtitle.hidden = true;
    }
  }

  // Wave mode: on ACTIONS screen, show profile card instead of action buttons
  if (screenId === 'ACTIONS' && isWaveMode) {
    document.getElementById('default-actions').hidden = true;
    document.getElementById('wave-profile').hidden = false;
    // Hide username row, challenge displays
    document.querySelector('.username-row').hidden = true;
    document.getElementById('ishield-challenge-display').hidden = true;
    document.getElementById('passkeys-challenge-display').hidden = true;
    // Populate email from username
    const email = document.getElementById('username')?.value?.trim() || '--';
    document.getElementById('wave-email').textContent = email;
    // Fetch user profile data
    fetchWaveProfile(email);
    // Show CTA banner
    document.getElementById('wave-cta-banner').hidden = false;
  } else {
    document.getElementById('default-actions').hidden = false;
    document.getElementById('wave-profile').hidden = true;
    document.querySelector('.username-row').hidden = false;
    if (document.getElementById('wave-cta-banner')) {
      document.getElementById('wave-cta-banner').hidden = true;
    }
  }

  // Announce screen change to screen readers
  const announcer = document.getElementById('screen-announcer');
  if (announcer) announcer.textContent = SCREEN_ANNOUNCEMENTS[screenId] || '';
}

// ---------------------------------------------------------------------------
// updateUI — detect state and show correct screen + pills
// ---------------------------------------------------------------------------
async function updateUI() {
  const user = getUsername();

  // Check iShield enrollment marker (localStorage — may be absent on Device B)
  const hasIShield = user ? hasLocalEnrollmentMarker(user) : false;

  // Check ZSM & Passkey status (SDK)
  let hasZSM = false;
  let hasPasskey = false;
  if (user) {
    try {
      await initializeZSMClient(user);
      const status = await checkAllEnrollment(user);
      if (status && !(status instanceof Error)) {
        hasZSM = status.hasZSMCred === true || !!status.zsmCredID;
        hasPasskey = status.hasRemotePasskey === true;
      }
    } catch (_) {}
  }

  // Update status pills
  function setPill(el, value) {
    el.textContent = value;
    const pill = el.closest('.pill');
    pill.classList.remove('pill-success', 'pill-danger', 'pill-neutral', 'pill-unknown');
    if (value === 'true' || value === 'Active') pill.classList.add('pill-success');
    else if (value === 'false' || value === 'Suspended') pill.classList.add('pill-danger');
    else if (value === 'unknown') pill.classList.add('pill-unknown');
    else pill.classList.add('pill-neutral');
  }

  setPill(document.getElementById('ishield-status'), !user ? '--' : (hasIShield ? 'true' : 'unknown'));
  setPill(document.getElementById('zsm-status'), !user ? '--' : (hasZSM ? 'true' : 'false'));
  setPill(document.getElementById('passkey-status'), !user ? '--' : (hasPasskey ? 'true' : 'false'));

  // Passkeys+ pill — iShield is no longer required (credential lives on the key)
  const fullyEnrolled = hasZSM && hasPasskey;
  const suspended = isSuspended(user);
  const ppStatus = !user || !fullyEnrolled ? 'Not Enrolled' : (suspended ? 'Suspended' : 'Active');
  setPill(document.getElementById('passkeys-plus-status'), ppStatus);

  // Suspend button — enabled only when fully enrolled and not already suspended
  document.getElementById('suspend-device').disabled = !(fullyEnrolled && !suspended);

  // Restore Use Passkeys toggle state
  // On ACTIONS: disable if no passkey registered (can't use what doesn't exist)
  // On LOGIN/SETUP: keep enabled so user can opt into passkeys enrollment
  const passkeysToggleEl = document.getElementById('use-passkeys-toggle');
  if (!hasPasskey && STATE.loginID) {
    passkeysToggleEl.checked = false;
    passkeysToggleEl.disabled = true;
  } else {
    passkeysToggleEl.checked = getPasskeysToggle(user);
    passkeysToggleEl.disabled = false;
  }

  // Enable/disable Trust Device button
  document.getElementById('trust-device-btn').disabled = !user;

  // Login button text based on suspended state
  const loginBtn = document.getElementById('login-btn');
  if (loginBtn) loginBtn.textContent = suspended ? 'Reactivate & Login' : 'Login';

  // If ZSM is present, this user is already enrolled — force New off and disable toggle
  const newToggleEl = document.getElementById('new-user-toggle');
  const isRegisterMode = new URLSearchParams(window.location.search).get('action') === 'register';
  if (hasZSM && !isRegisterMode) {
    newToggleEl.checked = false;
    newToggleEl.disabled = true;
  } else {
    newToggleEl.disabled = false;
  }

  // In register mode, always force New on to show SETUP screen
  if (isRegisterMode) {
    newToggleEl.checked = true;
  }

  // Determine which screen to show — driven by "New" toggle, not server-side passkey
  const isNewUser = newToggleEl.checked;
  if (STATE.loginID) {
    showScreen('ACTIONS');
  } else if (isNewUser) {
    showScreen('SETUP');
  } else {
    showScreen('LOGIN');
  }
}

// ---------------------------------------------------------------------------
// trustDevice — enroll USB key then ZSM+Passkeys
// ---------------------------------------------------------------------------
async function trustDevice() {
  const user = getUsername();
  if (!user) return;

  const btn = document.getElementById('trust-device-btn');
  btn.classList.add('loading');
  btn.setAttribute('aria-busy', 'true');
  btn.setAttribute('aria-disabled', 'true');

  try {
    // Step 1: Enroll iShield USB key (raw WebAuthn)
    showFlash('flash-status', 'Insert your iShield USB key...', 'success');
    try {
      await webauthnEnroll(user);
    } catch (err) {
      showFlash('flash-status',
        err.name === 'NotAllowedError' ? 'Cancelled or timed out' :
        err.name === 'SecurityError' ? 'Security error — try HTTPS or localhost' :
        err.name === 'InvalidStateError' ? 'Key already registered for this user' :
        err.message || 'iShield enrollment failed',
        'failure'
      );
      return;
    }

    // Verify enrollment succeeded (webauthnEnroll stores marker to localStorage)
    if (!hasLocalEnrollmentMarker(user)) {
      showFlash('flash-status', 'iShield enrollment failed or cancelled', 'failure');
      return;
    }

    // Step 2: Show confirmation popup before ZSM enrollment (skip in register mode)
    const isRegisterMode = new URLSearchParams(window.location.search).get('action') === 'register';
    if (!isRegisterMode) {
      const action = await showPopup("Now let's enroll with Passkeys+ (ZSM+Passkey)");
      if (action === 'cancel') {
        showFlash('flash-status', 'Passkeys+ enrollment cancelled', 'failure');
        await updateUI();
        return;
      }
    }

    // Step 3: Enroll ZSM + Passkeys+
    const usePasskeys = document.getElementById('use-passkeys-toggle').checked;
    showFlash('flash-status', usePasskeys ? 'Enrolling device with ZSM + Passkeys+...' : 'Enrolling device with ZSM...', 'success');
    await initializeZSMClient(user);
    const result = await enroll(user, usePasskeys);

    if (!result || result === false || result instanceof Error) {
      showFlash('flash-status', 'ZSM enrollment failed', 'failure');
      await updateUI();
      return;
    }

    // Success — update state and show actions
    STATE.loginID = user;
    if (isRegisterMode) {
      const redirectParams = new URLSearchParams(window.location.search);
      redirectParams.delete('action');
      redirectParams.set('msg', `${user} has iShield Key registered`);
      window.location.href = window.location.pathname + '?' + redirectParams.toString();
      return;
    }
    showFlash('flash-status', 'Device trusted successfully', 'success');
    await updateUI();

  } catch (err) {
    console.error('[trustDevice] Error:', err);
    showFlash('flash-status', 'Trust Device failed', 'failure');
    await updateUI();
  } finally {
    btn.classList.remove('loading');
    btn.removeAttribute('aria-busy');
    btn.removeAttribute('aria-disabled');
  }
}

// ---------------------------------------------------------------------------
// login — authenticate with Passkeys+ only
// ---------------------------------------------------------------------------
async function login() {
  const user = getUsername();
  if (!user) return;

  const btn = document.getElementById('login-btn');
  btn.classList.add('loading');
  btn.setAttribute('aria-busy', 'true');
  btn.setAttribute('aria-disabled', 'true');

  try {
    // Check if ZSM is bound locally. If not, this device needs iShield + enrollment.
    // User said they're not new (New toggle = OFF), so treat as existing user on new device.
    await initializeZSMClient(user);
    let hasLocalZSM = false;
    let hasPasskey = false;
    try {
      const status = await checkAllEnrollment(user);
      if (status && !(status instanceof Error)) {
        hasLocalZSM = status.hasZSMCred === true || !!status.zsmCredID;
        hasPasskey = status.hasRemotePasskey === true;
      }
    } catch (_) {}
    const needsBinding = !hasLocalZSM;

    if (needsBinding) {
      const action = await showPopup(
        'This device needs to be bound. Insert your iShield USB key.'
      );
      if (action === 'cancel') return;

      // Step 1: iShield authentication (discoverable credential)
      showFlash('flash-status', 'Touch your iShield USB key...', 'success', 60000);
      const ishieldResult = await webauthnAuthenticate(user);
      if (!ishieldResult.success) {
        showFlash('flash-status',
          ishieldResult.error?.name === 'NotAllowedError'
            ? 'Cancelled or timed out'
            : ishieldResult.error?.message || 'iShield authentication failed',
          'failure');
        return;
      }
      if (ishieldResult.clientDataHash) {
        updateIShieldChallengeDisplay(ishieldResult.clientDataHash, ishieldResult.signatureHex);
      }

      // Verify the key's credential matches the entered username
      if (ishieldResult.authenticatedUser && ishieldResult.authenticatedUser !== user) {
        showFlash('flash-status',
          `Wrong credential selected — key returned "${ishieldResult.authenticatedUser}" but you entered "${user}". Please try again and select the correct credential.`,
          'failure', 8000);
        return;
      }

      // Step 2: Enroll ZSM (+ Passkeys if toggle is on)
      const usePasskeys = document.getElementById('use-passkeys-toggle').checked;
      showFlash('flash-status', 'Binding device...', 'success');
      await initializeZSMClient(user);
      const enrollResult = await enroll(user, usePasskeys);

      if (!enrollResult || enrollResult === false || enrollResult instanceof Error) {
        showFlash('flash-status', 'Device binding failed', 'failure');
        return;
      }

      // Step 3: Store local enrollment marker so iShield pill shows 'true'
      localStorage.setItem(ENROLLMENT_MARKER_PREFIX + user, JSON.stringify({
        boundFromRemote: true,
        createdAt: new Date().toISOString()
      }));

      STATE.loginID = user;
      updateAuthIcons({ ishield: true, zsm: true, passkeys: usePasskeys });
      showFlash('flash-status', 'Device bound successfully', 'success');
      await updateUI();
      return;
    }

    // If suspended, require iShield + Passkeys+ to reactivate
    if (isSuspended(user)) {
      showFlash('flash-status', 'Device suspended — touch your iShield USB key to reactivate', 'success', 60000);

      const ishieldResult = await webauthnAuthenticate(user);
      if (!ishieldResult.success) {
        if (ishieldResult.error?.name === 'NotAllowedError') {
          showFlash('flash-status', 'Cancelled or timed out', 'failure');
        } else {
          showFlash('flash-status', ishieldResult.error?.message || 'Authentication failed', 'failure');
        }
        return;
      }
      updateIShieldChallengeDisplay(ishieldResult.clientDataHash, ishieldResult.signatureHex);

      // Verify the key's credential matches the entered username
      if (ishieldResult.authenticatedUser && ishieldResult.authenticatedUser !== user) {
        showFlash('flash-status',
          `Wrong credential selected — key returned "${ishieldResult.authenticatedUser}" but you entered "${user}". Please try again and select the correct credential.`,
          'failure', 8000);
        return;
      }

      const usePasskeys = document.getElementById('use-passkeys-toggle').checked;
      showFlash('flash-status', 'Authenticating to complete reactivation...', 'success');
      await initializeZSMClient(user);
      const reactivateResult = await authenticate(user, usePasskeys);
      if (!reactivateResult.success) {
        showFlash('flash-status', 'Reactivation failed', 'failure');
        return;
      }

      if (reactivateResult.challengeData) {
        updateChallengeDisplay(reactivateResult.challengeData.challenge, reactivateResult.challengeData.signedChallenge);
      }

      setSuspended(user, false);
      STATE.loginID = user;
      updateAuthIcons({ ishield: true, zsm: true, passkeys: usePasskeys });
      await updateUI();
      showFlash('flash-status', 'Device reactivated', 'success');
      return;
    }

    const usePasskeys = document.getElementById('use-passkeys-toggle').checked;
    await initializeZSMClient(user);

    // If user wants passkeys but none are enrolled yet, enroll them first
    if (usePasskeys && !hasPasskey) {
      showFlash('flash-status', 'Enrolling Passkeys+...', 'success');
      const enrollResult = await enroll(user, true);
      if (!enrollResult || enrollResult === false || enrollResult instanceof Error) {
        showFlash('flash-status', 'Passkeys+ enrollment failed', 'failure');
        return;
      }
      STATE.loginID = user;
      updateAuthIcons({ zsm: true, passkeys: true });
      showFlash('flash-status', 'Passkeys+ enrolled successfully', 'success');
      await updateUI();
      return;
    }

    const authResult = await authenticate(user, usePasskeys);

    if (!authResult.success) {
      showFlash('flash-status', 'Login failed', 'failure');
      return;
    }

    if (authResult.challengeData) {
      updateChallengeDisplay(authResult.challengeData.challenge, authResult.challengeData.signedChallenge);
    }

    STATE.loginID = user;
    updateAuthIcons({ zsm: true, passkeys: usePasskeys });
    await updateUI();
  } catch (err) {
    console.error('[login] Error:', err);
    showFlash('flash-status', 'Login failed', 'failure');
  } finally {
    btn.classList.remove('loading');
    btn.removeAttribute('aria-busy');
    btn.removeAttribute('aria-disabled');
  }
}

// ---------------------------------------------------------------------------
// handleProtectedAction
// ---------------------------------------------------------------------------
async function handleProtectedAction(actionKey) {
  const actionLabel = PROTECTED_ACTION_LABELS[actionKey] ?? 'Protected Action';

  if (!STATE.loginID) {
    showFlash('action-status', `${actionLabel} Failed`, 'failure', 2000);
    return;
  }

  const usePasskeys = document.getElementById('use-passkeys-toggle')?.checked === true;
  const authResult = await authenticate(STATE.loginID, usePasskeys);

  if (!authResult.success) {
    showFlash('action-status', `${actionLabel} Failed`, 'failure', 2000);
  } else {
    showFlash('action-status', `${actionLabel} Authorized`, 'success', 2000);
    if (authResult.challengeData) {
      updateChallengeDisplay(authResult.challengeData.challenge, authResult.challengeData.signedChallenge);
    }
    updateAuthIcons({ zsm: true, passkeys: usePasskeys });
  }
}

// ---------------------------------------------------------------------------
// logOut
// ---------------------------------------------------------------------------
async function logOut() {
  resetClient();
  STATE.reset();
  updateChallengeDisplay('--', '--');
  updateAuthIcons();
  await updateUI();
}

// ---------------------------------------------------------------------------
// purgeStorage
// ---------------------------------------------------------------------------
function purgeStorage() {
  const username = getUsername();
  localStorage.clear();
  sessionStorage.clear();
  if (username) localStorage.setItem('username', username);
  try { indexedDB.deleteDatabase('ideem'); } catch (_) { /* ignore */ }
  window.location.reload();
}

// ---------------------------------------------------------------------------
// suspendDevice — suspend Passkeys+ login, require iShield re-auth
// ---------------------------------------------------------------------------
async function suspendDevice() {
  const user = getUsername();
  if (!user) return;

  if (isSuspended(user)) return;

  const action = await showPopup('Suspend Passkeys+ login? You will need your iShield USB key to reactivate.');
  if (action === 'cancel') return;

  setSuspended(user, true);
  document.getElementById('new-user-toggle').checked = false;
  logOut();
  await updateUI();
}

// ---------------------------------------------------------------------------
// DOMContentLoaded — wire up event listeners
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  // Trust Device
  document.getElementById('trust-device-btn').addEventListener('click', () => trustDevice());

  // Login
  document.getElementById('login-btn').addEventListener('click', () => login());

  // Protected action buttons
  document.querySelectorAll('.btn-action').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      btn.classList.add('loading');
      btn.setAttribute('aria-busy', 'true');
      btn.setAttribute('aria-disabled', 'true');
      try {
        await handleProtectedAction(btn.dataset.action);
      } finally {
        btn.classList.remove('loading');
        btn.removeAttribute('aria-busy');
        btn.removeAttribute('aria-disabled');
      }
    });
  });

  // Persist Use Passkeys toggle state
  document.getElementById('use-passkeys-toggle').addEventListener('change', (e) => {
    setPasskeysToggle(getUsername(), e.target.checked);
  });

  // Log Out
  document.getElementById('logout-btn').addEventListener('click', () => logOut());

  // Suspend Device
  document.getElementById('suspend-device').addEventListener('click', () => suspendDevice());

  // Reset Device
  document.getElementById('reset-device').addEventListener('click', () => purgeStorage());

  // Confirmation Popup buttons
  document.getElementById('popup-continue').addEventListener('click', () => hidePopup('continue'));
  document.getElementById('popup-cancel').addEventListener('click', () => hidePopup('cancel'));

  // Restore username from localStorage
  const savedUsername = localStorage.getItem('username');
  if (savedUsername) {
    document.getElementById('username').value = savedUsername;
  }

  // Auto-populate from URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const urlEmail = urlParams.get('email');
  if (urlEmail) {
    document.getElementById('username').value = urlEmail;
    localStorage.setItem('username', urlEmail);
    document.getElementById('new-user-toggle').checked = true;
    document.getElementById('use-passkeys-toggle').checked = false;
    setPasskeysToggle(urlEmail, false);
  }

  // ?action=register — rename Trust Device button
  const actionParam = urlParams.get('action');
  if (actionParam === 'register') {
    document.getElementById('trust-device-btn').textContent = 'Register iShield Key';
  }

  // ?action=wave — wave mode (profile card instead of action buttons)
  if (actionParam === 'wave') {
    document.body.dataset.waveMode = 'true';
    document.getElementById('wave-banner').hidden = false;
    // Default passkeys to true in wave mode (overridden if ZSM already local)
    document.getElementById('use-passkeys-toggle').checked = true;
    if (urlEmail) setPasskeysToggle(urlEmail, true);
  }

  // Background image for register and wave modes
  if (actionParam === 'register' || actionParam === 'wave') {
    document.body.classList.add('wave-mode');
  }

  // ?msg= — show flash message from redirect
  const urlMsg = urlParams.get('msg');
  if (urlMsg) {
    showFlash('flash-status', urlMsg, 'success', 6000);
  }

  // "New" toggle — switching it re-routes to SETUP or LOGIN
  document.getElementById('new-user-toggle').addEventListener('change', () => updateUI());

  // Show hint when clicking readonly username field
  document.getElementById('username').addEventListener('click', (e) => {
    if (e.target.readOnly) {
      showFlash('flash-status', 'Reset Device before changing User ID', 'failure', 3000);
    }
  });

  // Persist username on input, update button state, and recheck enrollment status
  let usernameTimer = null;
  document.getElementById('username').addEventListener('input', (e) => {
    const user = getUsername();
    localStorage.setItem('username', user);
    document.getElementById('trust-device-btn').disabled = !user;

    if (usernameTimer) clearTimeout(usernameTimer);
    usernameTimer = setTimeout(() => updateUI(), 800);
  });

  // Copy button handlers
  document.querySelectorAll('.btn-copy').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const summary = btn.closest('summary');
      const details = summary?.closest('details');
      const pre = details?.querySelector('.challenge-full');
      const text = pre?.textContent;
      if (text) {
        try {
          await navigator.clipboard.writeText(text);
          const originalHTML = btn.innerHTML;
          btn.textContent = '✓';
          btn.style.opacity = '1';
          btn.style.color = 'var(--color-terminal-value)';
          setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.style.opacity = '';
            btn.style.color = '';
          }, 1500);
        } catch (err) {
          console.error('Copy failed:', err);
        }
      }
    });
  });

  // Detect existing credentials and show correct screen
  updateUI();
});
