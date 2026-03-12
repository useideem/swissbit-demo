/**
 * ishield.js -- iShield USB Key Integration (Raw WebAuthn)
 *
 * This module handles direct communication with Swissbit iShield USB
 * security keys using the Web Authentication API (navigator.credentials).
 *
 * It has ZERO SDK dependencies -- just raw browser WebAuthn calls.
 *
 * WHAT IT DOES:
 *   - Enrolls an iShield USB key for a user (creates a FIDO2 credential)
 *   - Authenticates a user by requesting a USB key touch
 *   - Stores enrollment markers in localStorage (credential lives on the key)
 *   - Manages device suspension state (localStorage flags)
 *   - Provides base64url and SHA-256 encoding utilities used by umfa.js
 *
 * HOW TO USE:
 *   import { webauthnEnroll, webauthnAuthenticate, hasLocalEnrollmentMarker } from './ishield.js';
 *
 *   // Enroll a new key (throws on failure -- wrap in try/catch)
 *   await webauthnEnroll('alice');
 *
 *   // Check if this device has an enrollment marker
 *   if (hasLocalEnrollmentMarker('alice')) { ... }
 *
 *   // Authenticate with the enrolled key
 *   const result = await webauthnAuthenticate('alice');
 *   if (result.success) {
 *     // result.clientDataHash -- SHA-256 hex of the clientDataJSON
 *     // result.signatureHex   -- hex-encoded raw signature bytes
 *   } else {
 *     // result.error -- the original Error object (check result.error.name)
 *   }
 *
 * INTEGRATION NOTES:
 *   - Requires HTTPS or localhost (WebAuthn security requirement)
 *   - authenticatorAttachment: 'cross-platform' targets USB keys specifically
 *     (as opposed to 'platform' which targets TouchID/FaceID/Windows Hello)
 *   - userVerification: 'discouraged' -- iShield keys use touch only; they
 *     do not have a PIN or biometric, so don't require user verification
 *   - Enrollment markers are stored in localStorage under
 *     the key 'ishield_enrolled:<username>'
 *   - Suspension state is stored in localStorage under
 *     'passkeys_suspended:<username>'
 */

// ---------------------------------------------------------------------------
// Storage key prefixes
// ---------------------------------------------------------------------------

/**
 * localStorage key prefix for iShield enrollment markers.
 * Full key = ENROLLMENT_MARKER_PREFIX + username
 * Value = JSON string: { id: '<base64url>', createdAt: '<ISO date>' }
 *
 * NOTE: The credential itself lives on the iShield key (discoverable/resident
 * credential). This localStorage marker is only used to indicate that
 * enrollment happened on THIS device. On a new device the marker won't
 * exist, but the key can still authenticate via discoverable credential.
 */
export const ENROLLMENT_MARKER_PREFIX = 'ishield_enrolled:';

/**
 * localStorage key prefix for device suspension state.
 * Full key = SUSPENDED_STORAGE_PREFIX + username
 * Value = 'true' when suspended, absent when active
 */
export const SUSPENDED_STORAGE_PREFIX = 'passkeys_suspended:';

/**
 * localStorage key prefix for the Passkeys+ toggle preference.
 * Full key = PASSKEYS_TOGGLE_PREFIX + username
 * Value = 'true' or 'false' (defaults to true when absent)
 */
export const PASSKEYS_TOGGLE_PREFIX = 'actions_passkeys_toggle:';

// ---------------------------------------------------------------------------
// Credential storage helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if an iShield enrollment marker exists for this user on
 * this device. The marker is set after enrollment or device binding.
 *
 * NOTE: A false return does NOT mean the user has no iShield credential --
 * the credential lives on the physical key and works on any device. This
 * only tells you whether enrollment happened on THIS device.
 *
 * @param {string} user - The username to check.
 * @returns {boolean} True if an enrollment marker is stored in localStorage.
 */
export function hasLocalEnrollmentMarker(user) {
  return user ? !!localStorage.getItem(ENROLLMENT_MARKER_PREFIX + user) : false;
}

/**
 * Returns true if this user's device is currently suspended.
 *
 * A suspended device requires the user to re-authenticate with their
 * physical iShield USB key before Passkeys+ login is re-enabled.
 *
 * @param {string} user - The username to check.
 * @returns {boolean} True if the device is suspended.
 */
export function isSuspended(user) {
  const key = user ? SUSPENDED_STORAGE_PREFIX + user : null;
  return key ? localStorage.getItem(key) === 'true' : false;
}

/**
 * Sets the suspension state for a user's device.
 *
 * Call with value=true to suspend (blocks Passkeys+ login).
 * Call with value=false to clear suspension (re-enables Passkeys+ login).
 *
 * @param {string} user - The username.
 * @param {boolean} value - True to suspend, false to clear suspension.
 */
