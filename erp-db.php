<?php
/* erp-db.php — ERP database + Google Sheets configuration */

$host   = 'localhost';
$dbname = 'alphaccp_alphadb';
$user   = 'alphaccp_alphadb';
$pass   = '6rrgSPjAW3w97LXqu5wb';

/* Apps Script deploy karne ke baad /exec URL yahan paste karein. */
// $googleSheetsWebhookUrl = 'https://script.google.com/macros/s/AKfycbzLhrxHo2idU--vTczdmrnRTjOqeRkQDVQ4WgeNHPpPpFaB1QkzlSN90YdGUjvVhOjBeA/exec'; // https://script.google.com/macros/s/XXXXX/exec
// $googleSheetsSecret     = 'erp-alpha-sheets-2026';

/* DELETE ALL ENTRIES ka server-side password. */
$deleteAllPassword = '9mm9mm9mm';

try {
    $pdo = new PDO(
        "mysql:host=$host;dbname=$dbname;charset=utf8mb4",
        $user,
        $pass,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]
    );
} catch (PDOException $e) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['success' => false, 'error' => 'Database connection failed']);
    exit;
}

$pdo->exec("
    CREATE TABLE IF NOT EXISTS app_storage (
        id INT AUTO_INCREMENT PRIMARY KEY,
        data_key VARCHAR(100) NOT NULL UNIQUE,
        data_value LONGTEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
");
