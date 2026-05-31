# The Critic

Proyecto escolar de desarrollo web — plataforma de reseñas y noticias de videojuegos.

**Equipo:** Angel de Jesus Jimenez Noh · Novelo Chimal Israel de Jesús · Salazar Iracheta Angel · Gonzalez Carillo Victor Abelardo  
**Materia:** Desarrollo Web  
**Entrega:** Mayo 2026  
**Servidor:** Debian VM en `192.168.64.5`

---

## De que va el proyecto

The Critic es un sitio donde los usuarios pueden registrarse, explorar un catalogo de videojuegos, dejar reseñas con puntuacion del 1 al 5 y leer noticias del mundo gamer. Tambien tiene un panel de administracion para gestionar juegos y noticias.

Construido con Node.js puro (sin Express) para aprender como funciona un servidor por dentro. El frontend es HTML, CSS y JavaScript vanilla, sin frameworks.

---

## Arquitectura MVC

El proyecto sigue el patrón **Modelo-Vista-Controlador** dentro de `server.js`:

| Capa | Qué contiene |
|---|---|
| **Model** | Validaciones, seguridad (scrypt), rate limiting, serializadores, helpers de BD, manejo de sesiones |
| **View** | Archivos HTML, CSS, JS e imágenes servidos estáticamente desde disco |
| **Controller** | Handlers de cada endpoint `/api/*` organizados por dominio: auth, perfil, juegos, reseñas, admin, noticias |
| **Router** | Enrutador principal que lee la URL y delega al Controller correcto |

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

### En producción (Debian + Apache)

**Requisitos:** Node.js v18+, MariaDB, Apache2

**1. Clonar el repositorio:**
```bash
git clone https://github.com/Angel-jimenez-21/the-critic /var/www/the-critic
cd /var/www/the-critic
npm install
```

**2. Crear la base de datos:**
```sql
CREATE DATABASE the_critic CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'critic_user'@'localhost' IDENTIFIED BY 'critic2026';
GRANT ALL PRIVILEGES ON the_critic.* TO 'critic_user'@'localhost';
FLUSH PRIVILEGES;
```

**3. Configurar Apache2:**
```bash
sudo a2enmod proxy proxy_http
sudo cp the-critic.conf /etc/apache2/sites-available/
sudo a2ensite the-critic.conf
sudo systemctl reload apache2
```

**4. Arrancar:**
```bash
bash /var/www/the-critic/start.sh
```

### En local (Windows / Mac — sin Apache)

**Requisitos:** Node.js v18+, MariaDB

```bash
git clone https://github.com/Angel-jimenez-21/the-critic
cd the-critic
npm install
DB_USER=root DB_PASSWORD=tu_password node server.js
```

Abrir en el navegador: `http://localhost:3000`

> Las tablas se crean automáticamente al arrancar por primera vez. No hay que importar ningún SQL.

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
│
├── server.js              — backend completo (MVC: Model + Controller + Router)
├── package.json           — dependencias npm
├── start.sh               — script para arrancar en producción
├── the-critic.conf        — configuración de Apache2 (reverse proxy)
│
│── [VIEW — páginas HTML]
├── index.html             — portada
├── videojuegos.html       — catálogo de juegos
├── juego.html             — detalle de juego y reseñas
├── noticias.html          — lista de noticias
├── noticia.html           — noticia completa
├── login.html             — inicio de sesión
├── register.html          — registro de cuenta
├── perfil.html            — perfil del usuario
├── admin.html             — panel de administración
├── nosotros.html          — página del equipo
├── terminos.html          — términos y condiciones
├── reset-password.html    — restablecer contraseña
│
├── css/                   — estilos separados por página
├── js/
│   ├── main.js            — lógica del frontend (Fetch API)
│   └── admin.js           — lógica del panel de admin
└── assets/img/            — imágenes del sitio
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
