// admin.js
// Panel de administracion de The Critic
// Solo pueden entrar usuarios con is_admin = true — si no, redirige al login
// Desde aqui se pueden crear, editar y eliminar videojuegos y noticias
//
// Lo primero que hace al cargar es verificar la sesion con /api/session
// Si el usuario no es admin o no hay sesion, va al login automaticamente

// imagen guardada para el juego que se esta creando/editando (en base64, o null si no hay)
let pendingGameImage = null;

// imagen guardada para la noticia que se esta creando/editando (en base64, o null si no hay)
let pendingNewsImage = null;

// ============================================================================
// COMUNICACION CON LA API
// ============================================================================

// hace una peticion JSON a la API y devuelve la respuesta
// si hay error lanza un Error con el mensaje del servidor
async function api(url, options = {}) {
  const res  = await fetch(url, {
    credentials: 'include', // necesario para mandar la cookie de sesion
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error desconocido');
  return data;
}

// ============================================================================
// MANEJO DE IMAGENES
// ============================================================================

// lee un archivo de imagen y lo convierte a base64 (data URL)
// esto nos permite guardarlo en la base de datos como texto
// devuelve una Promesa para poder usarlo con await
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader   = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file); // empieza a leer el archivo
  });
}

// ============================================================================
// PESTAÑAS (TABS)
// controla que se muestre el panel de juegos o el de noticias
// ============================================================================

function initTabs() {
  const tabs   = document.querySelectorAll('.admin-tab');
  const panels = {
    games: document.getElementById('panel-games'),
    news:  document.getElementById('panel-news'),
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      // quitar la clase activa de todas las pestañas
      tabs.forEach((t) => t.classList.remove('is-active'));
      tab.classList.add('is-active');

      // ocultar todos los paneles y mostrar el que corresponde a la pestaña clickeada
      Object.values(panels).forEach((p) => { p.hidden = true; });
      panels[tab.dataset.tab].hidden = false;
    });
  });
}

// ============================================================================
// PANEL DE VIDEOJUEGOS
// ============================================================================

// carga todos los juegos desde la API y los muestra en la tabla
async function loadGames() {
  const tbody = document.getElementById('games-tbody');
  try {
    const { games } = await api('/api/admin/games');

    if (!games.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="admin-table__empty">No hay videojuegos todavía.</td></tr>';
      return;
    }

    tbody.innerHTML = ''; // limpiar el contenido anterior antes de renderizar
    games.forEach((game) => tbody.appendChild(createGameRow(game)));
  } catch (err) {
    // mostrar el error dentro de la tabla para que sea visible
    tbody.innerHTML = `<tr><td colspan="6" class="admin-table__empty admin-table__empty--error">${err.message}</td></tr>`;
  }
}

// crea una fila <tr> para la tabla de juegos con sus botones de editar y eliminar
function createGameRow(game) {
  const tr = document.createElement('tr');
  tr.dataset.gameId = game.id;

  const imgSrc = game.image_url || '';

  tr.innerHTML = `
    <td class="admin-table__thumb">
      ${imgSrc
        ? `<img src="${imgSrc}" alt="${game.title}">`
        : '<span class="admin-table__no-img">Sin imagen</span>'
      }
    </td>
    <td>${game.title}</td>
    <td>${game.genre}</td>
    <td>${game.platform}</td>
    <td>${game.review_count}</td>
    <td class="admin-table__actions">
      <button class="btn-edit"   data-edit-game="${game.id}">Editar</button>
      <button class="btn-delete" data-delete-game="${game.id}">Eliminar</button>
    </td>
  `;

  // agregar eventos a los botones recien creados
  tr.querySelector('[data-edit-game]').addEventListener('click',   () => openGameForm(game));
  tr.querySelector('[data-delete-game]').addEventListener('click', () => deleteGame(game.id, game.title));
  return tr;
}

// lee cuales checkboxes estan marcados en un grupo y los devuelve como string "A, B, C"
// se usa para saber que generos o plataformas selecciono el admin
function getCheckedValues(groupId) {
  const checks = document.querySelectorAll(`#${groupId} input[type="checkbox"]:checked`);
  return Array.from(checks).map((c) => c.value).join(', ');
}

// marca los checkboxes de un grupo que coincidan con los valores del string "A, B, C"
// se usa al editar un juego existente para que aparezcan los generos/plataformas ya guardados
function setCheckedValues(groupId, valueString) {
  const values = (valueString || '').split(',').map((v) => v.trim());
  document.querySelectorAll(`#${groupId} input[type="checkbox"]`).forEach((cb) => {
    cb.checked = values.includes(cb.value);
  });
  syncChips(groupId); // actualizar el aspecto visual despues de cambiar el estado
}

