# Hotelio

MVP móvil/PWA para comparar alojamientos y consultar vuelos según destino, fechas, ocupantes y filtros opcionales.

## Ejecutar

```powershell
npm.cmd run dev
```

Abre `http://localhost:4173`. En Android, desde Chrome, usa **Añadir a pantalla de inicio** para instalarla (la publicación debe usar HTTPS).

El servidor se inicia con `--use-system-ca` para respetar el almacén de certificados de Windows al conectar con las APIs externas.

## Proveedores centralizados

Las credenciales se guardan en `.hotelio-config.php`, fuera de la carpeta pública `/hotelio`. Este archivo está ignorado por Git y nunca se entrega al navegador ni se incluye en el APK.

El menú público de proveedores se ha eliminado. La administración está disponible únicamente en `/hotelio/admin/`, protegida con contraseña. Desde allí se puede activar Stay22, guardar o sustituir la API key de SerpApi y limitar el consumo del buscador de vuelos; la configuración se aplica después a todos los usuarios de la web y del APK.

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

La pestaña **Vuelos** acepta una ciudad, el nombre de un aeropuerto o un código IATA. Las sugerencias salen de un catálogo local de OurAirports y se convierten al código IATA antes de consultar el motor Google Flights de SerpApi desde `/api/flights.php`. La clave permanece en el servidor y cada búsqueda no almacenada realiza una única llamada. Hotelio muestra hasta 20 opciones y abre el enlace seguro `search_metadata.google_flights_url` para que el usuario confirme precio y condiciones en Google Flights.

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

Hotelio incluye un proyecto Android basado en Capacitor 8. Requiere Node.js 22 o posterior, JDK 21 y Android SDK 36.

```powershell
npm.cmd install
npm.cmd run android:apk
```

El APK de depuración se genera en `android/app/build/outputs/apk/debug/app-debug.apk`. La aplicación nativa contiene la interfaz web y consulta el backend público HTTPS de Hotelio para alojamientos y vuelos. La configuración y las credenciales no se empaquetan en el APK.
