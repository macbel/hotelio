<?php

function hotelio_default_config() {
    return array(
        'admin_email' => '',
        'admin_password_hash' => '',
        'admin_password_salt' => '',
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
}

function hotelio_config_path() {
    $custom = getenv('HOTELIO_CONFIG_PATH');
    if (is_string($custom) && trim($custom) !== '') return trim($custom);
    return dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . '.hotelio-config.php';
}

function hotelio_config() {
    $config = hotelio_default_config();
    $path = hotelio_config_path();
    if (is_file($path)) {
        $stored = include $path;
        if (is_array($stored)) {
            $config['admin_email'] = trim((string) ($stored['admin_email'] ?? ''));
            $config['admin_password_hash'] = (string) ($stored['admin_password_hash'] ?? '');
            $config['admin_password_salt'] = (string) ($stored['admin_password_salt'] ?? '');
            if (isset($stored['password_reset']) && is_array($stored['password_reset'])) {
                $config['password_reset']['token_hash'] = (string) ($stored['password_reset']['token_hash'] ?? '');
                $config['password_reset']['expires_at'] = (int) ($stored['password_reset']['expires_at'] ?? 0);
                $config['password_reset']['requested_at'] = (int) ($stored['password_reset']['requested_at'] ?? 0);
            }
            if (isset($stored['flights']) && is_array($stored['flights'])) {
                $config['flights'] = array_merge($config['flights'], $stored['flights']);
            }
            foreach (array('stay22', 'serpapi') as $provider) {
                if (isset($stored['providers'][$provider]) && is_array($stored['providers'][$provider])) {
                    $config['providers'][$provider] = array_merge($config['providers'][$provider], $stored['providers'][$provider]);
                }
            }
        }
    }
    $environmentKey = getenv('HOTELIO_SERPAPI_KEY');
    if (is_string($environmentKey) && trim($environmentKey) !== '') {
        $config['providers']['serpapi']['api_key'] = trim($environmentKey);
        $config['providers']['serpapi']['enabled'] = true;
    }
    $config['providers']['stay22']['aid'] = 'hotelio';
    $config['providers']['serpapi']['enabled'] = !empty($config['providers']['serpapi']['enabled']) && trim((string) $config['providers']['serpapi']['api_key']) !== '';
    $config['flights']['enabled'] = !empty($config['flights']['enabled']);
    $config['flights']['cache_ttl'] = max(300, min(86400, (int) $config['flights']['cache_ttl']));
    $config['flights']['monthly_limit'] = max(1, min(240, (int) $config['flights']['monthly_limit']));
    $config['flights']['per_ip_hourly_limit'] = max(1, min(30, (int) $config['flights']['per_ip_hourly_limit']));
    return $config;
}

function hotelio_write_config($config) {
    $path = hotelio_config_path();
    $directory = dirname($path);
    if (!is_dir($directory) || !is_writable($directory)) return false;
    $contents = "<?php\nreturn " . var_export($config, true) . ";\n";
    $temporary = $path . '.tmp';
    if (file_put_contents($temporary, $contents, LOCK_EX) === false) return false;
    @chmod($temporary, 0600);
    if (!rename($temporary, $path)) {
        @unlink($temporary);
        return false;
    }
    @chmod($path, 0600);
    return true;
}

function hotelio_public_provider_config($config) {
    return array(
        'flights' => array(
            'enabled' => !empty($config['flights']['enabled']) && !empty($config['providers']['serpapi']['enabled']),
            'provider' => 'SerpApi · Google Flights',
            'cacheSeconds' => (int) $config['flights']['cache_ttl']
        ),
        'providers' => array(
            array('id' => 'stay22', 'name' => 'Stay22', 'enabled' => !empty($config['providers']['stay22']['enabled']), 'capabilities' => array('price' => true, 'accommodationType' => false, 'board' => false, 'images' => true)),
            array('id' => 'serpapi', 'name' => 'SerpApi · Google Hotels', 'enabled' => !empty($config['providers']['serpapi']['enabled']), 'capabilities' => array('price' => true, 'accommodationType' => true, 'board' => true, 'images' => true))
        )
    );
}
