<?php
// Copia este archivo como .hotelio-config.php fuera de la carpeta pública /hotelio.
// El panel privado de /hotelio/admin/ puede mantenerlo después.
return array(
    'admin_email' => 'tu-correo@example.com',
    'admin_password_hash' => 'REEMPLAZAR_POR_UN_HASH_SEGURO',
    'admin_password_salt' => 'REEMPLAZAR_POR_UN_SALT_ALEATORIO',
    'password_reset' => array(
        'token_hash' => '',
        'expires_at' => 0,
        'requested_at' => 0
    ),
    'flights' => array(
        'enabled' => true,
        'cache_ttl' => 3600,
        'monthly_limit' => 120,
        'per_ip_hourly_limit' => 8
    ),
    'providers' => array(
        'stay22' => array('enabled' => true, 'aid' => 'hotelio'),
        'serpapi' => array('enabled' => false, 'api_key' => '')
    )
);