// abre el formulario para crear un juego nuevo (sin argumento) o editar uno existente (con el objeto game)
function openGameForm(game = null) {
  const box        = document.getElementById('game-form-box');
  const form       = document.getElementById('game-form');
  const formTitle  = document.querySelector('[data-game-form-title]');
  const submitBtn  = document.getElementById('game-submit-btn');
  const preview    = document.getElementById('game-image-preview');
  const previewImg = document.getElementById('game-image-preview-img');

  // resetear la imagen pendiente al abrir el formulario
  pendingGameImage = null;
  document.getElementById('game-image').value = '';

  if (game) {
    // modo edicion — rellenar el formulario con los datos del juego
    formTitle.textContent = 'Editar videojuego';
    submitBtn.textContent = 'Guardar cambios';
    document.getElementById('game-id').value          = game.id;
    document.getElementById('game-title').value       = game.title;
    document.getElementById('game-description').value = game.description;
    setCheckedValues('game-genre-group', game.genre);
    setCheckedValues('game-platform-group', game.platform);

    if (game.image_url) {
      previewImg.src   = game.image_url;
      preview.hidden   = false;
      pendingGameImage = game.image_url; // mantener la imagen actual si no se cambia
    } else {
      preview.hidden = true;
    }
  } else {
    // modo creacion — limpiar todo el formulario
    formTitle.textContent = 'Nuevo videojuego';
    submitBtn.textContent = 'Guardar juego';
    form.reset();
    document.getElementById('game-id').value = '';

    // desmarcar todos los checkboxes y actualizar los chips
    document.querySelectorAll('#game-genre-group input, #game-platform-group input').forEach((cb) => {
      cb.checked = false;
    });
    syncChips('game-genre-group');
    syncChips('game-platform-group');
    preview.hidden = true;
  }

  box.hidden = false;
  box.scrollIntoView({ behavior: 'smooth', block: 'start' }); // hacer scroll hasta el formulario
}

// oculta el formulario de juego y limpia su contenido
function closeGameForm() {
  document.getElementById('game-form-box').hidden = true;
  document.getElementById('game-form').reset();
  pendingGameImage = null;
}

// elimina un juego tras pedir confirmacion
// ojo: esto tambien borra TODAS las reseñas del juego (ON DELETE CASCADE en la BD)
async function deleteGame(id, title) {
  if (!window.confirm(`¿Eliminar "${title}"? Esto borrará también todas sus reseñas.`)) return;
  try {
    await api(`/api/admin/games/${id}`, { method: 'DELETE' });
    await loadGames(); // recargar la tabla
  } catch (err) {
    window.alert(`Error: ${err.message}`);
  }
}

// sincroniza el aspecto visual de los chips con el estado real de los checkboxes
// los checkboxes estan ocultos visualmente, los chips son los labels que los representan
// cuando un checkbox esta marcado, su label recibe la clase is-checked (se pone blanco)
function syncChips(groupId) {
  document.querySelectorAll(`#${groupId} .admin-check`).forEach((label) => {
    const cb = label.querySelector('input[type="checkbox"]');
    label.classList.toggle('is-checked', cb.checked);
  });
}

