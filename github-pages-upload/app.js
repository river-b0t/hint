// Hint Web Viewer - Non-User Access
// Allows viewing and claiming from hintlists without an account

// Configuration
const SUPABASE_URL = 'https://whbqyxtjmbordcjtqyoq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndoYnF5eHRqbWJvcmRjanRxeW9xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwMzY0MDksImV4cCI6MjA4MjYxMjQwOX0.GiTCNNNcMVuGdd45AJbXFB6eS0a5enXoUW7nfkZPD3k';

let currentList = null;
let currentProducts = [];
let currentProductToClaim = null;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  checkURLForCode();
});

function setupEventListeners() {
  document.getElementById('loadHintlistBtn').addEventListener('click', loadHintlist);
  document.getElementById('accessCode').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') loadHintlist();
  });
  document.getElementById('cancelClaimBtn').addEventListener('click', closeClaimModal);
  document.getElementById('confirmClaimBtn').addEventListener('click', confirmClaim);
}

// Check if access code or unclaim token is in URL
function checkURLForCode() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const unclaimToken = params.get('unclaim');
  const productId = params.get('product');
  
  // Handle unclaim request
  if (unclaimToken && productId) {
    handleUnclaim(unclaimToken, productId);
    return;
  }
  
  if (code) {
    document.getElementById('accessCode').value = code;
    loadHintlist();
  }
}

