# The Critic

Proyecto escolar de desarrollo web — plataforma de reseñas y noticias de videojuegos.

**Alumno:** Angel Jiménez  
**Materia:** Desarrollo Web  
**Entrega:** Mayo 2026  
**Servidor:** Debian VM en `192.168.64.5`

---

## De que va el proyecto

The Critic es un sitio donde los usuarios pueden registrarse, explorar un catalogo de videojuegos, dejar reseñas con puntuacion del 1 al 5 y leer noticias del mundo gamer. Tambien tiene un panel de administracion para gestionar juegos, noticias y usuarios.

Lo hice con Node.js puro (sin Express ni nada) para entender bien como funciona un servidor por dentro. El frontend es HTML, CSS y JavaScript vanilla, sin frameworks.

---

## Stack

- **Backend:** Node.js v22 — servidor HTTP puro, sin frameworks
- **Base de datos:** MariaDB (compatible con MySQL)
- **Frontend:** HTML5 + CSS3 + JavaScript vanilla
- **Servidor web:** Apache2 como reverse proxy (puerto 80 → Node.js en el 3000)
- **Sistema operativo:** Debian 12 en maquina virtual
- **Correo:** Nodemailer con Gmail SMTP para recuperacion de contraseña

---

## Como correr el proyecto

### Requisitos
- Node.js v18+
- MariaDB o MySQL
- Apache2

### Pasos

**1. Copiar el proyecto al servidor:**
```bash
cp -r the-critic/ /var/www/the-critic
```

**2. Instalar dependencias:**
```bash
cd /var/www/the-critic
npm install
```

**3. Crear la base de datos:**
```sql
CREATE DATABASE the_critic CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'critic_user'@'localhost' IDENTIFIED BY 'critic2026';
GRANT ALL PRIVILEGES ON the_critic.* TO 'critic_user'@'localhost';
FLUSH PRIVILEGES;
```

**4. Configurar Apache2:**
```bash
sudo a2enmod proxy proxy_http
sudo cp the-critic.conf /etc/apache2/sites-available/
sudo a2ensite the-critic.conf
sudo systemctl reload apache2
```

**5. Arrancar:**
```bash
bash /var/www/the-critic/start.sh
```

Las tablas se crean solas al arrancar por primera vez, no hay que importar ningun SQL.

---

## Variables de entorno

El servidor lee las credenciales de variables de entorno para no ponerlas directo en el codigo:

| Variable | Para que sirve |
|---|---|
| `DB_USER` | Usuario de MariaDB |
| `DB_PASSWORD` | Contraseña de MariaDB |
| `DB_NAME` | Nombre de la base de datos |
| `DB_HOST` | Host de MariaDB (por defecto 127.0.0.1) |
| `PORT` | Puerto del servidor Node.js (por defecto 3000) |
| `MAIL_USER` | Cuenta Gmail para enviar correos |
| `MAIL_PASS` | Contraseña de aplicacion de Gmail |
| `SITE_URL` | URL base del sitio (para los links en los correos) |

---

## Estructura de archivos

```
the-critic/
├── server.js          — todo el backend: API, sesiones, BD
├── package.json       — dependencias
├── start.sh           — script para arrancar el servidor
├── the-critic.conf    — configuracion de Apache2
├── index.html         — inicio
├── videojuegos.html   — catalogo de juegos
├── juego.html         — detalle de un juego con sus reseñas
├── noticias.html      — lista de noticias
├── noticia.html       — noticia completa
├── login.html         — inicio de sesion
├── register.html      — registro
├── perfil.html        — perfil del usuario
├── nosotros.html      — pagina del equipo
├── terminos.html      — terminos y condiciones
├── reset-password.html — restablecer contraseña
├── admin.html         — panel de administracion
├── css/               — estilos separados por pagina
├── js/
│   ├── main.js        — logica del frontend
│   └── admin.js       — logica del panel de admin
└── assets/img/        — imagenes del sitio
```

---

## Seguridad

Algunas cosas que implemente para que el sitio sea seguro:

- Las contraseñas se guardan con hash `scrypt` + salt aleatorio, nunca en texto plano
- Las sesiones usan cookies `HttpOnly` con un token aleatorio de 96 caracteres
- Hay rate limiting: maximo 10 intentos de login por IP cada 15 minutos
- Los tokens de recuperacion de contraseña expiran en 1 hora
- Las imagenes se guardan en Base64 en la BD, sin escribir archivos en disco

---

## Base de datos

Tiene 6 tablas: `users`, `sessions`, `games`, `news`, `reviews` y `reset_tokens`. Todas usan InnoDB con claves foraneas y ON DELETE CASCADE para mantener la integridad. Se aplicaron indices en las columnas mas consultadas para optimizar las busquedas.

La documentacion completa del esquema, relaciones y formas normales esta en el PDF de documentacion del proyecto.

---

## Como restaurar si algo se rompe

El proyecto tiene Git inicializado con el estado final guardado:

```bash
git status      # ver que cambio
git diff        # ver exactamente que lineas cambiaron
git restore .   # restaurar todo
bash start.sh   # volver a arrancar
```
