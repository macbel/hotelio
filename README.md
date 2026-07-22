# Hotelio

MVP móvil/PWA para comparar alojamientos según destino, fechas, ocupantes y filtros opcionales.

## Ejecutar

```powershell
npm.cmd run dev
```

Abre `http://localhost:4173`. En Android, desde Chrome, usa **Añadir a pantalla de inicio** para instalarla (la publicación debe usar HTTPS).

El servidor se inicia con `--use-system-ca` para respetar el almacén de certificados de Windows al conectar con las APIs externas.

## Proveedores centralizados

Las credenciales se guardan en `.hotelio-config.php`, fuera de la carpeta pública `/hotelio`. Este archivo está ignorado por Git y nunca se entrega al navegador ni se incluye en el APK.

El menú público de proveedores se ha eliminado. La administración está disponible únicamente en `/hotelio/admin/`, protegida con contraseña. Desde allí se puede activar Stay22 y guardar o sustituir la API key de SerpApi una sola vez; la configuración se aplica después a todos los usuarios de la web y del APK.

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

Los precios mínimo y máximo son opcionales. SerpApi admite filtros de tipo de alojamiento y Hotelio usa su búsqueda textual para el régimen. Stay22 no permite filtrar el régimen ni el tipo con la misma fiabilidad, por lo que se omite cuando se seleccionan esos filtros. Ambos conectores devuelven miniaturas cuando el proveedor dispone de ellas.

## Compilar como APK

Hotelio incluye un proyecto Android basado en Capacitor 8. Requiere Node.js 22 o posterior, JDK 21 y Android SDK 36.

```powershell
npm.cmd install
npm.cmd run android:apk
```

El APK de depuración se genera en `android/app/build/outputs/apk/debug/app-debug.apk`. La aplicación nativa contiene la interfaz web y consulta el backend público HTTPS de Hotelio para las búsquedas Stay22 y SerpApi.
