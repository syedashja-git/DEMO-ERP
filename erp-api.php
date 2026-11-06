<?php
/* erp-api.php — MySQL storage API; Google Sheets sync disabled */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function respond(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode(
        $payload,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    );
    exit;
}

function readJsonBody(): array
{
    $input = json_decode(file_get_contents('php://input'), true);

    if (!is_array($input)) {
        respond([
            'success' => false,
            'error' => 'Invalid JSON body'
        ], 400);
    }

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
        'counters' => [
            'invoice' => 1,
            'purchase' => 1,
            'challan' => 1
        ]
    ];
}

function syncGoogleSheets(string $jsonValue): array
{
    // Google Sheets ko koi request nahi bheji jayegi.
    return [
        'configured' => false,
        'success' => false,
        'message' => 'Google Sheets sync is disabled'
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

try {
    require __DIR__ . '/erp-db.php';

    $action = $_GET['action'] ?? '';
    $dataKey = 'biz_data_v1';

    if (in_array($action, ['set', 'delete_all'], true)
        && ($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        header('Allow: POST');
        respond([
            'success' => false,
            'error' => 'POST request required'
        ], 405);
    }

    if ($action === 'get') {
        $stmt = $pdo->prepare(
            'SELECT data_value FROM app_storage WHERE data_key = ? LIMIT 1'
        );
        $stmt->execute([$dataKey]);
        $row = $stmt->fetch();

        respond([
            'success' => true,
            'value' => $row ? $row['data_value'] : null
        ]);
    }

    if ($action === 'set') {
        $input = readJsonBody();

        if (!isset($input['value']) || !is_string($input['value'])) {
            respond([
                'success' => false,
                'error' => 'Missing value'
            ], 400);
        }

        if (!is_array(json_decode($input['value'], true))) {
            respond([
                'success' => false,
                'error' => 'Value must contain a valid ERP JSON snapshot'
            ], 400);
        }

        storeSnapshot($pdo, $dataKey, $input['value']);

        respond([
            'success' => true,
            'databaseSaved' => true,
            'sheetSync' => syncGoogleSheets($input['value'])
        ]);
    }

    if ($action === 'delete_all') {
        $input = readJsonBody();

        if (!isset($deleteAllPassword)
            || !is_string($deleteAllPassword)
            || $deleteAllPassword === '') {
            respond([
                'success' => false,
                'error' => 'Delete password is not configured'
            ], 500);
        }

        $password = $input['password'] ?? '';

        if (!is_string($password)
            || !hash_equals($deleteAllPassword, $password)) {
            respond([
                'success' => false,
                'error' => 'Incorrect password'
            ], 403);
        }

        $value = json_encode(
            defaultErpData(),
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        );

        if ($value === false) {
            throw new RuntimeException('Could not encode empty ERP data');
        }

        storeSnapshot($pdo, $dataKey, $value);

        respond([
            'success' => true,
            'databaseSaved' => true,
            'value' => $value,
            'sheetSync' => syncGoogleSheets($value)
        ]);
    }

    respond([
        'success' => false,
        'error' => 'Invalid action'
    ], 400);

} catch (Throwable $e) {
    error_log('ERP API error: ' . $e->getMessage());

    respond([
        'success' => false,
        'error' => 'Server operation failed. Check PHP error log.'
    ], 500);
}