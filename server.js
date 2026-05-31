// server.js
// Servidor principal de The Critic
// Lo hice con Node.js puro, sin usar frameworks como Express, para aprender como funciona todo por dentro
// Se encarga de tres cosas: servir los archivos del sitio, manejar la API y conectarse a la base de datos
//
// Para correr en local:
//   node server.js
// En el servidor de debian se corre con las variables de entorno:
//   DB_USER=critic_user DB_PASSWORD=critic2026 DB_NAME=the_critic node server.js
//
// ============================================================================
// ARQUITECTURA MVC — separación de responsabilidades
// ============================================================================
//
//  MODEL      → validaciones, seguridad, rate limiting, serializadores,
//               helpers de BD, inicialización y seed de la base de datos.
//               Todo lo relacionado con los datos y sus reglas de negocio.
//
//  VIEW       → archivos estáticos (HTML, CSS, JS, imágenes).
//               El servidor los sirve directamente desde disco.
//               Están en las carpetas: /, css/, js/, assets/
//
//  CONTROLLER → handlers de cada endpoint de la API (/api/*).
//               Reciben la petición, llaman al Model y devuelven la respuesta.
//               Organizados por dominio: auth, perfil, juegos, reseñas, admin.
//
//  ROUTER     → enrutador principal al final del archivo.
//               Lee la URL entrante y delega al Controller correcto.
//
// ============================================================================

// --- modulos que trae Node de serie, no hay que instalar nada ----------------
const http   = require('node:http');   // para crear el servidor HTTP
const fs     = require('node:fs');     // para leer archivos del disco (css, html, img...)
const path   = require('node:path');   // para manejar rutas de archivos sin errores de / y \
const crypto = require('node:crypto'); // para el hash de contraseñas y generar ids de sesion

// --- unica dependencia externa que hay que instalar con npm ------------------
const mysql      = require('mysql2/promise'); // driver para conectarse a MariaDB con async/await
const nodemailer = require('nodemailer');     // para enviar correos de recuperacion de contraseña

// --- configuracion general del servidor -------------------------------------
const ROOT_DIR            = __dirname;               // carpeta raiz del proyecto (donde esta este archivo)
const PORT                = Number(process.env.PORT) || 3000; // puerto donde escucha el servidor
const SESSION_COOKIE_NAME = 'the_critic_session';    // nombre de la cookie que identifica al usuario
const SESSION_TTL_MS      = 1000 * 60 * 60 * 24 * 7; // cuanto dura la sesion: 7 dias en milisegundos
const DEFAULT_AVATAR      = 'assets/img/cta.png';   // imagen por defecto si el usuario no tiene foto

// --- datos de conexion a la base de datos -----------------------------------
// se leen de variables de entorno para no poner contraseñas en el codigo
const dbConfig = {
  host:               process.env.DB_HOST     || '127.0.0.1',
  port:               Number(process.env.DB_PORT) || 3306,
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '',
  database:           process.env.DB_NAME     || 'the_critic',
  charset:            'utf8mb4',      // utf8mb4 soporta emojis y caracteres especiales
  waitForConnections: true,
  connectionLimit:    10,             // maximo de conexiones abiertas al mismo tiempo
};

// pool de conexiones (se crea en initDatabase, aqui solo se declara)
let db;

// --- configuracion del correo para recuperacion de contraseña ---------------
// las credenciales se leen de variables de entorno, igual que la BD
// MAIL_USER = cuenta gmail  (ej: thecritic@gmail.com)
// MAIL_PASS = contraseña de aplicacion de google (NO la contraseña normal de gmail)
const mailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER || '',
    pass: process.env.MAIL_PASS || '',
  },
});

// tiempo que dura valido un token de recuperacion: 1 hora
const RESET_TOKEN_TTL_MS = 1000 * 60 * 60;

// URL base del sitio — se usa para construir el enlace del correo
// en produccion deberia ser el dominio real, por ahora apunta al servidor local
const SITE_URL = process.env.SITE_URL || 'http://192.168.64.5';

// devuelve la fecha/hora actual en formato que entiende MySQL: "2026-05-24 10:30:00"
function nowMysql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// ============================================================================
// UTILIDADES COMPARTIDAS — FECHA
// (usadas por Models y Controllers para formatear fechas)
// ============================================================================

// suma dias a una fecha y devuelve un Date nuevo (se usa para calcular expiracion de sesion)
function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

// convierte cualquier fecha a formato DD.MM.YYYY para mostrar en pantalla
// ej: "2026-03-24T09:00:00.000Z" → "24.03.2026"
function dateLabel(dateInput) {
  const value = new Date(dateInput);
  const day   = String(value.getDate()).padStart(2, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0'); // getMonth() empieza en 0, por eso +1
  const year  = value.getFullYear();
  return `${day}.${month}.${year}`;
}

// ============================================================================
// UTILIDADES COMPARTIDAS — TEXTO
// ============================================================================

// quita espacios al principio y al final, y convierte null o undefined a string vacio
// se usa antes de guardar cualquier dato que venga del usuario
function normalizeText(value) {
  return String(value || '').trim();
}

// ============================================================================
// MODEL — VALIDACIONES
// Comprueban que los datos del usuario sean correctos antes de procesarlos.
// Devuelven un mensaje de error (string) o null si todo está bien.
// ============================================================================

// verifica que la contraseña cumpla los requisitos de seguridad
// devuelve un mensaje de error si falla, o null si esta bien
function validatePassword(password) {
  if (password.length < 8) {
    return 'La contraseña debe tener al menos 8 caracteres.';
  }
  if (password.length > 128) {
    return 'La contraseña es demasiado larga.';
  }
  if (!/[A-Z]/.test(password)) {
    return 'La contraseña debe incluir al menos una letra mayúscula.';
  }
  if (!/[0-9]/.test(password)) {
    return 'La contraseña debe incluir al menos un número.';
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return 'La contraseña debe incluir al menos un carácter especial (!@#$%...).';
  }
  return null; // null significa que esta bien, no hay error
}

// verifica que el nombre de usuario sea valido (3-30 chars, solo letras/numeros/espacios/guion bajo)
function validateUsername(username) {
  if (username.length < 3) {
    return 'El nombre de usuario debe tener al menos 3 caracteres.';
  }
  if (username.length > 30) {
    return 'El nombre de usuario no puede superar los 30 caracteres.';
  }
  if (!/^[A-Za-zÀ-ÿ0-9 _]+$/.test(username)) {
    return 'El nombre de usuario solo puede contener letras, números, espacios y guiones bajos.';
  }
  return null;
}

// verifica que el correo tenga formato valido (algo@algo.algo) y no sea demasiado largo
function validateEmail(email) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return 'El formato del correo electrónico no es válido.';
  }
  if (email.length > 190) {
    return 'El correo electrónico es demasiado largo.';
  }
  return null;
}

// ============================================================================
// MODEL — RATE LIMITING
// Limita cuántos intentos puede hacer una IP en cierto tiempo.
// Evita ataques de fuerza bruta (probar miles de contraseñas).
// Máximo: 10 intentos de login / 5 de registro por ventana de tiempo.
// ============================================================================

// guarda los intentos fallidos: clave = "accion:ip", valor = { count, firstAttempt }
const rateLimitStore = new Map();

// saca la IP real del cliente, tomando en cuenta que hay un proxy (Apache) por delante
function getClientIp(request) {
  return (
    String(request.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    request.socket?.remoteAddress ||
    'unknown'
  );
}

// revisa si una IP ya supero el limite de intentos permitidos
// devuelve un mensaje si esta bloqueada, o null si puede seguir intentando
function checkRateLimit(ip, action, maxAttempts, windowMs) {
  const key    = `${action}:${ip}`;
  const now    = Date.now();
  const record = rateLimitStore.get(key);

  if (!record) {
    return null; // primera vez que intenta, no hay registro
  }

  // si ya paso la ventana de tiempo, borra el registro y deja pasar
  if (now - record.firstAttempt > windowMs) {
    rateLimitStore.delete(key);
    return null;
  }

  // si supero el maximo de intentos, calcula cuanto tiempo falta y bloquea
  if (record.count >= maxAttempts) {
    const minutesLeft = Math.ceil((windowMs - (now - record.firstAttempt)) / 60000);
    return `Demasiados intentos. Espera ${minutesLeft} minuto(s) antes de intentarlo de nuevo.`;
  }

  return null;
}

// registra un intento fallido para esa IP y accion
function registerRateLimitFailure(ip, action, windowMs) {
  const key    = `${action}:${ip}`;
  const now    = Date.now();
  const record = rateLimitStore.get(key);

  // si no hay registro o ya expiro, crea uno nuevo desde cero
  if (!record || now - record.firstAttempt > windowMs) {
    rateLimitStore.set(key, { count: 1, firstAttempt: now });
    return;
  }

  record.count += 1; // incrementa el contador de intentos fallidos
}

// limpia el registro cuando el usuario logra autenticarse correctamente
function clearRateLimit(ip, action) {
  rateLimitStore.delete(`${action}:${ip}`);
}

// ============================================================================
// MODEL — SEGURIDAD (manejo de contraseñas)
// hashPassword : genera hash scrypt + salt aleatorio → nunca se guarda el texto plano.
// verifyPassword: compara usando timingSafeEqual → resistente a timing attacks.
// ============================================================================

// genera un hash seguro de la contraseña usando scrypt + un salt aleatorio
// el salt hace que dos contraseñas iguales produzcan hashes distintos
// lo que se guarda en la BD es "salt:hash" (ambos en hexadecimal)
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');        // 16 bytes aleatorios
  const hash = crypto.scryptSync(password, salt, 64).toString('hex'); // 64 bytes de hash
  return `${salt}:${hash}`;
}

