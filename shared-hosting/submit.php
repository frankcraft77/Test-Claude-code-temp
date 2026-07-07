<?php
/* Form endpoint for shared hosting (no Docker / Node needed).
   Upload next to index.html and set SUBMIT_URL: 'submit.php' in config.js.

   Appends submissions as timestamp,field_key,value rows to a CSV.
   By default the file is written ONE LEVEL ABOVE the web root so it can
   never be downloaded publicly. If your host doesn't allow writing there,
   switch to the in-webroot line below and keep the provided .htaccess. */

$RESPONSES = dirname(__DIR__) . '/storydeck-responses.csv';
// $RESPONSES = __DIR__ . '/responses.csv';   // in-webroot alternative

$CONTENT       = __DIR__ . '/content.csv';
$MAX_BODY      = 10240;   // 10 KB per request
$MAX_VALUE_LEN = 5000;    // characters per answer

header('Content-Type: text/plain; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit('Method not allowed');
}

$raw  = file_get_contents('php://input', false, null, 0, $MAX_BODY + 1);
if (strlen($raw) > $MAX_BODY) {
    http_response_code(413);
    exit('Request too large');
}
$data = json_decode($raw, true);
if (!is_array($data)) {
    http_response_code(400);
    exit('Invalid JSON');
}

$key   = trim((string)($data['field_key'] ?? ''));
$value = trim((string)($data['value'] ?? ''));
if (function_exists('mb_substr')) {
    $value = mb_substr($value, 0, $MAX_VALUE_LEN);
} else {
    $value = substr($value, 0, $MAX_VALUE_LEN);
}
if ($key === '' || $value === '') {
    http_response_code(400);
    exit('field_key and value are required');
}

/* Only accept field_keys declared by input-type rows in content.csv. */
$allowed = [];
if (($fh = fopen($CONTENT, 'r')) !== false) {
    $head = fgetcsv($fh);
    if (is_array($head)) {
        $head    = array_map(fn($h) => strtolower(trim((string)$h)), $head);
        $typeIdx = array_search('type', $head, true);
        $keyIdx  = array_search('field_key', $head, true);
        while (($row = fgetcsv($fh)) !== false) {
            $type = strtolower(trim((string)($row[$typeIdx] ?? '')));
            if (in_array($type, ['input', 'longtext', 'email', 'choice'], true)) {
                $k = trim((string)($row[$keyIdx] ?? ''));
                $allowed[] = $k !== '' ? $k : 'answer';
            }
        }
    }
    fclose($fh);
}
if (!in_array($key, $allowed, true)) {
    http_response_code(400);
    exit('Unknown field_key');
}

$isNew = !file_exists($RESPONSES);
$fh = fopen($RESPONSES, 'a');
if ($fh === false) {
    http_response_code(500);
    exit('Could not save response');
}
flock($fh, LOCK_EX);
if ($isNew) {
    fputcsv($fh, ['timestamp', 'field_key', 'value']);
}
fputcsv($fh, [gmdate('c'), $key, $value]);
flock($fh, LOCK_UN);
fclose($fh);

http_response_code(204);
