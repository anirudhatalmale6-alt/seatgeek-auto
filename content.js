/**
 * SeatGeek Auto Select - Content Script
 * Press Alt+S to auto-select lowest price tickets
 * v6.0 - Uses listing cards in sidebar (map uses canvas/WebGL, not DOM)
 */

(function() {
  console.log('[SeatGeek] Content script loaded on:', window.location.href);

  let config = {
    maxPrice: 999999,
    quantity: 6
  };

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
    setTimeout(() => notif.remove(), 5000);
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function parsePrice(text) {
    if (!text) return Infinity;
    const cleanText = text.replace(/[+,]/g, '').trim();
    const match = cleanText.match(/\$?\s*(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : Infinity;
  }

  // Find ticket listings in sidebar - these are clickable cards
  function findListingCards() {
    const listings = [];
    console.log('[SeatGeek] Searching for listing cards...');

    // Method 1: Find listing cards by common patterns
    // SeatGeek uses cards with prices, section info, and row info
    const allElements = document.querySelectorAll('*');

    allElements.forEach(el => {
      // Look for clickable listing containers
      const text = el.textContent || '';
      const rect = el.getBoundingClientRect();

      // Skip tiny or huge elements
      if (rect.height < 50 || rect.height > 300 || rect.width < 100) return;

      // Check if this looks like a listing card (has price + section/row info)
      const hasPrice = text.match(/\$\d+/);
      const hasSection = text.match(/section|row|seat/i);
      const isClickable = el.onclick || getComputedStyle(el).cursor === 'pointer' ||
                          el.getAttribute('role') === 'button' ||
                          el.tagName === 'BUTTON' || el.tagName === 'A';

      if (hasPrice && hasSection && rect.width > 0) {
        // Extract price from text
        const priceMatch = text.match(/\$(\d+)/);
        if (priceMatch) {
          const price = parseInt(priceMatch[1]);

          // Find the actual clickable parent
          let clickable = el;
          let parent = el;
          for (let i = 0; i < 5; i++) {
            if (!parent.parentElement) break;
            parent = parent.parentElement;
            if (parent.onclick || getComputedStyle(parent).cursor === 'pointer' ||
                parent.getAttribute('role') === 'button' ||
                parent.classList.toString().match(/listing|card|ticket|item/i)) {
              clickable = parent;
            }
          }

          // Check if this is a unique listing (by position)
          const key = `${Math.round(rect.top)}-${price}`;
          const existing = listings.find(l => l.key === key);
          if (!existing && price > 0 && price < 10000) {
            listings.push({
              element: clickable,
              price: price,
              text: text.substring(0, 100),
              key: key,
              rect: rect
            });
            console.log('[SeatGeek] Found listing card: $' + price);
          }
        }
      }
    });

    // Method 2: Look for specific SeatGeek listing patterns
    // The screenshot shows "ClassicLayout__PriceWrapper" class
    document.querySelectorAll('[class*="PriceWrapper"], [class*="Listing"], [class*="listing"]').forEach(el => {
      const text = el.textContent || '';
      const priceMatch = text.match(/\$(\d+)/);
      if (priceMatch) {
        const price = parseInt(priceMatch[1]);
        const rect = el.getBoundingClientRect();

        // Find clickable parent (the actual card)
        let card = el;
        let parent = el;
        for (let i = 0; i < 10; i++) {
          if (!parent.parentElement) break;
          parent = parent.parentElement;
          if (parent.getAttribute('role') === 'button' ||
              parent.tagName === 'BUTTON' ||
              parent.classList.toString().match(/card|listing|item|row/i) ||
              getComputedStyle(parent).cursor === 'pointer') {
            card = parent;
          }
        }

        const key = `wrapper-${Math.round(rect.top)}-${price}`;
        const existing = listings.find(l => l.key === key);
        if (!existing && price > 0 && price < 10000 && rect.width > 0) {
          listings.push({
            element: card,
            price: price,
            text: text.substring(0, 100),
            key: key,
            rect: rect
          });
          console.log('[SeatGeek] Found PriceWrapper listing: $' + price);
        }
      }
    });

    // Sort by price
    listings.sort((a, b) => a.price - b.price);

    // Remove duplicates (same price at similar vertical position)
    const unique = [];
    listings.forEach(listing => {
      const isDupe = unique.some(u =>
        Math.abs(u.price - listing.price) === 0 &&
        Math.abs(u.rect.top - listing.rect.top) < 20
      );
      if (!isDupe) {
        unique.push(listing);
      }
    });

    console.log('[SeatGeek] ====== LISTING SCAN COMPLETE ======');
    console.log('[SeatGeek] Unique listings found:', unique.length);
    unique.slice(0, 10).forEach((l, i) => {
      console.log(`[SeatGeek] #${i + 1}: $${l.price}`);
    });

    return unique;
  }

  // Click on a map element with proper event simulation
  async function clickMapElement(item) {
    console.log('[SeatGeek] Attempting to click on $' + item.price);

    const element = item.element;
    const textElement = item.textElement;

    // Get the bounding rect to simulate mouse position
    const rect = (textElement || element).getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    console.log('[SeatGeek] Click position:', centerX, centerY);

    // Try multiple approaches to trigger the click

    // Approach 1: Direct click on element
    element.click();

    // Approach 2: Dispatch mouse events with coordinates
    const mouseEvents = ['mouseenter', 'mouseover', 'mousemove', 'mousedown', 'mouseup', 'click'];
    for (const eventType of mouseEvents) {
      const event = new MouseEvent(eventType, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: centerX,
        clientY: centerY,
        screenX: centerX,
        screenY: centerY
      });
      element.dispatchEvent(event);
      await delay(50);
    }

    // Approach 3: Click on text element too
    if (textElement && textElement !== element) {
      textElement.click();
      for (const eventType of mouseEvents) {
        const event = new MouseEvent(eventType, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: centerX,
          clientY: centerY
        });
        textElement.dispatchEvent(event);
      }
    }

    // Approach 4: Try to find and click on any sibling path/rect elements
    const parent = element.parentElement;
    if (parent) {
      const siblings = parent.querySelectorAll('path, rect, polygon, circle');
      for (const sibling of siblings) {
        sibling.click();
        sibling.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      }
    }

    // Approach 5: Simulate pointer events (for modern touch/pointer support)
    try {
      element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: centerX, clientY: centerY }));
      await delay(50);
      element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: centerX, clientY: centerY }));
    } catch (e) {
      console.log('[SeatGeek] PointerEvent not supported');
    }

    // Highlight the element
    try {
      element.style.outline = '3px solid #28a745';
      element.style.outlineOffset = '2px';
    } catch (e) {}

    return true;
  }

  // Main auto-select function
  async function autoSelect() {
    console.log('[SeatGeek] ========== Starting Auto Select ==========');
    console.log('[SeatGeek] Max price:', config.maxPrice);
    showNotification('Scanning ticket listings...');

    await delay(500);

    // STEP 1: Find all listing cards in sidebar
    // NOTE: Map prices are on canvas (Mapbox GL) - cannot be read from DOM
    // We use the sidebar listings instead
    const listings = findListingCards();

    if (listings.length === 0) {
      showNotification('No ticket listings found! Try scrolling the listing panel.', true);
      return;
    }

    // STEP 2: Filter by max price
    const affordable = listings.filter(l => l.price <= config.maxPrice);

    if (affordable.length === 0) {
      const lowestFound = listings[0].price;
      showNotification(`No tickets under $${config.maxPrice}. Lowest found: $${lowestFound}`, true);
      return;
    }

    // STEP 3: Get the cheapest
    const cheapest = affordable[0];
    console.log('[SeatGeek] *** Cheapest ticket: $' + cheapest.price + ' ***');
    showNotification(`Found lowest: $${cheapest.price} - Clicking...`);

    await delay(300);

    // STEP 4: Click on the listing card
    await clickMapElement(cheapest);

    showNotification(`Selected $${cheapest.price} listing!`);

    // STEP 5: Wait for ticket details to load
    await delay(2000);

    // Look for Continue button and highlight it
    const buttons = document.querySelectorAll('button, [role="button"], a');
    for (const btn of buttons) {
      const text = (btn.textContent || '').toLowerCase();
      if (text.includes('continue') || text.includes('buy') || text.includes('checkout')) {
        btn.style.outline = '3px solid #ff9800';
        btn.style.outlineOffset = '2px';
        console.log('[SeatGeek] Continue/Buy button found:', btn.textContent.trim());

        // Auto-click Continue if found
        if (text.includes('continue')) {
          await delay(500);
          btn.click();
          showNotification('Clicked Continue!');
        }
        break;
      }
    }
  }

  // Listen for messages
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'autoSelect') autoSelect();
    if (message.action === 'updateConfig') {
      config = message.config;
      console.log('[SeatGeek] Config updated:', config);
    }
  });

  // Alt+S keypress
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.code === 'KeyS') {
      e.preventDefault();
      autoSelect();
    }
  });

  // Overlay button
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

  setTimeout(createOverlay, 1500);

  console.log('[SeatGeek] v6.0 Ready - Press Alt+S to auto-select lowest price listing');
})();
