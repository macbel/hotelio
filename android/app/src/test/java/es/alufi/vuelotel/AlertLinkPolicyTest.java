package es.alufi.vuelotel;
import org.junit.Test;
import static org.junit.Assert.*;

public class AlertLinkPolicyTest {
    @Test public void canonicalAndBrowserAliasContainOnlyAValidatedId() {
        assertEquals(123, AlertLinkPolicy.alertId("https://www.alufi.es/vuelotel/abrir-alerta.html?alertId=123"));
        assertEquals(123, AlertLinkPolicy.alertId("https://www.alufi.es/vuelotel/abrir-alerta.html?alert=123&utm_source=email"));
        assertEquals(9007199254740991L, AlertLinkPolicy.alertId("https://www.alufi.es/vuelotel/abrir-alerta.html?alertId=9007199254740991"));
    }
    @Test public void untrustedOriginsRoutesAndAmbiguousIdsNeverReachTheBridge() {
        String[] invalid = {null, "https://www.alufi.es/vuelotel/abrir-alerta.html", "http://www.alufi.es/vuelotel/abrir-alerta.html?alertId=1",
                "https://alufi.es/vuelotel/abrir-alerta.html?alertId=1", "https://www.alufi.es.evil.test/vuelotel/abrir-alerta.html?alertId=1",
                "https://person@www.alufi.es/vuelotel/abrir-alerta.html?alertId=1", "https://www.alufi.es:443/vuelotel/abrir-alerta.html?alertId=1",
                "https://www.alufi.es/vuelotel/downloads/rumbiva.apk?alertId=1", "https://www.alufi.es/vuelotel/api/account.php?alertId=1",
                "https://www.alufi.es/vuelotel/abrir-alerta.html?alertId=1#other", "https://www.alufi.es/vuelotel/abrir-alerta.html?alertId=0",
                "https://www.alufi.es/vuelotel/abrir-alerta.html?alertId=-1", "https://www.alufi.es/vuelotel/abrir-alerta.html?alertId=01",
                "https://www.alufi.es/vuelotel/abrir-alerta.html?alertId=1&alert=2", "https://www.alufi.es/vuelotel/abrir-alerta.html?alertId=1&alertId=1",
                "https://www.alufi.es/vuelotel/abrir-alerta.html?alertId=9007199254740992", "https://www.alufi.es/vuelotel/abrir-alerta.html?alertId=%0a1",
                "https://www.alufi.es/vuelotel/%61brir-alerta.html?alertId=1",
                "https://www.alufi.es/vuelotel/?alertId=1", "https://www.alufi.es/vuelotel/index.html?alertId=1",
                "https://www.alufi.es/vuelotel/?reset=password", "https://www.alufi.es/vuelotel/#plan=shared"};
        for (String value : invalid) assertEquals(String.valueOf(value), 0, AlertLinkPolicy.alertId(value));
    }
}
