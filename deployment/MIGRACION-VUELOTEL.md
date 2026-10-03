# Migración de `/hotelio` a `/vuelotel`

Si el panel del alojamiento no permite programar tareas, el repositorio incluye `.github/workflows/alerts.yml`: ejecuta el procesador cada hora, en el minuto 17 (UTC), y permite ejecución manual desde Actions. GitHub puede retrasar las ejecuciones programadas; el archivo debe estar en la rama predeterminada y Actions debe estar habilitado.

Configura en Settings → Secrets and variables → Actions el secreto de repositorio `VUELOTEL_ALERTS_CRON`, con el mismo valor privado de `alerts.cron_secret` del servidor. El workflow lo envía mediante la cabecera `X-Vuelotel-Cron` al endpoint fijo HTTPS. No lo incluyas en el archivo YAML, en una URL ni en registros. Tras publicar el workflow y configurar el secreto, ejecútalo manualmente y verifica una ejecución correcta en Actions y la última revisión en Administración. Una respuesta HTTP fallida o errores de comprobación hacen fallar la ejecución de Actions; los registros muestran únicamente los recuentos.

1. Renombra la carpeta pública `hotelio` del servidor a `vuelotel`.
2. Crea una carpeta nueva y pequeña llamada `hotelio` y copia dentro el archivo `hotelio-redirect/.htaccess`. Esto mantiene funcionando enlaces y APK anteriores mientras se actualizan.
3. Conserva `.hotelio-config.php` en su ubicación actual: Vuelotel seguirá leyéndolo fuera de la carpeta pública.
4. Añade al bloque `alerts` de ese archivo un `cron_secret` largo y aleatorio. El ejemplo completo está en `.hotelio-config.example.php`.
5. Preferentemente programa cada hora PHP CLI: `0 * * * * /ruta/al/php /ruta/privada/web/vuelotel/api/alerts-run.php >> /ruta/privada/alerts-cron.log 2>&1`. Sustituye las rutas por las reales del alojamiento; usa un PHP con curl, SQLite y mbstring. CLI no requiere secreto web. Alternativamente crea una tarea programada que invoque cada hora `https://www.alufi.es/vuelotel/api/alerts-run.php` enviando el secreto en la cabecera `X-Vuelotel-Cron`.
6. Crea el buzón `no-reply@alufi.es` y comprueba que el servidor permite enviar correo PHP con ese remitente. Si el alojamiento exige SMTP autenticado habrá que añadir esas credenciales privadas al servidor.

La primera apertura crea la base privada `.vuelotel-data/vuelotel.sqlite` fuera de la web y registra `mblazquezm@gmail.com` como administrador. La contraseña es la misma del panel administrativo anterior y se actualiza automáticamente al formato moderno tras iniciar sesión.

El plan gratuito de SerpApi ofrece 250 consultas mensuales. El procesador atiende como máximo dos alertas por ejecución y reutiliza las cachés; con varios usuarios puede aplazar comprobaciones para no consumir el cupo interactivo.

El runner mantiene un bloqueo privado durante toda la ejecución; otra ejecución simultánea se omite. La URL web siempre exige el secreto (también bajo el servidor de desarrollo PHP); usa la cabecera para evitar incluirlo en registros de URL. Un acceso CLI no demuestra que exista una tarea programada: comprueba la última ejecución y las revisiones vencidas en Administración. El primer precio establece la referencia y no envía correo; después se mantienen las condiciones de cada alerta.
