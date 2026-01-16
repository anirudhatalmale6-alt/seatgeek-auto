// Load saved config
chrome.storage.sync.get(['seatgeek_config'], (result) => {
  if (result.seatgeek_config) {
    document.getElementById('maxPrice').value = result.seatgeek_config.maxPrice || 100;
    document.getElementById('quantity').value = result.seatgeek_config.quantity || 6;
  }
});

// Save config
document.getElementById('saveBtn').addEventListener('click', () => {
  const config = {
    maxPrice: parseInt(document.getElementById('maxPrice').value) || 100,
    quantity: parseInt(document.getElementById('quantity').value) || 6
  };

  chrome.storage.sync.set({ seatgeek_config: config }, () => {
    document.getElementById('status').textContent = '✓ Saved!';

    // Notify content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'updateConfig', config: config });
      }
    });

    setTimeout(() => {
      document.getElementById('status').textContent = '';
    }, 2000);
  });
});
