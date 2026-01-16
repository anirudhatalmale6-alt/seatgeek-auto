/**
 * SeatGeek Auto Select - Content Script
 * Press Alt+S to auto-select lowest price tickets with configured quantity
 */

(function() {
  console.log('[SeatGeek] Content script loaded on:', window.location.href);

  // Default config
  let config = {
    maxPrice: 999999,  // No limit by default
    quantity: 6        // Default 6 tickets
  };

  // Load config from storage
  chrome.storage.sync.get(['seatgeek_config'], (result) => {
    if (result.seatgeek_config) {
      config = result.seatgeek_config;
      console.log('[SeatGeek] Config loaded:', config);
    }
  });

  function showNotification(message, isError = false) {
    const existing = document.getElementById('seatgeek-notification');
    if (existing) existing.remove();

    const notif = document.createElement('div');
    notif.id = 'seatgeek-notification';
    notif.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${isError ? '#dc3545' : '#28a745'};
      color: white;
      padding: 16px 24px;
      border-radius: 8px;
      z-index: 9999999;
      font-family: sans-serif;
      font-size: 14px;
      font-weight: bold;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    notif.textContent = message;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 4000);
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Parse price from text (e.g. "$85" -> 85)
  function parsePrice(text) {
    if (!text) return Infinity;
    const match = text.replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : Infinity;
  }

  // Find all ticket listings on the page
  function findTicketListings() {
    const listings = [];

    // SeatGeek uses various selectors for ticket listings
    // Look for price elements and their parent containers
    const priceElements = document.querySelectorAll('[class*="price"], [class*="Price"], [data-testid*="price"]');

    priceElements.forEach(el => {
      const priceText = el.textContent;
      const price = parsePrice(priceText);

      if (price < Infinity && price > 0) {
        // Find the clickable parent or the listing container
        const listing = el.closest('button') ||
                       el.closest('a') ||
                       el.closest('[class*="listing"]') ||
                       el.closest('[class*="Listing"]') ||
                       el.closest('[role="button"]') ||
                       el.closest('[data-testid*="listing"]');

        if (listing && !listings.find(l => l.element === listing)) {
          listings.push({
            element: listing,
            price: price,
            priceText: priceText
          });
        }
      }
    });

    // Also look for rows/cards with prices
    const rows = document.querySelectorAll('[class*="row"], [class*="Row"], [class*="card"], [class*="Card"], [class*="ticket"], [class*="Ticket"]');
    rows.forEach(row => {
      const priceEl = row.querySelector('[class*="price"], [class*="Price"]');
      if (priceEl) {
        const price = parsePrice(priceEl.textContent);
        if (price < Infinity && price > 0 && !listings.find(l => l.element === row)) {
          listings.push({
            element: row,
            price: price,
            priceText: priceEl.textContent
          });
        }
      }
    });

    // Sort by price (lowest first)
    listings.sort((a, b) => a.price - b.price);

    console.log('[SeatGeek] Found listings:', listings.length);
    listings.slice(0, 5).forEach((l, i) => {
      console.log(`[SeatGeek] #${i + 1}: $${l.price}`);
    });

    return listings;
  }

  // Set quantity on the page
  async function setQuantity(qty) {
    console.log('[SeatGeek] Setting quantity to:', qty);

    // Look for quantity selector/dropdown
    const qtySelectors = [
      'select[class*="quantity"]',
      'select[class*="Quantity"]',
      '[class*="quantity"] select',
      '[class*="Quantity"] select',
      'select[name*="quantity"]',
      '[data-testid*="quantity"] select',
      'select'
    ];

    for (const selector of qtySelectors) {
      const select = document.querySelector(selector);
      if (select && select.tagName === 'SELECT') {
        // Find option with matching quantity
        const options = Array.from(select.options);
        const targetOption = options.find(opt =>
          opt.value === String(qty) ||
          opt.textContent.includes(String(qty))
        );

        if (targetOption) {
          select.value = targetOption.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          console.log('[SeatGeek] Quantity set via select');
          return true;
        }
      }
    }

    // Try clicking quantity buttons (+ / -)
    const qtyInput = document.querySelector('input[class*="quantity"], input[class*="Quantity"], input[type="number"]');
    if (qtyInput) {
      qtyInput.value = qty;
      qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
      qtyInput.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('[SeatGeek] Quantity set via input');
      return true;
    }

    // Check URL for quantity parameter and update if needed
    const url = new URL(window.location.href);
    if (url.searchParams.get('quantity') !== String(qty)) {
      url.searchParams.set('quantity', qty);
      // Don't navigate, just log
      console.log('[SeatGeek] URL quantity param:', url.searchParams.get('quantity'));
    }

    return false;
  }

  // Main auto-select function
  async function autoSelect() {
    console.log('[SeatGeek] Starting auto-select...');
    console.log('[SeatGeek] Config:', config);
    showNotification('Searching for lowest price tickets...');

    await delay(500);

    // Find all listings
    const listings = findTicketListings();

    if (listings.length === 0) {
      showNotification('No ticket listings found on page', true);
      return;
    }

    // Filter by max price
    const affordable = listings.filter(l => l.price <= config.maxPrice);

    if (affordable.length === 0) {
      showNotification(`No tickets under $${config.maxPrice}. Lowest: $${listings[0].price}`, true);
      return;
    }

    // Get the cheapest option
    const cheapest = affordable[0];
    console.log('[SeatGeek] Cheapest ticket: $' + cheapest.price);

    showNotification(`Found! $${cheapest.price} - Clicking...`);

    // Click on the listing
    await delay(300);

    if (cheapest.element) {
      cheapest.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await delay(500);

      // Highlight the element
      cheapest.element.style.outline = '3px solid #28a745';
      cheapest.element.style.outlineOffset = '2px';

      // Click it
      cheapest.element.click();

      console.log('[SeatGeek] Clicked on cheapest listing');
      showNotification(`Selected: $${cheapest.price} tickets!`);

      // Try to set quantity after clicking
      await delay(1000);
      await setQuantity(config.quantity);
    }
  }

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'autoSelect') {
      autoSelect();
    }
    if (message.action === 'updateConfig') {
      config = message.config;
      console.log('[SeatGeek] Config updated:', config);
    }
  });

  // Also listen for Alt+S keypress directly
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.code === 'KeyS') {
      e.preventDefault();
      console.log('[SeatGeek] Alt+S detected via keydown');
      autoSelect();
    }
  });

  // Create overlay button
  function createOverlay() {
    if (document.getElementById('seatgeek-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'seatgeek-overlay';
    overlay.innerHTML = `
      <style>
        #seatgeek-overlay {
          position: fixed;
          bottom: 20px;
          left: 20px;
          z-index: 9999999;
          font-family: Arial, sans-serif;
        }
        #seatgeek-overlay .btn {
          background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
          color: white;
          border: none;
          padding: 12px 20px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: bold;
          cursor: pointer;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        }
        #seatgeek-overlay .btn:hover {
          background: linear-gradient(135deg, #5CBF60 0%, #4CAF50 100%);
        }
      </style>
      <button class="btn" id="seatgeek-auto-btn">🎫 AUTO SELECT (Alt+S)</button>
    `;
    document.body.appendChild(overlay);

    document.getElementById('seatgeek-auto-btn').addEventListener('click', autoSelect);
  }

  // Add overlay after page loads
  setTimeout(createOverlay, 1500);

  console.log('[SeatGeek] Ready! Press Alt+S to auto-select lowest price tickets.');
})();
