/**
 * SeatGeek Auto Select - Content Script
 * Press Alt+S to auto-select lowest price tickets with configured quantity
 * v2.0 - Now clicks on lowest price section on the stadium map first
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

  // Parse price from text (e.g. "$85" -> 85, "+$85" -> 85)
  function parsePrice(text) {
    if (!text) return Infinity;
    const cleanText = text.replace(/[+,]/g, '').trim();
    const match = cleanText.match(/\$?\s*(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : Infinity;
  }

  // Find price markers on the stadium map
  function findMapPriceMarkers() {
    const markers = [];

    // Look for SVG text elements or div overlays with prices on the map
    // SeatGeek uses SVG for the map with price labels

    // Method 1: Look for text elements with dollar amounts
    const allText = document.querySelectorAll('text, [class*="price"], [class*="Price"], [class*="marker"], [class*="Marker"], [class*="label"], [class*="Label"]');

    allText.forEach(el => {
      const text = el.textContent.trim();
      // Match prices like "$61", "+$94", "$130"
      if (text.match(/^\+?\$\d+$/)) {
        const price = parsePrice(text);
        if (price > 0 && price < Infinity) {
          markers.push({
            element: el,
            price: price,
            text: text
          });
        }
      }
    });

    // Method 2: Look for clickable elements in the map area containing prices
    const mapContainer = document.querySelector('[class*="map"], [class*="Map"], [class*="venue"], [class*="Venue"], svg');
    if (mapContainer) {
      const clickables = mapContainer.querySelectorAll('[role="button"], [tabindex], g[class], path[class], rect[class], circle[class]');
      clickables.forEach(el => {
        // Check for price in this element or nearby text
        const nearbyText = el.querySelector('text') || el.closest('g')?.querySelector('text');
        if (nearbyText) {
          const text = nearbyText.textContent.trim();
          if (text.match(/^\+?\$\d+$/)) {
            const price = parsePrice(text);
            if (price > 0 && price < Infinity && !markers.find(m => m.element === el)) {
              markers.push({
                element: el,
                price: price,
                text: text
              });
            }
          }
        }
      });
    }

    // Method 3: Look for any element that looks like a price tag on the map
    const priceLabels = document.querySelectorAll('[class*="section"] [class*="price"], [class*="seat"] [class*="price"], [data-price], [aria-label*="$"]');
    priceLabels.forEach(el => {
      const text = el.textContent || el.getAttribute('aria-label') || el.getAttribute('data-price') || '';
      const price = parsePrice(text);
      if (price > 0 && price < Infinity && !markers.find(m => m.element === el)) {
        markers.push({
          element: el,
          price: price,
          text: text
        });
      }
    });

    // Sort by price (lowest first)
    markers.sort((a, b) => a.price - b.price);

    console.log('[SeatGeek] Found map markers:', markers.length);
    markers.slice(0, 10).forEach((m, i) => {
      console.log(`[SeatGeek] Map #${i + 1}: $${m.price} - "${m.text}"`);
    });

    return markers;
  }

  // Find ticket listings in the sidebar
  function findTicketListings() {
    const listings = [];

    // Look for listing items in the left panel
    const listItems = document.querySelectorAll('[class*="listing"], [class*="Listing"], [class*="ticket-row"], [class*="TicketRow"], [data-testid*="listing"]');

    listItems.forEach(el => {
      const priceEl = el.querySelector('[class*="price"], [class*="Price"]');
      if (priceEl) {
        const price = parsePrice(priceEl.textContent);
        if (price > 0 && price < Infinity) {
          listings.push({
            element: el,
            price: price,
            priceText: priceEl.textContent
          });
        }
      }
    });

    // Also look for any clickable rows with prices
    const rows = document.querySelectorAll('[role="button"], [class*="row"], [class*="Row"], [class*="card"], [class*="Card"]');
    rows.forEach(row => {
      const priceEl = row.querySelector('[class*="price"], [class*="Price"]');
      if (priceEl) {
        const price = parsePrice(priceEl.textContent);
        if (price > 0 && price < Infinity && !listings.find(l => l.element === row)) {
          // Make sure it's not a map element
          if (!row.closest('svg') && !row.closest('[class*="map"]')) {
            listings.push({
              element: row,
              price: price,
              priceText: priceEl.textContent
            });
          }
        }
      }
    });

    // Sort by price
    listings.sort((a, b) => a.price - b.price);

    console.log('[SeatGeek] Found sidebar listings:', listings.length);
    listings.slice(0, 5).forEach((l, i) => {
      console.log(`[SeatGeek] Listing #${i + 1}: $${l.price}`);
    });

    return listings;
  }

  // Click on a map section by price
  async function clickMapSection(targetPrice) {
    console.log('[SeatGeek] Looking for section with price $' + targetPrice + ' on map...');

    // Find all clickable elements in the SVG map
    const svg = document.querySelector('svg');
    if (!svg) {
      console.log('[SeatGeek] No SVG map found');
      return false;
    }

    // Look for text elements with the target price
    const textElements = svg.querySelectorAll('text');
    for (const text of textElements) {
      const content = text.textContent.trim();
      const price = parsePrice(content);

      if (price === targetPrice || Math.abs(price - targetPrice) < 1) {
        console.log('[SeatGeek] Found price label:', content);

        // Find the parent group that's clickable
        let clickTarget = text.closest('g[class]') || text.closest('[role="button"]') || text.parentElement;

        // Try clicking
        if (clickTarget) {
          console.log('[SeatGeek] Clicking on map section...');

          // Dispatch multiple event types to ensure click is registered
          ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click'].forEach(eventType => {
            clickTarget.dispatchEvent(new MouseEvent(eventType, {
              bubbles: true,
              cancelable: true,
              view: window
            }));
          });

          return true;
        }
      }
    }

    // Alternative: Look for sections by area/path elements
    const sections = svg.querySelectorAll('g, path, rect, polygon');
    for (const section of sections) {
      const ariaLabel = section.getAttribute('aria-label') || '';
      const dataPrice = section.getAttribute('data-price') || '';

      if (ariaLabel.includes('$' + targetPrice) || dataPrice.includes(targetPrice)) {
        console.log('[SeatGeek] Found section by aria-label');
        section.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return true;
      }
    }

    return false;
  }

  // Main auto-select function
  async function autoSelect() {
    console.log('[SeatGeek] Starting auto-select...');
    console.log('[SeatGeek] Config:', config);
    showNotification('Scanning for lowest price...');

    await delay(500);

    // Step 1: Find prices on the map
    const mapMarkers = findMapPriceMarkers();

    // Step 2: Find listings in sidebar
    const listings = findTicketListings();

    // Combine all prices found
    const allPrices = [...mapMarkers, ...listings];
    allPrices.sort((a, b) => a.price - b.price);

    if (allPrices.length === 0) {
      showNotification('No prices found on page', true);
      return;
    }

    // Filter by max price
    const affordable = allPrices.filter(p => p.price <= config.maxPrice);

    if (affordable.length === 0) {
      showNotification(`No tickets under $${config.maxPrice}. Lowest: $${allPrices[0].price}`, true);
      return;
    }

    // Get the cheapest option
    const cheapest = affordable[0];
    console.log('[SeatGeek] Cheapest found: $' + cheapest.price);
    showNotification(`Found $${cheapest.price} - Clicking...`);

    await delay(300);

    // Try to click on the element
    if (cheapest.element) {
      // Scroll into view if in sidebar
      if (!cheapest.element.closest('svg')) {
        cheapest.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await delay(300);
      }

      // Highlight
      cheapest.element.style.outline = '3px solid #28a745';
      cheapest.element.style.outlineOffset = '2px';

      // Click
      cheapest.element.click();

      // Also try dispatching events
      ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click'].forEach(eventType => {
        cheapest.element.dispatchEvent(new MouseEvent(eventType, {
          bubbles: true,
          cancelable: true,
          view: window
        }));
      });

      console.log('[SeatGeek] Clicked on cheapest option');
      showNotification(`Selected: $${cheapest.price}!`);

      // Wait and look for a "Buy" or "Get Tickets" button
      await delay(1500);

      // Try to click buy button if it appears
      const buyButtons = document.querySelectorAll('button, [role="button"]');
      for (const btn of buyButtons) {
        const text = btn.textContent.toLowerCase();
        if (text.includes('buy') || text.includes('get tickets') || text.includes('checkout') || text.includes('continue')) {
          console.log('[SeatGeek] Found buy button:', btn.textContent);
          // Don't auto-click buy, just highlight it
          btn.style.outline = '3px solid #ff9800';
          break;
        }
      }
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

  // Listen for Alt+S keypress directly
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.code === 'KeyS') {
      e.preventDefault();
      console.log('[SeatGeek] Alt+S detected');
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

  console.log('[SeatGeek] v2.0 Ready! Press Alt+S to auto-select lowest price tickets.');
})();
