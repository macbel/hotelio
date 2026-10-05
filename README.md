# Rumbiva

Aplicación web/PWA y Android para comparar alojamientos, vuelos y viajes combinados. Incluye cuentas, favoritos, búsquedas guardadas, alertas de precio y administración de usuarios.

## Ejecutar

```powershell
npm.cmd run dev
```

Abre `http://localhost:4173`. En Android, desde Chrome, usa **Añadir a pantalla de inicio** para instalarla (la publicación debe usar HTTPS).

El servidor se inicia con `--use-system-ca` para respetar el almacén de certificados de Windows al conectar con las APIs externas.

## Proveedores centralizados

Las credenciales se guardan en `.hotelio-config.php`, fuera de la carpeta pública `/vuelotel`. Este archivo está ignorado por Git y nunca se entrega al navegador ni se incluye en el APK. Consulta [la guía de migración](deployment/MIGRACION-VUELOTEL.md) antes de renombrar la carpeta del servidor.

La configuración de proveedores está disponible en `/vuelotel/admin/`, protegida con contraseña. La administración de usuarios, búsquedas y alertas se abre desde la cuenta administradora dentro de Rumbiva. La ruta pública y el identificador Android existentes se mantienen para conservar enlaces e instalaciones.

### Evaluación de un proveedor adicional de vuelos

