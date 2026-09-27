<?php
require __DIR__ . '/../public/api/bootstrap.php';

$config = hotelio_default_config();
$config['providers']['aviasales']['api_token'] = 'private-test-token';
$public = hotelio_public_provider_config($config);
if (strpos(json_encode($public), 'private-test-token') !== false) throw new RuntimeException('The Aviasales token must stay server-side.');
if (!empty($config['providers']['aviasales']['enabled'])) throw new RuntimeException('Aviasales cannot be active without a verified adapter.');
echo "Provider configuration contract passed.\n";