// Handle unclaim from email link
async function handleUnclaim(token, productId) {
  document.getElementById('accessForm').innerHTML = `
    <h2>🔓 Unclaim Item</h2>
    <div id="unclaimMessage"></div>
    <p>Processing your unclaim request...</p>
  `;
  
  try {
    // Verify the token matches the product
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/products?id=eq.${productId}&unclaim_token=eq.${token}&select=*`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const products = await response.json();
    
    if (!products || products.length === 0) {
      document.getElementById('accessForm').innerHTML = `
        <h2>❌ Invalid Link</h2>
        <p style="color: #dc3545;">This unclaim link is invalid or has already been used.</p>
        <p>The item may have already been unclaimed, or the link has expired.</p>
      `;
      return;
    }
    
    const product = products[0];
    
    // Store product info for later use
    window.unclaimProductInfo = {
      name: product.name,
      email: product.guest_claimer_email,
      claimerName: product.guest_claimer_name
    };
    
    // Show confirmation dialog
    document.getElementById('accessForm').innerHTML = `
      <h2>🔓 Unclaim Item</h2>
      <p>Are you sure you want to unclaim this item?</p>
      <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc3545;">
        <strong>${product.name}</strong>
      </div>
      <p style="color: #666; font-size: 14px;">This will make the item available for others to claim again.</p>
      <div style="display: flex; gap: 10px; margin-top: 20px;">
        <button onclick="window.location.href='${window.location.pathname}'" style="background: #6c757d; color: white;">Cancel</button>
        <button onclick="confirmUnclaim('${productId}', '${token}')" style="background: #dc3545; color: white;">Yes, Unclaim</button>
      </div>
      <div id="unclaimResult" style="margin-top: 20px;"></div>
    `;
  } catch (error) {
    console.error('Error verifying unclaim:', error);
    document.getElementById('accessForm').innerHTML = `
      <h2>❌ Error</h2>
      <p style="color: #dc3545;">There was an error processing your request. Please try again.</p>
    `;
  }
}

// Confirm and process the unclaim
async function confirmUnclaim(productId, token) {
  const resultDiv = document.getElementById('unclaimResult');
  resultDiv.innerHTML = '<p style="color: #0c5460;">Processing...</p>';
  
  // Get stored product info
  const productInfo = window.unclaimProductInfo || {};
  
  try {
    // Clear the claim data
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/products?id=eq.${productId}&unclaim_token=eq.${token}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          guest_claimer_name: null,
          guest_claimer_email: null,
          claimed_at: null,
          claimed_by: null,
          unclaim_token: null
        })
      }
    );
    
    if (response.ok) {
      // Send unclaim confirmation email
      if (productInfo.email) {
        await sendUnclaimConfirmation(productInfo.claimerName, productInfo.email, productInfo.name);
      }
      
      document.getElementById('accessForm').innerHTML = `
        <h2>🔓 Item Unclaimed</h2>
        <p style="color: #155724;">The item has been successfully unclaimed and is now available for others.</p>
        <p style="margin-top: 20px;">Thank you for letting us know!</p>
      `;
    } else {
      resultDiv.innerHTML = '<p style="color: #dc3545;">Failed to unclaim. Please try again.</p>';
    }
  } catch (error) {
    console.error('Error unclaiming:', error);
    resultDiv.innerHTML = '<p style="color: #dc3545;">An error occurred. Please try again.</p>';
  }
}

async function loadHintlist() {
  const code = document.getElementById('accessCode').value.trim().toUpperCase();
  
  if (!code) {
    showMessage('formMessage', 'Please enter an access code', 'error');
    return;
  }
  
  showMessage('formMessage', 'Loading hintlist...', 'info');
  
  try {
    // Find list by access code
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/lists?access_code=eq.${code}&is_public=eq.true&select=*`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const lists = await response.json();
    
    if (!response.ok || lists.length === 0) {
      showMessage('formMessage', 'Invalid access code or hintlist not found', 'error');
      return;
    }
    
    currentList = lists[0];
    
    // Load products for this list
    const productsResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/products?list_id=eq.${currentList.id}&select=*`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    
    currentProducts = await productsResponse.json();
    
    // Display the hintlist
    displayHintlist();
    
  } catch (error) {
    console.error('Error loading hintlist:', error);
    showMessage('formMessage', 'Error loading hintlist. Please try again.', 'error');
  }
}

function displayHintlist() {
  // Hide form, show hintlist
  document.getElementById('accessForm').style.display = 'none';
  document.getElementById('hintlistView').style.display = 'block';
  
  // Update header
  document.getElementById('hintlistName').textContent = currentList.name;
  
  // Filter out claimed items (non-users can't see who claimed)
  const availableProducts = currentProducts.filter(p => !p.claimed_by && !p.guest_claimer_email);
  
  document.getElementById('itemCount').textContent = `${availableProducts.length} available items`;
  
  // Display products
  const container = document.getElementById('productsContainer');
  container.innerHTML = '';
  
  if (availableProducts.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🎁</div>
        <div style="font-size: 18px; margin-bottom: 8px;">All items have been claimed!</div>
        <div style="font-size: 14px;">Check back later for new additions.</div>
      </div>
    `;
    return;
  }
  
  availableProducts.forEach(product => {
    const productDiv = document.createElement('div');
    productDiv.className = 'product-item';
    
    // Product image
    let imageHTML = '';
    if (product.image_url) {
      imageHTML = `
        <div class="product-image">
          <img src="${product.image_url}" alt="${product.name}" onerror="this.parentElement.innerHTML='<div class=\\'product-image-placeholder\\'>📦</div>'">
        </div>
      `;
    } else {
      imageHTML = `
        <div class="product-image">
          <div class="product-image-placeholder">📦</div>
        </div>
      `;
    }
    
    let priceHTML = '';
    if (product.current_price) {
      priceHTML = `<div class="product-price">$${product.current_price}</div>`;
    }
    
    let urlHTML = '';
    if (product.url) {
      // Truncate long URLs
      const displayUrl = product.url.length > 50 ? product.url.substring(0, 50) + '...' : product.url;
      urlHTML = `<div class="product-url">${displayUrl}</div>`;
    }
    
    // Escape URL for use in onclick
    const escapedUrl = product.url ? product.url.replace(/'/g, "\\'") : '';
    
    productDiv.innerHTML = `
      <div class="product-content">
        ${imageHTML}
        <div class="product-details">
          <div class="product-name">${product.name}</div>
          ${priceHTML}
          ${urlHTML}
        </div>
      </div>
      <div class="product-actions">
        ${product.url ? `<button class="btn-small btn-secondary" onclick="window.open('${product.url}', '_blank')">🔗 View Product</button>` : ''}
        <button class="btn-small" onclick="openClaimModal('${product.id}', '${product.name.replace(/'/g, "\\'")}', '${escapedUrl}')">🎁 I'll Buy This</button>
      </div>
    `;
    
    container.appendChild(productDiv);
  });
  
  // Update URL with access code (for easy sharing)
  const newURL = `${window.location.origin}${window.location.pathname}?code=${currentList.access_code}`;
  window.history.replaceState({}, '', newURL);
}

function openClaimModal(productId, productName, productUrl) {
  currentProductToClaim = { id: productId, name: productName, url: productUrl };
  document.getElementById('claimModal').classList.add('show');
  document.getElementById('claimerName').focus();
  
  // Clear previous inputs
  document.getElementById('claimerName').value = '';
  document.getElementById('claimerEmail').value = '';
  document.getElementById('claimMessage').innerHTML = '';
}

function closeClaimModal() {
  document.getElementById('claimModal').classList.remove('show');
  currentProductToClaim = null;
}

async function confirmClaim() {
  const name = document.getElementById('claimerName').value.trim();
  const email = document.getElementById('claimerEmail').value.trim();
  
  if (!name || !email) {
    showMessage('claimMessage', 'Please enter your name and email', 'error');
    return;
  }
  
  if (!validateEmail(email)) {
    showMessage('claimMessage', 'Please enter a valid email address', 'error');
    return;
  }
  
  showMessage('claimMessage', 'Claiming item...', 'info');
  
  try {
    // Generate unclaim token for email verification
    const unclaimToken = generateUnclaimToken();
    
    // Update product directly with guest claim info
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/products?id=eq.${currentProductToClaim.id}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          guest_claimer_name: name,
          guest_claimer_email: email,
          claimed_at: new Date().toISOString(),
          unclaim_token: unclaimToken
        })
      }
    );
    
    if (response.ok) {
      const claimedProduct = await response.json();
      
      // Send notification to list owner
      await sendClaimNotification(currentProductToClaim.id, name);
      
      // Send confirmation email to claimer with unclaim link and buy link
      await sendClaimerConfirmation(name, email, currentProductToClaim.name, currentProductToClaim.url, unclaimToken, currentProductToClaim.id);
      
      // Award points for claiming (10 points)
      await awardClaimPoints(email, name, currentProductToClaim.id);
      
      // Show success with Buy Now option
      const productUrl = currentProductToClaim.url;
      const productName = currentProductToClaim.name;
      
      document.querySelector('#claimModal .modal').innerHTML = `
        <h3 style="color: #228855;">🎉 Item Claimed! +10 pts 🏆</h3>
        <p style="color: #155724; background: #d4edda; padding: 12px; border-radius: 8px; margin: 20px 0;">
          You've successfully claimed <strong>"${productName}"</strong>
        </p>
        <p style="color: #666; font-size: 14px;">
          We've sent a confirmation email to <strong>${email}</strong> with all the details.
        </p>
        
        ${productUrl ? `
          <div style="background: #f0f9f4; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
            <p style="margin: 0 0 15px; font-weight: 600;">Ready to buy this gift?</p>
            <a href="${productUrl}" target="_blank" style="display: inline-block; background: #228855; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
              🛒 Buy Now
            </a>
          </div>
        ` : ''}
        
        <div style="display: flex; gap: 10px; margin-top: 20px;">
          <button onclick="closeClaimModal(); loadHintlist();" style="flex: 1; background: #6c757d; color: white;">Done</button>
        </div>
      `;
    } else {
      const error = await response.json();
      console.error('Claim error:', error);
      showMessage('claimMessage', error.message || 'Failed to claim item', 'error');
    }
    
  } catch (error) {
    console.error('Error claiming product:', error);
    showMessage('claimMessage', 'Error claiming item. Please try again.', 'error');
  }
}

