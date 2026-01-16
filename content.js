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

  // Try to find ALL ticket data from SeatGeek's internal state
  function findAllTicketData() {
    console.log('[SeatGeek] Searching for internal ticket data...');
    const allTickets = [];

    // Method 1: Look for React/Redux state in window
    try {
      // Check for __NEXT_DATA__ (Next.js)
      const nextData = document.getElementById('__NEXT_DATA__');
      if (nextData) {
        const data = JSON.parse(nextData.textContent);
        console.log('[SeatGeek] Found __NEXT_DATA__');
        // Search for listings in the data
        const searchData = (obj, path = '') => {
          if (!obj || typeof obj !== 'object') return;
          if (Array.isArray(obj)) {
            obj.forEach((item, i) => searchData(item, `${path}[${i}]`));
          } else {
            if (obj.price && obj.section) {
              allTickets.push({ price: obj.price, section: obj.section, row: obj.row, data: obj });
            }
            if (obj.listings && Array.isArray(obj.listings)) {
              obj.listings.forEach(l => {
                if (l.price) allTickets.push({ price: l.price, section: l.section, row: l.row, data: l });
              });
            }
            Object.keys(obj).forEach(key => searchData(obj[key], `${path}.${key}`));
          }
        };
        searchData(data);
      }
    } catch (e) {
      console.log('[SeatGeek] Error parsing __NEXT_DATA__:', e);
    }

    // Method 2: Look for window.__PRELOADED_STATE__ or similar
    const stateKeys = ['__PRELOADED_STATE__', '__INITIAL_STATE__', '__APP_STATE__', 'INITIAL_DATA', '__data'];
    for (const key of stateKeys) {
      try {
        if (window[key]) {
          console.log('[SeatGeek] Found window.' + key);
          const searchState = (obj) => {
            if (!obj || typeof obj !== 'object') return;
            if (obj.price && typeof obj.price === 'number') {
              allTickets.push({ price: obj.price, section: obj.section, data: obj });
            }
            if (Array.isArray(obj)) {
              obj.forEach(searchState);
            } else {
              Object.values(obj).forEach(searchState);
            }
          };
          searchState(window[key]);
        }
      } catch (e) {}
    }

    // Method 3: Look for script tags with JSON data
    document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"]').forEach(script => {
      try {
        const data = JSON.parse(script.textContent);
        if (data.offers || data.listings) {
          const items = data.offers || data.listings;
          if (Array.isArray(items)) {
            items.forEach(item => {
              if (item.price) allTickets.push({ price: parseFloat(item.price), data: item });
            });
          }
        }
      } catch (e) {}
    });

    console.log('[SeatGeek] Found', allTickets.length, 'tickets in internal data');
    return allTickets;
  }

  // Click on different parts of the map to load all sections
  async function scanEntireMap() {
    console.log('[SeatGeek] Scanning entire stadium map...');
    showNotification('Scanning stadium map for all prices...');

    // Find the map canvas
    const mapCanvas = document.querySelector('canvas.mapboxgl-canvas, canvas[class*="mapbox"]');
    if (!mapCanvas) {
      console.log('[SeatGeek] Map canvas not found');
      return [];
    }

    const rect = mapCanvas.getBoundingClientRect();
    console.log('[SeatGeek] Map bounds:', rect.width, 'x', rect.height);

    const allPricesFound = new Map(); // price -> section info

    // Click on a grid of points across the map
    const gridSize = 6; // 6x6 grid = 36 clicks
    const stepX = rect.width / (gridSize + 1);
    const stepY = rect.height / (gridSize + 1);

    for (let row = 1; row <= gridSize; row++) {
      for (let col = 1; col <= gridSize; col++) {
        const x = rect.left + (col * stepX);
        const y = rect.top + (row * stepY);

        // Simulate mouse move to this position (triggers price popup)
        const moveEvent = new MouseEvent('mousemove', {
          bubbles: true, cancelable: true, view: window,
          clientX: x, clientY: y
        });
        mapCanvas.dispatchEvent(moveEvent);
        await delay(80);

        // Check for any price popup that appeared
        const popups = document.querySelectorAll('[class*="popup"], [class*="tooltip"], [class*="Popup"], [class*="Tooltip"], [class*="marker"], [class*="Marker"], [class*="price"], [class*="Price"]');
        popups.forEach(popup => {
          const text = popup.textContent || '';
          const priceMatch = text.match(/\$(\d+)/);
          if (priceMatch) {
            const price = parseInt(priceMatch[1]);
            if (!allPricesFound.has(price)) {
              allPricesFound.set(price, { price, x, y, text: text.substring(0, 100) });
              console.log('[SeatGeek] Map scan found: $' + price + ' at grid(' + col + ',' + row + ')');
            }
          }
        });
      }
      // Update progress
      showNotification(`Scanning map... Row ${row}/${gridSize}`);
    }

    // Convert to array and sort
    const prices = Array.from(allPricesFound.values());
    prices.sort((a, b) => a.price - b.price);

    console.log('[SeatGeek] Map scan complete. Found', prices.length, 'unique prices');
    if (prices.length > 0) {
      console.log('[SeatGeek] Cheapest from map scan: $' + prices[0].price);
    }
    return prices;
  }

  // Click on a specific point on the map canvas
  async function clickOnMapPoint(x, y) {
    const mapCanvas = document.querySelector('canvas.mapboxgl-canvas, canvas[class*="mapbox"]');
    if (!mapCanvas) return false;

    console.log('[SeatGeek] Clicking map at:', x, y);

    // Full mouse event sequence on canvas
    const events = ['mouseenter', 'mouseover', 'mousemove', 'mousedown', 'mouseup', 'click'];
    for (const type of events) {
      mapCanvas.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: x, clientY: y, button: 0
      }));
      await delay(30);
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
    showNotification('Scanning ENTIRE stadium for lowest price...');

    await delay(300);

    // STEP 0: Scan the entire map by moving mouse across it
    const mapPrices = await scanEntireMap();

    if (mapPrices.length > 0) {
      // Found prices by scanning the map!
      const cheapestMap = mapPrices.find(p => p.price <= config.maxPrice);
      if (cheapestMap) {
        console.log('[SeatGeek] *** Found $' + cheapestMap.price + ' on map! ***');
        showNotification(`Found $${cheapestMap.price} on map! Clicking...`);

        // Click on this location on the map
        await clickOnMapPoint(cheapestMap.x, cheapestMap.y);
        await delay(1500);

        // Now the sidebar should show this section's tickets
        showNotification(`Clicked $${cheapestMap.price} section. Loading tickets...`);
        await delay(1000);
      } else {
        const lowestOnMap = mapPrices[0].price;
        showNotification(`No tickets under $${config.maxPrice} on map. Lowest: $${lowestOnMap}`, true);
        return;
      }
    }

    // STEP 1: Find all listing cards in sidebar (should now have cheaper tickets)
    const listings = findListingCards();

    if (listings.length === 0) {
      // Try to find internal data as fallback
      const internalTickets = findAllTicketData();
      if (internalTickets.length > 0) {
        internalTickets.sort((a, b) => a.price - b.price);
        console.log('[SeatGeek] Found', internalTickets.length, 'tickets in internal data');
      }
      showNotification('No ticket listings found! Try clicking on the map first.', true);
      return;
    }

    // STEP 2: Filter by max price
    const affordable = listings.filter(l => l.price <= config.maxPrice);

    if (affordable.length === 0) {
      const lowestFound = listings[0].price;
      showNotification(`No tickets under $${config.maxPrice}. Lowest in sidebar: $${lowestFound}`, true);
      return;
    }

    // STEP 3: Get the cheapest
    const cheapest = affordable[0];
    console.log('[SeatGeek] *** Cheapest ticket in sidebar: $' + cheapest.price + ' ***');
    showNotification(`Found $${cheapest.price} - Clicking...`);

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

  console.log('[SeatGeek] v8.0 Ready - Press Alt+S to scan ENTIRE stadium map');
})();