// compara la contraseña escrita por el usuario contra el hash guardado en la BD
// usa timingSafeEqual para que la comparacion tarde igual aunque sea incorrecta
// (evita ataques de timing que miden cuanto tarda en responder)
function verifyPassword(password, storedHash) {
  const [salt, hash] = String(storedHash || '').split(':');

  // si el hash no tiene el formato correcto, rechaza directamente
  if (!salt || !hash) {
    return false;
  }

  const derivedHash  = crypto.scryptSync(password, salt, 64);
  const originalHash = Buffer.from(hash, 'hex');

  if (derivedHash.length !== originalHash.length) {
    return false;
  }

  return crypto.timingSafeEqual(derivedHash, originalHash);
}

// ============================================================================
// UTILIDADES COMPARTIDAS — HTTP
// Helpers para leer y escribir peticiones/respuestas HTTP.
// Usados por todos los Controllers.
// ============================================================================

// convierte el header Cookie (string) en un objeto clave-valor para poder leerlo facil
// ej: "session=abc123; tema=oscuro" → { session: 'abc123', tema: 'oscuro' }
function parseCookies(cookieHeader) {
  return String(cookieHeader || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separator = part.indexOf('=');

      if (separator === -1) {
        return cookies;
      }

      const key   = part.slice(0, separator).trim();
      const value = decodeURIComponent(part.slice(separator + 1).trim());
      cookies[key] = value;
      return cookies;
    }, {});
}

// manda una respuesta JSON al cliente con el codigo HTTP y los datos
// siempre incluye Cache-Control: no-store para que el browser no guarde respuestas de la API
function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

// manda una respuesta de texto plano (se usa para errores simples)
function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
  });
  response.end(text);
}

// lee el cuerpo JSON de una peticion HTTP y lo devuelve como objeto
// si el body pesa mas de 1MB rechaza la peticion (proteccion basica)
function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let rawBody = '';

    request.on('data', (chunk) => {
      rawBody += chunk.toString();

      // ojo: si alguien manda un payload gigante lo cortamos aqui
      if (rawBody.length > 1024 * 1024) {
        reject(new Error('Payload demasiado grande.'));
        request.destroy();
      }
    });

    request.on('end', () => {
      if (!rawBody) {
        resolve({}); // body vacio → objeto vacio, no es error
        return;
      }

      try {
        resolve(JSON.parse(rawBody));
      } catch (error) {
        reject(new Error('JSON inválido.'));
      }
    });

    request.on('error', reject);
  });
}

// ============================================================================
// MODEL — SERIALIZADORES
// Convierten filas de la BD al formato JSON que usa el frontend.
// IMPORTANTE: nunca exponen campos sensibles como password_hash o salt.
// ============================================================================

// convierte un usuario de la BD al objeto que ve el frontend
// nunca incluye el hash de contraseña
function serializeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id:        user.id,
    name:      user.username,
    email:     user.email,
    avatar:    user.avatar_url || DEFAULT_AVATAR,
    isAdmin:   Boolean(user.is_admin), // 0 → false, 1 → true
    createdAt: user.created_at,
  };
}

// convierte una fila de reviews (con JOIN de users y games) al formato de la API
function serializeReview(review) {
  return {
    id:        review.id,
    userId:    review.user_id,     // se usa en el frontend para saber si la reseña es del usuario actual
    userName:  review.username,
    gameName:  review.game_title,
    gameSlug:  review.game_slug,
    comment:   review.comment,
    rating:    review.rating,
    avatar:    review.avatar_url || DEFAULT_AVATAR,
    createdAt: review.created_at,
    date:      dateLabel(review.created_at), // version legible de la fecha
  };
}

// convierte un juego de la BD incluyendo su promedio de puntuacion y total de reseñas
function serializeGame(game) {
  const averageRating = Number(game.average_rating) || 0;

  return {
    id:           game.id,
    slug:         game.slug,          // identificador en la URL, ej: "hollow-knight"
    title:        game.title,
    description:  game.description,
    genre:        game.genre,
    platform:     game.platform,
    imageUrl:     game.image_url,
    averageRating,
    rating:       Math.round(averageRating), // rating redondeado para las barras visuales
    reviewCount:  Number(game.review_count) || 0,
  };
}

// convierte una noticia de la BD al formato de la API
function serializeNews(article) {
  return {
    id:          article.id,
    slug:        article.slug,
    title:       article.title,
    excerpt:     article.excerpt,    // resumen corto que se muestra en la lista
    content:     article.content || null, // contenido completo (solo se manda en el detalle)
    imageUrl:    article.image_url,
    category:    article.category,
    publishedAt: article.published_at,
    date:        dateLabel(article.published_at),
  };
}

// ============================================================================
// MODEL — COOKIES DE SESIÓN
// Genera y limpia la cookie HttpOnly que identifica la sesión del usuario.
// ============================================================================