// inicializa todos los eventos del panel de videojuegos
function initGamesPanel() {
  // boton "Nuevo videojuego"
  document.querySelector('[data-open-game-form]').addEventListener('click', () => openGameForm());

  // boton "Cancelar" del formulario
  document.querySelector('[data-cancel-game-form]').addEventListener('click', closeGameForm);

  // sincronizar chips cada vez que cambia un checkbox de genero o plataforma
  ['game-genre-group', 'game-platform-group'].forEach((groupId) => {
    document.querySelectorAll(`#${groupId} input[type="checkbox"]`).forEach((cb) => {
      cb.addEventListener('change', () => syncChips(groupId));
    });
  });

  // vista previa de imagen cuando el admin selecciona un archivo
  document.getElementById('game-image').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      pendingGameImage = await readFileAsBase64(file);
      const previewImg = document.getElementById('game-image-preview-img');
      previewImg.src   = pendingGameImage;
      document.getElementById('game-image-preview').hidden = false;
    } catch {
      window.alert('No se pudo cargar la imagen.');
    }
  });

  // quitar la imagen seleccionada
  document.querySelector('[data-remove-game-image]').addEventListener('click', () => {
    pendingGameImage = ''; // string vacio significa "borrar la imagen del juego"
    document.getElementById('game-image').value = '';
    document.getElementById('game-image-preview').hidden = true;
  });

  // envio del formulario — crea o actualiza segun si hay id en el campo oculto
  document.getElementById('game-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id          = document.getElementById('game-id').value;
    const title       = document.getElementById('game-title').value.trim();
    const description = document.getElementById('game-description').value.trim();
    const genre       = getCheckedValues('game-genre-group');
    const platform    = getCheckedValues('game-platform-group');

    // validar que se haya seleccionado al menos un genero y una plataforma
    if (!genre)    { window.alert('Selecciona al menos un género.');    return; }
    if (!platform) { window.alert('Selecciona al menos una plataforma.'); return; }

    const body = { title, description, genre, platform };

    // solo incluir imageUrl en el body si se cambio (null = no cambiar la imagen actual)
    if (pendingGameImage !== null) body.imageUrl = pendingGameImage;

    try {
      if (id) {
        // tiene id → es una edicion
        await api(`/api/admin/games/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        // sin id → es un juego nuevo
        await api('/api/admin/games', { method: 'POST', body: JSON.stringify(body) });
      }
      closeGameForm();
      await loadGames(); // refrescar la tabla con los datos actualizados
    } catch (err) {
      window.alert(`Error: ${err.message}`);
    }
  });
}

// ============================================================================
// PANEL DE NOTICIAS
// mismo patron que el panel de juegos
// ============================================================================

// carga todas las noticias y las muestra en la tabla
async function loadNews() {
  const tbody = document.getElementById('news-tbody');
  try {
    const { news } = await api('/api/admin/news');

    if (!news.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="admin-table__empty">No hay noticias todavía.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    news.forEach((article) => tbody.appendChild(createNewsRow(article)));
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="admin-table__empty admin-table__empty--error">${err.message}</td></tr>`;
  }
}

// crea una fila <tr> para la tabla de noticias
function createNewsRow(article) {
  const tr = document.createElement('tr');
  tr.dataset.newsId = article.id;

  const imgSrc = article.image_url || '';
  const date   = new Date(article.published_at).toLocaleDateString('es-MX'); // formato local

  tr.innerHTML = `
    <td class="admin-table__thumb">
      ${imgSrc
        ? `<img src="${imgSrc}" alt="${article.title}">`
        : '<span class="admin-table__no-img">Sin imagen</span>'
      }
    </td>
    <td>${article.title}</td>
    <td>${article.category}</td>
    <td>${date}</td>
    <td class="admin-table__actions">
      <button class="btn-edit"   data-edit-news="${article.id}">Editar</button>
      <button class="btn-delete" data-delete-news="${article.id}">Eliminar</button>
    </td>
  `;

  tr.querySelector('[data-edit-news]').addEventListener('click',   () => openNewsForm(article));
  tr.querySelector('[data-delete-news]').addEventListener('click', () => deleteNews(article.id, article.title));
  return tr;
}

// abre el formulario para crear o editar una noticia
// si viene el objeto article es modo edicion, sin argumento es modo creacion
async function openNewsForm(article = null) {
  const box        = document.getElementById('news-form-box');
  const form       = document.getElementById('news-form');
  const formTitle  = document.querySelector('[data-news-form-title]');
  const submitBtn  = document.getElementById('news-submit-btn');
  const preview    = document.getElementById('news-image-preview');
  const previewImg = document.getElementById('news-image-preview-img');

  pendingNewsImage = null;
  document.getElementById('news-image').value = '';

  if (article) {
    // cuando se edita, la tabla solo trae un resumen de la noticia (sin el contenido completo)
    // hay que hacer una segunda peticion para obtener el contenido completo
    let fullArticle = article;
    if (!article.content) {
      try {
        const data = await api(`/api/news/${article.slug}`);
        fullArticle = data.article;
      } catch {
        // si falla usamos lo que ya tenemos (puede que falte el contenido)
      }
    }

    formTitle.textContent = 'Editar noticia';
    submitBtn.textContent = 'Guardar cambios';
    document.getElementById('news-id').value       = fullArticle.id;
    document.getElementById('news-title').value    = fullArticle.title;
    document.getElementById('news-excerpt').value  = fullArticle.excerpt;
    document.getElementById('news-content').value  = fullArticle.content || '';
    document.getElementById('news-category').value = fullArticle.category;

    if (fullArticle.image_url) {
      previewImg.src   = fullArticle.image_url;
      preview.hidden   = false;
      pendingNewsImage = fullArticle.image_url;
    } else {
      preview.hidden = true;
    }
  } else {
    formTitle.textContent = 'Nueva noticia';
    submitBtn.textContent = 'Guardar noticia';
    form.reset();
    document.getElementById('news-id').value = '';
    preview.hidden = true;
  }

  box.hidden = false;
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// cierra y limpia el formulario de noticia
function closeNewsForm() {
  document.getElementById('news-form-box').hidden = true;
  document.getElementById('news-form').reset();
  pendingNewsImage = null;
}

// elimina una noticia tras pedir confirmacion
async function deleteNews(id, title) {
  if (!window.confirm(`¿Eliminar la noticia "${title}"?`)) return;
  try {
    await api(`/api/admin/news/${id}`, { method: 'DELETE' });
    await loadNews();
  } catch (err) {
    window.alert(`Error: ${err.message}`);
  }
}

// inicializa todos los eventos del panel de noticias
function initNewsPanel() {
  document.querySelector('[data-open-news-form]').addEventListener('click',   () => openNewsForm());
  document.querySelector('[data-cancel-news-form]').addEventListener('click', closeNewsForm);

  // vista previa al seleccionar imagen
  document.getElementById('news-image').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      pendingNewsImage = await readFileAsBase64(file);
      const previewImg = document.getElementById('news-image-preview-img');
      previewImg.src   = pendingNewsImage;
      document.getElementById('news-image-preview').hidden = false;
    } catch {
      window.alert('No se pudo cargar la imagen.');
    }
  });

  // quitar imagen
  document.querySelector('[data-remove-news-image]').addEventListener('click', () => {
    pendingNewsImage = '';
    document.getElementById('news-image').value = '';
    document.getElementById('news-image-preview').hidden = true;
  });

  // envio del formulario de noticia
  document.getElementById('news-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id       = document.getElementById('news-id').value;
    const title    = document.getElementById('news-title').value.trim();
    const excerpt  = document.getElementById('news-excerpt').value.trim();
    const content  = document.getElementById('news-content').value.trim();
    const category = document.getElementById('news-category').value;

    const body = { title, excerpt, content, category };
    if (pendingNewsImage !== null) body.imageUrl = pendingNewsImage;

    try {
      if (id) {
        await api(`/api/admin/news/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await api('/api/admin/news', { method: 'POST', body: JSON.stringify(body) });
      }
      closeNewsForm();
      await loadNews();
    } catch (err) {
      window.alert(`Error: ${err.message}`);
    }
  });
}

// ============================================================================
// INICIO DEL PANEL
// ============================================================================

async function init() {
  // lo primero es verificar que hay sesion y que el usuario es admin
  // si no cumple alguna condicion se va al login sin mas
  try {
    const { user } = await api('/api/session');
    if (!user || !user.isAdmin) {
      window.location.href = 'login.html';
      return;
    }
    // mostrar el nombre del admin en el header (desktop y movil)
    document.querySelectorAll('[data-admin-username], [data-admin-username-mobile]').forEach((el) => {
      el.textContent = user.name;
    });
  } catch {
    window.location.href = 'login.html';
    return;
  }

  // evento de logout en el header del admin (funciona en desktop y en el drawer movil)
  document.querySelectorAll('[data-admin-logout], [data-admin-logout-mobile]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      window.location.href = 'login.html';
    });
  });

  // menu hamburguesa del admin (mismo funcionamiento que en el resto del sitio)
  const navToggle = document.querySelector('[data-nav-toggle]');
  const navDrawer = document.querySelector('[data-nav-drawer]');
  if (navToggle && navDrawer) {
    navToggle.addEventListener('click', () => {
      const isOpen = navDrawer.classList.toggle('is-open');
      navToggle.classList.toggle('is-open', isOpen);
      document.body.classList.toggle('drawer-open', isOpen);
    });

    // cerrar drawer al hacer clic en cualquier link dentro de el
    navDrawer.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        navDrawer.classList.remove('is-open');
        navToggle.classList.remove('is-open');
        document.body.classList.remove('drawer-open');
      });
    });
  }

  // inicializar las pestañas y los paneles
  initTabs();
  initGamesPanel();
  initNewsPanel();

  // cargar juegos y noticias en paralelo para que sea mas rapido
  await Promise.all([loadGames(), loadNews()]);
}

init();
