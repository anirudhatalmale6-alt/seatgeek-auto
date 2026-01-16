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

  // Click on a listing element - try multiple strategies
  async function clickMapElement(item) {
    console.log('[SeatGeek] Attempting to click on $' + item.price);

    const element = item.element;
    const rect = item.rect || element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    console.log('[SeatGeek] Element:', element.tagName, element.className);
    console.log('[SeatGeek] Click position:', centerX, centerY);

    // Highlight the element first so user can see what we're clicking
    try {
      element.style.outline = '3px solid #28a745';
      element.style.outlineOffset = '2px';
    } catch (e) {}

    // Strategy 1: Scroll element into view and use native click
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await delay(300);

    // Strategy 2: Try clicking the element directly
    element.click();
    console.log('[SeatGeek] Direct click done');
    await delay(200);

    // Strategy 3: Find any clickable children (buttons, links, divs with click handlers)
    const clickableChildren = element.querySelectorAll('button, a, [role="button"], [onclick]');
    for (const child of clickableChildren) {
      console.log('[SeatGeek] Clicking child:', child.tagName);
      child.click();
      await delay(100);
    }

    // Strategy 4: Walk up to find the actual clickable container
    let parent = element;
    for (let i = 0; i < 10 && parent; i++) {
      const cursor = getComputedStyle(parent).cursor;
      const role = parent.getAttribute('role');

      if (cursor === 'pointer' || role === 'button' || parent.onclick) {
        console.log('[SeatGeek] Found clickable parent:', parent.tagName, parent.className.substring(0, 50));
        parent.click();

        // Also dispatch mouse events
        const mouseEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: centerX,
          clientY: centerY
        });
        parent.dispatchEvent(mouseEvent);
        await delay(100);
      }
      parent = parent.parentElement;
    }

    // Strategy 5: Simulate real mouse interaction at coordinates
    const elemAtPoint = document.elementFromPoint(centerX, centerY);
    if (elemAtPoint) {
      console.log('[SeatGeek] Element at point:', elemAtPoint.tagName, elemAtPoint.className.substring(0, 50));

      // Full mouse event sequence
      ['mouseenter', 'mouseover', 'mousemove', 'mousedown'].forEach(type => {
        elemAtPoint.dispatchEvent(new MouseEvent(type, {
          bubbles: true, cancelable: true, view: window,
          clientX: centerX, clientY: centerY
        }));
      });

      await delay(50);

      ['mouseup', 'click'].forEach(type => {
        elemAtPoint.dispatchEvent(new MouseEvent(type, {
          bubbles: true, cancelable: true, view: window,
          clientX: centerX, clientY: centerY
        }));
      });

      // Try pointer events too
      try {
        elemAtPoint.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, pointerId: 1,
          clientX: centerX, clientY: centerY
        }));
        await delay(50);
        elemAtPoint.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true, cancelable: true, pointerId: 1,
          clientX: centerX, clientY: centerY
        }));
      } catch (e) {}
    }

    return true;
  }

  // Try to sort listings by lowest price first
  async function sortByLowestPrice() {
    console.log('[SeatGeek] Looking for sort/filter options...');

    // Look for sort dropdown or "Lowest Price" option
    const sortButtons = document.querySelectorAll('button, [role="button"], select, [class*="sort"], [class*="Sort"], [class*="filter"], [class*="Filter"]');

    for (const btn of sortButtons) {
      const text = (btn.textContent || '').toLowerCase();
      if (text.includes('sort') || text.includes('price') || text.includes('low')) {
        console.log('[SeatGeek] Found sort element:', text.substring(0, 50));
        btn.click();
        await delay(500);

        // Look for "Lowest Price" option in dropdown
        const options = document.querySelectorAll('[role="option"], [role="menuitem"], li, option');
        for (const opt of options) {
          const optText = (opt.textContent || '').toLowerCase();
          if (optText.includes('low') || optText.includes('price')) {
            console.log('[SeatGeek] Clicking lowest price option:', optText);
            opt.click();
            await delay(1000);
            return true;
          }
        }
      }
    }

    // Alternative: scroll the listing panel to load more items
    const listContainer = document.querySelector('[class*="ListingList"], [class*="listing-list"], [class*="scroll"]');
    if (listContainer) {
      console.log('[SeatGeek] Scrolling listing panel to load more...');
      listContainer.scrollTop = 0; // Scroll to top first
      await delay(500);
    }

    return false;
  }

  // Main auto-select function
  async function autoSelect() {
    console.log('[SeatGeek] ========== Starting Auto Select ==========');
    console.log('[SeatGeek] Max price:', config.maxPrice);
    showNotification('Looking for lowest price tickets...');

    await delay(500);

    // STEP 0: Try to sort by lowest price first
    await sortByLowestPrice();
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

  console.log('[SeatGeek] v6.2 Ready - Press Alt+S to auto-select lowest price listing');
})();