// arma el string del header Set-Cookie para cuando el usuario inicia sesion
// HttpOnly: el JS del browser no puede leer la cookie (evita robo por XSS)
// SameSite=Lax: protege contra CSRF en la mayoria de casos
function createSessionCookie(sessionId) {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(
    SESSION_TTL_MS / 1000
  )}`;
}

// arma el header para borrar la cookie al hacer logout (Max-Age=0 la elimina)
function clearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

// ============================================================================
// MODEL — HELPERS DE CONSULTA A LA BD
// Wrappers sobre db.execute para simplificar las consultas frecuentes.
// ============================================================================

// ejecuta una consulta y devuelve solo la primera fila (o null si no hay resultados)
// se usa cuando se busca algo que deberia existir una sola vez (buscar por id, email, etc)
async function queryOne(sql, params = []) {
  const [rows] = await db.execute(sql, params);
  return rows[0] || null;
}

// ejecuta una consulta y devuelve todas las filas como array
async function queryAll(sql, params = []) {
  const [rows] = await db.execute(sql, params);
  return rows;
}

// ============================================================================
// MODEL — BASE DE DATOS (inicialización y seed)
// Crea las tablas si no existen, aplica migraciones y carga datos de ejemplo.
// Tablas: users, sessions, games, news, reviews, reset_tokens
// ============================================================================

async function initDatabase() {
  // crea el pool de conexiones con la config de arriba
  db = await mysql.createPool(dbConfig);

  // tabla de usuarios — guarda cuentas registradas
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      username      VARCHAR(120) NOT NULL UNIQUE,
      email         VARCHAR(190) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,          -- hash scrypt, nunca la contraseña real
      avatar_url    MEDIUMTEXT NULL,                -- imagen en base64 (puede ser grande)
      is_admin      TINYINT(1) NOT NULL DEFAULT 0,  -- 0 = usuario normal, 1 = administrador
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // tabla de sesiones — una fila por sesion activa, se vincula al usuario por user_id
  await db.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id         VARCHAR(96) PRIMARY KEY,           -- id aleatorio de 48 bytes en hex
      user_id    INT UNSIGNED NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE -- si se borra el usuario se borran sus sesiones
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // tabla de juegos — catalogo de videojuegos que se pueden reseñar
  await db.query(`
    CREATE TABLE IF NOT EXISTS games (
      id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      slug        VARCHAR(190) NOT NULL UNIQUE,   -- version url del titulo, ej: "hollow-knight"
      title       VARCHAR(190) NOT NULL,
      description TEXT NOT NULL,
      genre       VARCHAR(120) NOT NULL,          -- puede ser "Accion, RPG" (varios separados por coma)
      platform    VARCHAR(120) NOT NULL,
      image_url   MEDIUMTEXT NULL,               -- imagen en base64
      created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // tabla de noticias
  await db.query(`
    CREATE TABLE IF NOT EXISTS news (
      id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      slug         VARCHAR(190) NOT NULL UNIQUE,
      title        VARCHAR(190) NOT NULL,
      excerpt      TEXT NOT NULL,       -- resumen corto para la lista
      content      LONGTEXT NOT NULL,   -- articulo completo (puede ser muy largo)
      image_url    MEDIUMTEXT NULL,
      category     VARCHAR(120) NOT NULL,
      published_at DATETIME NOT NULL,
      created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // tabla de reseñas — cada usuario puede tener maximo una reseña por juego
  // el indice unico idx_reviews_user_game lo garantiza a nivel de BD
  await db.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id    INT UNSIGNED NOT NULL,
      game_id    INT UNSIGNED NOT NULL,
      rating     TINYINT UNSIGNED NOT NULL,
      comment    TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (rating BETWEEN 1 AND 5),             -- la puntuacion solo puede ser del 1 al 5
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // indices para que las consultas mas frecuentes sean rapidas
  // sin indices MySQL tiene que leer toda la tabla para cada busqueda
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions (user_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_reviews_game      ON reviews  (game_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_reviews_user      ON reviews  (user_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_reviews_created   ON reviews  (created_at)`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_user_game ON reviews (user_id, game_id)`); // 1 reseña por usuario por juego
  await db.query(`CREATE INDEX IF NOT EXISTS idx_news_published   ON news     (published_at)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_news_category    ON news     (category)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_games_slug       ON games    (slug)`);

  // tabla de tokens de recuperacion de contraseña
  // cada token dura 1 hora y se borra cuando se usa o cuando expira
  await db.query(`
    CREATE TABLE IF NOT EXISTS reset_tokens (
      id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id    INT UNSIGNED NOT NULL,
      token      VARCHAR(96) NOT NULL UNIQUE,   -- token aleatorio de 48 bytes en hex
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // migraciones para bases de datos que ya existian con estructura anterior
  // ALTER TABLE con IF NOT EXISTS no falla si la columna ya existe
  await db.query(`ALTER TABLE users  ADD COLUMN IF NOT EXISTS is_admin TINYINT(1) NOT NULL DEFAULT 0`);
  await db.query(`ALTER TABLE games  MODIFY COLUMN image_url MEDIUMTEXT NULL`);
  await db.query(`ALTER TABLE news   MODIFY COLUMN image_url MEDIUMTEXT NULL`);

  await seedDatabase();
}

// carga los datos iniciales de ejemplo (juegos, usuarios de prueba, noticias y reseñas)
// solo inserta si no existe ya — ON DUPLICATE KEY UPDATE para los juegos,
// y un conteo previo para usuarios, noticias y reseñas
async function seedDatabase() {
  // lista de juegos de ejemplo con los que inicia el sitio
  const games = [
    {
      slug:        'minecraft-java-edition',
      title:       'MINECRAFT: Java Edition',
      description: 'Minecraft es una experiencia sandbox centrada en creatividad, supervivencia y exploración. Su libertad de juego y comunidad lo mantienen vigente.',
      genre:       'Sandbox, Survival',
      platform:    'PC',
      imageUrl:    'assets/img/minecraft.png',
    },
    {
      slug:        'terraria',
      title:       'Terraria',
      description: 'Un sandbox 2D con gran profundidad de combate, construcción y progresión.',
      genre:       'Sandbox, Aventura',
      platform:    'PC',
      imageUrl:    'assets/img/terraria.png',
    },
    {
      slug:        'hollow-knight',
      title:       'Hollow Knight',
      description: 'Aventura indie con exploración metroidvania, combates precisos y una atmósfera memorable.',
      genre:       'Indie, Aventura',
      platform:    'PC, Switch, PlayStation, Xbox',
      imageUrl:    'assets/img/hollow_knight.jpeg',
    },
    {
      slug:        'stardew-valley',
      title:       'Stardew Valley',
      description: 'Simulador de granja con relaciones, exploración, minería y progreso relajado.',
      genre:       'Indie, RPG',
      platform:    'PC, Switch, Mobile',
      imageUrl:    'assets/img/stardew_valley.png',
    },
    {
      slug:        'the-legend-of-zelda-tears-of-the-kingdom',
      title:       'Zelda: Tears of the Kingdom',
      description: 'Aventura de mundo abierto enfocada en exploración, creatividad y resolución de problemas.',
      genre:       'Aventura, Accion',
      platform:    'Switch',
      imageUrl:    'assets/img/zelda.jpeg',
    },
    {
      slug:        'elden-ring',
      title:       'Elden Ring',
      description: 'RPG de acción con mundo abierto, jefes exigentes y libertad para construir tu personaje.',
      genre:       'RPG, Accion',
      platform:    'PC, PlayStation, Xbox',
      imageUrl:    'assets/img/elden_ring.jpg',
    },
    {
      slug:        'halo-infinite',
      title:       'Halo Infinite',
      description: 'Shooter de ciencia ficción con campaña abierta y combate multijugador competitivo.',
      genre:       'Accion',
      platform:    'PC, Xbox',
      imageUrl:    'assets/img/halo_infinite.jpeg',
    },
    {
      slug:        'clash-royale',
      title:       'Clash Royale',
      description: 'Estrategia móvil en tiempo real con partidas cortas, cartas y duelos competitivos.',
      genre:       'Estrategia',
      platform:    'Mobile',
      imageUrl:    'assets/img/clash-royale.jpg',
    },
  ];

  // INSERT OR UPDATE — si el juego ya existe actualiza sus datos, no falla ni duplica
  for (const game of games) {
    await db.execute(
      `INSERT INTO games (slug, title, description, genre, platform, image_url)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title),
         description = VALUES(description),
         genre = VALUES(genre),
         platform = VALUES(platform),
         image_url = VALUES(image_url)`,
      [game.slug, game.title, game.description, game.genre, game.platform, game.imageUrl]
    );
  }

  // usuarios de prueba — solo se crean si la tabla esta vacia (primera vez que corre)
  const userCount = await queryOne('SELECT COUNT(*) AS total FROM users');

  if (!Number(userCount.total)) {
    const users = [
      { username: 'Joe Pino',    email: 'joe@thecritic.test',  password: 'demo1234', isAdmin: 1 }, // este es el admin
      { username: 'Ana Ramirez', email: 'ana@thecritic.test',  password: 'demo1234', isAdmin: 0 },
      { username: 'Luis Torres', email: 'luis@thecritic.test', password: 'demo1234', isAdmin: 0 },
    ];

    for (const user of users) {
      await db.execute(
        'INSERT INTO users (username, email, password_hash, avatar_url, is_admin) VALUES (?, ?, ?, ?, ?)',
        [user.username, user.email, hashPassword(user.password), DEFAULT_AVATAR, user.isAdmin]
      );
    }
  }

  // noticias de ejemplo — igual, solo si la tabla esta vacia
  const newsCount = await queryOne('SELECT COUNT(*) AS total FROM news');

  if (!Number(newsCount.total)) {
    const newsArticles = [
      {
        slug:        'gta-vi-espera-mundial',
        title:       'Tercera guerra mundial antes de GTA VI',
        excerpt:     'La comunidad sigue esperando novedades mientras los rumores no se detienen.',
        content:     'GTA VI sigue siendo uno de los juegos más esperados de la historia. Rockstar Games ha confirmado su lanzamiento pero los fans ya dudan que los plazos se cumplan. Los rumores apuntan a un mundo enorme ambientado en Vice City moderna, con una protagonista femenina por primera vez en la saga principal. La comunidad de jugadores sigue de cerca cada filtración.',
        imageUrl:    'assets/img/hero.png',
        category:    'Noticias en General',
        publishedAt: '2026-02-02 10:00:00',
      },
      {
        slug:        'minecraft-15-aniversario',
        title:       'Minecraft celebra 15 años revolucionando los videojuegos',
        excerpt:     'El juego sandbox más popular de la historia alcanza un nuevo hito con más de 300 millones de copias vendidas.',
        content:     'Minecraft cumple 15 años desde su lanzamiento oficial y sigue siendo uno de los juegos más jugados del mundo. Con más de 300 millones de copias vendidas en todas las plataformas, Mojang continúa lanzando actualizaciones que mantienen fresco el contenido. La última actualización trajo nuevos biomas y mobs que la comunidad recibió con entusiasmo.',
        imageUrl:    'assets/img/minecraft.png',
        category:    'Lanzamientos',
        publishedAt: '2026-01-15 09:00:00',
      },
      {
        slug:        'elden-ring-dlc-anuncio',
        title:       'FromSoftware anuncia nuevo contenido descargable para Elden Ring',
        excerpt:     'El aclamado RPG de acción regresa con nueva historia, jefes y mecánicas de juego.',
        content:     'FromSoftware ha anunciado un nuevo DLC para Elden Ring. El contenido incluirá una nueva región completamente explorable, más de 10 jefes inéditos y nuevas armas y hechizos. Los fans del juego original están emocionados con las primeras imágenes que muestran entornos oscuros y criaturas nunca vistas antes en el universo del juego.',
        imageUrl:    'assets/img/hero.png',
        category:    'Lanzamientos',
        publishedAt: '2026-01-28 14:00:00',
      },
      {
        slug:        'esports-record-audiencia-2025',
        title:       'Los esports superan los 2 mil millones de espectadores en 2025',
        excerpt:     'La industria de los deportes electrónicos marca un nuevo récord de audiencia a nivel mundial.',
        content:     'Los esports continúan su crecimiento imparable. Durante 2025, los torneos de videojuegos competitivos alcanzaron más de 2 mil millones de espectadores únicos en todo el mundo. League of Legends, Valorant y Counter-Strike 2 lideraron las listas de juegos más vistos, mientras que nuevos títulos comienzan a ganar terreno en la escena competitiva.',
        imageUrl:    'assets/img/cta.png',
        category:    'Esports',
        publishedAt: '2026-01-10 11:00:00',
      },
      {
        slug:        'indie-games-dominan-2026',
        title:       'Los juegos indie dominan las listas de los más vendidos',
        excerpt:     'Desarrolladores independientes siguen sorprendiendo con propuestas que superan a grandes estudios.',
        content:     'El mercado de videojuegos indie sigue en auge. Títulos como Hollow Knight, Stardew Valley y Hades continúan vendiendo millones de copias años después de su lanzamiento. Los jugadores valoran cada vez más la originalidad y la pasión que los estudios pequeños imprimen en sus proyectos, prefiriéndolos sobre grandes producciones con presupuestos millonarios pero sin alma.',
        imageUrl:    'assets/img/hero.png',
        category:    'Industria',
        publishedAt: '2026-01-05 08:00:00',
      },
    ];

    for (const article of newsArticles) {
      await db.execute(
        `INSERT INTO news (slug, title, excerpt, content, image_url, category, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [article.slug, article.title, article.excerpt, article.content, article.imageUrl, article.category, article.publishedAt]
      );
    }
  }

  // reseñas de ejemplo — solo si la tabla esta vacia
  const reviewCount = await queryOne('SELECT COUNT(*) AS total FROM reviews');

  if (!Number(reviewCount.total)) {
    const minecraft = await findGameBySlug('minecraft-java-edition');
    const joe       = await findUserByEmail('joe@thecritic.test');
    const ana       = await findUserByEmail('ana@thecritic.test');
    const luis      = await findUserByEmail('luis@thecritic.test');

    const baseReviews = [
      {
        userId:    joe.id,
        rating:    5,
        comment:   'Minecraft sigue siendo uno de los juegos más completos para jugar solo o con amigos. Siempre hay algo nuevo que construir o explorar.',
        createdAt: '2026-03-24 09:00:00',
      },
      {
        userId:    ana.id,
        rating:    4,
        comment:   'La libertad que da el juego es increíble. Me gustaría una interfaz más amigable para nuevos jugadores, pero su creatividad no tiene límite.',
        createdAt: '2026-03-22 18:30:00',
      },
      {
        userId:    luis.id,
        rating:    5,
        comment:   'Entre mods, servidores y supervivencia, Minecraft tiene una vida útil enorme. Muy fácil entender por qué sigue siendo tan popular.',
        createdAt: '2026-03-21 14:10:00',
      },
    ];

    for (const review of baseReviews) {
      await db.execute(
        `INSERT INTO reviews (user_id, game_id, rating, comment, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [review.userId, minecraft.id, review.rating, review.comment, review.createdAt, review.createdAt]
      );
    }
  }
}

// ============================================================================
// MODEL — HELPERS DE BASE DE DATOS (sesiones y búsquedas frecuentes)
// Funciones reutilizables para buscar usuarios, juegos y manejar sesiones.
// ============================================================================

// elimina las sesiones que ya expiraron — se llama antes de cada verificacion de sesion
// asi la BD no se va llenando de sesiones viejas
async function cleanupExpiredSessions() {
  await db.execute('DELETE FROM sessions WHERE expires_at <= ?', [nowMysql()]);
}

// busca usuario por email (no distingue mayusculas/minusculas)
async function findUserByEmail(email) {
  return queryOne('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [email]);
}

// busca usuario por nombre de usuario (no distingue mayusculas/minusculas)
async function findUserByUsername(username) {
  return queryOne('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [username]);
}

// busca usuario por ID — nota que NO trae el password_hash, eso es intencional
async function findUserById(id) {
  return queryOne('SELECT id, username, email, avatar_url, is_admin, created_at FROM users WHERE id = ?', [id]);
}

// busca juego por su slug de URL
async function findGameBySlug(slug) {
  return queryOne('SELECT * FROM games WHERE slug = ?', [slug]);
}

// obtiene el usuario que hizo la peticion leyendo su cookie de sesion
// primero limpia sesiones expiradas, luego busca la cookie, luego verifica en la BD
// devuelve el usuario o null si no hay sesion valida
async function getSessionUser(request) {
  await cleanupExpiredSessions();
  const cookies   = parseCookies(request.headers.cookie);
  const sessionId = cookies[SESSION_COOKIE_NAME];

  if (!sessionId) {
    return null; // no hay cookie de sesion
  }

  // hace JOIN entre sessions y users para obtener todos los datos del usuario en una sola consulta
  const user = await queryOne(
    `SELECT
      sessions.id         AS session_id,
      sessions.expires_at AS expires_at,
      users.id            AS id,
      users.username      AS username,
      users.email         AS email,
      users.avatar_url    AS avatar_url,
      users.is_admin      AS is_admin,
      users.created_at    AS created_at
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.id = ?`,
    [sessionId]
  );

  if (!user) {
    return null; // la sesion no existe en la BD
  }

  // verifica que la sesion no haya expirado (doble check ademas del DELETE periodico)
  if (new Date(user.expires_at).getTime() <= Date.now()) {
    await db.execute('DELETE FROM sessions WHERE id = ?', [sessionId]);
    return null;
  }

  return user;
}

// crea una nueva sesion para el usuario y devuelve el id de sesion
// el id es un string de 48 bytes aleatorios en hexadecimal (imposible de adivinar)
async function createSession(userId) {
  const sessionId = crypto.randomBytes(24).toString('hex');
  const expiresAt = addDays(new Date(), 7).toISOString().slice(0, 19).replace('T', ' ');
  await db.execute('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)', [
    sessionId,
    userId,
    expiresAt,
  ]);
  return sessionId;
}

// ============================================================================
// VIEW — ARCHIVOS ESTÁTICOS
// Sirve los HTML, CSS, JS e imágenes directamente desde el disco.
// Las vistas del proyecto son: index.html, login.html, register.html,
// videojuegos.html, juego.html, noticias.html, noticia.html,
// perfil.html, admin.html, nosotros.html, terminos.html, reset-password.html
// ============================================================================

// mapa de extensiones a tipos MIME — el browser necesita saber que tipo de archivo le mandan
const mimeTypes = {
  '.css':  'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico':  'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg':  'image/jpeg',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.webp': 'image/webp',
};

// convierte una ruta de URL en ruta absoluta del disco de forma segura
// normaliza el path y verifica que este dentro de ROOT_DIR (evita path traversal)
// ej: "/../../../etc/passwd" → null (bloqueado)
function safePathname(pathname) {
  const relativePath = String(pathname || '').replace(/^\/+/, '');
  const normalized   = path.normalize(path.join(ROOT_DIR, relativePath || 'index.html'));

  if (!normalized.startsWith(ROOT_DIR)) {
    return null; // intento de salir del directorio del proyecto — bloqueado
  }

  return normalized;
}

// sirve el archivo estatico solicitado (html, css, js, imagenes...)
// si el archivo no existe devuelve 404
function serveStaticFile(request, response, pathname) {
  const requestedPath = pathname === '/' ? 'index.html' : pathname;
  const absolutePath  = safePathname(requestedPath);

  if (!absolutePath || !fs.existsSync(absolutePath) || fs.statSync(absolutePath).isDirectory()) {
    sendText(response, 404, 'Archivo no encontrado');
    return;
  }

  const extension = path.extname(absolutePath).toLowerCase();
  const mimeType  = mimeTypes[extension] || 'application/octet-stream';

  response.writeHead(200, { 'Content-Type': mimeType });

  // usa un stream para no cargar el archivo entero en memoria
  fs.createReadStream(absolutePath).pipe(response);
}

// ============================================================================
// CONTROLLER — AUTENTICACIÓN
// Maneja registro, login, logout y verificación de sesión.
// Endpoints: POST /api/auth/register, POST /api/auth/login,
//            POST /api/auth/logout,   GET  /api/session
// ============================================================================

// POST /api/auth/register — crea una cuenta nueva y abre sesion automaticamente
async function handleRegister(request, response) {
  const ip       = getClientIp(request);
  const action   = 'register';
  const windowMs = 60 * 60 * 1000; // ventana de 1 hora para el rate limit de registro

  // maximo 5 registros por hora desde la misma IP
  const rateLimitError = checkRateLimit(ip, action, 5, windowMs);
  if (rateLimitError) {
    sendJson(response, 429, { error: rateLimitError });
    return;
  }

  const body            = await readJsonBody(request);
  const username        = normalizeText(body.username);
  const email           = normalizeText(body.email).toLowerCase(); // guardamos el email en minusculas siempre
  const password        = normalizeText(body.password);
  const confirmPassword = normalizeText(body.confirmPassword);

  // validar que no venga nada vacio
  if (!username || !email || !password || !confirmPassword) {
    registerRateLimitFailure(ip, action, windowMs);
    sendJson(response, 400, { error: 'Completa todos los campos.' });
    return;
  }

  // validar formato y reglas de cada campo
  const usernameError = validateUsername(username);
  if (usernameError) {
    registerRateLimitFailure(ip, action, windowMs);
    sendJson(response, 400, { error: usernameError });
    return;
  }

  const emailError = validateEmail(email);
  if (emailError) {
    registerRateLimitFailure(ip, action, windowMs);
    sendJson(response, 400, { error: emailError });
    return;
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    registerRateLimitFailure(ip, action, windowMs);
    sendJson(response, 400, { error: passwordError });
    return;
  }

  if (password !== confirmPassword) {
    registerRateLimitFailure(ip, action, windowMs);
    sendJson(response, 400, { error: 'Las contraseñas no coinciden.' });
    return;
  }

  // verificar que el correo y el nombre de usuario no esten ya en uso
  if (await findUserByEmail(email)) {
    registerRateLimitFailure(ip, action, windowMs);
    sendJson(response, 409, { error: 'Ese correo ya está registrado.' });
    return;
  }

  if (await findUserByUsername(username)) {
    registerRateLimitFailure(ip, action, windowMs);
    sendJson(response, 409, { error: 'Ese nombre de usuario ya está en uso.' });
    return;
  }

  // todo bien — crear usuario, abrir sesion y responder
  const [result] = await db.execute(
    'INSERT INTO users (username, email, password_hash, avatar_url) VALUES (?, ?, ?, ?)',
    [username, email, hashPassword(password), DEFAULT_AVATAR]
  );
  const user      = await findUserById(Number(result.insertId));
  const sessionId = await createSession(user.id);
  clearRateLimit(ip, action); // registro exitoso, limpiar contador de intentos

  sendJson(response, 201, { user: serializeUser(user) }, { 'Set-Cookie': createSessionCookie(sessionId) });
}

// POST /api/auth/login — verifica credenciales y abre sesion
async function handleLogin(request, response) {
  const ip       = getClientIp(request);
  const action   = 'login';
  const windowMs = 15 * 60 * 1000; // ventana de 15 minutos

  // maximo 10 intentos de login por IP cada 15 minutos
  const rateLimitError = checkRateLimit(ip, action, 10, windowMs);
  if (rateLimitError) {
    sendJson(response, 429, { error: rateLimitError });
    return;
  }

  const body       = await readJsonBody(request);
  const identifier = normalizeText(body.identifier).toLowerCase(); // puede ser email o nombre de usuario
  const password   = normalizeText(body.password);

  if (!identifier || !password) {
    registerRateLimitFailure(ip, action, windowMs);
    sendJson(response, 400, { error: 'Correo/usuario y contraseña son obligatorios.' });
    return;
  }

  // buscar por email primero, si no encuentra intentar por nombre de usuario
  const user = (await findUserByEmail(identifier)) || (await findUserByUsername(identifier));

  // si no existe el usuario O la contraseña es incorrecta, mismo mensaje (no dar pistas)
  if (!user || !verifyPassword(password, user.password_hash)) {
    registerRateLimitFailure(ip, action, windowMs);
    sendJson(response, 401, { error: 'Credenciales incorrectas.' });
    return;
  }

  const sessionId = await createSession(user.id);
  clearRateLimit(ip, action);
  sendJson(response, 200, { user: serializeUser(user) }, { 'Set-Cookie': createSessionCookie(sessionId) });
}

// POST /api/auth/logout — elimina la sesion activa del usuario
async function handleLogout(request, response) {
  const cookies   = parseCookies(request.headers.cookie);
  const sessionId = cookies[SESSION_COOKIE_NAME];

  if (sessionId) {
    await db.execute('DELETE FROM sessions WHERE id = ?', [sessionId]);
  }

  // manda la cookie con Max-Age=0 para que el browser la elimine
  sendJson(response, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
}

// GET /api/session — devuelve quien esta logueado (o null si no hay sesion)
// el frontend llama esto al cargar cada pagina para saber el estado de la sesion
async function handleSession(request, response) {
  const user = await getSessionUser(request);
  sendJson(response, 200, { user: serializeUser(user) });
}

// ============================================================================
// CONTROLLER — PERFIL DE USUARIO
// Endpoints: GET /api/profile, PATCH /api/profile/email,
//            PATCH /api/profile/password, PATCH /api/profile/avatar
// ============================================================================

// GET /api/profile — devuelve los datos del usuario logueado y sus reseñas
async function handleProfile(request, response) {
  const user = await getSessionUser(request);

  if (!user) {
    sendJson(response, 401, { error: 'No has iniciado sesión.' });
    return;
  }

  // traer todas las reseñas del usuario con el titulo y slug del juego
  const reviews = await queryAll(
    `SELECT
      reviews.id         AS id,
      reviews.rating     AS rating,
      reviews.comment    AS comment,
      reviews.created_at AS created_at,
      games.title        AS game_title,
      games.slug         AS game_slug
    FROM reviews
    JOIN games ON games.id = reviews.game_id
    WHERE reviews.user_id = ?
    ORDER BY reviews.created_at DESC, reviews.id DESC`,
    [user.id]
  );

  sendJson(response, 200, {
    user: serializeUser(user),
    reviews: reviews.map((review) =>
      serializeReview({
        ...review,
        username:   user.username,
        avatar_url: user.avatar_url,
      })
    ),
  });
}

// PATCH /api/profile/email — el usuario cambia su correo electronico
async function handleProfileEmailUpdate(request, response) {
  const user = await getSessionUser(request);

  if (!user) {
    sendJson(response, 401, { error: 'No has iniciado sesión.' });
    return;
  }

  const body  = await readJsonBody(request);
  const email = normalizeText(body.email).toLowerCase();

  if (!email) {
    sendJson(response, 400, { error: 'El correo no puede estar vacío.' });
    return;
  }

  // verificar que el nuevo correo no lo tenga ya otro usuario
  const existingUser = await findUserByEmail(email);
  if (existingUser && existingUser.id !== user.id) {
    sendJson(response, 409, { error: 'Ese correo ya está en uso.' });
    return;
  }

  await db.execute('UPDATE users SET email = ? WHERE id = ?', [email, user.id]);
  const updatedUser = await findUserById(user.id);
  sendJson(response, 200, { user: serializeUser(updatedUser) });
}

// PATCH /api/profile/password — el usuario cambia su contraseña
async function handleProfilePasswordUpdate(request, response) {
  const user = await getSessionUser(request);

  if (!user) {
    sendJson(response, 401, { error: 'No has iniciado sesión.' });
    return;
  }

  const body     = await readJsonBody(request);
  const password = normalizeText(body.password);

  const passwordError = validatePassword(password);
  if (passwordError) {
    sendJson(response, 400, { error: passwordError });
    return;
  }

  await db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(password), user.id]);
  sendJson(response, 200, { ok: true });
}

// PATCH /api/profile/avatar — el usuario sube una nueva foto de perfil en base64
// maximo 2 MB porque se guarda en la BD (no en disco)
async function handleProfileAvatarUpdate(request, response) {
  const user = await getSessionUser(request);

  if (!user) {
    sendJson(response, 401, { error: 'No has iniciado sesión.' });
    return;
  }

  const body   = await readJsonBody(request);
  const avatar = normalizeText(body.avatar);

  // verificar que sea una imagen (debe empezar con "data:image/...")
  if (!avatar.startsWith('data:image/')) {
    sendJson(response, 400, { error: 'Formato de imagen inválido.' });
    return;
  }

  // 2 MB maximo — imagenes muy grandes enlentecen la BD
  if (avatar.length > 1024 * 1024 * 2) {
    sendJson(response, 400, { error: 'La imagen es demasiado grande.' });
    return;
  }

  await db.execute('UPDATE users SET avatar_url = ? WHERE id = ?', [avatar, user.id]);
  const updatedUser = await findUserById(user.id);
  sendJson(response, 200, { user: serializeUser(updatedUser) });
}

// ============================================================================
// CONTROLLER — JUEGOS Y RESEÑAS
// Endpoints: GET  /api/games, GET /api/games/:slug/reviews,
//            POST /api/reviews
// ============================================================================

// GET /api/games — lista juegos con filtros opcionales: search, genre, platform, rating
// usa parametros en la URL tipo /api/games?genre=RPG&platform=PC
async function handleGames(requestUrl, response) {
  const search    = normalizeText(requestUrl.searchParams.get('search'));
  const genre     = normalizeText(requestUrl.searchParams.get('genre'));
  const platform  = normalizeText(requestUrl.searchParams.get('platform'));
  const minRating = Number(requestUrl.searchParams.get('rating')) || 0;

  // construimos el WHERE dinamicamente segun los filtros que vengan
  const where  = [];
  const having = []; // HAVING es para filtrar por columnas calculadas (como el promedio)
  const params = [];

  if (search) {
    const likeSearch = `%${search}%`;
    where.push('(games.title LIKE ? OR games.description LIKE ? OR games.genre LIKE ? OR games.platform LIKE ?)');
    params.push(likeSearch, likeSearch, likeSearch, likeSearch);
  }

  if (genre) {
    where.push('games.genre LIKE ?');
    params.push(`%${genre}%`);
  }

  if (platform) {
    where.push('games.platform LIKE ?');
    params.push(`%${platform}%`);
  }

  if (minRating) {
    having.push('average_rating >= ?');
    params.push(minRating);
  }

  const whereSql  = where.length  ? `WHERE ${where.join(' AND ')}`   : '';
  const havingSql = having.length ? `HAVING ${having.join(' AND ')}`  : '';

  const games = await queryAll(
    `SELECT
      games.id,
      games.slug,
      games.title,
      games.description,
      games.genre,
      games.platform,
      games.image_url,
      COALESCE(ROUND(AVG(reviews.rating), 1), 0) AS average_rating,
      COUNT(reviews.id)                           AS review_count
    FROM games
    LEFT JOIN reviews ON reviews.game_id = games.id
    ${whereSql}
    GROUP BY games.id
    ${havingSql}
    ORDER BY games.title ASC
    LIMIT 100`,
    params
  );

  sendJson(response, 200, { games: games.map(serializeGame) });
}

// GET /api/games/:slug/reviews — devuelve el detalle de un juego y todas sus reseñas
async function handleGameReviews(response, slug) {
  const game = await queryOne(
    `SELECT
      games.id,
      games.slug,
      games.title,
      games.description,
      games.genre,
      games.platform,
      games.image_url,
      COALESCE(ROUND(AVG(reviews.rating), 1), 0) AS average_rating,
      COUNT(reviews.id)                           AS review_count
    FROM games
    LEFT JOIN reviews ON reviews.game_id = games.id
    WHERE games.slug = ?
    GROUP BY games.id`,
    [slug]
  );

  if (!game) {
    sendJson(response, 404, { error: 'Juego no encontrado.' });
    return;
  }

  const reviews = await queryAll(
    `SELECT
      reviews.id         AS id,
      reviews.user_id    AS user_id,
      reviews.rating     AS rating,
      reviews.comment    AS comment,
      reviews.created_at AS created_at,
      users.username     AS username,
      users.avatar_url   AS avatar_url,
      games.title        AS game_title,
      games.slug         AS game_slug
    FROM reviews
    JOIN users ON users.id = reviews.user_id
    JOIN games ON games.id = reviews.game_id
    WHERE games.slug = ?
    ORDER BY reviews.created_at DESC, reviews.id DESC`,
    [slug]
  );

  sendJson(response, 200, {
    game:    serializeGame(game),
    reviews: reviews.map(serializeReview),
  });
}

// POST /api/reviews — crea o actualiza la reseña del usuario para un juego
// un usuario solo puede tener una reseña por juego — si ya tiene una se actualiza
async function handleCreateReview(request, response) {
  const user = await getSessionUser(request);

  if (!user) {
    sendJson(response, 401, { error: 'Debes iniciar sesión para comentar.' });
    return;
  }

  const body     = await readJsonBody(request);
  const gameSlug = normalizeText(body.gameSlug);
  const comment  = normalizeText(body.comment);
  const rating   = Number(body.rating);

  if (!gameSlug || !comment || !Number.isInteger(rating)) {
    sendJson(response, 400, { error: 'Datos de reseña inválidos.' });
    return;
  }

  if (comment.length > 1000) {
    sendJson(response, 400, { error: 'El comentario no puede superar los 1000 caracteres.' });
    return;
  }

  if (rating < 1 || rating > 5) {
    sendJson(response, 400, { error: 'La puntuación debe estar entre 1 y 5.' });
    return;
  }

  const game = await findGameBySlug(gameSlug);

  if (!game) {
    sendJson(response, 404, { error: 'Juego no encontrado.' });
    return;
  }

  const now = nowMysql();

  // buscar si el usuario ya tiene una reseña para este juego (upsert manual)
  const existing = await queryOne(
    'SELECT id FROM reviews WHERE user_id = ? AND game_id = ?',
    [user.id, game.id]
  );

  let reviewId;
  if (existing) {
    // ya existe → actualizar la existente
    await db.execute(
      'UPDATE reviews SET rating = ?, comment = ?, updated_at = ? WHERE id = ?',
      [rating, comment, now, existing.id]
    );
    reviewId = existing.id;
  } else {
    // no existe → crear nueva
    const [result] = await db.execute(
      `INSERT INTO reviews (user_id, game_id, rating, comment, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user.id, game.id, rating, comment, now, now]
    );
    reviewId = Number(result.insertId);
  }

  // traer la reseña completa con datos del usuario y del juego para devolvérsela al frontend
  const savedReview = await queryOne(
    `SELECT
      reviews.id         AS id,
      reviews.user_id    AS user_id,
      reviews.rating     AS rating,
      reviews.comment    AS comment,
      reviews.created_at AS created_at,
      users.username     AS username,
      users.avatar_url   AS avatar_url,
      games.title        AS game_title,
      games.slug         AS game_slug
    FROM reviews
    JOIN users ON users.id = reviews.user_id
    JOIN games ON games.id = reviews.game_id
    WHERE reviews.id = ?`,
    [reviewId]
  );

  // 200 si actualizo una existente, 201 si creo una nueva
  const status = existing ? 200 : 201;
  sendJson(response, status, { review: serializeReview(savedReview) });
}

// ============================================================================
// CONTROLLER — PANEL DE ADMINISTRACIÓN
// Endpoints protegidos — requieren is_admin = 1 en la sesión activa.
// Juegos:   GET/POST /api/admin/games, PUT/DELETE /api/admin/games/:id
// Noticias: GET/POST /api/admin/news,  PUT/DELETE /api/admin/news/:id
// ============================================================================

// convierte un titulo en slug para la URL: "Hollow Knight" → "hollow-knight"
function generateSlug(text) {
  return text
    .toLowerCase()
    .normalize('NFD')                    // descompone caracteres acentuados
    .replace(/[̀-ͯ]/g, '')            // elimina los acentos despues de descomponer
    .replace(/[^a-z0-9]+/g, '-')        // reemplaza cualquier caracter raro con guion
    .replace(/^-|-$/g, '')              // quita guiones al principio y al final
    .substring(0, 190);                 // limita la longitud del slug
}

// middleware de admin — verifica que el usuario logueado sea administrador
// si no lo es devuelve 401 o 403 y regresa null para cortar la ejecucion
async function requireAdmin(request, response) {
  const user = await getSessionUser(request);
  if (!user) {
    sendJson(response, 401, { error: 'Debes iniciar sesión.' });
    return null;
  }
  if (!user.is_admin) {
    sendJson(response, 403, { error: 'Acceso restringido a administradores.' });
    return null;
  }
  return user;
}

// GET /api/admin/games — lista todos los juegos con conteo de reseñas
async function handleAdminGetGames(request, response) {
  if (!await requireAdmin(request, response)) return;
  const games = await queryAll(
    `SELECT id, slug, title, genre, platform, image_url,
            (SELECT COUNT(*) FROM reviews WHERE reviews.game_id = games.id) AS review_count
     FROM games ORDER BY id DESC`
  );
  sendJson(response, 200, { games });
}

// POST /api/admin/games — crea un juego nuevo
async function handleAdminCreateGame(request, response) {
  if (!await requireAdmin(request, response)) return;
  const body        = await readJsonBody(request);
  const title       = normalizeText(body.title);
  const description = normalizeText(body.description);
  const genre       = normalizeText(body.genre);
  const platform    = normalizeText(body.platform);
  const imageUrl    = body.imageUrl || null;
  const slug        = normalizeText(body.slug) || generateSlug(title);

  if (!title || !description || !genre || !platform) {
    sendJson(response, 400, { error: 'Faltan campos obligatorios (título, descripción, género, plataforma).' });
    return;
  }
  if (imageUrl && !imageUrl.startsWith('data:image/')) {
    sendJson(response, 400, { error: 'Formato de imagen inválido.' });
    return;
  }
  if (imageUrl && imageUrl.length > 1024 * 1024 * 3) {
    sendJson(response, 400, { error: 'La imagen no puede superar 3 MB.' });
    return;
  }

  const [result] = await db.execute(
    'INSERT INTO games (slug, title, description, genre, platform, image_url) VALUES (?, ?, ?, ?, ?, ?)',
    [slug, title, description, genre, platform, imageUrl]
  );
  const game = await queryOne('SELECT * FROM games WHERE id = ?', [result.insertId]);
  sendJson(response, 201, { game });
}

// PUT /api/admin/games/:id — edita un juego existente
async function handleAdminUpdateGame(request, response, id) {
  if (!await requireAdmin(request, response)) return;
  const body        = await readJsonBody(request);
  const title       = normalizeText(body.title);
  const description = normalizeText(body.description);
  const genre       = normalizeText(body.genre);
  const platform    = normalizeText(body.platform);
  const imageUrl    = body.imageUrl !== undefined ? body.imageUrl : undefined;

  if (!title || !description || !genre || !platform) {
    sendJson(response, 400, { error: 'Faltan campos obligatorios.' });
    return;
  }
  if (imageUrl && !imageUrl.startsWith('data:image/') && imageUrl !== '') {
    sendJson(response, 400, { error: 'Formato de imagen inválido.' });
    return;
  }

  const existing = await queryOne('SELECT id FROM games WHERE id = ?', [Number(id)]);
  if (!existing) { sendJson(response, 404, { error: 'Juego no encontrado.' }); return; }

  // si imageUrl vino en el body (aunque sea string vacio) se actualiza, si no vino se conserva la anterior
  if (imageUrl !== undefined) {
    await db.execute(
      'UPDATE games SET title = ?, description = ?, genre = ?, platform = ?, image_url = ? WHERE id = ?',
      [title, description, genre, platform, imageUrl || null, Number(id)]
    );
  } else {
    await db.execute(
      'UPDATE games SET title = ?, description = ?, genre = ?, platform = ? WHERE id = ?',
      [title, description, genre, platform, Number(id)]
    );
  }
  const game = await queryOne('SELECT * FROM games WHERE id = ?', [Number(id)]);
  sendJson(response, 200, { game });
}

// DELETE /api/admin/games/:id — elimina un juego (y en cascada todas sus reseñas)
async function handleAdminDeleteGame(request, response, id) {
  if (!await requireAdmin(request, response)) return;
  const existing = await queryOne('SELECT id FROM games WHERE id = ?', [Number(id)]);
  if (!existing) { sendJson(response, 404, { error: 'Juego no encontrado.' }); return; }
  await db.execute('DELETE FROM games WHERE id = ?', [Number(id)]);
  sendJson(response, 200, { ok: true });
}

// GET /api/admin/news — lista todas las noticias
async function handleAdminGetNews(request, response) {
  if (!await requireAdmin(request, response)) return;
  const articles = await queryAll(
    'SELECT id, slug, title, category, excerpt, image_url, published_at FROM news ORDER BY id DESC'
  );
  sendJson(response, 200, { news: articles });
}

// POST /api/admin/news — crea una noticia nueva
async function handleAdminCreateNews(request, response) {
  if (!await requireAdmin(request, response)) return;
  const body     = await readJsonBody(request);
  const title    = normalizeText(body.title);
  const excerpt  = normalizeText(body.excerpt);
  const content  = normalizeText(body.content);
  const category = normalizeText(body.category);
  const imageUrl = body.imageUrl || null;
  const slug     = normalizeText(body.slug) || generateSlug(title);

  if (!title || !excerpt || !content || !category) {
    sendJson(response, 400, { error: 'Faltan campos obligatorios (título, resumen, contenido, categoría).' });
    return;
  }
  if (imageUrl && !imageUrl.startsWith('data:image/')) {
    sendJson(response, 400, { error: 'Formato de imagen inválido.' });
    return;
  }

  const [result] = await db.execute(
    'INSERT INTO news (slug, title, excerpt, content, image_url, category, published_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
    [slug, title, excerpt, content, imageUrl, category]
  );
  const article = await queryOne('SELECT * FROM news WHERE id = ?', [result.insertId]);
  sendJson(response, 201, { article });
}

// PUT /api/admin/news/:id — edita una noticia existente
async function handleAdminUpdateNews(request, response, id) {
  if (!await requireAdmin(request, response)) return;
  const body     = await readJsonBody(request);
  const title    = normalizeText(body.title);
  const excerpt  = normalizeText(body.excerpt);
  const content  = normalizeText(body.content);
  const category = normalizeText(body.category);
  const imageUrl = body.imageUrl !== undefined ? body.imageUrl : undefined;

  if (!title || !excerpt || !content || !category) {
    sendJson(response, 400, { error: 'Faltan campos obligatorios.' });
    return;
  }

  const existing = await queryOne('SELECT id FROM news WHERE id = ?', [Number(id)]);
  if (!existing) { sendJson(response, 404, { error: 'Noticia no encontrada.' }); return; }

  if (imageUrl !== undefined) {
    await db.execute(
      'UPDATE news SET title = ?, excerpt = ?, content = ?, category = ?, image_url = ? WHERE id = ?',
      [title, excerpt, content, category, imageUrl || null, Number(id)]
    );
  } else {
    await db.execute(
      'UPDATE news SET title = ?, excerpt = ?, content = ?, category = ? WHERE id = ?',
      [title, excerpt, content, category, Number(id)]
    );
  }
  const article = await queryOne('SELECT * FROM news WHERE id = ?', [Number(id)]);
  sendJson(response, 200, { article });
}

// DELETE /api/admin/news/:id — elimina una noticia
async function handleAdminDeleteNews(request, response, id) {
  if (!await requireAdmin(request, response)) return;
  const existing = await queryOne('SELECT id FROM news WHERE id = ?', [Number(id)]);
  if (!existing) { sendJson(response, 404, { error: 'Noticia no encontrada.' }); return; }
  await db.execute('DELETE FROM news WHERE id = ?', [Number(id)]);
  sendJson(response, 200, { ok: true });
}

// ============================================================================
// CONTROLLER — HOME Y NOTICIAS
// Endpoints: GET /api/home, GET /api/news, GET /api/news/:slug
// ============================================================================

// GET /api/home — datos para la portada: los 4 juegos mas reseñados, 3 reseñas recientes y 3 noticias
async function handleHome(response) {
  // juegos ordenados por cantidad de reseñas (los mas populares primero)
  const games = await queryAll(
    `SELECT
      games.id, games.slug, games.title, games.description,
      games.genre, games.platform, games.image_url,
      COALESCE(ROUND(AVG(reviews.rating), 1), 0) AS average_rating,
      COUNT(reviews.id)                           AS review_count
    FROM games
    LEFT JOIN reviews ON reviews.game_id = games.id
    GROUP BY games.id
    ORDER BY review_count DESC, games.id ASC
    LIMIT 4`,
    []
  );

  const reviews = await queryAll(
    `SELECT
      reviews.id         AS id,
      reviews.rating     AS rating,
      reviews.comment    AS comment,
      reviews.created_at AS created_at,
      users.username     AS username,
      users.avatar_url   AS avatar_url,
      games.title        AS game_title,
      games.slug         AS game_slug
    FROM reviews
    JOIN users ON users.id = reviews.user_id
    JOIN games ON games.id = reviews.game_id
    ORDER BY reviews.created_at DESC, reviews.id DESC
    LIMIT 3`,
    []
  );

  const news = await queryAll(
    `SELECT id, slug, title, excerpt, image_url, category, published_at
     FROM news
     ORDER BY published_at DESC
     LIMIT 3`,
    []
  );

  sendJson(response, 200, {
    games:   games.map(serializeGame),
    reviews: reviews.map(serializeReview),
    news:    news.map(serializeNews),
  });
}

// GET /api/news — lista noticias con filtros opcionales de busqueda y categoria
async function handleNewsList(requestUrl, response) {
  const search   = normalizeText(requestUrl.searchParams.get('search'));
  const category = normalizeText(requestUrl.searchParams.get('category'));
  const where    = [];
  const params   = [];

  if (search) {
    const likeSearch = `%${search}%`;
    where.push('(title LIKE ? OR excerpt LIKE ?)');
    params.push(likeSearch, likeSearch);
  }

  if (category) {
    where.push('category = ?');
    params.push(category);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const articles = await queryAll(
    `SELECT id, slug, title, excerpt, image_url, category, published_at
     FROM news ${whereSql}
     ORDER BY published_at DESC
     LIMIT 50`,
    params
  );

  sendJson(response, 200, { news: articles.map(serializeNews) });
}

// GET /api/news/:slug — devuelve el contenido completo de una noticia
async function handleNewsDetail(response, slug) {
  const article = await queryOne('SELECT * FROM news WHERE slug = ?', [slug]);

  if (!article) {
    sendJson(response, 404, { error: 'Noticia no encontrada.' });
    return;
  }

  sendJson(response, 200, { article: serializeNews(article) });
}

// ============================================================================
// CONTROLLER — RECUPERACIÓN DE CONTRASEÑA
// Endpoints: POST /api/auth/forgot-password, POST /api/auth/reset-password
// ============================================================================

// POST /api/auth/forgot-password — recibe un email, genera un token y manda el correo
// si el email no existe responde igual (no queremos confirmar si alguien esta registrado o no)
async function handleForgotPassword(request, response) {
  const body  = await readJsonBody(request);
  const email = normalizeText(body.email).toLowerCase();

  if (!email) {
    sendJson(response, 400, { error: 'Falta el correo.' });
    return;
  }

  // buscamos el usuario con ese email
  const [rows] = await db.query('SELECT id, username FROM users WHERE email = ?', [email]);

  // aunque no exista respondemos ok — no queremos que alguien pueda saber si un email esta registrado
  if (rows.length === 0) {
    sendJson(response, 200, { ok: true });
    return;
  }

  const user = rows[0];

  // borramos tokens viejos del mismo usuario que no se hayan usado
  await db.query('DELETE FROM reset_tokens WHERE user_id = ?', [user.id]);

  // generamos un token aleatorio de 48 bytes (96 caracteres en hex)
  const token      = crypto.randomBytes(48).toString('hex');
  const expiresStr = new Date(Date.now() + RESET_TOKEN_TTL_MS)
    .toISOString().slice(0, 19).replace('T', ' ');

  // guardamos el token con la fecha de expiracion
  await db.query(
    'INSERT INTO reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
    [user.id, token, expiresStr]
  );

  // construimos el enlace que va en el correo
  const resetUrl = `${SITE_URL}/reset-password.html?token=${token}`;

  // enviamos el correo
  try {
    await mailTransporter.sendMail({
      from:    `"The Critic" <${process.env.MAIL_USER}>`,
      to:      email,
      subject: 'Recupera tu contraseña — The Critic',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;background:#111;color:#fff;padding:32px;border-radius:16px;">
          <h1 style="font-size:24px;margin-bottom:8px;">THE CRITIC</h1>
          <p style="color:#b3b3b3;">Hola ${user.username},</p>
          <p style="color:#b3b3b3;">Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
          <a href="${resetUrl}"
             style="display:inline-block;margin:24px 0;padding:12px 28px;background:#fff;color:#000;border-radius:999px;text-decoration:none;font-weight:700;">
            Restablecer contraseña
          </a>
          <p style="color:#b3b3b3;font-size:13px;">Este enlace expira en 1 hora.</p>
          <p style="color:#b3b3b3;font-size:13px;">Si no solicitaste esto, ignora este correo.</p>
        </div>
      `,
    });
  } catch (mailError) {
    // si falla el envio del correo lo registramos pero no lo mostramos al usuario
    console.error('Error al enviar correo de recuperacion:', mailError.message);
    sendJson(response, 500, { error: 'No se pudo enviar el correo. Intenta más tarde.' });
    return;
  }

  sendJson(response, 200, { ok: true });
}

// POST /api/auth/reset-password — valida el token y actualiza la contraseña
async function handleResetPassword(request, response) {
  const body     = await readJsonBody(request);
  const token    = normalizeText(body.token);
  const password = normalizeText(body.password);

  if (!token || !password) {
    sendJson(response, 400, { error: 'Faltan datos.' });
    return;
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    sendJson(response, 400, { error: passwordError });
    return;
  }

  // buscamos el token y comprobamos que no haya expirado
  const [rows] = await db.query(
    'SELECT user_id FROM reset_tokens WHERE token = ? AND expires_at > NOW()',
    [token]
  );

  if (rows.length === 0) {
    sendJson(response, 400, { error: 'El enlace no es válido o ya expiró.' });
    return;
  }

  const userId = rows[0].user_id;

  // hasheamos la nueva contraseña igual que en el registro
  const salt         = crypto.randomBytes(16).toString('hex');
  const derivedKey   = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve(key));
  });
  const passwordHash = `${salt}:${derivedKey.toString('hex')}`;

  // actualizamos la contraseña del usuario
  await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);

  // borramos el token — ya no sirve
  await db.query('DELETE FROM reset_tokens WHERE user_id = ?', [userId]);

  sendJson(response, 200, { ok: true });
}

