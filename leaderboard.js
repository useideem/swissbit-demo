const params = new URLSearchParams(window.location.search);
const currentEmail = params.get('email');

// Set back link to return to wave mode with email
const backLink = document.getElementById('back-link');
if (backLink && currentEmail) {
  backLink.href = `./?action=wave&email=${encodeURIComponent(currentEmail)}`;
}

async function loadLeaderboard() {
  const tbody = document.getElementById('leaderboard-body');
  try {
    const res = await fetch('/api/users');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const users = await res.json();

    // Sort by balance descending
    users.sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0));

    tbody.innerHTML = '';
    users.forEach((user, i) => {
      const tr = document.createElement('tr');
      if (currentEmail && user.email && user.email.toLowerCase() === currentEmail.toLowerCase()) {
        tr.classList.add('leaderboard-highlight');
      }
      const name = [user.lastName, user.firstName].filter(Boolean).join(', ') || '--';
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${escapeHtml(name)}</td>
        <td>$${(user.balance ?? 0).toLocaleString()}</td>
      `;
      tbody.appendChild(tr);
    });

    if (users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--color-text-secondary);">No users found</td></tr>';
    }
  } catch (err) {
    console.error('[Leaderboard] Failed to load:', err);
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--color-danger);">Failed to load leaderboard</td></tr>';
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

loadLeaderboard();
