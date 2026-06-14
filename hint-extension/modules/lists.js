// Lists module - List CRUD, display, sharing
import * as state from './state.js';
import * as api from './api.js';
import * as ui from './ui.js';
import { displayProducts, createProductPreview } from './products.js';

// Load user data (lists and products)
export async function loadUserData() {
  const container = document.getElementById('myListsContainer');

  // Show skeleton loading
  ui.showListsSkeleton(container, 3);

  try {
    // Only get lists owned by the current user
    const lists = await api.supabaseRequest('GET', `/rest/v1/lists?user_id=eq.${state.currentUser.id}&select=*&order=created_at.desc`);
    state.setCurrentLists(lists);

    const productRequests = lists.map(list =>
      api.supabaseRequest('GET', `/rest/v1/products?list_id=eq.${list.id}&select=*`)
    );

    const allProducts = await Promise.all(productRequests);
    state.setCurrentProducts(allProducts.flat());

    updateListsDropdown();
    displayMyLists();
  } catch (error) {
    ui.showMessage('addMessage', 'Error loading data', 'error');
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">😕</div><div>Error loading lists</div></div>';
  }
}

// Update the list dropdown
export function updateListsDropdown() {
  const select = document.getElementById('listSelect');
  select.innerHTML = '<option value="">Select a list...</option>';

  state.currentLists.forEach(list => {
    const option = document.createElement('option');
    option.value = list.id;
    option.textContent = list.name;
    select.appendChild(option);
  });
}

