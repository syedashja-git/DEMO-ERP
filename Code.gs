/*
 * ERP -> Google Sheets receiver
 * Is code ko target Google Sheet > Extensions > Apps Script mein paste karein.
 * Deploy > New deployment > Web app; Execute as: Me; Who has access: Anyone.
 */
const SHEETS_SECRET = 'erp-alpha-sheets-2026';

function doGet() {
  return jsonOutput_({ success: true, service: 'ERP Google Sheets Sync' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (payload.secret !== SHEETS_SECRET) {
      return jsonOutput_({ success: false, error: 'Unauthorized' });
    }
    if (!payload.data || typeof payload.data !== 'object') {
      return jsonOutput_({ success: false, error: 'Missing ERP data' });
    }

    syncSnapshot_(payload.data, payload.updatedAt || new Date().toISOString());
    return jsonOutput_({ success: true, updatedAt: new Date().toISOString() });
  } catch (err) {
    return jsonOutput_({ success: false, error: String(err && err.message ? err.message : err) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function syncSnapshot_(data, updatedAt) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const products = array_(data.products);
  const purchases = array_(data.purchases);
  const invoices = array_(data.invoices);
  const challans = array_(data.challans);
  const expenses = array_(data.expenses);
  const inventory = data.items && typeof data.items === 'object' ? data.items : {};
  const rawMaterials = array_(data.rawMaterials);
  const rawMaterialStock = data.rawMaterialStock && typeof data.rawMaterialStock === 'object' ? data.rawMaterialStock : {};
  const rawMaterialPurchases = array_(data.rawMaterialPurchases);
  const rawMaterialUsage = array_(data.rawMaterialUsage);
  const capitalEntries = array_(data.capitalEntries);
  const expenseFolders = array_(data.expenseFolders);
  const transactionHeads = array_(data.transactionHeads);
  const generalTransactions = array_(data.generalTransactions);

  writeTable_(ss, 'Products',
    ['Code', 'Product Name', 'Unit'],
    products.map(p => [p.code || '', p.name || '', p.unit || '']));

  writeTable_(ss, 'Inventory',
    ['Product Name', 'Unit', 'Quantity', 'Stock Value', 'Average Cost'],
    Object.keys(inventory).sort().map(name => {
      const item = inventory[name] || {};
      const qty = number_(item.qty);
      const value = number_(item.value);
      return [name, item.unit || '', qty, value, qty ? value / qty : 0];
    }));

  writeTable_(ss, 'Raw Materials',
    ['Code', 'Raw Material', 'Unit', 'Stock Qty', 'Average Cost', 'Stock Value'],
    rawMaterials.map(material => {
      const stock = rawMaterialStock[material.name] || {};
      const qty = number_(stock.qty);
      const value = number_(stock.value);
      return [material.code || '', material.name || '', material.unit || '', qty, qty ? value / qty : 0, value];
    }));

  writeTable_(ss, 'Raw Material Purchases',
    ['Date', 'Reference No', 'Supplier', 'Raw Material', 'Unit', 'Quantity', 'Rate', 'Total', 'Payment From'],
    rawMaterialPurchases.map(entry => [entry.date || '', entry.refNo || '', entry.supplier || '', entry.name || '', entry.unit || '', number_(entry.qty), number_(entry.rate), number_(entry.total), entry.account || 'Cash']));

  writeTable_(ss, 'Raw Material Usage',
    ['Date', 'Batch / Reference', 'Product / Production', 'Raw Material', 'Unit', 'Quantity Used', 'Average Cost', 'Production Cost'],
    rawMaterialUsage.map(entry => [entry.date || '', entry.refNo || '', entry.product || '', entry.name || '', entry.unit || '', number_(entry.qty), number_(entry.unitCost), number_(entry.total)]));

  writeTable_(ss, 'Purchases',
    ['Date', 'PO No', 'Supplier', 'Total'],
    purchases.map(p => [p.date || '', p.poNo || '', p.supplier || '', number_(p.total)]));
  writeTable_(ss, 'Purchase Items',
    ['Date', 'PO No', 'Supplier', 'Product', 'Unit', 'Quantity', 'Rate', 'Line Total'],
    flattenItems_(purchases, (p, item) => [p.date || '', p.poNo || '', p.supplier || '', item.name || '', item.unit || '', number_(item.qty), number_(item.rate), number_(item.qty) * number_(item.rate)]));

  writeTable_(ss, 'Invoices',
    ['Invoice No', 'Date', 'Customer', 'Phone', 'Address', 'Total', 'COGS'],
    invoices.map(i => [i.invoiceNo || '', i.date || '', i.customer || '', i.phone || '', i.address || '', number_(i.total), number_(i.cogs)]));
  writeTable_(ss, 'Invoice Items',
    ['Invoice No', 'Date', 'Customer', 'Product', 'Quantity', 'Rate', 'Cost', 'Line Total'],
    flattenItems_(invoices, (i, item) => [i.invoiceNo || '', i.date || '', i.customer || '', item.name || '', number_(item.qty), number_(item.rate), number_(item.cost), number_(item.qty) * number_(item.rate)]));

  writeTable_(ss, 'Challans',
    ['Challan No', 'Date', 'Customer', 'Phone', 'Address'],
    challans.map(c => [c.challanNo || '', c.date || '', c.customer || '', c.phone || '', c.address || '']));
  writeTable_(ss, 'Challan Items',
    ['Challan No', 'Date', 'Customer', 'Product', 'Unit', 'Quantity'],
    flattenItems_(challans, (c, item) => [c.challanNo || '', c.date || '', c.customer || '', item.name || '', item.unit || '', number_(item.qty)]));

  writeTable_(ss, 'Expenses',
    ['Date', 'Category', 'Description', 'Amount'],
    expenses.map(e => [e.date || '', e.category || '', e.description || '', number_(e.amount)]));

  writeTable_(ss, 'Expense Folders',
    ['Folder Name', 'Description', 'Expense Entries', 'Total Expense'],
    expenseFolders.map(folder => {
      const folderExpenses = expenses.filter(entry => (entry.category || '') === (folder.name || ''));
      return [
        folder.name || '',
        folder.description || '',
        folderExpenses.length,
        folderExpenses.reduce((sum, entry) => sum + number_(entry.amount), 0)
      ];
    }));

  writeTable_(ss, 'Capital Entries',
    ['Date', 'Type', 'Cash / Bank', 'Owner / Investor', 'Description', 'Amount'],
    capitalEntries.map(entry => [entry.date || '', entry.type === 'investment' ? 'Capital Investment' : 'Withdrawal / Drawings', entry.account || '', entry.owner || '', entry.description || '', number_(entry.amount)]));

  const rawCapitalMap = {};
  rawMaterialPurchases.forEach(entry => {
    const name = entry.name || 'Unknown Raw Material';
    if (!rawCapitalMap[name]) rawCapitalMap[name] = { code: '', unit: entry.unit || '', entries: 0, qty: 0, cash: 0, bank: 0, total: 0 };
    const row = rawCapitalMap[name];
    const material = rawMaterials.find(item => (item.name || '') === name);
    row.code = material ? (material.code || '') : row.code;
    row.unit = entry.unit || row.unit;
    row.entries += 1;
    row.qty += number_(entry.qty);
    row.total += number_(entry.total);
    if ((entry.account || 'Cash') === 'Bank') row.bank += number_(entry.total);
    else row.cash += number_(entry.total);
  });
  writeTable_(ss, 'Capital RM Utilization',
    ['Code', 'Raw Material', 'Purchase Entries', 'Unit', 'Total Quantity', 'Paid from Cash', 'Paid from Bank', 'Total Capital Used'],
    Object.keys(rawCapitalMap).sort().map(name => {
      const row = rawCapitalMap[name];
      return [row.code, name, row.entries, row.unit, row.qty, row.cash, row.bank, row.total];
    }));

  writeTable_(ss, 'Transaction Heads',
    ['Head Name', 'P&L Classification', 'Description'],
    transactionHeads.map(head => [head.name || '', head.reportType === 'income' ? 'Other Income' : head.reportType === 'expense' ? 'Other Expense' : 'Balance Sheet / No P&L Effect', head.description || '']));

  writeTable_(ss, 'General Transactions',
    ['Date', 'Head', 'Type', 'Cash / Bank', 'Reference', 'Description', 'Amount'],
    generalTransactions.map(entry => [entry.date || '', entry.headName || '', entry.type === 'receipt' ? 'Receipt / Money In' : 'Payment / Money Out', entry.account || '', entry.reference || '', entry.description || '', number_(entry.amount)]));

  const cashBankEntries = [];
  capitalEntries.forEach(entry => {
    const amount = number_(entry.amount);
    cashBankEntries.push({
      date: entry.date || '',
      account: entry.account || 'Cash',
      source: 'Capital',
      ownerHead: entry.owner || '',
      reference: '',
      description: entry.description || '',
      moneyIn: entry.type === 'investment' ? amount : 0,
      moneyOut: entry.type === 'withdrawal' ? amount : 0
    });
  });
  generalTransactions.forEach(entry => {
    const amount = number_(entry.amount);
    cashBankEntries.push({
      date: entry.date || '',
      account: entry.account || 'Cash',
      source: 'General Transaction',
      ownerHead: entry.headName || '',
      reference: entry.reference || '',
      description: entry.description || '',
      moneyIn: entry.type === 'receipt' ? amount : 0,
      moneyOut: entry.type === 'payment' ? amount : 0
    });
  });
  rawMaterialPurchases.forEach(entry => {
    cashBankEntries.push({
      date: entry.date || '',
      account: entry.account || 'Cash',
      source: 'Raw Material Purchase',
      ownerHead: entry.supplier || '',
      reference: entry.refNo || '',
      description: (entry.name || '') + ' — ' + number_(entry.qty) + ' ' + (entry.unit || '') + ' × Rs ' + number_(entry.rate) + '; Supplier: ' + (entry.supplier || '-'),
      moneyIn: 0,
      moneyOut: number_(entry.total)
    });
  });
  cashBankEntries.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const runningBalance = { Cash: 0, Bank: 0 };
  const cashBankLedgerRows = cashBankEntries.map(entry => {
    if (!Object.prototype.hasOwnProperty.call(runningBalance, entry.account)) runningBalance[entry.account] = 0;
    runningBalance[entry.account] += entry.moneyIn - entry.moneyOut;
    return [
      entry.date,
      entry.account,
      entry.source,
      entry.ownerHead,
      entry.reference,
      entry.description,
      entry.moneyIn,
      entry.moneyOut,
      runningBalance[entry.account]
    ];
  });
  writeTable_(ss, 'Cash & Bank Ledger',
    ['Date', 'Account', 'Source', 'Owner / Head', 'Reference', 'Description', 'Money In', 'Money Out', 'Running Balance'],
    cashBankLedgerRows);

  const cashBankAccounts = ['Cash', 'Bank'];
  cashBankEntries.forEach(entry => {
    if (cashBankAccounts.indexOf(entry.account) === -1) cashBankAccounts.push(entry.account);
  });
  writeTable_(ss, 'Cash & Bank Summary',
    ['Account', 'Total Money In', 'Total Money Out', 'Closing Balance'],
    cashBankAccounts.map(account => {
      const accountEntries = cashBankEntries.filter(entry => entry.account === account);
      const moneyIn = accountEntries.reduce((sum, entry) => sum + entry.moneyIn, 0);
      const moneyOut = accountEntries.reduce((sum, entry) => sum + entry.moneyOut, 0);
      return [account, moneyIn, moneyOut, moneyIn - moneyOut];
    }));

  const detailedRows = [];
  purchases.forEach(entry => array_(entry.items).forEach(item => detailedRows.push([entry.date || '', 'Finished Goods Purchase', entry.poNo || '', entry.supplier || '', (item.name || '') + ' — ' + number_(item.qty) + ' ' + (item.unit || '') + ' × Rs ' + number_(item.rate), number_(item.qty) * number_(item.rate)])));
  rawMaterialPurchases.forEach(entry => detailedRows.push([entry.date || '', 'Raw Material Purchase', entry.refNo || '', entry.supplier || '', (entry.name || '') + ' — ' + number_(entry.qty) + ' ' + (entry.unit || '') + ' × Rs ' + number_(entry.rate) + '; Paid from ' + (entry.account || 'Cash'), number_(entry.total)]));
  rawMaterialUsage.forEach(entry => detailedRows.push([entry.date || '', 'Raw Material Consumed', entry.refNo || '', entry.product || '', (entry.name || '') + ' — ' + number_(entry.qty) + ' ' + (entry.unit || '') + ' × Rs ' + number_(entry.unitCost), number_(entry.total)]));
  invoices.forEach(entry => {
    array_(entry.items).forEach(item => detailedRows.push([entry.date || '', 'Sales Invoice', entry.invoiceNo || '', entry.customer || '', (item.name || '') + ' — ' + number_(item.qty) + ' ' + (item.unit || '') + ' × Rs ' + number_(item.rate), number_(item.qty) * number_(item.rate)]));
    if (number_(entry.cartage)) detailedRows.push([entry.date || '', 'Invoice Cartage', entry.invoiceNo || '', entry.customer || '', 'Cartage / delivery charges', number_(entry.cartage)]);
  });
  challans.forEach(entry => array_(entry.items).forEach(item => detailedRows.push([entry.date || '', 'Delivery Challan', entry.challanNo || '', entry.customer || '', (item.name || '') + ' — ' + number_(item.qty) + ' ' + (item.unit || ''), 0])));
  expenses.forEach(entry => detailedRows.push([entry.date || '', 'Expense', '', entry.category || '', entry.description || '', number_(entry.amount)]));
  capitalEntries.forEach(entry => detailedRows.push([entry.date || '', entry.type === 'investment' ? 'Capital Investment' : 'Capital Withdrawal', '', entry.owner || '', (entry.account || 'Cash') + ' — ' + (entry.description || ''), number_(entry.amount)]));
  generalTransactions.forEach(entry => detailedRows.push([entry.date || '', entry.type === 'receipt' ? 'General Receipt' : 'General Payment', entry.reference || '', entry.headName || '', (entry.account || 'Cash') + ' — ' + (entry.description || ''), number_(entry.amount)]));
  detailedRows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])) || String(a[4]).localeCompare(String(b[4])));
  writeTable_(ss, 'Dashboard Detailed Report',
    ['Date', 'Type', 'Reference', 'Party / Head', 'Complete Item Description', 'Amount'],
    detailedRows);

  const sales = invoices.reduce((sum, entry) => sum + number_(entry.total), 0);
  const finishedGoodsCost = invoices.reduce((sum, entry) => sum + number_(entry.cogs), 0);
  const rawMaterialCost = rawMaterialUsage.reduce((sum, entry) => sum + number_(entry.total), 0);
  const regularExpenses = expenses.reduce((sum, entry) => sum + number_(entry.amount), 0);
  let otherIncome = 0;
  let otherExpense = 0;
  generalTransactions.forEach(entry => {
    const head = transactionHeads.find(item => item.id === entry.headId);
    if (!head) return;
    if (head.reportType === 'income') otherIncome += entry.type === 'receipt' ? number_(entry.amount) : -number_(entry.amount);
    if (head.reportType === 'expense') otherExpense += entry.type === 'payment' ? number_(entry.amount) : -number_(entry.amount);
  });
  const grossProfit = sales - finishedGoodsCost - rawMaterialCost;
  const netProfit = grossProfit + otherIncome - regularExpenses - otherExpense;
  writeTable_(ss, 'P&L Summary',
    ['Particular', 'Amount'],
    [
      ['Total Sales', sales],
      ['Less: Finished Goods Cost', -finishedGoodsCost],
      ['Less: Raw Material Consumed', -rawMaterialCost],
      ['Gross Profit', grossProfit],
      ['Other Income — General Heads', otherIncome],
      ['Daily Expenses', -regularExpenses],
      ['Other Expenses — General Heads', -otherExpense],
      ['Net Profit / Loss', netProfit]
    ]);

  writeTable_(ss, 'ERP Meta',
    ['Field', 'Value'],
    [
      ['Last Sync (UTC)', updatedAt],
      ['Products', products.length],
      ['Purchases', purchases.length],
      ['Invoices', invoices.length],
      ['Challans', challans.length],
      ['Expenses', expenses.length],
      ['Raw Materials', rawMaterials.length],
      ['Raw Material Purchases', rawMaterialPurchases.length],
      ['Raw Material Usage', rawMaterialUsage.length],
      ['Capital Entries', capitalEntries.length],
      ['Expense Folders', expenseFolders.length],
      ['Transaction Heads', transactionHeads.length],
      ['General Transactions', generalTransactions.length],
      ['Cash & Bank Ledger Entries', cashBankEntries.length]
    ]);
}

function writeTable_(ss, name, headers, rows) {
  let sheet = ss.getSheetByName(name);
  const isNewSheet = !sheet;
  if (isNewSheet) sheet = ss.insertSheet(name);
  sheet.clearContents();
  const values = [headers].concat(rows);
  sheet.getRange(1, 1, values.length, headers.length).setValues(values);
  if (sheet.getFrozenRows() !== 1) sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#17323f')
    .setFontColor('#ffffff');
  if (isNewSheet) sheet.autoResizeColumns(1, headers.length);
}

function flattenItems_(entries, mapper) {
  const rows = [];
  entries.forEach(entry => array_(entry.items).forEach(item => rows.push(mapper(entry, item))));
  return rows;
}

function array_(value) {
  return Array.isArray(value) ? value : [];
}

function number_(value) {
  const n = Number(value);
  return isFinite(n) ? n : 0;
}

function jsonOutput_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