// Generate a random token for unclaiming
function generateUnclaimToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

// Send notification to list owner about the claim
async function sendClaimNotification(productId, claimerName) {
  try {
    // Get product and list info
    const productRes = await fetch(
      `${SUPABASE_URL}/rest/v1/products?id=eq.${productId}&select=*,lists(*)`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    const products = await productRes.json();
    if (!products || products.length === 0) return;
    
    const product = products[0];
    const list = product.lists;
    
    // Get list owner info
    const userRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${list.user_id}&select=email,name`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    const users = await userRes.json();
    if (!users || users.length === 0) return;
    
    const owner = users[0];
    
    // Call the claim notification edge function
    await fetch(`${SUPABASE_URL}/functions/v1/claim-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        owner_email: owner.email,
        owner_name: owner.name,
        list_name: list.name,
        product_name: product.name,
        claimer_name: claimerName,
        notification_level: list.notification_level || 'both'
      })
    });
  } catch (error) {
    console.error('Error sending claim notification:', error);
  }
}

// Send confirmation email to the person who claimed
async function sendClaimerConfirmation(claimerName, claimerEmail, productName, productUrl, unclaimToken, productId) {
  try {
    const unclaimUrl = `${window.location.origin}${window.location.pathname}?unclaim=${unclaimToken}&product=${productId}`;
    
    await fetch(`${SUPABASE_URL}/functions/v1/send-claimer-confirmation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        claimer_name: claimerName,
        claimer_email: claimerEmail,
        product_name: productName,
        product_url: productUrl || null,
        unclaim_url: unclaimUrl
      })
    });
  } catch (error) {
    console.error('Error sending claimer confirmation:', error);
  }
}

function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

function showMessage(elementId, text, type) {
  const el = document.getElementById(elementId);
  if (el) {
    el.className = `message ${type}`;
    el.textContent = text;
    
    if (type === 'success' || type === 'info') {
      setTimeout(() => {
        el.innerHTML = '';
      }, 4000);
    }
  }
}

// Send unclaim confirmation email
async function sendUnclaimConfirmation(claimerName, claimerEmail, productName) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-unclaim-confirmation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        claimer_name: claimerName,
        claimer_email: claimerEmail,
        product_name: productName
      })
    });
  } catch (error) {
    console.error('Error sending unclaim confirmation:', error);
  }
}

// ============================================
// SIGNUP / LOGIN FLOW
// ============================================

function openSignupModal() {
  document.getElementById('signupModal').classList.add('show');
  document.getElementById('signupForm').style.display = 'block';
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('signupSuccess').style.display = 'none';
  document.getElementById('signupMessage').innerHTML = '';
  document.getElementById('signupName').value = '';
  document.getElementById('signupEmail').value = '';
  document.getElementById('signupPassword').value = '';
  document.getElementById('signupName').focus();
}

function closeSignupModal() {
  document.getElementById('signupModal').classList.remove('show');
}

function showLoginForm() {
  document.getElementById('signupForm').style.display = 'none';
  document.getElementById('loginForm').style.display = 'block';
  document.getElementById('signupSuccess').style.display = 'none';
  document.getElementById('signupMessage').innerHTML = '';
  document.getElementById('loginEmail').value = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginEmail').focus();
}

function showSignupForm() {
  document.getElementById('signupForm').style.display = 'block';
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('signupSuccess').style.display = 'none';
  document.getElementById('signupMessage').innerHTML = '';
  document.getElementById('signupName').focus();
}

async function handleSignup() {
  const name = document.getElementById('signupName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  
  if (!name) {
    showMessage('signupMessage', 'Please enter your name', 'error');
    return;
  }
  
  if (!email || !validateEmail(email)) {
    showMessage('signupMessage', 'Please enter a valid email address', 'error');
    return;
  }
  
  if (!password || password.length < 6) {
    showMessage('signupMessage', 'Password must be at least 6 characters', 'error');
    return;
  }
  
  showMessage('signupMessage', 'Creating your account...', 'info');
  
  try {
    // Sign up with Supabase Auth
    const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: email,
        password: password,
        data: {
          name: name
        }
      })
    });
    
    const data = await response.json();
    
    if (response.ok && data.id) {
      // Success! Show success message
      document.getElementById('signupForm').style.display = 'none';
      document.getElementById('signupSuccess').style.display = 'block';
      
      // Also create user record in users table
      await createUserRecord(data.id, email, name);
      
      // Send welcome email
      await sendWelcomeEmail(name, email);
    } else {
      // Handle errors
      const errorMsg = data.error_description || data.msg || data.error?.message || 'Failed to create account';
      showMessage('signupMessage', errorMsg, 'error');
    }
  } catch (error) {
    console.error('Signup error:', error);
    showMessage('signupMessage', 'An error occurred. Please try again.', 'error');
  }
}

async function handleLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  
  if (!email || !validateEmail(email)) {
    showMessage('signupMessage', 'Please enter a valid email address', 'error');
    return;
  }
  
  if (!password) {
    showMessage('signupMessage', 'Please enter your password', 'error');
    return;
  }
  
  showMessage('signupMessage', 'Logging in...', 'info');
  
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: email,
        password: password
      })
    });
    
    const data = await response.json();
    
    if (response.ok && data.access_token) {
      showMessage('signupMessage', 'Logged in successfully! Install the extension to manage your hintlists.', 'success');
      
      setTimeout(() => {
        document.getElementById('signupForm').style.display = 'none';
        document.getElementById('loginForm').style.display = 'none';
        document.getElementById('signupSuccess').style.display = 'block';
        // Update success message for login
        document.getElementById('signupSuccess').querySelector('h3').textContent = 'Welcome Back!';
        document.getElementById('signupSuccess').querySelector('p').textContent = 
          'You\'re logged in! Install the hint extension to manage your hintlists.';
      }, 1500);
    } else {
      const errorMsg = data.error_description || data.msg || 'Invalid email or password';
      showMessage('signupMessage', errorMsg, 'error');
    }
  } catch (error) {
    console.error('Login error:', error);
    showMessage('signupMessage', 'An error occurred. Please try again.', 'error');
  }
}

async function createUserRecord(userId, email, name) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/users`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        id: userId,
        email: email,
        name: name
      })
    });
  } catch (error) {
    console.error('Error creating user record:', error);
  }
}

