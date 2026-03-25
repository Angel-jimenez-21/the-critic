const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DB_PATH = path.join(DATA_DIR, 'the-critic.db');
const PORT = Number(process.env.PORT) || 3000;
const SESSION_COOKIE_NAME = 'the_critic_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const DEFAULT_AVATAR = 'assets/img/cta.png';

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    avatar_url TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    genre TEXT NOT NULL,
    platform TEXT NOT NULL,
    image_url TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    excerpt TEXT NOT NULL,
    content TEXT NOT NULL,
    image_url TEXT,
    category TEXT NOT NULL,
    published_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    game_id INTEGER NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
  );
`);

const statements = {
  countUsers: db.prepare('SELECT COUNT(*) AS total FROM users'),
  countGames: db.prepare('SELECT COUNT(*) AS total FROM games'),
  countNews: db.prepare('SELECT COUNT(*) AS total FROM news'),
  countReviews: db.prepare('SELECT COUNT(*) AS total FROM reviews'),
  insertUser: db.prepare(`
    INSERT INTO users (username, email, password_hash, avatar_url)
    VALUES (?, ?, ?, ?)
  `),
  insertGame: db.prepare(`
    INSERT INTO games (slug, title, description, genre, platform, image_url)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  insertNews: db.prepare(`
    INSERT INTO news (slug, title, excerpt, content, image_url, category, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  insertReview: db.prepare(`
    INSERT INTO reviews (user_id, game_id, rating, comment, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  findUserByEmail: db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)'),
  findUserByUsername: db.prepare('SELECT * FROM users WHERE lower(username) = lower(?)'),
  findUserById: db.prepare('SELECT id, username, email, avatar_url, created_at FROM users WHERE id = ?'),
  findGameBySlug: db.prepare('SELECT * FROM games WHERE slug = ?'),
  insertSession: db.prepare(`
    INSERT INTO sessions (id, user_id, expires_at)
    VALUES (?, ?, ?)
  `),
  findSessionUser: db.prepare(`
    SELECT
      sessions.id AS session_id,
      sessions.expires_at AS expires_at,
      users.id AS id,
      users.username AS username,
      users.email AS email,
      users.avatar_url AS avatar_url,
      users.created_at AS created_at
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.id = ?
  `),
  deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
  deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  updateUserEmail: db.prepare('UPDATE users SET email = ? WHERE id = ?'),
  updateUserPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
  updateUserAvatar: db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?'),
  listReviewsByGameSlug: db.prepare(`
    SELECT
      reviews.id AS id,
      reviews.rating AS rating,
      reviews.comment AS comment,
      reviews.created_at AS created_at,
      users.username AS username,
      users.avatar_url AS avatar_url,
      games.title AS game_title,
      games.slug AS game_slug
    FROM reviews
    JOIN users ON users.id = reviews.user_id
    JOIN games ON games.id = reviews.game_id
    WHERE games.slug = ?
    ORDER BY datetime(reviews.created_at) DESC, reviews.id DESC
  `),
  listReviewsByUserId: db.prepare(`
    SELECT
      reviews.id AS id,
      reviews.rating AS rating,
      reviews.comment AS comment,
      reviews.created_at AS created_at,
      games.title AS game_title,
      games.slug AS game_slug
    FROM reviews
    JOIN games ON games.id = reviews.game_id
    WHERE reviews.user_id = ?
    ORDER BY datetime(reviews.created_at) DESC, reviews.id DESC
  `),
};

