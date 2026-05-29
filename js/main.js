// main.js
// Este archivo maneja todo lo que pasa en el frontend de The Critic
// Se carga en todas las paginas y detecta en cuál esta para hacer solo lo necesario
// Se comunica con el servidor via fetch() a los endpoints /api/*
//
// Cosas que hace:
//  - sabe si hay usuario logueado (llama /api/session al cargar)
//  - renderiza juegos, noticias y reseñas dinamicamente
//  - maneja login, registro y logout
//  - controla el perfil del usuario (foto, email, contraseña)
//  - abre/cierra el modal de reseñas
//  - controla el menu hamburguesa en movil

document.addEventListener('DOMContentLoaded', () => {

  // estado global de la sesion — se actualiza cuando el usuario inicia o cierra sesion
  const state = {
    currentUser: null, // null si no hay sesion, objeto usuario si hay
  };

  // imagen por defecto cuando alguien no tiene foto de perfil
  const DEFAULT_AVATAR = 'assets/img/cta.png';

  // --- referencias al DOM: home -----------------------------------------------
  // estas solo existen en index.html, en otras paginas son null (y eso esta bien)
  const homeGamesCarousel   = document.querySelector('[data-home-games]');
  const homeReviewsCarousel = document.querySelector('[data-home-reviews]');
  const homeNewsCarousel    = document.querySelector('[data-home-news]');

  // --- referencias al DOM: noticias -------------------------------------------
  const newsCards          = document.querySelectorAll('.news-card');
  const newsGrid           = document.querySelector('[data-news-grid]');
  const newsSearchInput    = document.querySelector('[data-news-search]');
  const newsSearchButton   = document.querySelector('.news-search .search-button');
  const newsCategorySelect = document.querySelector('[data-news-category]');

  // --- referencias al DOM: navegacion -----------------------------------------
  const navAuthContainers = document.querySelectorAll('.nav-auth');
  const navToggleBtn      = document.querySelector('[data-nav-toggle]');  // boton hamburguesa
  const navDrawer         = document.querySelector('[data-nav-drawer]');  // menu que se abre en movil
  const navMobileAuthBox  = document.querySelector('[data-nav-mobile-auth]'); // links de auth dentro del drawer

  // --- referencias al DOM: videojuegos ----------------------------------------
  const gamesGrid           = document.querySelector('[data-games-grid]');
  const gamesResults        = document.querySelector('[data-games-results]');
  const gamesSearchInput    = document.querySelector('[data-games-search]');
  const gamesSearchButton   = document.querySelector('.games-search .search-button');
  const gamesGenreFilter    = document.querySelector('[data-games-genre]');
  const gamesPlatformFilter = document.querySelector('[data-games-platform]');
  const gamesRatingFilter   = document.querySelector('[data-games-rating]');

  // --- referencias al DOM: validacion de contraseña (registro) ----------------
  const passwordRulesBox  = document.querySelector('#password-rules');
  const passwordRuleItems = passwordRulesBox
    ? passwordRulesBox.querySelectorAll('[data-rule]')
    : [];

  // --- referencias al DOM: formularios de autenticacion -----------------------
  const loginForm    = document.querySelector('.login-form');
  const registerForm = document.querySelector('.register-form');

  // --- referencias al DOM: perfil ---------------------------------------------
  const profilePage          = document.querySelector('.profile-page');
  const profileName          = document.querySelector('[data-profile-name]');
  const profileEmail         = document.querySelector('[data-profile-email]');
  const profileAvatar        = document.querySelector('[data-profile-avatar]');
  const profilePhotoInput    = document.querySelector('[data-profile-photo-input]');
  const profileReviewsGrid   = document.querySelector('[data-profile-reviews]');
  const profileActionButtons = document.querySelectorAll('[data-profile-action]');

  // --- referencias al DOM: modal de reseña ------------------------------------
  const reviewOpenButton   = document.querySelector('[data-review-open]');
  const reviewModal        = document.querySelector('[data-review-modal]');
  const reviewCloseButtons = document.querySelectorAll('[data-review-close]');
  const reviewForm         = document.querySelector('[data-review-form]');
  const reviewTextarea     = document.querySelector('#review-comment');
  const reviewRatingInput  = reviewForm ? reviewForm.elements.rating : null;
  const reviewScoreButtons = document.querySelectorAll('[data-score-value]');

  // --- referencias al DOM: detalle de juego -----------------------------------
  const reviewsGrid       = document.querySelector('.reviews-grid');
  const gameTitle         = document.querySelector('.game-detail__title');
  const gameDetailRating  = document.querySelector('[data-game-rating]');
  const gameMeta          = document.querySelector('.game-detail__meta');
  const gameDescription   = document.querySelector('.game-detail__desc');
  const gameImage         = document.querySelector('.game-detail__image');
  const reviewGameName    = document.querySelector('[data-review-game-name]');
  const gameDetailSection = document.querySelector('[data-game-slug]');

  // pagina actual y parametros de la URL (para saber en que juego o noticia estamos)
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  const urlParams   = new URLSearchParams(window.location.search);

  // limpia espacios de un valor y lo convierte a string
  const sanitizeText = (value) => String(value || '').trim();

  // convierte un texto a slug para URLs: "Hollow Knight" → "hollow-knight"
  const slugify = (value) =>
    sanitizeText(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // quita acentos
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  // obtiene el slug del juego actual:
  // primero mira la URL (?game=slug), luego el data attribute del HTML, y si no hay nada usa minecraft
  const currentGameSlug =
    urlParams.get('game') ||
    gameDetailSection?.dataset.gameSlug ||
    slugify(gameTitle ? gameTitle.textContent : 'minecraft-java-edition');

  // ============================================================================
  // COMUNICACION CON LA API
  // wrapper sobre fetch que incluye las credenciales (cookie) y maneja errores
  // ============================================================================

  // hace una peticion a la API y devuelve el JSON de la respuesta
  // si el servidor responde con error lanza un Error con el mensaje del servidor
  const apiFetch = async (url, options = {}) => {
    const response = await fetch(url, {
      credentials: 'same-origin', // necesario para que el browser mande la cookie de sesion
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      ...options,
    });

    const isJson  = response.headers.get('content-type')?.includes('application/json');
    const payload = isJson ? await response.json() : null;

    if (!response.ok) {
      throw new Error(payload?.error || 'Ocurrió un error al procesar la solicitud.');
    }

    return payload;
  };

  // ============================================================================
  // UTILIDADES
  // ============================================================================

  // convierte una fecha ISO o timestamp a formato DD.MM.YYYY
  // ej: "2026-03-24T09:00:00.000Z" → "24.03.2026"
  const formatReviewDate = (value) => {
    if (!value) {
      return '';
    }

    // si ya esta en formato DD.MM.YYYY no hace nada
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(value)) {
      return value;
    }

    const date  = new Date(value);
    const day   = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year  = date.getFullYear();

    return `${day}.${month}.${year}`;
  };

  // actualiza el area de autenticacion del nav segun si hay sesion o no
  // se llama cada vez que el estado de sesion cambia (login, logout, carga inicial)
  const renderAuthNavigation = () => {
    const profileActiveClass  = currentPage === 'perfil.html'   ? ' class="is-active"' : '';
    const loginActiveClass    = currentPage === 'login.html'    ? ' class="is-active"' : '';
    const registerActiveClass = currentPage === 'register.html' ? ' class="is-active"' : '';

    // nav del escritorio
    navAuthContainers.forEach((container) => {
      if (state.currentUser) {
        // si es admin se muestra el link al panel de administracion
        const adminLink = state.currentUser.isAdmin ? ` / <a href="admin.html">Admin</a>` : '';
        container.innerHTML = `<a${profileActiveClass} href="perfil.html">Mi perfil</a>${adminLink} / <button class="nav-auth__button" type="button" data-logout>Cerrar sesión</button>`;
      } else {
        container.innerHTML = `<a${loginActiveClass} href="login.html">Iniciar sesión</a> / <a${registerActiveClass} href="register.html">Registrarse</a>`;
      }
    });

    // menu movil (drawer) — mismo contenido que el desktop pero como lista
    if (navMobileAuthBox) {
      if (state.currentUser) {
        const adminItem = state.currentUser.isAdmin ? `<li><a href="admin.html">Admin</a></li>` : '';
        navMobileAuthBox.innerHTML = `
          <li><a href="perfil.html">Mi perfil</a></li>
          ${adminItem}
          <li><button class="nav-drawer__logout" type="button" data-logout>Cerrar sesión</button></li>`;
      } else {
        navMobileAuthBox.innerHTML = `
          <li><a href="login.html">Iniciar sesión</a></li>
          <li><a href="register.html">Registrarse</a></li>`;
      }
    }
  };

  // ============================================================================
  // CONSTRUCTORES DE ELEMENTOS DEL DOM
  // funciones que crean elementos HTML dinamicamente para no tener que escribir
  // el mismo innerHTML mil veces
  // ============================================================================

  // crea las 5 barras de puntuacion, las que corresponden al rating se rellenan de blanco
  const createRatingBars = (rating) => {
    const ratingBars = document.createElement('div');
    ratingBars.className = 'rating-bars';

    for (let index = 1; index <= 5; index += 1) {
      const bar = document.createElement('span');
      bar.className = 'rating-bar';

      if (index <= rating) {
        bar.classList.add('is-filled'); // esta barra se pinta de blanco
      }

      ratingBars.appendChild(bar);
    }

    return ratingBars;
  };

  // crea una tarjeta de reseña para mostrar en la pagina de detalle del juego
  const createReviewPost = (review) => {
    const article = document.createElement('article');
    article.className  = 'review-post';
    article.dataset.reviewId = review.id; // guarda el id para poder reemplazarla si se edita

    const top = document.createElement('div');
    top.className = 'review-post__top';

    const user = document.createElement('div');
    user.className = 'review-post__user';

    const avatar = document.createElement('img');
    avatar.className = 'review-post__avatar';
    avatar.src = review.avatar || DEFAULT_AVATAR;
    avatar.alt = 'Avatar del usuario';

    const details = document.createElement('div');
    const name    = document.createElement('p');
    name.className   = 'review-post__name';
    name.textContent = review.userName || 'Jugador';

    const game = document.createElement('p');
    game.className   = 'review-post__game';
    game.textContent = review.gameName || 'Minecraft';

    details.append(name, game);
    user.append(avatar, details);

    const rating = document.createElement('div');
    rating.className = 'review-post__rating';

    const ratingMain = document.createElement('div');
    ratingMain.className = 'review-post__rating-main';
    ratingMain.append(createRatingBars(Number(review.rating) || 5));

    const score = document.createElement('span');
    score.textContent = String(Number(review.rating) || 5);
    ratingMain.appendChild(score);

    const date = document.createElement('p');
    date.className   = 'review-post__date';
    date.textContent = formatReviewDate(review.date || review.createdAt);

    rating.append(ratingMain, date);
    top.append(user, rating);

    const text = document.createElement('p');
    text.className   = 'review-post__text';
    text.textContent = review.comment || '';

    article.append(top, text);
    return article;
  };

  // crea una tarjeta de juego clickeable con imagen, titulo, descripcion y puntuacion
  const createGameCard = (game) => {
    const article = document.createElement('article');
    article.className       = 'game-card';
    article.dataset.gameSlug = game.slug; // se usa para navegar a juego.html?game=slug

    const image = document.createElement('img');
    image.className = 'game-card__image';
    image.src = game.imageUrl || DEFAULT_AVATAR;
    image.alt = `Portada de ${game.title}`;

    const title = document.createElement('h3');
    title.className   = 'game-card__title';
    title.textContent = game.title;

    const description = document.createElement('p');
    description.className   = 'game-card__desc';
    description.textContent = game.description;

    const rating = document.createElement('div');
    rating.className = 'game-card__rating';
    rating.append(createRatingBars(Number(game.rating) || 0));

    const score = document.createElement('span');
    // si no hay reseñas muestra 0, si hay muestra el promedio sin decimales innecesarios
    score.textContent = game.averageRating ? String(Number(game.averageRating).toFixed(1)).replace('.0', '') : '0';
    rating.appendChild(score);

    article.append(image, title, description, rating);
    return article;
  };

  // actualiza el bloque de puntuacion en la pagina de detalle del juego
  const updateGameDetailRating = (game) => {
    if (!gameDetailRating) {
      return;
    }

    const averageRating = Number(game.averageRating) || 0;
    const roundedRating = Number.isFinite(Number(game.rating)) ? Number(game.rating) : Math.round(averageRating);
    const score         = averageRating ? String(averageRating.toFixed(1)).replace('.0', '') : '0';

    gameDetailRating.innerHTML = '';
    gameDetailRating.append(createRatingBars(roundedRating));

    const scoreElement = document.createElement('span');
    scoreElement.textContent = score;
    gameDetailRating.appendChild(scoreElement);
  };

  // crea una tarjeta de reseña para la pagina de perfil del usuario
  // es diferente a createReviewPost porque tiene un diseño mas compacto
  const createProfileReviewCard = (review) => {
    const article = document.createElement('article');
    article.className = 'profile-review-card';

    const top = document.createElement('div');
    top.className = 'profile-review-card__top';

    const user = document.createElement('div');
    user.className = 'profile-review-card__user';

    const avatar = document.createElement('img');
    avatar.className = 'profile-review-card__avatar';
    avatar.src = review.avatar || state.currentUser?.avatar || DEFAULT_AVATAR;
    avatar.alt = 'Avatar del usuario';

    const details = document.createElement('div');
    const name    = document.createElement('p');
    name.className   = 'profile-review-card__name';
    name.textContent = review.userName || state.currentUser?.name || 'Jugador';

    const game = document.createElement('p');
    game.className   = 'profile-review-card__game';
    game.textContent = review.gameName || 'Minecraft';

    details.append(name, game);
    user.append(avatar, details);

    const rating = document.createElement('div');
    rating.className = 'profile-review-card__rating';

    const ratingMain = document.createElement('div');
    ratingMain.className = 'profile-review-card__rating-main';
    ratingMain.append(createRatingBars(Number(review.rating) || 5));

    const score = document.createElement('span');
    score.textContent = String(Number(review.rating) || 5);
    ratingMain.appendChild(score);

    const date = document.createElement('p');
    date.className   = 'profile-review-card__date';
    date.textContent = formatReviewDate(review.date || review.createdAt);

    rating.append(ratingMain, date);
    top.append(user, rating);

    const text = document.createElement('p');
    text.className   = 'profile-review-card__text';
    text.textContent = review.comment || '';

    article.append(top, text);
    return article;
  };

  // crea un parrafo de "estado vacio" cuando no hay resultados o hay un error
  const createEmptyState = (className, text) => {
    const message = document.createElement('p');
    message.className   = className;
    message.textContent = text;
    return message;
  };

  // ============================================================================
  // CARGA DE DATOS — llaman a la API y renderizan el resultado en el DOM
  // ============================================================================

  // agrega eventos de click y teclado a las tarjetas de juego para navegar a juego.html
  // usa data-card-ready para no agregar el mismo evento dos veces si se llama mas de una vez
  const attachGameCardEvents = (cards = document.querySelectorAll('.game-card')) => {
    cards.forEach((card) => {
      if (card.dataset.cardReady === 'true') {
        return;
      }

      card.dataset.cardReady = 'true';
      card.setAttribute('role', 'link');
      card.setAttribute('tabindex', '0');

      const openGame = () => {
        const slug = card.dataset.gameSlug;
        window.location.href = slug ? `juego.html?game=${encodeURIComponent(slug)}` : 'juego.html';
      };

      card.addEventListener('click', openGame);
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openGame();
        }
      });
    });
  };

  // carga y muestra el catalogo de juegos aplicando los filtros activos (videojuegos.html)
  const loadGames = async () => {
    if (!gamesGrid) {
      return; // no estamos en la pagina de juegos
    }

    // armar la query string con los filtros que tengan valor
    const params   = new URLSearchParams();
    const search   = sanitizeText(gamesSearchInput?.value);
    const genre    = sanitizeText(gamesGenreFilter?.value);
    const platform = sanitizeText(gamesPlatformFilter?.value);
    const rating   = sanitizeText(gamesRatingFilter?.value);

    if (search)   params.set('search', search);
    if (genre)    params.set('genre', genre);
    if (platform) params.set('platform', platform);
    if (rating)   params.set('rating', rating);

    if (gamesResults) {
      gamesResults.textContent = 'Buscando videojuegos...';
    }

    try {
      const query   = params.toString();
      const payload = await apiFetch(`/api/games${query ? `?${query}` : ''}`, {
        method: 'GET',
        headers: {},
      });

      gamesGrid.innerHTML = '';

      if (!payload.games.length) {
        gamesGrid.appendChild(createEmptyState('games-empty', 'No encontramos videojuegos con esos filtros.'));

        if (gamesResults) {
          gamesResults.textContent = '0 videojuegos encontrados';
        }

        return;
      }

      payload.games.forEach((game) => {
        gamesGrid.appendChild(createGameCard(game));
      });
      attachGameCardEvents(gamesGrid.querySelectorAll('.game-card'));

      if (gamesResults) {
        gamesResults.textContent = `${payload.games.length} videojuegos encontrados`;
      }
    } catch (error) {
      gamesGrid.innerHTML = '';
      gamesGrid.appendChild(createEmptyState('games-empty', error.message));

      if (gamesResults) {
        gamesResults.textContent = 'No se pudieron cargar los videojuegos';
      }
    }
  };

  // llama a /api/session para saber si hay usuario logueado y actualiza el nav
  // se llama siempre al iniciar, en todas las paginas
  const loadSession = async () => {
    try {
      const payload = await apiFetch('/api/session', {
        method: 'GET',
        headers: {},
      });

      state.currentUser = payload.user || null;
    } catch (error) {
      state.currentUser = null; // si falla la peticion asumimos que no hay sesion
    }

    renderAuthNavigation();
  };

  // carga el juego actual y sus reseñas — solo actua en juego.html
  const loadGameReviews = async () => {
    if (!reviewsGrid || !currentGameSlug) {
      return;
    }

    try {
      const payload = await apiFetch(`/api/games/${currentGameSlug}/reviews`, {
        method: 'GET',
        headers: {},
      });

      // rellenar los datos del juego en la pagina
      if (payload.game) {
        document.title = `${payload.game.title} | The Critic`;

        if (gameDetailSection) {
          gameDetailSection.dataset.gameSlug = payload.game.slug;
        }

        if (gameTitle)       { gameTitle.textContent = payload.game.title; }
        updateGameDetailRating(payload.game);
        if (gameMeta)        { gameMeta.innerHTML = `Genero: ${payload.game.genre}<br>Plataforma: ${payload.game.platform}`; }
        if (gameDescription) { gameDescription.textContent = payload.game.description; }

        if (gameImage) {
          gameImage.src = payload.game.imageUrl || DEFAULT_AVATAR;
          gameImage.alt = payload.game.title;
        }

        if (reviewGameName) { reviewGameName.textContent = payload.game.title; }
      }

      // renderizar la lista de reseñas
      reviewsGrid.innerHTML = '';

      if (!payload.reviews.length) {
        reviewsGrid.appendChild(createEmptyState('reviews-empty', 'Aún no hay reseñas para este juego.'));
      } else {
        payload.reviews.forEach((review) => {
          reviewsGrid.appendChild(createReviewPost(review));
        });
      }

      // si el usuario ya reseño este juego, pre-llenar el formulario con su reseña existente
      if (state.currentUser) {
        const myReview = payload.reviews.find((r) => r.userId === state.currentUser.id);
        if (myReview) {
          if (reviewTextarea)   { reviewTextarea.value = myReview.comment; }
          if (reviewRatingInput){ reviewRatingInput.value = myReview.rating; setReviewRating(myReview.rating); }
          const submitBtn = reviewForm ? reviewForm.querySelector('.review-form__submit') : null;
          if (submitBtn)       { submitBtn.textContent = 'Actualizar reseña'; }
          if (reviewOpenButton){ reviewOpenButton.textContent = 'Editar tu reseña'; }
        }
      }
    } catch (error) {
      reviewsGrid.innerHTML = '';
      reviewsGrid.appendChild(createEmptyState('reviews-empty', error.message));
    }
  };

  // carga y muestra los datos del perfil del usuario logueado (perfil.html)
  // si no hay sesion redirige al login
  const loadProfile = async () => {
    if (!profilePage) {
      return;
    }

    try {
      const payload = await apiFetch('/api/profile', {
        method: 'GET',
        headers: {},
      });

      state.currentUser = payload.user;
      renderAuthNavigation();

      if (profileName)  { profileName.textContent  = payload.user.name; }
      if (profileEmail) { profileEmail.textContent = payload.user.email; }
      if (profileAvatar){ profileAvatar.src = payload.user.avatar || DEFAULT_AVATAR; }

      if (profileReviewsGrid) {
        profileReviewsGrid.innerHTML = '';

        if (!payload.reviews.length) {
          profileReviewsGrid.appendChild(
            createEmptyState('profile-reviews__empty', 'Aún no has publicado reseñas.')
          );
          return;
        }

        payload.reviews.forEach((review) => {
          profileReviewsGrid.appendChild(createProfileReviewCard(review));
        });
      }
    } catch (error) {
      // si no hay sesion valida el servidor devuelve 401 y mandamos al login
      window.location.href = 'login.html';
    }
  };

  // ============================================================================
  // MODAL DE RESEÑA
  // ============================================================================

  // actualiza cuales botones de puntuacion se ven activos (rellenados)
  // se llama cuando el usuario hace clic en un numero del 1 al 5
  const setReviewRating = (value) => {
    if (!reviewRatingInput) {
      return;
    }

    const rating = Number(value);
    reviewRatingInput.value = String(rating);

    // todos los botones menores o iguales al rating seleccionado se marcan como activos
    reviewScoreButtons.forEach((button) => {
      button.classList.toggle('is-active', Number(button.dataset.scoreValue) <= rating);
    });
  };

  // abre el modal para escribir una reseña
  // si el usuario no esta logueado lo manda al login primero
  const openReviewModal = () => {
    if (!state.currentUser) {
      window.alert('Debes iniciar sesión para publicar una reseña.');
      window.location.href = 'login.html';
      return;
    }

    if (!reviewModal) {
      return;
    }

    reviewModal.hidden = false;
    document.body.classList.add('modal-open'); // bloquea el scroll del fondo

    window.requestAnimationFrame(() => {
      if (reviewTextarea) {
        reviewTextarea.focus(); // poner el cursor en el textarea al abrir
      }
    });
  };

  // cierra el modal y devuelve el foco al boton que lo abrio
  const closeReviewModal = () => {
    if (!reviewModal) {
      return;
    }

    reviewModal.hidden = true;
    document.body.classList.remove('modal-open');

    if (reviewOpenButton) {
      reviewOpenButton.focus();
    }
  };

  // ============================================================================
  // EVENT LISTENERS
  // ============================================================================

  // logout — delegado en .nav-auth para capturar el boton que se crea dinamicamente
  navAuthContainers.forEach((container) => {
    container.addEventListener('click', async (event) => {
      const logoutButton = event.target.closest('[data-logout]');

      if (!logoutButton) {
        return; // el clic no fue en el boton de logout
      }

      try {
        await apiFetch('/api/auth/logout', {
          method: 'POST',
          body: JSON.stringify({}),
        });

        state.currentUser = null;
        renderAuthNavigation();

        // si estamos en el perfil redirigir al inicio (ya no tiene sentido estar ahi)
        if (profilePage) {
          window.location.href = 'index.html';
        }
      } catch (error) {
        window.alert(error.message);
      }
    });
  });

  // hamburguesa — abre y cierra el menu de navegacion en movil
  if (navToggleBtn && navDrawer) {
    navToggleBtn.addEventListener('click', () => {
      const isOpen = navDrawer.classList.toggle('is-open');
      navToggleBtn.classList.toggle('is-open', isOpen);
      navToggleBtn.setAttribute('aria-label', isOpen ? 'Cerrar menú' : 'Abrir menú');
      document.body.classList.toggle('drawer-open', isOpen); // bloquea el scroll del body
    });

    // cerrar el drawer cuando el usuario hace clic en un enlace dentro de el
    navDrawer.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        navDrawer.classList.remove('is-open');
        navToggleBtn.classList.remove('is-open');
        document.body.classList.remove('drawer-open');
      });
    });

    // logout desde el drawer movil (delegado en el drawer entero)
    navDrawer.addEventListener('click', async (event) => {
      const logoutButton = event.target.closest('[data-logout]');
      if (!logoutButton) return;
      try {
        await apiFetch('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
        state.currentUser = null;
        renderAuthNavigation();
        window.location.href = 'index.html';
      } catch (error) {
        window.alert(error.message);
      }
    });
  }

  // boton "Explorar juegos" de la hero en el inicio
  const heroExploreButton = document.querySelector('[data-hero-explore]');
  if (heroExploreButton) {
    heroExploreButton.addEventListener('click', () => {
      window.location.href = 'videojuegos.html';
    });
  }

  // boton CTA de registro — si ya esta logueado va al perfil, si no al registro
  const ctaRegisterButton = document.querySelector('[data-cta-register]');
  if (ctaRegisterButton) {
    ctaRegisterButton.addEventListener('click', () => {
      window.location.href = state.currentUser ? 'perfil.html' : 'register.html';
    });
  }

  attachGameCardEvents(); // agregar eventos a tarjetas que ya estan en el HTML (home estático)

  // tarjetas de noticias del home (estas son estaticas en el HTML, no dinamicas)
  newsCards.forEach((card) => {
    card.setAttribute('role', 'link');
    card.setAttribute('tabindex', '0');
    card.addEventListener('click', () => {
      window.location.href = 'noticia.html';
    });
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        window.location.href = 'noticia.html';
      }
    });
  });

  // formulario de login
  if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      const formData = new FormData(loginForm);

      try {
        const payload = await apiFetch('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            identifier: sanitizeText(formData.get('identifier')), // puede ser email o nombre de usuario
            password:   sanitizeText(formData.get('password')),
          }),
        });

        state.currentUser = payload.user;
        renderAuthNavigation();
        window.location.href = 'perfil.html';
      } catch (error) {
        window.alert(error.message);
      }
    });
  }

  // validacion de contraseña en tiempo real al escribir en el registro
  // va marcando los requisitos que ya se cumplen (longitud, mayuscula, numero, especial)
  const checkPasswordRules = (password) => {
    const results = {
      length:  password.length >= 8,
      upper:   /[A-Z]/.test(password),
      number:  /[0-9]/.test(password),
      special: /[^A-Za-z0-9]/.test(password),
    };

    passwordRuleItems.forEach((item) => {
      item.classList.toggle('is-valid', !!results[item.dataset.rule]);
    });
  };

  const registerPasswordInput = registerForm ? registerForm.elements.password : null;

  if (registerPasswordInput && passwordRulesBox) {
    registerPasswordInput.addEventListener('focus', () => {
      passwordRulesBox.hidden = false; // mostrar los requisitos al enfocar el campo
    });

    registerPasswordInput.addEventListener('input', () => {
      checkPasswordRules(registerPasswordInput.value);
    });
  }

  // formulario de registro
  if (registerForm) {
    registerForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      const formData = new FormData(registerForm);

      try {
        const payload = await apiFetch('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            username:        sanitizeText(formData.get('username')),
            email:           sanitizeText(formData.get('email')),
            password:        sanitizeText(formData.get('password')),
            confirmPassword: sanitizeText(formData.get('confirmPassword')),
          }),
        });

        state.currentUser = payload.user;
        renderAuthNavigation();
        window.location.href = 'perfil.html';
      } catch (error) {
        window.alert(error.message);
      }
    });
  }

  // poner el nombre del juego en el titulo del modal de reseña
  if (reviewGameName && gameTitle) {
    reviewGameName.textContent = sanitizeText(gameTitle.textContent);
  }

  if (reviewOpenButton) {
    reviewOpenButton.addEventListener('click', openReviewModal);
  }

  reviewCloseButtons.forEach((button) => {
    button.addEventListener('click', closeReviewModal);
  });

  // busqueda de juegos con debounce: espera 250ms despues de que el usuario deja de escribir
  // para no hacer una peticion por cada tecla presionada
  if (gamesSearchInput) {
    let searchTimer;

    gamesSearchInput.addEventListener('input', () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(loadGames, 250);
    });

    gamesSearchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        loadGames(); // buscar inmediatamente al presionar Enter
      }
    });
  }

  if (gamesSearchButton && gamesGrid) {
    gamesSearchButton.addEventListener('click', loadGames);
  }

  // cuando cambia cualquier filtro (genero, plataforma, puntuacion) se recarga la lista
  [gamesGenreFilter, gamesPlatformFilter, gamesRatingFilter].forEach((filter) => {
    if (filter) {
      filter.addEventListener('change', loadGames);
    }
  });

  // botones de puntuacion del modal de reseña (1 al 5)
  reviewScoreButtons.forEach((button) => {
    button.addEventListener('click', () => {
      setReviewRating(button.dataset.scoreValue);
    });
  });

  // cerrar el modal con la tecla Escape
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && reviewModal && !reviewModal.hidden) {
      closeReviewModal();
    }
  });

  // envio del formulario de reseña
  if (reviewForm) {
    reviewForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      const comment = sanitizeText(reviewTextarea ? reviewTextarea.value : '');
      const rating  = reviewRatingInput ? Number(reviewRatingInput.value) : 5;

      if (!comment) {
        if (reviewTextarea) { reviewTextarea.focus(); }
        return; // no mandar si el comentario esta vacio
      }

      try {
        const payload = await apiFetch('/api/reviews', {
          method: 'POST',
          body: JSON.stringify({
            gameSlug: currentGameSlug,
            comment,
            rating,
          }),
        });

        if (reviewsGrid) {
          const emptyState = reviewsGrid.querySelector('.reviews-empty');
          if (emptyState) { emptyState.remove(); }

          // si ya habia una tarjeta con el id de esta reseña la reemplaza (edicion)
          // si no habia, la pone al inicio de la lista (nueva reseña)
          const existingCard = reviewsGrid.querySelector(`[data-review-id="${payload.review.id}"]`);
          if (existingCard) {
            existingCard.replaceWith(createReviewPost(payload.review));
          } else {
            reviewsGrid.prepend(createReviewPost(payload.review));
          }
        }

        // actualizar el texto del boton segun si fue crear o editar
        const submitBtn = reviewForm.querySelector('.review-form__submit');
        if (submitBtn)       { submitBtn.textContent = 'Actualizar reseña'; }
        if (reviewOpenButton){ reviewOpenButton.textContent = 'Editar tu reseña'; }

        closeReviewModal();
      } catch (error) {
        window.alert(error.message);
      }
    });
  }

  // cambio de foto de perfil — lee el archivo, lo convierte a base64 y lo manda al servidor
  if (profilePhotoInput) {
    profilePhotoInput.addEventListener('change', () => {
      const [selectedFile] = profilePhotoInput.files || [];

      if (!selectedFile) {
        return;
      }

      const reader = new FileReader();
      reader.addEventListener('load', async () => {
        try {
          const payload = await apiFetch('/api/profile/avatar', {
            method: 'PATCH',
            body: JSON.stringify({
              avatar: reader.result, // data URL en base64
            }),
          });

          state.currentUser = payload.user;
          renderAuthNavigation();

          if (profileAvatar) {
            profileAvatar.src = payload.user.avatar;
          }
        } catch (error) {
          window.alert(error.message);
        }
      });
      reader.readAsDataURL(selectedFile); // convierte el archivo a base64
    });
  }

  // botones de "Cambiar contraseña" y "Cambiar correo" del perfil
  profileActionButtons.forEach((button) => {
    button.addEventListener('click', async () => {

      // cambiar correo electronico
      if (button.dataset.profileAction === 'email') {
        const nextEmail = window.prompt('Escribe tu nuevo correo', profileEmail?.textContent || '');

        if (!nextEmail) {
          return; // el usuario cancelo el prompt
        }

        try {
          const payload = await apiFetch('/api/profile/email', {
            method: 'PATCH',
            body: JSON.stringify({ email: nextEmail }),
          });

          state.currentUser = payload.user;
          renderAuthNavigation();

          if (profileEmail) {
            profileEmail.textContent = payload.user.email;
          }
        } catch (error) {
          window.alert(error.message);
        }
      }

      // cambiar contraseña
      if (button.dataset.profileAction === 'password') {
        const nextPassword = window.prompt('Escribe tu nueva contraseña');

        if (!nextPassword) {
          return;
        }

        try {
          await apiFetch('/api/profile/password', {
            method: 'PATCH',
            body: JSON.stringify({ password: nextPassword }),
          });

          window.alert('Tu contraseña se actualizó correctamente.');
        } catch (error) {
          window.alert(error.message);
        }
      }
    });
  });

  // crea una tarjeta de reseña compacta para el carrusel del inicio (home)
  // diferente a createReviewPost porque no muestra la imagen del usuario
  const createHomeReviewCard = (review) => {
    const article = document.createElement('article');
    article.className = 'review-card';

    const top = document.createElement('div');
    top.className = 'review-card__top';

    const info = document.createElement('div');
    const name = document.createElement('h3');
    name.className   = 'review-card__name';
    name.textContent = review.userName || 'Jugador';

    const game = document.createElement('p');
    game.className   = 'review-card__game';
    game.textContent = review.gameName || '';

    info.append(name, game);

    const ratingDiv = document.createElement('div');
    ratingDiv.className = 'review-card__rating';
    ratingDiv.append(createRatingBars(Number(review.rating) || 5));

    const score = document.createElement('span');
    score.textContent = String(Number(review.rating) || 5);
    ratingDiv.appendChild(score);

    top.append(info, ratingDiv);

    const desc = document.createElement('p');
    desc.className   = 'review-card__desc';
    desc.textContent = review.comment || '';

    article.append(top, desc);
    return article;
  };

  // crea una tarjeta de noticia clickeable que navega a noticia.html?slug=...
  const createNewsCard = (article) => {
    const el = document.createElement('article');
    el.className       = 'news-card';
    el.dataset.newsSlug = article.slug;

    const image = document.createElement('img');
    image.className = 'news-card__image';
    image.src = article.imageUrl || DEFAULT_AVATAR;
    image.alt = `Imagen de ${article.title}`;

    const title = document.createElement('h3');
    title.className   = 'news-card__title';
    title.textContent = article.title;

    const meta = document.createElement('p');
    meta.className   = 'news-card__meta';
    meta.textContent = article.date || '';

    const desc = document.createElement('p');
    desc.className   = 'news-card__desc';
    desc.textContent = article.excerpt;

    el.append(image, title, meta, desc);

    const navigate = () => {
      window.location.href = `noticia.html?slug=${encodeURIComponent(article.slug)}`;
    };

    el.setAttribute('role', 'link');
    el.setAttribute('tabindex', '0');
    el.addEventListener('click', navigate);
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        navigate();
      }
    });

    return el;
  };

  // carga juegos, reseñas y noticias para los carruseles del inicio (index.html)
  const loadHomePage = async () => {
    if (!homeGamesCarousel && !homeReviewsCarousel && !homeNewsCarousel) {
      return; // no estamos en el inicio
    }

    try {
      const payload = await apiFetch('/api/home');

      if (homeGamesCarousel) {
        homeGamesCarousel.innerHTML = '';
        payload.games.forEach((game) => {
          homeGamesCarousel.appendChild(createGameCard(game));
        });
        attachGameCardEvents(homeGamesCarousel.querySelectorAll('.game-card'));
      }

      if (homeReviewsCarousel) {
        homeReviewsCarousel.innerHTML = '';
        payload.reviews.forEach((review) => {
          homeReviewsCarousel.appendChild(createHomeReviewCard(review));
        });
      }

      if (homeNewsCarousel) {
        homeNewsCarousel.innerHTML = '';
        payload.news.forEach((article) => {
          homeNewsCarousel.appendChild(createNewsCard(article));
        });
      }
    } catch {
      // si falla la carga del home la pagina igual carga, solo sin los carruseles dinamicos
    }
  };

  // carga y muestra la lista de noticias con filtros (noticias.html)
  const loadNewsList = async () => {
    if (!newsGrid) {
      return;
    }

    const params   = new URLSearchParams();
    const search   = sanitizeText(newsSearchInput?.value);
    const category = sanitizeText(newsCategorySelect?.value);

    if (search)   params.set('search', search);
    if (category) params.set('category', category);

    newsGrid.innerHTML = '';

    try {
      const query   = params.toString();
      const payload = await apiFetch(`/api/news${query ? `?${query}` : ''}`, {
        method: 'GET',
        headers: {},
      });

      if (!payload.news.length) {
        newsGrid.appendChild(createEmptyState('news-empty', 'No se encontraron noticias.'));
        return;
      }

      payload.news.forEach((article) => {
        newsGrid.appendChild(createNewsCard(article));
      });
    } catch (error) {
      newsGrid.innerHTML = '';
      newsGrid.appendChild(createEmptyState('news-empty', error.message));
    }
  };

  // carga el contenido completo de una noticia — solo actua si hay ?slug= en la URL (noticia.html)
  const loadNewsDetail = async () => {
    const newsDetailSection = document.querySelector('.news-detail');
    if (!newsDetailSection) {
      return; // no estamos en la pagina de detalle de noticia
    }

    const slug = urlParams.get('slug');

    if (!slug) {
      window.location.href = 'noticias.html'; // sin slug no sabemos que noticia mostrar
      return;
    }

    try {
      const payload = await apiFetch(`/api/news/${encodeURIComponent(slug)}`, {
        method: 'GET',
        headers: {},
      });

      const article = payload.article;
      document.title = `${article.title} | The Critic`;

      const titleEl = document.querySelector('[data-news-title]');
      if (titleEl) { titleEl.textContent = article.title; }

      const metaEl = document.querySelector('[data-news-meta]');
      if (metaEl) { metaEl.textContent = `${article.date} · ${article.category}`; }

      // el contenido puede tener saltos de linea — dividimos en parrafos
      const contentEl = document.querySelector('[data-news-content]');
      if (contentEl) {
        contentEl.innerHTML = '';
        const paragraphs = (article.content || article.excerpt || '').split('\n').filter(Boolean);
        paragraphs.forEach((paragraph) => {
          const p = document.createElement('p');
          p.textContent = paragraph;
          contentEl.appendChild(p);
        });
      }

      const imageEl = document.querySelector('.news-detail__image');
      if (imageEl && article.imageUrl) {
        imageEl.src = article.imageUrl;
        imageEl.alt = article.title;
      }
    } catch (error) {
      // si la noticia no existe o hay error, redirigir a la lista
      window.location.href = 'noticias.html';
    }
  };

  // busqueda de noticias con debounce igual que en juegos
  if (newsSearchInput) {
    let newsSearchTimer;
    newsSearchInput.addEventListener('input', () => {
      window.clearTimeout(newsSearchTimer);
      newsSearchTimer = window.setTimeout(loadNewsList, 250);
    });
    newsSearchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        loadNewsList();
      }
    });
  }

  if (newsSearchButton && newsGrid) {
    newsSearchButton.addEventListener('click', loadNewsList);
  }

  if (newsCategorySelect) {
    newsCategorySelect.addEventListener('change', loadNewsList);
  }

  // ============================================================================
  // PUNTO DE ENTRADA
  // carga la sesion primero (siempre) y luego ejecuta solo lo que necesita la
  // pagina actual segun que elementos existan en el DOM
  // ============================================================================
  const init = async () => {
    await loadSession(); // siempre primero — necesitamos saber si hay usuario logueado

    if (profilePage)                                                       { await loadProfile();     }
    if (gamesGrid)                                                         { await loadGames();       }
    if (reviewsGrid)                                                       { await loadGameReviews(); }
    if (homeGamesCarousel || homeReviewsCarousel || homeNewsCarousel)      { await loadHomePage();    }
    if (newsGrid)                                                          { await loadNewsList();    }

    await loadNewsDetail(); // solo hace algo si existe .news-detail en el DOM
  };

  // --- mostrar/ocultar contraseña -----------------------------------------------
  // en lugar de tener dos SVGs y pelear con el CSS para mostrar/ocultar,
  // usamos UN solo SVG y cambiamos su contenido interno con JS al hacer clic
  // asi no hay ningun conflicto de especificidad CSS posible
  const EYE_ON  = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  const EYE_OFF = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';

  document.querySelectorAll('.btn-show-pass').forEach(btn => {
    const svg = btn.querySelector('svg');
    btn.addEventListener('click', () => {
      const input   = btn.parentElement.querySelector('input');
      const mostrar = input.type === 'password';

      input.type    = mostrar ? 'text'   : 'password';
      svg.innerHTML = mostrar ? EYE_OFF  : EYE_ON;
    });
  });

  // --- mini-formulario de contraseña olvidada ------------------------------------
  // al hacer clic en el link se despliega un campo de email dentro del mismo form
  // al enviar llama a /api/auth/forgot-password y muestra confirmacion
  const forgotToggle = document.querySelector('[data-forgot-toggle]');
  const forgotBox    = document.getElementById('forgot-box');
  const forgotSend   = document.getElementById('forgot-send');
  const forgotEmail  = document.getElementById('forgot-email');
  const forgotMsg    = document.getElementById('forgot-msg');

  if (forgotToggle && forgotBox) {
    forgotToggle.addEventListener('click', (e) => {
      e.preventDefault();
      const visible = !forgotBox.classList.contains('hidden');
      forgotBox.classList.toggle('hidden', visible);
      if (!visible) forgotEmail.focus();
    });
  }

  if (forgotSend) {
    forgotSend.addEventListener('click', async () => {
      const email = (forgotEmail.value || '').trim();
      if (!email) { forgotEmail.focus(); return; }

      forgotSend.disabled    = true;
      forgotSend.textContent = 'Enviando...';
      forgotMsg.classList.add('hidden');

      try {
        await fetch('/api/auth/forgot-password', {
          method:      'POST',
          headers:     { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body:        JSON.stringify({ email }),
        });

        // siempre mostramos el mismo mensaje para no revelar si el correo existe
        forgotMsg.classList.remove('hidden');
        forgotMsg.classList.add('forgot-msg-ok');
        forgotMsg.classList.remove('forgot-msg-error');
        forgotMsg.textContent = 'Si ese correo está registrado, recibirás un enlace en breve.';
        forgotEmail.value     = '';
      } catch {
        forgotMsg.classList.remove('hidden');
        forgotMsg.classList.remove('forgot-msg-ok');
        forgotMsg.classList.add('forgot-msg-error');
        forgotMsg.textContent = 'Error de red. Intenta de nuevo.';
      } finally {
        forgotSend.disabled    = false;
        forgotSend.textContent = 'Enviar';
      }
    });
  }

  // --- pagina de reset de contraseña (reset-password.html) ----------------------
  // lee el token de la URL, muestra el formulario y llama a /api/auth/reset-password
  const resetForm    = document.getElementById('reset-form');
  const resetSuccess = document.getElementById('reset-success');
  const resetInvalid = document.getElementById('reset-invalid');
  const resetError   = document.getElementById('reset-error');

  if (resetForm) {
    // leemos el token de la URL: reset-password.html?token=abc123
    const params = new URLSearchParams(window.location.search);
    const token  = params.get('token');

    // si no hay token mostramos el aviso de enlace invalido y ocultamos el form
    if (!token) {
      resetForm.classList.add('hidden');
      resetInvalid.classList.remove('hidden');
    }

    resetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = document.getElementById('reset-password').value;
      const confirm  = document.getElementById('reset-confirm').value;

      resetError.classList.add('hidden');

      if (password !== confirm) {
        resetError.classList.remove('hidden');
        resetError.textContent = 'Las contraseñas no coinciden.';
        return;
      }

      try {
        const res  = await fetch('/api/auth/reset-password', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ token, password }),
        });
        const data = await res.json();

        if (!res.ok) {
          resetError.classList.remove('hidden');
          resetError.textContent = data.error || 'Error al cambiar la contraseña.';
          return;
        }

        // exito — ocultamos el form y mostramos confirmacion
        resetForm.classList.add('hidden');
        resetSuccess.classList.remove('hidden');
      } catch {
        resetError.classList.remove('hidden');
        resetError.textContent = 'Error de red. Intenta de nuevo.';
      }
    });
  }

  init();
});