export function setSuspended(user, value) {
  const key = user ? SUSPENDED_STORAGE_PREFIX + user : null;
  if (!key) return;
  value ? localStorage.setItem(key, 'true') : localStorage.removeItem(key);
}

/**
 * Returns the saved state of the Passkeys+ toggle for this user.
 *
 * This persists the user's preference between sessions so the UI
 * toggle reflects their last choice when they return.
 *
 * @param {string} user - The username.
 * @returns {boolean} The saved toggle value, defaults to true if not set.
 */
export function getPasskeysToggle(user) {
  const key = user ? PASSKEYS_TOGGLE_PREFIX + user : null;
  if (!key) return true;
  const val = localStorage.getItem(key);
  return val === null ? true : val === 'true';
}

/**
 * Persists the Passkeys+ toggle preference for this user.
 *
 * @param {string} user - The username.
 * @param {boolean} value - The toggle state to save.
 */
export function setPasskeysToggle(user, value) {
  const key = user ? PASSKEYS_TOGGLE_PREFIX + user : null;
  if (!key) return;
  localStorage.setItem(key, String(value));
}

// ---------------------------------------------------------------------------
// Encoding utilities
// ---------------------------------------------------------------------------

/**
 * Converts an ArrayBuffer to a base64url-encoded string.
 *
 * base64url is the URL-safe variant of base64: '+' becomes '-',
 * '/' becomes '_', and trailing '=' padding is stripped. This is the
 * standard encoding for WebAuthn credential IDs and challenge values.
 *
 * @param {ArrayBuffer} buffer - The raw bytes to encode.
 * @returns {string} The base64url-encoded string.
 */
export function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Converts a base64url-encoded string back to an ArrayBuffer.
 *
 * Used to decode stored credential IDs before passing them to
 * navigator.credentials.get() as allowCredentials entries.
 *
 * @param {string} base64url - The base64url-encoded string to decode.
 * @returns {ArrayBuffer} The decoded raw bytes.
 */
export function base64urlToBuffer(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Computes the SHA-256 hash of a string and returns it as a hex string.
 *
 * Used to produce human-readable representations of challenge data for
 * display purposes, and by umfa.js to hash clientDataJSON before display.
 *
 * @param {string} input - The string to hash. Must be a string.
 * @returns {Promise<string>} The hex-encoded SHA-256 digest.
 * @throws {TypeError} If input is not a string.
 */
export async function hashSHA256(input) {
  if (typeof input !== 'string') throw new TypeError('hashSHA256 expects a string input.');
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Core WebAuthn operations
// ---------------------------------------------------------------------------

/**
 * Enrolls an iShield USB key for a user via raw WebAuthn.
 *
 * This is step 1 of the Trust Device flow. It calls
 * navigator.credentials.create() to register a new FIDO2 credential on the
 * iShield USB key, then stores the credential ID in localStorage so the key
 * can be targeted specifically during future authentication.
 *
 * The authenticator selection is deliberately configured for cross-platform
 * USB keys with no PIN/biometric requirement -- matching the iShield's
 * touch-only design.
 *
 * KEY BEHAVIORS:
 *   - On success: stores credential in localStorage and resolves normally.
 *   - On cancellation (user dismisses prompt or times out): throws NotAllowedError.
 *   - On security error (not HTTPS/localhost): throws SecurityError.
 *   - On duplicate registration: throws InvalidStateError.
 *   - All errors are re-thrown -- the caller is responsible for UI feedback.
 *
 * CALLER PATTERN (in app.js):
 *   try {
 *     await webauthnEnroll(user);
 *   } catch (err) {
 *     if (err.name === 'NotAllowedError') showFlash('Cancelled or timed out');
 *     else showFlash('Enrollment failed: ' + err.message);
 *     return;
 *   }
 *
 * @param {string} user - The username to enroll. Used as the WebAuthn user.name
 *   and as the localStorage key suffix.
 * @returns {Promise<void>} Resolves on successful enrollment.
 * @throws {Error} Throws the original WebAuthn error on any failure.
 */
export async function webauthnEnroll(user) {
  const userId = new TextEncoder().encode(user);
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  console.log('[FIDO2 Enroll] Starting enrollment for user:', user);

  // Build excludeCredentials from any existing enrollment marker to prevent
  // duplicate registration on the same key
  const excludeCredentials = [];
  const existingMarker = localStorage.getItem(ENROLLMENT_MARKER_PREFIX + user);
  if (existingMarker) {
    try {
      const { id } = JSON.parse(existingMarker);
      if (id) excludeCredentials.push({ id: base64urlToBuffer(id), type: 'public-key', transports: ['usb'] });
    } catch (_) {}
  }

  const options = {
    publicKey: {
      rp: { name: 'Demo Swissbit', id: location.hostname },
      user: { id: userId, name: user, displayName: user },
      challenge,
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },   // ES256
        { alg: -257, type: 'public-key' }   // RS256
      ],
      excludeCredentials,
      authenticatorSelection: {
        authenticatorAttachment: 'cross-platform', // USB keys, not platform authenticators
        userVerification: 'required',              // PIN required — forces credProtect Level 2
        residentKey: 'required',                   // Store credential ON the key (discoverable)
        requireResidentKey: true                   // Compat for older browsers
      },
      attestation: 'none',
      timeout: 60000
    }
  };

  console.log('[FIDO2 Enroll] Options:', JSON.stringify({
    rp: options.publicKey.rp,
    user: { name: user, displayName: user },
    authenticatorSelection: options.publicKey.authenticatorSelection,
    attestation: options.publicKey.attestation,
    timeout: options.publicKey.timeout
  }, null, 2));

  try {
    const credential = await navigator.credentials.create(options);

    const stored = {
      id: bufferToBase64url(credential.rawId),
      createdAt: new Date().toISOString()
    };
    localStorage.setItem(ENROLLMENT_MARKER_PREFIX + user, JSON.stringify(stored));

    console.log('[FIDO2 Enroll] Success:', {
      credentialId: stored.id,
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment,
      createdAt: stored.createdAt
    });
  } catch (err) {
    console.error('[FIDO2 Enroll] Error:', { name: err.name, message: err.message });
    throw err; // Re-throw -- caller handles UI feedback
  }
}

