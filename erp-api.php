<?php
/* erp-api.php — Browser local + MySQL + Google Sheets sync API */

require __DIR__ . '/erp-db.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$action = $_GET['action'] ?? '';
$dataKey = 'biz_data_v1';

function respond(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function readJsonBody(): array
{
    $input = json_decode(file_get_contents('php://input'), true);
    if (!is_array($input)) respond(['success' => false, 'error' => 'Invalid JSON body'], 400);
    return $input;
}

function defaultErpData(): array
{
    return [
        'products' => [],
        'items' => new stdClass(),
        'purchases' => [],
        'invoices' => [],
        'challans' => [],
        'expenses' => [],
        'rawMaterials' => [],
        'rawMaterialStock' => new stdClass(),
        'rawMaterialPurchases' => [],
        'rawMaterialUsage' => [],
        'capitalEntries' => [],
        'expenseFolders' => [],
        'expenseFoldersInitialized' => true,
        'transactionHeads' => [],
        'generalTransactions' => [],
        'counters' => ['invoice' => 1, 'purchase' => 1, 'challan' => 1],
    ];
}

// function syncGoogleSheets(string $jsonValue): array
{
    // global $googleSheetsWebhookUrl, $googleSheetsSecret;
    if (!$googleSheetsWebhookUrl) {
        // return ['configured' => false, 'success' => false, 'message' => 'Google Sheets webhook URL not configured'];
    }
    if (!function_exists('curl_init')) {
        // return ['configured' => true, 'success' => false, 'message' => 'PHP cURL extension is not enabled'];
    }

    $snapshot = json_decode($jsonValue, true);
    if (!is_array($snapshot)) {
        return ['configured' => true, 'success' => false, 'message' => 'ERP snapshot is invalid'];
    }

    $body = json_encode([
        // 'secret' => $googleSheetsSecret,
        'updatedAt' => gmdate('c'),
        'data' => $snapshot,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    // $ch = curl_init($googleSheetsWebhookUrl);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
    ]);
    $response = curl_exec($ch);
    $curlError = curl_error($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $decoded = is_string($response) ? json_decode($response, true) : null;
    $ok = !$curlError && $status >= 200 && $status < 300 && is_array($decoded) && !empty($decoded['success']);
    return [
        'configured' => true,
        'success' => $ok,
        'status' => $status,
        // 'message' => $ok ? 'Google Sheets updated' : ($curlError ?: ($decoded['error'] ?? 'Google Sheets sync failed')),
    ];
}

function storeSnapshot(PDO $pdo, string $dataKey, string $value): void
{
    $stmt = $pdo->prepare("
        INSERT INTO app_storage (data_key, data_value)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE data_value = VALUES(data_value)
    ");
    $stmt->execute([$dataKey, $value]);
}

if ($action === 'get') {
    $stmt = $pdo->prepare('SELECT data_value FROM app_storage WHERE data_key = ? LIMIT 1');
    $stmt->execute([$dataKey]);
    $row = $stmt->fetch();
    respond(['success' => true, 'value' => $row ? $row['data_value'] : null]);
}

if ($action === 'set') {
    $input = readJsonBody();
    if (!isset($input['value']) || !is_string($input['value'])) {
        respond(['success' => false, 'error' => 'Missing value'], 400);
    }
    if (!is_array(json_decode($input['value'], true))) {
        respond(['success' => false, 'error' => 'Value must contain a valid ERP JSON snapshot'], 400);
    }
    storeSnapshot($pdo, $dataKey, $input['value']);
    // $sheet = syncGoogleSheets($input['value']);
    respond(['success' => true, 'databaseSaved' => true, 'sheetSync' => $sheet]);
}

if ($action === 'delete_all') {
    $input = readJsonBody();
    if (!hash_equals($deleteAllPassword, (string) ($input['password'] ?? ''))) {
        respond(['success' => false, 'error' => 'Incorrect password'], 403);
    }

    $clean = defaultErpData();
    $value = json_encode($clean, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    storeSnapshot($pdo, $dataKey, $value);
    // $sheet = syncGoogleSheets($value);
    respond(['success' => true, 'value' => $value, 'sheetSync' => $sheet]);
}

respond(['success' => false, 'error' => 'Invalid action'], 400);