Aviasales Data API (Travelpayouts) podría aportar precios orientativos procedentes de caché y ampliar la exploración de destinos. Su uso real requiere cuenta de afiliado, token privado, revisión de sus condiciones y comprobación de límites vigentes. No equivale a disponibilidad ni precio final en tiempo real. Hay un contrato de configuración servidor en `public/api/bootstrap.php` (`providers.aviasales`: `enabled`, `api_token`, `cache_ttl`), desactivado de forma obligatoria hasta implementar y validar el adaptador. El token nunca se envía en `providers.php`, JavaScript ni APK. La fuente oficial es [Travelpayouts Data API](https://support.travelpayouts.com/hc/en-us/articles/360002322092-Data-API).

Los correos de alerta incluyen **Abrir búsqueda** y el enlace HTTPS completo. El enlace restaura la búsqueda de la alerta tras acceder con su cuenta, sin llevar sesiones ni datos de viaje en la URL. Las alertas de plan conservan fechas, destino y hotel; las fechas pasadas se muestran para corregirlas sin consultar proveedores. La APK 2.6.1 admite enlaces Android verificados en `/vuelotel/abrir-alerta.html`; la asociación se publica en `https://www.alufi.es/.well-known/assetlinks.json`. La apertura directa depende de los ajustes del dispositivo y del navegador; la web Android ofrece también un botón para abrir Rumbiva. Los enlaces a descargas, administración, recuperación de contraseña y planes compartidos conservan su ruta habitual.

Las alertas pueden cambiar frecuencia, caducidad y condiciones desde **Cuenta → Alertas**: cualquier cambio, bajada, precio objetivo o porcentaje mínimo. El límite entre avisos es independiente de la frecuencia de revisión. El porcentaje se calcula desde la referencia inicial o el último aviso, acumulando pequeñas bajadas. El historial registra cada nueva comprobación con precio, estado y aceptación del correo; no reconstruye consultas antiguas.

La APK 2.6.0 permite activar voluntariamente **Avisos en este móvil** en Cuenta → Alertas. Android solicita permiso y consulta las bajadas periódicamente con conexión (aproximadamente cada 15 minutos, aplazable por batería y sistema). No usa Firebase ni garantiza avisos instantáneos. Al activarlo establece una referencia para no reproducir avisos antiguos; al cerrar sesión cancela la tarea y elimina la credencial. Pulsar un aviso abre la alerta propia y su historial.

Los resultados muestran subtotal del grupo y reparto medio orientativo. El calendario distingue fechas con precio, consultadas sin tarifa, pendientes y errores; en modo flexible muestra las fechas muestreadas, sin afirmar cobertura de todos los días. El comparador incluye horarios, escalas y condiciones disponibles, con los datos ausentes señalados para confirmar.

Las alertas pueden cambiar frecuencia y fecha de caducidad desde **Cuenta → Alertas**. Al modificar la frecuencia, la siguiente comprobación se programa desde el momento de guardar. Una alerta caducada requiere marcar su reactivación; los envíos siguen dependiendo del cron y el correo configurados en el servidor.

El panel permite cambiar la contraseña introduciendo primero la actual. Si se olvida, envía al correo privado configurado un enlace de un solo uso que caduca en una hora. Hotelio nunca envía ni recupera la contraseña existente.

Para desarrollo local, SerpApi puede activarse mediante la variable de entorno `HOTELIO_SERPAPI_KEY`.

### Stay22: activo con el Partner ID de Hotelio

Hotelio consulta **Stay22 Direct Travel API** de forma predeterminada. El modo demo funciona sin cuenta y busca precios reales de Booking.com, Expedia, Hotels.com y Vrbo con un límite de 5 peticiones por minuto.

La cuenta de Stay22 está asociada al Partner ID (AID) `hotelio`. Hotelio añade ese identificador y la campaña `hotelio_search` a todos los enlaces de oferta para atribuir correctamente las reservas. No se utiliza un token de informes. La búsqueda transmite destino, fechas, adultos, cantidad de niños y habitaciones. Stay22 no acepta las edades concretas de los niños, por lo que deben confirmarse al abrir la oferta.

El rango en euros se vuelve a aplicar dentro de Hotelio. Conforme a las restricciones publicadas por Stay22, sus fichas se consultan en tiempo real y no se almacenan como favoritos permanentes.

### SerpApi Google Hotels

Hotelio trae un conector incorporado para **SerpApi Google Hotels**. La API key se introduce en el panel privado del servidor, no en cada dispositivo.

- SerpApi: <https://serpapi.com/users/sign_up>

Las peticiones pasan por el servidor de Hotelio (`/api/search.php`). El navegador solo descarga el estado público de los proveedores desde `/api/providers.php`.

La búsqueda envía al backend:

```json
{"destination":"Valencia","checkIn":"2026-08-01","checkOut":"2026-08-05","adults":2,"children":2,"childrenAges":[5,9],"guests":4,"rooms":1,"minPrice":null,"maxPrice":180,"accommodationType":"hotel","board":"breakfast","currency":"EUR","nights":4}
```

Los precios mínimo y máximo son opcionales. El selector muestra únicamente tipos que SerpApi documenta con un `property_types` exacto: hotel de playa, hotel boutique, hotel con spa, apartamento, aparthotel, hostel, posada, motel, resort y bed & breakfast. No se ofrece un “hotel” genérico porque SerpApi no publica un identificador exacto para esa categoría. Para desayuno utiliza `amenities=9` y para todo incluido `amenities=52`; ambos significan que el alojamiento ofrece esa opción, por lo que la tarifa concreta se marca como **Aproximado** y debe confirmarse. Solo alojamiento, media pensión y pensión completa no tienen filtro exacto y se marcan como **Confirmar en la web**. Stay22 sigue mostrando opciones, pero etiqueta como aproximados o pendientes de confirmar los filtros que no puede transmitir de forma fiable.

Los enlaces externos ya no incluyen parámetros internos o inventados. Solo Expedia recibe destino, fechas y ocupantes mediante su deeplink documentado. Booking, KAYAK, Trivago, Hostelworld y el resto se abren sin afirmar que hayan aplicado el tipo o el régimen.

## Buscador de vuelos

En **Favoritos**, pulsa el nombre del alojamiento o **Consultar** para abrir sus fechas, ocupantes, preferencias, servicios y todas las ofertas guardadas. En una cuenta, abre **Acceder → Búsquedas** y pulsa **Consultar** para cargar de nuevo una búsqueda de alojamientos, vuelos o viaje combinado en su formulario correspondiente. Cada oferta conserva el precio y la fecha de guardado y permite abrir el enlace del proveedor; cargar una búsqueda no la ejecuta automáticamente.

Los campos de origen y destino reconocen ciudad, nombre de aeropuerto y código IATA, con sugerencias filtradas y nombres habituales en español (por ejemplo, Sevilla, Roma, Londres o París). Si una ciudad tiene varios aeropuertos, puedes elegir una sugerencia concreta; al enviar solo la ciudad se muestra el aeropuerto elegido en el campo. Los nombres parciales ambiguos requieren seleccionar una sugerencia.

La pestaña **Vuelos y destinos** acepta una ciudad, el nombre de un aeropuerto o un código IATA. Las sugerencias salen de un catálogo local de OurAirports y se convierten al código IATA antes de consultar Google Flights mediante SerpApi desde `/api/flights.php`. La clave permanece en el servidor. Una búsqueda de ida y vuelta utiliza hasta dos llamadas: la segunda selecciona la vuelta mediante `departure_token`. Las opciones que solo tienen salida se etiquetan como provisionales y nunca se suman a un hotel ni se usan en alertas.

**Seguir un destino** compara una ventana de hasta siete días de salida y un número fijo de noches. Comprueba hasta dos fechas por acción y cada fecha usa como máximo dos consultas de vuelo. Después consulta Google Hotels para las dos fechas con vuelos completos de menor precio y presenta planes con vuelo y hotel de la misma estancia, un presupuesto opcional, desglose y enlaces externos. La cobertura indica las fechas comprobadas y el mínimo se refiere solo a los planes comparados; pueden faltar tasas o maletas facturadas. Los resultados y planes pueden guardarse en la cuenta.

Una alerta puede seguir el subtotal del primer plan guardado (la misma fecha y el mismo hotel) o solo el vuelo. El programador vuelve a consultar ambas partes antes de avisar; si no encuentra una tarifa comparable para ese hotel, registra el fallo y reintenta sin enviar un aviso. Las alertas antiguas de vuelo establecen una nueva referencia al completar una comparación con vuelta seleccionada. Las búsquedas guardadas antiguas siguen abriéndose; las ventanas y alertas antiguas de más de siete días deben abrirse desde la cuenta y recrearse con una ventana válida. Hasta entonces muestran un error visible y no envían comparaciones incompletas.

En móvil, la navegación inferior ofrece Inicio, Buscar, Seguir y Guardados. La barra de guardar y alertar se abre bajo demanda para dejar visibles los resultados.

- No se gestionan pagos, reservas, PNR ni datos de pasajeros.
- Los precios son orientativos y siempre deben confirmarse en la página de compra.
- La caché privada dura una hora y evita repetir consultas idénticas.
- Por defecto se permiten 8 búsquedas correctas por IP y hora y un máximo global de 120 llamadas de vuelos al mes.
- La cuota de vuelos comparte la cuenta gratuita de SerpApi con las búsquedas de hoteles.
- Amadeus Self-Service queda previsto como futuro proveedor oficial complementario; no forma parte de este MVP.

El autocompletado usa un catálogo local de aeropuertos de [OurAirports](https://ourairports.com/data/) (dominio público), por lo que buscar una ciudad no consume API. Para actualizarlo:

```powershell
npm.cmd run airports:update
```

## Compilar como APK

Desde Rumbiva 2.5.2, al abrir la app se consulta el manifiesto de actualizaciones y una APK nueva se descarga automáticamente mediante DownloadManager. Android muestra su confirmación de instalación después de verificar SHA-256; si falta el permiso para instalar desde Rumbiva, se abre Ajustes una vez y la instalación continúa al volver con el permiso concedido. Una denegación o cancelación no vuelve a abrir pantallas en bucle: se puede reintentar en una apertura nueva. Las descargas en curso continúan en segundo plano y se recuperan al volver a abrir la app sin duplicarlas. Los fallos de descarga o verificación esperan una hora antes de reintentarse.

La versión 2.5.1 y anteriores necesitan completar una vez su actualización mediante el flujo anterior, que pide descargar el APK. La descarga automática estará disponible después de instalar 2.5.2. Para verificar las decisiones de descarga, los retornos de permisos y SHA-256 sin dispositivo, desde la carpeta `android` ejecuta `gradlew.bat :app:testDebugUnitTest`; la integración con DownloadManager y el instalador necesita comprobación en un Android real.

Hotelio incluye un proyecto Android basado en Capacitor 8. Requiere Node.js 22 o posterior, JDK 21 y Android SDK 36.

```powershell
npm.cmd install
npm.cmd run android:apk
```

El APK de depuración se genera en `android/app/build/outputs/apk/debug/app-debug.apk`. La aplicación nativa contiene la interfaz web y consulta el backend público HTTPS de Hotelio para alojamientos y vuelos. La configuración y las credenciales no se empaquetan en el APK.