// Display all user lists
export function displayMyLists() {
  const container = document.getElementById('myListsContainer');
  container.innerHTML = '';

  if (state.currentLists.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📝</div>
        <div style="font-size: 15px; font-weight: 600; margin-bottom: 8px;">No lists yet</div>
        <div style="font-size: 13px;">Create your first hintlist to get started!</div>
      </div>
    `;
    return;
  }

  state.currentLists.forEach((list, listIndex) => {
    const products = state.currentProducts.filter(p => p.list_id === list.id);
    const listDiv = document.createElement('div');
    listDiv.className = 'list-item collapsible';
    listDiv.style.animationDelay = `${listIndex * 50}ms`;

    // Check if already expanded
    if (state.expandedLists.has(list.id)) {
      listDiv.classList.add('expanded');
    }

    const headerDiv = document.createElement('div');
    headerDiv.className = 'list-header';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'list-name';
    nameDiv.textContent = list.name;
    headerDiv.appendChild(nameDiv);

    const badgesDiv = document.createElement('div');
    badgesDiv.className = 'list-badges';

    const publicBadge = document.createElement('span');
    publicBadge.className = `badge ${list.is_public ? 'public' : 'private'}`;
    publicBadge.textContent = list.is_public ? 'Public' : 'Private';
    badgesDiv.appendChild(publicBadge);

    const countBadge = document.createElement('span');
    countBadge.className = 'badge count';
    countBadge.textContent = `${products.length} items`;
    badgesDiv.appendChild(countBadge);

    // Claimed count badge
    const claimedCount = products.filter(p => p.claimed_by).length;
    if (claimedCount > 0) {
      const claimedBadge = document.createElement('span');
      claimedBadge.className = 'badge claimed';
      claimedBadge.textContent = `${claimedCount} claimed`;
      claimedBadge.title = `${claimedCount} of ${products.length} items have been claimed by others`;
      badgesDiv.appendChild(claimedBadge);
    }

    headerDiv.appendChild(badgesDiv);
    listDiv.appendChild(headerDiv);

    // Key date display
    if (list.key_date) {
      const keyDate = new Date(list.key_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      keyDate.setHours(0, 0, 0, 0);
      const daysUntil = Math.ceil((keyDate - today) / (1000 * 60 * 60 * 24));

      const dateLineDiv = document.createElement('div');
      dateLineDiv.style.marginBottom = '8px';
      dateLineDiv.style.fontSize = '13px';
      dateLineDiv.style.fontWeight = '600';

      if (daysUntil <= 15) {
        dateLineDiv.style.color = 'var(--error-text)';
      } else if (daysUntil <= 30) {
        dateLineDiv.style.color = 'var(--warning-text)';
      } else {
        dateLineDiv.style.color = 'var(--green-primary)';
      }

      const month = keyDate.getMonth() + 1;
      const day = keyDate.getDate();
      const year = keyDate.getFullYear().toString().slice(-2);
      const formattedDate = `${month}/${day}/${year}`;

      dateLineDiv.textContent = `📅 ${formattedDate} (${daysUntil}d)`;
      listDiv.appendChild(dateLineDiv);
    }

    // List actions - inline icons row
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'list-actions-row';

    // Expand/Collapse button with preview dots underneath
    const expandWrapper = document.createElement('div');
    expandWrapper.className = 'expand-wrapper';

    const expandBtn = document.createElement('button');
    expandBtn.className = 'btn-tiny secondary';
    expandBtn.innerHTML = state.expandedLists.has(list.id) ? '▼' : '▶';
    expandBtn.id = `expand-${list.id}`;
    expandBtn.setAttribute('aria-label', state.expandedLists.has(list.id) ? 'Hide items' : 'Show items');
    expandBtn.title = state.expandedLists.has(list.id) ? 'Hide items' : 'Show items';
    expandWrapper.appendChild(expandBtn);

    // Add product preview dots directly under expand button
    if (products.length > 0) {
      const preview = createProductPreview(products, 5);
      preview.className = 'list-products-preview inline';
      expandWrapper.appendChild(preview);
    }

    actionsDiv.appendChild(expandWrapper);

    // Spacer
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    actionsDiv.appendChild(spacer);

    // Action icons container - fixed order for alignment
    const iconsContainer = document.createElement('div');
    iconsContainer.className = 'list-action-icons';

    // Share (only for public lists)
    if (list.is_public) {
      const shareBtn = document.createElement('button');
      shareBtn.className = 'btn-action-icon';
      shareBtn.innerHTML = '📤';
      shareBtn.setAttribute('aria-label', 'Share list');
      shareBtn.title = 'Share';
      shareBtn.addEventListener('click', () => openInviteModal(list));
      iconsContainer.appendChild(shareBtn);
    }

    // Rename
    const renameBtn = document.createElement('button');
    renameBtn.className = 'btn-action-icon';
    renameBtn.innerHTML = '✏️';
    renameBtn.setAttribute('aria-label', 'Rename list');
    renameBtn.title = 'Rename';
    renameBtn.addEventListener('click', () => renameList(list.id, list.name));
    iconsContainer.appendChild(renameBtn);

    // Date
    const dateBtn = document.createElement('button');
    dateBtn.className = 'btn-action-icon';
    dateBtn.innerHTML = '📅';
    dateBtn.setAttribute('aria-label', list.key_date ? 'Edit date' : 'Set date');
    dateBtn.title = list.key_date ? 'Edit date' : 'Set date';
    dateBtn.addEventListener('click', () => setKeyDate(list.id, list.name, list.key_date));
    iconsContainer.appendChild(dateBtn);

    // Public/Private toggle
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn-action-icon';
    toggleBtn.innerHTML = list.is_public ? '🔒' : '🌍';
    toggleBtn.setAttribute('aria-label', list.is_public ? 'Make private' : 'Make public');
    toggleBtn.title = list.is_public ? 'Make private' : 'Make public';
    toggleBtn.addEventListener('click', async () => {
      await toggleListPublic(list.id, !list.is_public);
    });
    iconsContainer.appendChild(toggleBtn);

    // Export
    const exportBtn = document.createElement('button');
    exportBtn.className = 'btn-action-icon';
    exportBtn.innerHTML = '📥';
    exportBtn.setAttribute('aria-label', 'Export CSV');
    exportBtn.title = 'Export CSV';
    exportBtn.addEventListener('click', () => exportListToExcel(list, products));
    iconsContainer.appendChild(exportBtn);

    // Delete
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-action-icon danger';
    deleteBtn.innerHTML = '🗑️';
    deleteBtn.setAttribute('aria-label', 'Delete list');
    deleteBtn.title = 'Delete';
    deleteBtn.addEventListener('click', () => deleteList(list.id, list.name));
    iconsContainer.appendChild(deleteBtn);

    actionsDiv.appendChild(iconsContainer);
    listDiv.appendChild(actionsDiv);

    // Products container (collapsible)
    const productsContainer = document.createElement('div');
    productsContainer.id = `products-${list.id}`;
    productsContainer.className = 'list-products';
    productsContainer.style.marginTop = '12px';

    // Render products
    displayProducts(products, productsContainer, list);

    listDiv.appendChild(productsContainer);

    // Add expand/collapse click handler
    expandBtn.addEventListener('click', () => {
      const isExpanded = listDiv.classList.toggle('expanded');
      expandBtn.innerHTML = isExpanded ? '▼ Hide' : '▶ Show';
      expandBtn.setAttribute('aria-label', isExpanded ? 'Hide items' : 'Show items');

      if (isExpanded) {
        state.expandedLists.add(list.id);
      } else {
        state.expandedLists.delete(list.id);
      }
    });

    container.appendChild(listDiv);
  });

  // Animate items
  ui.animateListItems(container, '.list-item');
}

// Create a new list
export async function createNewList() {
  ui.showCustomModal(
    '📝 Create New List',
    '<input type="text" id="newListName" class="modal-input" placeholder="e.g., Birthday Wishlist">',
    async () => {
      const name = document.getElementById('newListName').value.trim();
      if (!name) {
        ui.showMessage('addMessage', 'Please enter a list name', 'error');
        return;
      }

      try {
        const newList = await api.supabaseRequest('POST', '/rest/v1/lists', {
          name,
          user_id: state.currentUser.id,
          is_public: false
        });

        ui.hideModal();
        await loadUserData();
        ui.showMessage('addMessage', 'List created!', 'success');
      } catch (error) {
        ui.showMessage('addMessage', 'Error creating list', 'error');
      }
    }
  );
}

// Delete a list
export async function deleteList(id, name) {
  if (!confirm(`Delete "${name}" and all its items? This cannot be undone.`)) {
    return;
  }

  try {
    // Delete products first
    await api.supabaseRequest('DELETE', `/rest/v1/products?list_id=eq.${id}`);
    // Delete list
    await api.supabaseRequest('DELETE', `/rest/v1/lists?id=eq.${id}`);

    await loadUserData();
    ui.showMessage('addMessage', 'List deleted', 'success');
  } catch (error) {
    ui.showMessage('addMessage', 'Error deleting list', 'error');
  }
}

// Rename a list
export function renameList(id, currentName) {
  ui.showCustomModal(
    '✏️ Rename List',
    `<input type="text" id="newListName" class="modal-input" value="${currentName}">`,
    async () => {
      const name = document.getElementById('newListName').value.trim();
      if (!name) {
        ui.showMessage('addMessage', 'Please enter a name', 'error');
        return;
      }

      try {
        await api.supabaseRequest('PATCH', `/rest/v1/lists?id=eq.${id}`, { name });
        ui.hideModal();
        await loadUserData();
        ui.showMessage('addMessage', 'List renamed!', 'success');
      } catch (error) {
        ui.showMessage('addMessage', 'Error renaming list', 'error');
      }
    }
  );
}

// Set key date for a list
export function setKeyDate(id, listName, currentDate) {
  const dateValue = currentDate ? new Date(currentDate).toISOString().split('T')[0] : '';

  ui.showCustomModal(
    '📅 Set Key Date',
    `<p style="margin-bottom: 12px;">When is this list needed by?</p>
     <input type="date" id="keyDateInput" class="modal-input" value="${dateValue}">
     <p style="font-size: 12px; color: var(--text-secondary); margin-top: 8px;">
       You'll get reminders as the date approaches.
     </p>`,
    async () => {
      const date = document.getElementById('keyDateInput').value;

      try {
        await api.supabaseRequest('PATCH', `/rest/v1/lists?id=eq.${id}`, {
          key_date: date || null
        });
        ui.hideModal();
        await loadUserData();
        ui.showMessage('addMessage', date ? 'Date set!' : 'Date cleared!', 'success');
      } catch (error) {
        ui.showMessage('addMessage', 'Error setting date', 'error');
      }
    }
  );
}

// Toggle list public/private
export async function toggleListPublic(id, makePublic) {
  try {
    await api.supabaseRequest('PATCH', `/rest/v1/lists?id=eq.${id}`, {
      is_public: makePublic
    });
    await loadUserData();
    ui.showMessage('addMessage', makePublic ? 'List is now public' : 'List is now private', 'success');
  } catch (error) {
    ui.showMessage('addMessage', 'Error updating list', 'error');
  }
}

// Toggle list notification level
export async function toggleListNotifications(id, level) {
  try {
    await api.supabaseRequest('PATCH', `/rest/v1/lists?id=eq.${id}`, {
      notification_level: level
    });
    await loadUserData();
    ui.showMessage('addMessage', 'Notification settings updated', 'success');
  } catch (error) {
    ui.showMessage('addMessage', 'Error updating notifications', 'error');
  }
}

// Export list to Excel (CSV format)
export function exportListToExcel(list, products) {
  // Claimer identity is intentionally omitted to preserve the "secret claim" model —
  // the owner can see that an item is claimed, but never who claimed it.
  const headers = ['Product Name', 'URL', 'Claimed', 'Date Added', 'Current Price'];
  const rows = [headers];

  products.forEach(product => {
    const isClaimed = product.claimed_by || product.guest_claimer_email;
    const row = [
      product.name || '',
      product.url || '',
      isClaimed ? 'Yes' : 'No',
      product.created_at ? new Date(product.created_at).toLocaleDateString() : '',
      product.current_price ? `$${product.current_price}` : 'N/A'
    ];
    rows.push(row);
  });

  const csvContent = rows.map(row =>
    row.map(cell => {
      const escaped = String(cell).replace(/"/g, '""');
      return escaped.includes(',') || escaped.includes('\n') ? `"${escaped}"` : escaped;
    }).join(',')
  ).join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${list.name.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  URL.revokeObjectURL(url);

  ui.showMessage('addMessage', 'List exported successfully!', 'success');
}

// Open invite modal for sharing a list
export function openInviteModal(list) {
  const shareableUrl = `https://wahans.github.io/hint/?code=${list.access_code}`;
  const userName = state.currentUser?.user_metadata?.name || state.currentUser?.name || 'Your friend';

  const emailSubject = encodeURIComponent(`🎁 ${userName} shared a hintlist with you!`);
  const emailBody = encodeURIComponent(`Hi!

I created a hintlist on hint and wanted to share it with you: "${list.name}"

You can view my hintlist here:
${shareableUrl}

No signup required - just click the link!

- ${userName}`);

  const smsBody = encodeURIComponent(`Hey! I shared my "${list.name}" hintlist with you on hint. Check it out: ${shareableUrl}`);

  const modalContent = `
    <div class="modal-header">✉️ Invite Friends</div>
    <div class="modal-body">
      <p style="margin-bottom: 16px;">Share <strong>"${list.name}"</strong> with friends and family!</p>

      <div class="settings-item">
        <label class="settings-label">Shareable Link</label>
        <div style="display: flex; gap: 8px;">
          <input type="text" id="inviteUrlInput" class="modal-input" value="${shareableUrl}" readonly style="flex: 1; margin: 0;">
          <button id="copyInviteLinkBtn" class="btn-small">Copy</button>
        </div>
        <div style="font-size: 12px; color: var(--text-secondary); margin-top: 8px;">
          Anyone with this link can view your hintlist
        </div>
      </div>

      <div class="settings-item">
        <label class="settings-label">Send via Email</label>
        <div style="display: flex; gap: 8px;">
          <input type="email" id="inviteEmailInput" class="modal-input" placeholder="friend@example.com" style="flex: 1; margin: 0;">
          <button id="sendEmailInviteBtn" class="btn-small">Send</button>
        </div>
        <div style="font-size: 12px; color: var(--text-secondary); margin-top: 8px;">
          We'll send them a beautiful email with your hintlist
        </div>
      </div>

      <div class="settings-item">
        <label class="settings-label">Quick Share</label>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button id="emailClientBtn" class="btn-small secondary" style="flex: 1;">
            📧 Email
          </button>
          <button id="smsBtn" class="btn-small secondary" style="flex: 1;">
            💬 SMS
          </button>
          <button id="qrCodeBtn" class="btn-small secondary" style="flex: 1;">
            📱 QR Code
          </button>
        </div>
      </div>

      <div id="inviteMessage" style="margin-top: 16px;"></div>
    </div>

    <div class="modal-buttons">
      <button id="closeInviteBtn" class="secondary">Close</button>
    </div>
  `;

  document.getElementById('modalContent').innerHTML = modalContent;
  document.getElementById('modalOverlay').classList.add('show');

  document.getElementById('closeInviteBtn').addEventListener('click', ui.hideModal);

  document.getElementById('copyInviteLinkBtn').addEventListener('click', () => {
    const input = document.getElementById('inviteUrlInput');
    input.select();
    navigator.clipboard.writeText(shareableUrl);
    showInviteMessage('Link copied to clipboard!', 'success');
  });

  document.getElementById('sendEmailInviteBtn').addEventListener('click', () => {
    sendEmailInvite(list, shareableUrl);
  });

  document.getElementById('emailClientBtn').addEventListener('click', () => {
    window.open(`mailto:?subject=${emailSubject}&body=${emailBody}`);
    showInviteMessage('Opening email client...', 'success');
  });

  document.getElementById('smsBtn').addEventListener('click', () => {
    window.open(`sms:?body=${smsBody}`);
    showInviteMessage('Opening SMS...', 'success');
  });

  document.getElementById('qrCodeBtn').addEventListener('click', () => {
    generateQRCode(shareableUrl, list.name, list.access_code);
  });
}

// Show message in invite modal
function showInviteMessage(text, type) {
  const el = document.getElementById('inviteMessage');
  if (el) {
    el.className = type === 'error' ? 'error-message' : 'success-message';
    el.textContent = text;

    setTimeout(() => {
      el.textContent = '';
      el.className = '';
    }, 3000);
  }
}

// Send email invitation
async function sendEmailInvite(list, shareableUrl) {
  const emailInput = document.getElementById('inviteEmailInput');
  const email = emailInput.value.trim();

  if (!email) {
    showInviteMessage('Please enter an email address', 'error');
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showInviteMessage('Please enter a valid email address', 'error');
    return;
  }

  showInviteMessage('Sending invitation...', 'info');

  try {
    let userName = 'Your friend';
    try {
      const userRecord = await api.supabaseRequest('GET', `/rest/v1/users?id=eq.${state.currentUser.id}&select=name`);
      if (userRecord && userRecord.length > 0 && userRecord[0].name) {
        userName = userRecord[0].name;
      }
    } catch (nameError) {
      console.warn('Could not fetch user name:', nameError);
    }

    const SUPABASE_ANON_KEY = state.supabaseKey;

    const response = await fetch(`${state.supabaseUrl}/functions/v1/send-email-invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        to_email: email,
        from_name: userName,
        list_name: list.name,
        shareable_url: shareableUrl
      })
    });

    let responseData;
    try {
      responseData = await response.json();
    } catch (jsonError) {
      const responseText = await response.text();
      throw new Error(`Server returned non-JSON response: ${responseText.substring(0, 100)}`);
    }

    if (response.ok) {
      showInviteMessage('Invitation sent! ✓', 'success');
      emailInput.value = '';
      await trackInvitation(email, list.id);
    } else {
      const errorMsg = responseData.error || responseData.message || 'Unknown error';
      showInviteMessage(`Error: ${errorMsg}`, 'error');
    }
  } catch (error) {
    if (error.message.includes('Failed to fetch')) {
      showInviteMessage('Error: Cannot reach server.', 'error');
    } else {
      showInviteMessage(`Error: ${error.message}`, 'error');
    }
  }
}

// Track invitation in database
async function trackInvitation(email, listId) {
  try {
    await api.supabaseRequest('POST', '/rest/v1/invitations', {
      invited_email: email,
      list_id: listId,
      inviter_id: state.currentUser.id,
      invited_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error tracking invitation:', error);
  }
}

// Generate QR code for sharing
function generateQRCode(url, listName, accessCode) {
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url)}&color=228855&bgcolor=ffffff`;

  const qrContent = `
    <div class="modal-header" style="padding: 12px 16px; font-size: 16px;">📱 QR Code</div>
    <div class="modal-body" style="text-align: center; padding: 12px 16px;">
      <p style="margin-bottom: 12px; font-size: 13px;">Scan to view <strong>"${listName}"</strong></p>
      <div style="display: flex; justify-content: center; margin: 12px 0;">
        <img src="${qrImageUrl}" alt="QR Code" style="width: 180px; height: 180px; border-radius: 6px; border: 3px solid #228855;" />
      </div>
      <div style="margin: 12px 0; padding: 10px; background: var(--bg-tertiary); border-radius: 6px;">
        <p style="font-size: 11px; color: var(--text-secondary); margin: 0 0 4px;">Or share this code:</p>
        <div style="font-size: 20px; font-weight: bold; font-family: monospace; letter-spacing: 2px; color: var(--green-primary);">${accessCode}</div>
      </div>
      <p style="font-size: 11px; color: var(--text-secondary); margin: 8px 0;">
        Enter code at <strong>wahans.github.io/hint</strong>
      </p>
      <a href="${qrImageUrl}" download="hint-qr-${listName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.png" class="btn-small" style="display: inline-block; margin-top: 8px; text-decoration: none; font-size: 12px; padding: 6px 12px;">💾 Download</a>
    </div>
    <div class="modal-buttons" style="padding: 12px 16px;">
      <button id="closeQRBtn" class="secondary">Close</button>
    </div>
  `;

  document.getElementById('modalContent').innerHTML = qrContent;
  document.getElementById('modalOverlay').classList.add('show');

  document.getElementById('closeQRBtn').addEventListener('click', ui.hideModal);
}
