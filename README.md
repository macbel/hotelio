# Hotelio

MVP móvil/PWA para comparar alojamientos según destino, fechas, ocupantes y rango de precios.

## Ejecutar

```powershell
npm.cmd run dev
```

Abre `http://localhost:4173`. En Android, desde Chrome, usa **Añadir a pantalla de inicio** para instalarla (la publicación debe usar HTTPS).

El servidor se inicia con `--use-system-ca` para respetar el almacén de certificados de Windows al conectar con las APIs externas.

## Conectar un proveedor real

### Stay22: activo con el Partner ID de Hotelio

Hotelio consulta **Stay22 Direct Travel API** de forma predeterminada. El modo demo funciona sin cuenta y busca precios reales de Booking.com, Expedia, Hotels.com y Vrbo con un límite de 5 peticiones por minuto.

La cuenta de Stay22 está asociada al Partner ID (AID) `hotelio`. Hotelio añade ese identificador y la campaña `hotelio_search` a todos los enlaces de oferta para atribuir correctamente las reservas. No se utiliza un token de informes. La búsqueda transmite destino, fechas, adultos, cantidad de niños y habitaciones. Stay22 no acepta las edades concretas de los niños, por lo que deben confirmarse al abrir la oferta.

El rango en euros se vuelve a aplicar dentro de Hotelio. Conforme a las restricciones publicadas por Stay22, sus fichas se consultan en tiempo real y no se almacenan como favoritos permanentes.

### Opción sencilla: solo una API key

Hotelio trae un conector incorporado para **SerpApi Google Hotels**, con cuota gratuita mensual. Abre **Proveedores**, pulsa **Obtener clave**, crea una cuenta, copia la API key, pégala, marca **Activar** y guarda. No hace falta escribir endpoints.

- SerpApi: <https://serpapi.com/users/sign_up>

Las peticiones pasan por el servidor local de Hotelio (`/api/search/...`). La clave queda en el almacenamiento local del navegador; para una publicación multiusuario se debería usar un almacén seguro del servidor.

### Conector HTTP avanzado

En **Proveedores**, añade un endpoint HTTPS. Hotelio hace `POST` con:

```json
{"destination":"Valencia","checkIn":"2026-08-01","checkOut":"2026-08-05","adults":2,"children":2,"childrenAges":[5,9],"guests":4,"rooms":1,"minPrice":20,"maxPrice":180,"currency":"EUR","nights":4}
```

Respuesta esperada:

```json
{"results":[{"id":"offer-1","name":"Hotel Ejemplo","location":"Valencia","nightlyPrice":62,"totalPrice":248,"currency":"EUR","rating":8.4,"features":["Cancelación gratis"],"url":"https://proveedor.example/oferta"}]}
```

El endpoint debe permitir CORS. Para portales comerciales, utiliza sus APIs oficiales o un backend autorizado; extraer HTML directamente desde Android es frágil y puede incumplir sus condiciones.

## Compilar como APK

Hotelio incluye un proyecto Android basado en Capacitor 8. Requiere Node.js 22 o posterior, JDK 21 y Android SDK 36.

```powershell
npm.cmd install
npm.cmd run android:apk
```

El APK de depuración se genera en `android/app/build/outputs/apk/debug/app-debug.apk`. La aplicación nativa contiene la interfaz web y consulta el backend público HTTPS de Hotelio para las búsquedas Stay22 y SerpApi.
