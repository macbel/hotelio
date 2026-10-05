package es.alufi.vuelotel;

import java.net.URI;
import java.net.URLDecoder;

/** Only account-owned alert IDs cross the bridge; links never carry query/session data. */
final class AlertLinkPolicy {
    static long alertId(String value) {
        if (value == null || value.length() > 2048) return 0;
        try {
            URI uri = new URI(value);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || !"www.alufi.es".equalsIgnoreCase(uri.getHost())
                    || uri.getRawUserInfo() != null || uri.getPort() != -1 || uri.getRawFragment() != null
                    || !"/vuelotel/abrir-alerta.html".equals(uri.getRawPath())) return 0;
            String query = uri.getRawQuery(); if (query == null) return 0;
            long id = 0; boolean found = false;
            for (String part : query.split("&", -1)) {
                String[] item = part.split("=", 2);
                String key = URLDecoder.decode(item[0], "UTF-8");
                if (!"alertId".equals(key) && !"alert".equals(key)) continue;
                if (found || item.length != 2) return 0;
                String raw = URLDecoder.decode(item[1], "UTF-8");
                if (!raw.matches("[1-9][0-9]{0,15}")) return 0;
                id = Long.parseLong(raw); if (id > 9007199254740991L) return 0;
                found = true;
            }
            return found ? id : 0;
        } catch (Exception ignored) { return 0; }
    }
}