function nowIso() {
  return new Date().toISOString();
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function dateLabel(dateInput) {
  const value = new Date(dateInput);
  const day = String(value.getDate()).padStart(2, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const year = value.getFullYear();
  return `${day}.${month}.${year}`;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = String(storedHash || '').split(':');

  if (!salt || !hash) {
    return false;
  }

  const derivedHash = crypto.scryptSync(password, salt, 64);
  const originalHash = Buffer.from(hash, 'hex');

  if (derivedHash.length !== originalHash.length) {
    return false;
  }

  return crypto.timingSafeEqual(derivedHash, originalHash);
}

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

      const key = part.slice(0, separator).trim();
      const value = decodeURIComponent(part.slice(separator + 1).trim());
      cookies[key] = value;
      return cookies;
    }, {});
}

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
  });
  response.end(text);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let rawBody = '';

    request.on('data', (chunk) => {
      rawBody += chunk.toString();

      if (rawBody.length > 1024 * 1024) {
        reject(new Error('Payload demasiado grande.'));
        request.destroy();
      }
    });

    request.on('end', () => {
      if (!rawBody) {
        resolve({});
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

function serializeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    name: user.username,
    email: user.email,
    avatar: user.avatar_url || DEFAULT_AVATAR,
    createdAt: user.created_at,
  };
}

function serializeReview(review) {
  return {
    id: review.id,
    userName: review.username,
    gameName: review.game_title,
    gameSlug: review.game_slug,
    comment: review.comment,
    rating: review.rating,
    avatar: review.avatar_url || DEFAULT_AVATAR,
    createdAt: review.created_at,
    date: dateLabel(review.created_at),
  };
}

function serializeProfileReview(review, user) {
  return {
    id: review.id,
    userName: user.username,
    gameName: review.game_title,
    gameSlug: review.game_slug,
    comment: review.comment,
    rating: review.rating,
    avatar: user.avatar_url || DEFAULT_AVATAR,
    createdAt: review.created_at,
    date: dateLabel(review.created_at),
  };
}

function createSessionCookie(sessionId) {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(
    SESSION_TTL_MS / 1000
  )}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

function cleanupExpiredSessions() {
  statements.deleteExpiredSessions.run(nowIso());
}

function getSessionUser(request) {
  cleanupExpiredSessions();
  const cookies = parseCookies(request.headers.cookie);
  const sessionId = cookies[SESSION_COOKIE_NAME];

  if (!sessionId) {
    return null;
  }

  const user = statements.findSessionUser.get(sessionId);

  if (!user) {
    return null;
  }

  if (new Date(user.expires_at).getTime() <= Date.now()) {
    statements.deleteSession.run(sessionId);
    return null;
  }

  return user;
}

function createSession(userId) {
  const sessionId = crypto.randomBytes(24).toString('hex');
  const expiresAt = addDays(new Date(), 7).toISOString();
  statements.insertSession.run(sessionId, userId, expiresAt);
  return sessionId;
}

function seedDatabase() {
  if (!statements.countGames.get().total) {
    const games = [
      {
        slug: 'minecraft-java-edition',
        title: 'MINECRAFT: Java Edition',
        description:
          'Minecraft es una experiencia sandbox centrada en creatividad, supervivencia y exploración. Su libertad de juego y comunidad lo mantienen vigente.',
        genre: 'Sandbox, Survival',
        platform: 'PC',
        imageUrl: 'assets/img/minecraft.png',
      },
      {
        slug: 'terraria',
        title: 'Terraria',
        description: 'Un sandbox 2D con gran profundidad de combate, construcción y progresión.',
        genre: 'Sandbox, Aventura',
        platform: 'PC',
        imageUrl: 'assets/img/minecraft.png',
      },
    ];

    games.forEach((game) => {
      statements.insertGame.run(
        game.slug,
        game.title,
        game.description,
        game.genre,
        game.platform,
        game.imageUrl
      );
    });
  }

  if (!statements.countNews.get().total) {
    const articles = [
      {
        slug: 'gta-vi-espera-mundial',
        title: 'Tercera guerra mundial antes de GTA VI',
        excerpt: 'La comunidad sigue esperando novedades mientras los rumores no se detienen.',
        content:
          'Artículo demo para el proyecto escolar. Aquí se podrá cargar contenido real desde la base de datos en una siguiente fase.',
        imageUrl: 'assets/img/hero.png',
        category: 'Noticias en General',
        publishedAt: '2026-02-02T10:00:00.000Z',
      },
    ];

    articles.forEach((article) => {
      statements.insertNews.run(
        article.slug,
        article.title,
        article.excerpt,
        article.content,
        article.imageUrl,
        article.category,
        article.publishedAt
      );
    });
  }

  if (!statements.countUsers.get().total) {
    const users = [
      { username: 'Joe Pino', email: 'joe@thecritic.test', password: 'demo1234' },
      { username: 'Ana Ramirez', email: 'ana@thecritic.test', password: 'demo1234' },
      { username: 'Luis Torres', email: 'luis@thecritic.test', password: 'demo1234' },
    ];

    users.forEach((user) => {
      statements.insertUser.run(user.username, user.email, hashPassword(user.password), DEFAULT_AVATAR);
    });
  }

  if (!statements.countReviews.get().total) {
    const minecraft = statements.findGameBySlug.get('minecraft-java-edition');
    const joe = statements.findUserByEmail.get('joe@thecritic.test');
    const ana = statements.findUserByEmail.get('ana@thecritic.test');
    const luis = statements.findUserByEmail.get('luis@thecritic.test');
    const baseReviews = [
      {
        userId: joe.id,
        rating: 5,
        comment:
          'Minecraft sigue siendo uno de los juegos más completos para jugar solo o con amigos. Siempre hay algo nuevo que construir o explorar.',
        createdAt: '2026-03-24T09:00:00.000Z',
      },
      {
        userId: ana.id,
        rating: 4,
        comment:
          'La libertad que da el juego es increíble. Me gustaría una interfaz más amigable para nuevos jugadores, pero su creatividad no tiene límite.',
        createdAt: '2026-03-22T18:30:00.000Z',
      },
      {
        userId: luis.id,
        rating: 5,
        comment:
          'Entre mods, servidores y supervivencia, Minecraft tiene una vida útil enorme. Muy fácil entender por qué sigue siendo tan popular.',
        createdAt: '2026-03-21T14:10:00.000Z',
      },
    ];

    baseReviews.forEach((review) => {
      statements.insertReview.run(
        review.userId,
        minecraft.id,
        review.rating,
        review.comment,
        review.createdAt,
        review.createdAt
      );
    });
  }
}

seedDatabase();

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function safePathname(pathname) {
  const relativePath = String(pathname || '').replace(/^\/+/, '');
  const normalized = path.normalize(path.join(ROOT_DIR, relativePath || 'index.html'));
  if (!normalized.startsWith(ROOT_DIR)) {
    return null;
  }
  return normalized;
}

function serveStaticFile(request, response, pathname) {
  let requestedPath = pathname === '/' ? 'index.html' : pathname;
  const absolutePath = safePathname(requestedPath);

  if (!absolutePath || !fs.existsSync(absolutePath) || fs.statSync(absolutePath).isDirectory()) {
    sendText(response, 404, 'Archivo no encontrado');
    return;
  }

  const extension = path.extname(absolutePath).toLowerCase();
  const mimeType = mimeTypes[extension] || 'application/octet-stream';

  response.writeHead(200, {
    'Content-Type': mimeType,
  });

  fs.createReadStream(absolutePath).pipe(response);
}

async function handleRegister(request, response) {
  const body = await readJsonBody(request);
  const username = normalizeText(body.username);
  const email = normalizeText(body.email).toLowerCase();
  const password = normalizeText(body.password);
  const confirmPassword = normalizeText(body.confirmPassword);

  if (!username || !email || !password || !confirmPassword) {
    sendJson(response, 400, { error: 'Completa todos los campos.' });
    return;
  }

  if (password !== confirmPassword) {
    sendJson(response, 400, { error: 'Las contraseñas no coinciden.' });
    return;
  }

  if (statements.findUserByEmail.get(email)) {
    sendJson(response, 409, { error: 'Ese correo ya está registrado.' });
    return;
  }

  if (statements.findUserByUsername.get(username)) {
    sendJson(response, 409, { error: 'Ese nombre de usuario ya está en uso.' });
    return;
  }

  const result = statements.insertUser.run(username, email, hashPassword(password), DEFAULT_AVATAR);
  const user = statements.findUserById.get(Number(result.lastInsertRowid));
  const sessionId = createSession(user.id);

  sendJson(
    response,
    201,
    { user: serializeUser(user) },
    {
      'Set-Cookie': createSessionCookie(sessionId),
    }
  );
}

async function handleLogin(request, response) {
  const body = await readJsonBody(request);
  const identifier = normalizeText(body.identifier).toLowerCase();
  const password = normalizeText(body.password);

  if (!identifier || !password) {
    sendJson(response, 400, { error: 'Correo/usuario y contraseña son obligatorios.' });
    return;
  }

  const user =
    statements.findUserByEmail.get(identifier) ||
    statements.findUserByUsername.get(identifier);

  if (!user || !verifyPassword(password, user.password_hash)) {
    sendJson(response, 401, { error: 'Credenciales incorrectas.' });
    return;
  }

  const sessionId = createSession(user.id);

  sendJson(
    response,
    200,
    { user: serializeUser(user) },
    {
      'Set-Cookie': createSessionCookie(sessionId),
    }
  );
}

function handleLogout(request, response) {
  const cookies = parseCookies(request.headers.cookie);
  const sessionId = cookies[SESSION_COOKIE_NAME];

  if (sessionId) {
    statements.deleteSession.run(sessionId);
  }

  sendJson(
    response,
    200,
    { ok: true },
    {
      'Set-Cookie': clearSessionCookie(),
    }
  );
}

function handleSession(request, response) {
  const user = getSessionUser(request);
  sendJson(response, 200, { user: serializeUser(user) });
}

function handleProfile(request, response) {
  const user = getSessionUser(request);

  if (!user) {
    sendJson(response, 401, { error: 'No has iniciado sesión.' });
    return;
  }

  const reviews = statements
    .listReviewsByUserId
    .all(user.id)
    .map((review) => serializeProfileReview(review, user));

  sendJson(response, 200, {
    user: serializeUser(user),
    reviews,
  });
}

async function handleProfileEmailUpdate(request, response) {
  const user = getSessionUser(request);

  if (!user) {
    sendJson(response, 401, { error: 'No has iniciado sesión.' });
    return;
  }

  const body = await readJsonBody(request);
  const email = normalizeText(body.email).toLowerCase();

  if (!email) {
    sendJson(response, 400, { error: 'El correo no puede estar vacío.' });
    return;
  }

  const existingUser = statements.findUserByEmail.get(email);
  if (existingUser && existingUser.id !== user.id) {
    sendJson(response, 409, { error: 'Ese correo ya está en uso.' });
    return;
  }

  statements.updateUserEmail.run(email, user.id);
  const updatedUser = statements.findUserById.get(user.id);
  sendJson(response, 200, { user: serializeUser(updatedUser) });
}

async function handleProfilePasswordUpdate(request, response) {
  const user = getSessionUser(request);

  if (!user) {
    sendJson(response, 401, { error: 'No has iniciado sesión.' });
    return;
  }

  const body = await readJsonBody(request);
  const password = normalizeText(body.password);

  if (!password || password.length < 6) {
    sendJson(response, 400, { error: 'La nueva contraseña debe tener al menos 6 caracteres.' });
    return;
  }

  statements.updateUserPassword.run(hashPassword(password), user.id);
  sendJson(response, 200, { ok: true });
}

async function handleProfileAvatarUpdate(request, response) {
  const user = getSessionUser(request);

  if (!user) {
    sendJson(response, 401, { error: 'No has iniciado sesión.' });
    return;
  }

  const body = await readJsonBody(request);
  const avatar = normalizeText(body.avatar);

  if (!avatar.startsWith('data:image/')) {
    sendJson(response, 400, { error: 'Formato de imagen inválido.' });
    return;
  }

  if (avatar.length > 1024 * 1024 * 2) {
    sendJson(response, 400, { error: 'La imagen es demasiado grande.' });
    return;
  }

  statements.updateUserAvatar.run(avatar, user.id);
  const updatedUser = statements.findUserById.get(user.id);
  sendJson(response, 200, { user: serializeUser(updatedUser) });
}

function handleGameReviews(request, response, slug) {
  const game = statements.findGameBySlug.get(slug);

  if (!game) {
    sendJson(response, 404, { error: 'Juego no encontrado.' });
    return;
  }

  const reviews = statements.listReviewsByGameSlug.all(slug).map(serializeReview);

  sendJson(response, 200, {
    game: {
      slug: game.slug,
      title: game.title,
      description: game.description,
      genre: game.genre,
      platform: game.platform,
      imageUrl: game.image_url,
    },
    reviews,
  });
}

async function handleCreateReview(request, response) {
  const user = getSessionUser(request);

  if (!user) {
    sendJson(response, 401, { error: 'Debes iniciar sesión para comentar.' });
    return;
  }

  const body = await readJsonBody(request);
  const gameSlug = normalizeText(body.gameSlug);
  const comment = normalizeText(body.comment);
  const rating = Number(body.rating);

  if (!gameSlug || !comment || !Number.isInteger(rating)) {
    sendJson(response, 400, { error: 'Datos de reseña inválidos.' });
    return;
  }

  if (rating < 1 || rating > 5) {
    sendJson(response, 400, { error: 'La puntuación debe estar entre 1 y 5.' });
    return;
  }

  const game = statements.findGameBySlug.get(gameSlug);

  if (!game) {
    sendJson(response, 404, { error: 'Juego no encontrado.' });
    return;
  }

  const createdAt = nowIso();
  const result = statements.insertReview.run(user.id, game.id, rating, comment, createdAt, createdAt);
  const createdReview = statements
    .listReviewsByGameSlug
    .all(game.slug)
    .find((review) => review.id === Number(result.lastInsertRowid));

  sendJson(response, 201, { review: serializeReview(createdReview) });
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const { pathname } = requestUrl;

    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    if (pathname === '/api/session' && request.method === 'GET') {
      handleSession(request, response);
      return;
    }

    if (pathname === '/api/auth/register' && request.method === 'POST') {
      await handleRegister(request, response);
      return;
    }

    if (pathname === '/api/auth/login' && request.method === 'POST') {
      await handleLogin(request, response);
      return;
    }

    if (pathname === '/api/auth/logout' && request.method === 'POST') {
      handleLogout(request, response);
      return;
    }

    if (pathname === '/api/profile' && request.method === 'GET') {
      handleProfile(request, response);
      return;
    }

    if (pathname === '/api/profile/email' && request.method === 'PATCH') {
      await handleProfileEmailUpdate(request, response);
      return;
    }

    if (pathname === '/api/profile/password' && request.method === 'PATCH') {
      await handleProfilePasswordUpdate(request, response);
      return;
    }

    if (pathname === '/api/profile/avatar' && request.method === 'PATCH') {
      await handleProfileAvatarUpdate(request, response);
      return;
    }

    if (pathname.startsWith('/api/games/') && pathname.endsWith('/reviews') && request.method === 'GET') {
      const slug = pathname.replace('/api/games/', '').replace('/reviews', '').replace(/\/+/g, '');
      handleGameReviews(request, response, slug);
      return;
    }

    if (pathname === '/api/reviews' && request.method === 'POST') {
      await handleCreateReview(request, response);
      return;
    }

    if (pathname.startsWith('/api/')) {
      sendJson(response, 404, { error: 'Endpoint no encontrado.' });
      return;
    }

    serveStaticFile(request, response, pathname);
  } catch (error) {
    sendJson(response, 500, {
      error: 'Ocurrió un error interno en el servidor.',
      detail: error.message,
    });
  }
});

server.listen(PORT, () => {
  console.log(`The Critic corriendo en http://localhost:${PORT}`);
});