async function sendWelcomeEmail(name, email) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-welcome-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        name: name,
        email: email
      })
    });
  } catch (error) {
    console.error('Error sending welcome email:', error);
  }
}

// Add event listeners for signup/login buttons
document.addEventListener('DOMContentLoaded', function() {
  // Signup modal buttons
  const cancelSignupBtn = document.getElementById('cancelSignupBtn');
  const confirmSignupBtn = document.getElementById('confirmSignupBtn');
  const cancelLoginBtn = document.getElementById('cancelLoginBtn');
  const confirmLoginBtn = document.getElementById('confirmLoginBtn');
  
  if (cancelSignupBtn) cancelSignupBtn.addEventListener('click', closeSignupModal);
  if (confirmSignupBtn) confirmSignupBtn.addEventListener('click', handleSignup);
  if (cancelLoginBtn) cancelLoginBtn.addEventListener('click', closeSignupModal);
  if (confirmLoginBtn) confirmLoginBtn.addEventListener('click', handleLogin);
  
  // Close modal on overlay click
  const signupModal = document.getElementById('signupModal');
  if (signupModal) {
    signupModal.addEventListener('click', function(e) {
      if (e.target === signupModal) {
        closeSignupModal();
      }
    });
  }
  
  // Enter key handling for forms
  const signupPassword = document.getElementById('signupPassword');
  const loginPassword = document.getElementById('loginPassword');
  
  if (signupPassword) {
    signupPassword.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') handleSignup();
    });
  }
  
  if (loginPassword) {
    loginPassword.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') handleLogin();
    });
  }
});

// Award points for claiming a gift
async function awardClaimPoints(email, name, productId) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/award_points`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_user_id: null,
        p_email: email,
        p_name: name,
        p_event_type: 'claim',
        p_points: 10,
        p_description: 'Claimed a gift',
        p_product_id: productId,
        p_list_id: null
      })
    });
  } catch (error) {
    console.error('Error awarding claim points:', error);
  }
}