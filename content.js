/**
 * SeatGeek Auto Select - Content Script
 * Press Alt+S to auto-select lowest price tickets
 * v4.0 - Comprehensive price detection across all element types
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

  // Find ALL price elements on the page - comprehensive search
  function findAllMapPrices() {
    const prices = [];
    const seen = new Set();

    console.log('[SeatGeek] Starting comprehensive price scan...');

    // Method 1: Scan ALL elements on page for price text
    const allElements = document.querySelectorAll('*');
    console.log('[SeatGeek] Total elements on page:', allElements.length);

    allElements.forEach(el => {
      // Skip script, style, and our own elements
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' ||
          el.id === 'seatgeek-notification' || el.id === 'seatgeek-overlay') {
        return;
      }

      // Get direct text content (not from children)
      const directText = Array.from(el.childNodes)
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent.trim())
        .join('');

      // Also check full text content for small elements
      const fullText = el.textContent?.trim() || '';

      // Check both direct text and full text (for small elements)
      const textsToCheck = [directText];
      if (fullText.length < 20) {
        textsToCheck.push(fullText);
      }

      textsToCheck.forEach(text => {
        // Match price patterns: $61, +$94, $130, $61+, From $61, etc.
        // More flexible regex to catch various formats
        if (text && (text.match(/^\+?\$\d+\+?$|^\$\d+$/) ||
                     text.match(/^From\s*\$\d+$/i) ||
                     text.match(/^\$\d+\s*(each)?$/i))) {
          const price = parsePrice(text);
          const key = `${price}-${el.getBoundingClientRect().left}-${el.getBoundingClientRect().top}`;

          if (price > 0 && price < 10000 && !seen.has(key)) {
            seen.add(key);

            // Find clickable parent
            let clickable = el;
            let parent = el.parentElement;
            for (let i = 0; i < 10 && parent; i++) {
              if (parent.onclick || parent.hasAttribute('data-section') ||
                  parent.hasAttribute('data-id') || parent.hasAttribute('role') ||
                  parent.style.cursor === 'pointer' ||
                  parent.classList.toString().match(/section|seat|price|marker|clickable/i)) {
                clickable = parent;
              }
              parent = parent.parentElement;
            }

            prices.push({
              element: clickable,
              textElement: el,
              price: price,
              text: text
            });

            console.log('[SeatGeek] Found price:', text, '- Tag:', el.tagName, '- Classes:', el.className);
          }
        }
      });
    });

    // Method 1b: Find prices using more flexible patterns (for map markers)
    const priceRegex = /\$(\d+)/g;
    allElements.forEach(el => {
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;

      // Check for small leaf elements that might contain prices
      if (el.children.length === 0) {
        const text = el.textContent?.trim() || '';
        if (text.length <= 15 && text.includes('$')) {
          const match = text.match(/\$(\d+)/);
          if (match) {
            const price = parseInt(match[1]);
            const rect = el.getBoundingClientRect();
            const key = `leaf-${price}-${Math.round(rect.left)}-${Math.round(rect.top)}`;

            if (price > 0 && price < 10000 && !seen.has(key) && rect.width > 0) {
              seen.add(key);

              // Check if element is within map area (typically left half of screen)
              const isInMapArea = rect.left < window.innerWidth * 0.7;

              let clickable = el;
              let parent = el.parentElement;
              for (let i = 0; i < 10 && parent; i++) {
                if (parent.onclick || parent.hasAttribute('data-section') ||
                    getComputedStyle(parent).cursor === 'pointer') {
                  clickable = parent;
                }
                parent = parent.parentElement;
              }

              prices.push({
                element: clickable,
                textElement: el,
                price: price,
                text: text,
                isMapPrice: isInMapArea
              });

              console.log('[SeatGeek] Found leaf price:', text, '- InMap:', isInMapArea);
            }
          }
        }
      }
    });

    // Method 2: Search in SVG elements
    const svgElements = document.querySelectorAll('svg');
    console.log('[SeatGeek] Found SVG elements:', svgElements.length);

    svgElements.forEach(svg => {
      const textElements = svg.querySelectorAll('text, tspan');
      textElements.forEach(textEl => {
        const text = textEl.textContent?.trim();
        if (text && text.match(/^\+?\$\d+\+?$/)) {
          const price = parsePrice(text);
          const key = `svg-${price}-${textEl.getBoundingClientRect().left}`;

          if (price > 0 && price < 10000 && !seen.has(key)) {
            seen.add(key);
            let clickableParent = textEl.closest('g') || textEl;

            prices.push({
              element: clickableParent,
              textElement: textEl,
              price: price,
              text: text
            });

            console.log('[SeatGeek] Found SVG price:', text);
          }
        }
      });
    });

    // Method 3: Search in Shadow DOM if present
    document.querySelectorAll('*').forEach(el => {
      if (el.shadowRoot) {
        console.log('[SeatGeek] Found shadow root in:', el.tagName);
        el.shadowRoot.querySelectorAll('*').forEach(shadowEl => {
          const text = shadowEl.textContent?.trim();
          if (text && text.match(/^\+?\$\d+\+?$/) && text.length < 10) {
            const price = parsePrice(text);
            if (price > 0 && price < 10000) {
              prices.push({
                element: shadowEl,
                textElement: shadowEl,
                price: price,
                text: text
              });
              console.log('[SeatGeek] Found shadow DOM price:', text);
            }
          }
        });
      }
    });

    // Method 4: Search in iframes (same origin only)
    document.querySelectorAll('iframe').forEach(iframe => {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iframeDoc) {
          console.log('[SeatGeek] Scanning iframe...');
          iframeDoc.querySelectorAll('*').forEach(el => {
            const text = el.textContent?.trim();
            if (text && text.match(/^\+?\$\d+\+?$/) && text.length < 10) {
              const price = parsePrice(text);
              if (price > 0 && price < 10000) {
                prices.push({
                  element: el,
                  textElement: el,
                  price: price,
                  text: text,
                  inIframe: true
                });
                console.log('[SeatGeek] Found iframe price:', text);
              }
            }
          });
        }
      } catch (e) {
        console.log('[SeatGeek] Cannot access iframe (cross-origin)');
      }
    });

    // Sort by price (lowest first), prioritizing map prices
    prices.sort((a, b) => {
      // Prioritize map prices over sidebar prices
      if (a.isMapPrice && !b.isMapPrice) return -1;
      if (!a.isMapPrice && b.isMapPrice) return 1;
      return a.price - b.price;
    });

    console.log('[SeatGeek] ====== PRICE SCAN COMPLETE ======');
    console.log('[SeatGeek] Total prices found:', prices.length);
    prices.slice(0, 20).forEach((p, i) => {
      console.log(`[SeatGeek] #${i + 1}: $${p.price} (${p.textElement.tagName}) - Map: ${p.isMapPrice || false}`);
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

  console.log('[SeatGeek] v5.0 Ready - Press Alt+S to find lowest price on MAP');
})();
