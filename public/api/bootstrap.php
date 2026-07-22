<?php

function hotelio_default_config() {
    return array(
        'admin_password_hash' => '',
        'admin_password_salt' => '',
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
            $config['admin_password_hash'] = (string) ($stored['admin_password_hash'] ?? '');
            $config['admin_password_salt'] = (string) ($stored['admin_password_salt'] ?? '');
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
        'providers' => array(
            array('id' => 'stay22', 'name' => 'Stay22', 'enabled' => !empty($config['providers']['stay22']['enabled']), 'capabilities' => array('price' => true, 'accommodationType' => false, 'board' => false, 'images' => true)),
            array('id' => 'serpapi', 'name' => 'SerpApi · Google Hotels', 'enabled' => !empty($config['providers']['serpapi']['enabled']), 'capabilities' => array('price' => true, 'accommodationType' => true, 'board' => true, 'images' => true))
        )
    );
}