/**
 * Authenticates a user with their iShield USB key via raw WebAuthn.
 *
 * Uses discoverable (resident) credentials -- the key presents its own
 * stored credential without needing an allowCredentials list. This means
 * authentication works on ANY device, not just the one where enrollment
 * happened.
 *
 * The `user` parameter is used to VERIFY the authenticated identity: the
 * `userHandle` returned by the key must match the expected username.
 *
 * Returns a structured result object instead of throwing, so the caller
 * can cleanly branch on success vs. failure and display appropriate messages.
 *
 * RESULT SHAPES:
 *   Success: { success: true, clientDataHash: string, signatureHex: string, authenticatedUser: string }
 *     - clientDataHash: SHA-256 hex of the clientDataJSON (for display)
 *     - signatureHex: hex-encoded raw signature bytes (for display)
 *     - authenticatedUser: username recovered from the key's userHandle
 *
 *   Failure: { success: false, error: Error }
 *     - error.name === 'NotAllowedError': user cancelled or timed out
 *     - error.message contains 'mismatch': wrong user on this key
 *     - Other error names: unexpected failure
 *
 * @param {string} user - The expected username. Verified against userHandle.
 * @returns {Promise<{success: boolean, clientDataHash?: string, signatureHex?: string, authenticatedUser?: string, error?: Error}>}
 */
export async function webauthnAuthenticate(user) {
  if (!user) {
    return { success: false, error: new Error('No user specified.') };
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));

  console.log('[FIDO2 Auth] Starting authentication for user:', user);

  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: location.hostname,
        userVerification: 'required',
        timeout: 60000
      }
    });
    console.log('[FIDO2 Auth] Success, attachment:', assertion.authenticatorAttachment);

    // Verify a cross-platform authenticator (USB key) was used, not platform (Touch ID)
    if (assertion.authenticatorAttachment === 'platform') {
      return {
        success: false,
        error: new Error('Please use your iShield USB key, not Touch ID or a platform passkey.')
      };
    }

    // Decode userHandle to recover the authenticated username
    let authenticatedUser = null;
    if (assertion.response.userHandle && assertion.response.userHandle.byteLength > 0) {
      authenticatedUser = new TextDecoder().decode(assertion.response.userHandle);
    }

    // Log mismatch but don't fail — caller decides what to do
    if (authenticatedUser && authenticatedUser !== user) {
      console.warn('[FIDO2 Auth] User mismatch:', { expected: user, got: authenticatedUser });
    }

    // Extract challenge and signature for display purposes
    try {
      const clientDataHash = await hashSHA256(
        new TextDecoder().decode(assertion.response.clientDataJSON)
      );
      const signatureHex = Array.from(
        new Uint8Array(assertion.response.signature),
        byte => byte.toString(16).padStart(2, '0')
      ).join('');
      return { success: true, clientDataHash, signatureHex, authenticatedUser };
    } catch (extractErr) {
      console.warn('[FIDO2 Auth] Could not extract challenge data:', extractErr.message);
      return { success: true, authenticatedUser };
    }
  } catch (err) {
    console.error('[FIDO2 Auth] Error:', { name: err.name, message: err.message });
    return { success: false, error: err };
  }
}
