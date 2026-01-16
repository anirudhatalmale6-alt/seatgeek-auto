/**
 * SeatGeek Auto Select - Content Script
 * Press Alt+S to auto-select lowest price tickets
 * v3.0 - Prioritizes MAP prices over sidebar, clicks on map sections first
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

  // Find ALL price markers on the stadium map (SVG)
  function findAllMapPrices() {
    const prices = [];

    // Get ALL SVG elements on the page
    const svgElements = document.querySelectorAll('svg');
    console.log('[SeatGeek] Found SVG elements:', svgElements.length);

    svgElements.forEach(svg => {
      // Find all text elements that contain prices
      const textElements = svg.querySelectorAll('text');
      console.log('[SeatGeek] Found text elements in SVG:', textElements.length);

      textElements.forEach(textEl => {
        const text = textEl.textContent.trim();

        // Match price patterns: $61, +$94, $130, etc.
        if (text.match(/^\+?\$\d+$/)) {
          const price = parsePrice(text);

          if (price > 0 && price < 10000) {
            // Find the clickable parent group
            let clickableParent = textEl.closest('g');

            // Walk up to find a group that has event handlers or is clickable
            let parent = textEl.parentElement;
            while (parent && parent !== svg) {
              if (parent.tagName === 'g' || parent.hasAttribute('data-section') ||
                  parent.hasAttribute('data-id') || parent.classList.length > 0) {
                clickableParent = parent;
              }
              parent = parent.parentElement;
            }

            prices.push({
              element: clickableParent || textEl,
              textElement: textEl,
              price: price,
              text: text
            });

            console.log('[SeatGeek] Found map price:', text, '- Element:', clickableParent?.tagName || textEl.tagName);
          }
        }
      });
    });

    // Also look for price markers outside SVG (some sites use div overlays)
    const priceOverlays = document.querySelectorAll('[class*="price-marker"], [class*="PriceMarker"], [class*="section-price"]');
    priceOverlays.forEach(el => {
      const text = el.textContent.trim();
      if (text.match(/^\+?\$\d+$/)) {
        const price = parsePrice(text);
        if (price > 0 && price < 10000) {
          prices.push({
            element: el,
            textElement: el,
            price: price,
            text: text
          });
        }
      }
    });

    // Sort by price (lowest first)
    prices.sort((a, b) => a.price - b.price);

    console.log('[SeatGeek] Total map prices found:', prices.length);
    prices.slice(0, 10).forEach((p, i) => {
      console.log(`[SeatGeek] #${i + 1}: $${p.price}`);
    });

    return prices;
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
    showNotification('Scanning stadium map for lowest prices...');

    await delay(500);

    // STEP 1: Find ALL prices on the map
    const mapPrices = findAllMapPrices();

    if (mapPrices.length === 0) {
      showNotification('No prices found on map!', true);
      return;
    }

    // STEP 2: Filter by max price
    const affordable = mapPrices.filter(p => p.price <= config.maxPrice);

    if (affordable.length === 0) {
      const lowestFound = mapPrices[0].price;
      showNotification(`No tickets under $${config.maxPrice}. Lowest found: $${lowestFound}`, true);
      return;
    }

    // STEP 3: Get the cheapest
    const cheapest = affordable[0];
    console.log('[SeatGeek] *** Cheapest ticket: $' + cheapest.price + ' ***');
    showNotification(`Found lowest: $${cheapest.price} - Clicking...`);

    await delay(300);

    // STEP 4: Click on the map section
    await clickMapElement(cheapest);

    showNotification(`Clicked on $${cheapest.price} section!`);

    // STEP 5: Wait for tickets to load and look for checkout
    await delay(2000);

    // Look for any buy/checkout buttons
    const buttons = document.querySelectorAll('button, [role="button"], a');
    for (const btn of buttons) {
      const text = (btn.textContent || '').toLowerCase();
      if (text.includes('buy') || text.includes('checkout') || text.includes('get ticket') || text.includes('continue')) {
        btn.style.outline = '3px solid #ff9800';
        btn.style.outlineOffset = '2px';
        console.log('[SeatGeek] Buy button found:', btn.textContent.trim());
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

  console.log('[SeatGeek] v3.0 Ready - Press Alt+S to find lowest price on MAP');
})();