// ============================================================================
// ROUTER — ENRUTADOR PRINCIPAL
// Lee la URL y el método HTTP de cada petición entrante y delega al
// Controller correspondiente. Si la ruta no es /api/* sirve archivos estáticos.
// ============================================================================

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl  = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const { pathname } = requestUrl;

    // cabeceras de seguridad que se aplican a TODAS las respuestas
    response.setHeader('X-Content-Type-Options', 'nosniff');      // evita que el browser "adivine" el tipo de archivo
    response.setHeader('X-Frame-Options', 'DENY');                 // evita que el sitio se cargue en un iframe (clickjacking)
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()'); // no pedimos permisos de hardware
    response.setHeader(
      'Content-Security-Policy',
      // solo se permite cargar recursos del mismo dominio, fuentes de google y datos en base64
      "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'"
    );

    // ---- rutas de la API -------------------------------------------------------

    if (pathname === '/api/session' && request.method === 'GET') {
      await handleSession(request, response); return;
    }
    if (pathname === '/api/auth/register' && request.method === 'POST') {
      await handleRegister(request, response); return;
    }
    if (pathname === '/api/auth/login' && request.method === 'POST') {
      await handleLogin(request, response); return;
    }
    if (pathname === '/api/auth/forgot-password' && request.method === 'POST') {
      await handleForgotPassword(request, response); return;
    }
    if (pathname === '/api/auth/reset-password' && request.method === 'POST') {
      await handleResetPassword(request, response); return;
    }
    if (pathname === '/api/auth/logout' && request.method === 'POST') {
      await handleLogout(request, response); return;
    }
    if (pathname === '/api/profile' && request.method === 'GET') {
      await handleProfile(request, response); return;
    }
    if (pathname === '/api/profile/email' && request.method === 'PATCH') {
      await handleProfileEmailUpdate(request, response); return;
    }
    if (pathname === '/api/profile/password' && request.method === 'PATCH') {
      await handleProfilePasswordUpdate(request, response); return;
    }
    if (pathname === '/api/profile/avatar' && request.method === 'PATCH') {
      await handleProfileAvatarUpdate(request, response); return;
    }
    if (pathname === '/api/games' && request.method === 'GET') {
      await handleGames(requestUrl, response); return;
    }
    if (pathname.startsWith('/api/games/') && pathname.endsWith('/reviews') && request.method === 'GET') {
      const slug = pathname.replace('/api/games/', '').replace('/reviews', '').replace(/\/+/g, '');
      await handleGameReviews(response, slug); return;
    }
    if (pathname === '/api/reviews' && request.method === 'POST') {
      await handleCreateReview(request, response); return;
    }
    if (pathname === '/api/home' && request.method === 'GET') {
      await handleHome(response); return;
    }
    if (pathname === '/api/news' && request.method === 'GET') {
      await handleNewsList(requestUrl, response); return;
    }
    if (pathname.startsWith('/api/news/') && request.method === 'GET') {
      const slug = pathname.replace('/api/news/', '').replace(/\/+/g, '');
      await handleNewsDetail(response, slug); return;
    }

    // ---- rutas del panel de admin -----------------------------------------------
    if (pathname === '/api/admin/games' && request.method === 'GET') {
      await handleAdminGetGames(request, response); return;
    }
    if (pathname === '/api/admin/games' && request.method === 'POST') {
      await handleAdminCreateGame(request, response); return;
    }
    if (pathname.startsWith('/api/admin/games/') && request.method === 'PUT') {
      const id = pathname.replace('/api/admin/games/', '');
      await handleAdminUpdateGame(request, response, id); return;
    }
    if (pathname.startsWith('/api/admin/games/') && request.method === 'DELETE') {
      const id = pathname.replace('/api/admin/games/', '');
      await handleAdminDeleteGame(request, response, id); return;
    }
    if (pathname === '/api/admin/news' && request.method === 'GET') {
      await handleAdminGetNews(request, response); return;
    }
    if (pathname === '/api/admin/news' && request.method === 'POST') {
      await handleAdminCreateNews(request, response); return;
    }
    if (pathname.startsWith('/api/admin/news/') && request.method === 'PUT') {
      const id = pathname.replace('/api/admin/news/', '');
      await handleAdminUpdateNews(request, response, id); return;
    }
    if (pathname.startsWith('/api/admin/news/') && request.method === 'DELETE') {
      const id = pathname.replace('/api/admin/news/', '');
      await handleAdminDeleteNews(request, response, id); return;
    }

    // si empieza con /api/ pero no coincidio con nada → 404
    if (pathname.startsWith('/api/')) {
      sendJson(response, 404, { error: 'Endpoint no encontrado.' });
      return;
    }

    // todo lo demas → archivo estatico (html, css, js, imagenes)
    serveStaticFile(request, response, pathname);

  } catch (error) {
    // cualquier error no controlado llega aqui
    sendJson(response, 500, {
      error:  'Ocurrió un error interno en el servidor.',
      detail: error.message,
    });
  }
});

// arranca todo: primero la BD, luego el servidor
initDatabase()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`The Critic corriendo en http://localhost:${PORT}`);
      console.log(`Base de datos MariaDB: ${dbConfig.database} en ${dbConfig.host}:${dbConfig.port}`);
    });
  })
  .catch((error) => {
    // si no se puede conectar a la BD no tiene sentido arrancar el servidor
    console.error('No se pudo conectar a MariaDB.');
    console.error(error.message);
    process.exit(1);
  });
