<?php
// Copia este archivo como .hotelio-config.php fuera de la carpeta pública /hotelio.
// El panel privado de /hotelio/admin/ puede mantenerlo después.
return array(
    'admin_password_hash' => 'REEMPLAZAR_POR_UN_HASH_SEGURO',
    'admin_password_salt' => 'REEMPLAZAR_POR_UN_SALT_ALEATORIO',
    'providers' => array(
        'stay22' => array('enabled' => true, 'aid' => 'hotelio'),
        'serpapi' => array('enabled' => false, 'api_key' => '')
    )
);
