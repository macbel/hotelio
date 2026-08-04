# Migración de `/hotelio` a `/vuelotel`

1. Renombra la carpeta pública `hotelio` del servidor a `vuelotel`.
2. Crea una carpeta nueva y pequeña llamada `hotelio` y copia dentro el archivo `hotelio-redirect/.htaccess`. Esto mantiene funcionando enlaces y APK anteriores mientras se actualizan.
3. Conserva `.hotelio-config.php` en su ubicación actual: Vuelotel seguirá leyéndolo fuera de la carpeta pública.
4. Añade al bloque `alerts` de ese archivo un `cron_secret` largo y aleatorio. El ejemplo completo está en `.hotelio-config.example.php`.
5. Crea una tarea programada que invoque cada hora `https://www.alufi.es/vuelotel/api/alerts-run.php` enviando el secreto en la cabecera `X-Vuelotel-Cron`.
6. Crea el buzón `no-reply@alufi.es` y comprueba que el servidor permite enviar correo PHP con ese remitente. Si el alojamiento exige SMTP autenticado habrá que añadir esas credenciales privadas al servidor.

La primera apertura crea la base privada `.vuelotel-data/vuelotel.sqlite` fuera de la web y registra `mblazquezm@gmail.com` como administrador. La contraseña es la misma del panel administrativo anterior y se actualiza automáticamente al formato moderno tras iniciar sesión.

El plan gratuito de SerpApi ofrece 250 consultas mensuales. El procesador atiende como máximo dos alertas por ejecución y reutiliza las cachés; con varios usuarios puede aplazar comprobaciones para no consumir el cupo interactivo.
