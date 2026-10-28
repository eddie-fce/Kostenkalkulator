<?php
// Minimaler Sync-Endpunkt für den Druckkalkulator (nur Kunden & Angebote).
// Kein Framework, kein Daemon, keine Datenbank: pro Schlüssel eine JSON-Datei.
declare(strict_types=1);

$cfg = require __DIR__ . '/config.php';
const KEYS = ['kunden', 'kundenCounter', 'angebote', 'angebotsCounter'];
const COUNTER_KEYS = ['kundenCounter', 'angebotsCounter'];

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
header('Access-Control-Allow-Methods: GET, PUT, OPTIONS');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function out(int $code, array $body): never {
    http_response_code($code);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$token = (string)($cfg['token'] ?? '');
if (strlen($token) < 24) out(500, ['error' => 'config.php: token fehlt oder ist zu kurz (min. 24 Zeichen)']);
$auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
if (!hash_equals($token, trim(preg_replace('/^Bearer\s+/i', '', $auth)))) out(401, ['error' => 'unauthorized']);

$dir = rtrim((string)($cfg['data_dir'] ?? __DIR__ . '/data'), '/');
if (!is_dir($dir) && !mkdir($dir, 0750, true)) out(500, ['error' => 'data_dir nicht anlegbar']);

function readKey(string $dir, string $key): array {
    $f = "$dir/$key.json";
    $d = is_file($f) ? json_decode((string)file_get_contents($f), true) : null;
    return is_array($d) ? $d : ['rev' => 0, 'value' => null];
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    if (isset($_GET['all'])) {
        $data = [];
        foreach (KEYS as $k) $data[$k] = readKey($dir, $k);
        out(200, ['data' => $data]);
    }
    $key = (string)($_GET['key'] ?? '');
    if (!in_array($key, KEYS, true)) out(400, ['error' => 'unbekannter key']);
    out(200, readKey($dir, $key));
}

if ($method === 'PUT') {
    $key = (string)($_GET['key'] ?? '');
    if (!in_array($key, KEYS, true)) out(400, ['error' => 'unbekannter key']);
    $body = json_decode((string)file_get_contents('php://input'), true);
    if (!is_array($body) || !is_string($body['value'] ?? null) || !is_int($body['rev'] ?? null)) out(400, ['error' => 'ungültiger body']);

    $lock = fopen("$dir/.lock", 'c');
    flock($lock, LOCK_EX);
    $cur = readKey($dir, $key);
    if ($cur['rev'] !== $body['rev']) out(409, ['conflict' => true] + $cur); // Lock wird mit Skriptende frei

    $value = $body['value'];
    if (in_array($key, COUNTER_KEYS, true)) $value = (string)max((int)$value, (int)($cur['value'] ?? 0)); // Zähler nie zurücksetzen
    elseif (!is_array(json_decode($value, true))) out(400, ['error' => 'value ist keine JSON-Liste']);

    $f = "$dir/$key.json";
    if (is_file($f)) copy($f, "$f.bak");
    $new = ['rev' => $cur['rev'] + 1, 'value' => $value];
    file_put_contents("$f.tmp", json_encode($new, JSON_UNESCAPED_UNICODE));
    rename("$f.tmp", $f);
    out(200, ['rev' => $new['rev']]);
}

out(405, ['error' => 'method not allowed']);
