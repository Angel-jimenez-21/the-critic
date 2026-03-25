document.addEventListener('DOMContentLoaded', () => {
  const state = {
    currentUser: null,
  };

  const DEFAULT_AVATAR = 'assets/img/cta.png';
  const gameCards = document.querySelectorAll('.game-card');
  const newsCards = document.querySelectorAll('.news-card');
  const navAuthContainers = document.querySelectorAll('.nav-auth');
  const loginForm = document.querySelector('.login-form');
  const registerForm = document.querySelector('.register-form');
  const profilePage = document.querySelector('.profile-page');
  const profileName = document.querySelector('[data-profile-name]');
  const profileEmail = document.querySelector('[data-profile-email]');
  const profileAvatar = document.querySelector('[data-profile-avatar]');
  const profilePhotoInput = document.querySelector('[data-profile-photo-input]');
  const profileReviewsGrid = document.querySelector('[data-profile-reviews]');
  const profileActionButtons = document.querySelectorAll('[data-profile-action]');
  const reviewOpenButton = document.querySelector('[data-review-open]');
  const reviewModal = document.querySelector('[data-review-modal]');
  const reviewCloseButtons = document.querySelectorAll('[data-review-close]');
  const reviewForm = document.querySelector('[data-review-form]');
  const reviewTextarea = document.querySelector('#review-comment');
  const reviewRatingInput = reviewForm ? reviewForm.elements.rating : null;
  const reviewScoreButtons = document.querySelectorAll('[data-score-value]');
  const reviewsGrid = document.querySelector('.reviews-grid');
  const gameTitle = document.querySelector('.game-detail__title');
  const reviewGameName = document.querySelector('[data-review-game-name]');
  const gameDetailSection = document.querySelector('[data-game-slug]');
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';

  const sanitizeText = (value) => String(value || '').trim();

  const slugify = (value) =>
    sanitizeText(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  const currentGameSlug =
    gameDetailSection?.dataset.gameSlug || slugify(gameTitle ? gameTitle.textContent : 'minecraft-java-edition');

  const apiFetch = async (url, options = {}) => {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      ...options,
    });

    const isJson = response.headers.get('content-type')?.includes('application/json');
    const payload = isJson ? await response.json() : null;

    if (!response.ok) {
      throw new Error(payload?.error || 'Ocurrió un error al procesar la solicitud.');
    }

    return payload;
  };

  const formatReviewDate = (value) => {
    if (!value) {
      return '';
    }

    if (/^\d{2}\.\d{2}\.\d{4}$/.test(value)) {
      return value;
    }

    const date = new Date(value);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();

    return `${day}.${month}.${year}`;
  };

  const renderAuthNavigation = () => {
    const profileActiveClass = currentPage === 'perfil.html' ? ' class="is-active"' : '';
    const loginActiveClass = currentPage === 'login.html' ? ' class="is-active"' : '';
    const registerActiveClass = currentPage === 'register.html' ? ' class="is-active"' : '';

    navAuthContainers.forEach((container) => {
      container.innerHTML = state.currentUser
        ? `<a${profileActiveClass} href="perfil.html">Mi perfil</a> / <button class="nav-auth__button" type="button" data-logout>Cerrar sesión</button>`
        : `<a${loginActiveClass} href="login.html">Iniciar sesión</a> / <a${registerActiveClass} href="register.html">Registrarse</a>`;
    });
  };

  const createRatingBars = (rating) => {
    const ratingBars = document.createElement('div');
    ratingBars.className = 'rating-bars';

    for (let index = 1; index <= 5; index += 1) {
      const bar = document.createElement('span');
      bar.className = 'rating-bar';

      if (index <= rating) {
        bar.classList.add('is-filled');
      }

      ratingBars.appendChild(bar);
    }

    return ratingBars;
  };

  const createReviewPost = (review) => {
    const article = document.createElement('article');
    article.className = 'review-post';

    const top = document.createElement('div');
    top.className = 'review-post__top';

    const user = document.createElement('div');
    user.className = 'review-post__user';

    const avatar = document.createElement('img');
    avatar.className = 'review-post__avatar';
    avatar.src = review.avatar || DEFAULT_AVATAR;
    avatar.alt = 'Avatar del usuario';

    const details = document.createElement('div');
    const name = document.createElement('p');
    name.className = 'review-post__name';
    name.textContent = review.userName || 'Jugador';

    const game = document.createElement('p');
    game.className = 'review-post__game';
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
    date.className = 'review-post__date';
    date.textContent = formatReviewDate(review.date || review.createdAt);

    rating.append(ratingMain, date);
    top.append(user, rating);

    const text = document.createElement('p');
    text.className = 'review-post__text';
    text.textContent = review.comment || '';

    article.append(top, text);
    return article;
  };

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
    const name = document.createElement('p');
    name.className = 'profile-review-card__name';
    name.textContent = review.userName || state.currentUser?.name || 'Jugador';

    const game = document.createElement('p');
    game.className = 'profile-review-card__game';
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
    date.className = 'profile-review-card__date';
    date.textContent = formatReviewDate(review.date || review.createdAt);

    rating.append(ratingMain, date);
    top.append(user, rating);

    const text = document.createElement('p');
    text.className = 'profile-review-card__text';
    text.textContent = review.comment || '';

    article.append(top, text);
    return article;
  };

  const createEmptyState = (className, text) => {
    const message = document.createElement('p');
    message.className = className;
    message.textContent = text;
    return message;
  };

  const loadSession = async () => {
    try {
      const payload = await apiFetch('/api/session', {
        method: 'GET',
        headers: {},
      });

      state.currentUser = payload.user || null;
    } catch (error) {
      state.currentUser = null;
    }

    renderAuthNavigation();
  };

  const loadGameReviews = async () => {
    if (!reviewsGrid || !currentGameSlug) {
      return;
    }

    try {
      const payload = await apiFetch(`/api/games/${currentGameSlug}/reviews`, {
        method: 'GET',
        headers: {},
      });

      reviewsGrid.innerHTML = '';

      if (!payload.reviews.length) {
        reviewsGrid.appendChild(createEmptyState('reviews-empty', 'Aún no hay reseñas para este juego.'));
        return;
      }

      payload.reviews.forEach((review) => {
        reviewsGrid.appendChild(createReviewPost(review));
      });
    } catch (error) {
      reviewsGrid.innerHTML = '';
      reviewsGrid.appendChild(createEmptyState('reviews-empty', error.message));
    }
  };

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

      if (profileName) {
        profileName.textContent = payload.user.name;
      }

      if (profileEmail) {
        profileEmail.textContent = payload.user.email;
      }

      if (profileAvatar) {
        profileAvatar.src = payload.user.avatar || DEFAULT_AVATAR;
      }

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
      window.location.href = 'login.html';
    }
  };

  const setReviewRating = (value) => {
    if (!reviewRatingInput) {
      return;
    }

    const rating = Number(value);
    reviewRatingInput.value = String(rating);

    reviewScoreButtons.forEach((button) => {
      button.classList.toggle('is-active', Number(button.dataset.scoreValue) <= rating);
    });
  };

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
    document.body.classList.add('modal-open');

    window.requestAnimationFrame(() => {
      if (reviewTextarea) {
        reviewTextarea.focus();
      }
    });
  };

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

  navAuthContainers.forEach((container) => {
    container.addEventListener('click', async (event) => {
      const logoutButton = event.target.closest('[data-logout]');

      if (!logoutButton) {
        return;
      }

      try {
        await apiFetch('/api/auth/logout', {
          method: 'POST',
          body: JSON.stringify({}),
        });

        state.currentUser = null;
        renderAuthNavigation();

        if (profilePage) {
          window.location.href = 'index.html';
        }
      } catch (error) {
        window.alert(error.message);
      }
    });
  });

  gameCards.forEach((card) => {
    card.setAttribute('role', 'link');
    card.setAttribute('tabindex', '0');
    card.addEventListener('click', () => {
      window.location.href = 'juego.html';
    });
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        window.location.href = 'juego.html';
      }
    });
  });

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

  if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      const formData = new FormData(loginForm);

      try {
        const payload = await apiFetch('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            identifier: sanitizeText(formData.get('identifier')),
            password: sanitizeText(formData.get('password')),
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

  if (registerForm) {
    registerForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      const formData = new FormData(registerForm);

      try {
        const payload = await apiFetch('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            username: sanitizeText(formData.get('username')),
            email: sanitizeText(formData.get('email')),
            password: sanitizeText(formData.get('password')),
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

  if (reviewGameName && gameTitle) {
    reviewGameName.textContent = sanitizeText(gameTitle.textContent);
  }

  if (reviewOpenButton) {
    reviewOpenButton.addEventListener('click', openReviewModal);
  }

  reviewCloseButtons.forEach((button) => {
    button.addEventListener('click', closeReviewModal);
  });

  reviewScoreButtons.forEach((button) => {
    button.addEventListener('click', () => {
      setReviewRating(button.dataset.scoreValue);
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && reviewModal && !reviewModal.hidden) {
      closeReviewModal();
    }
  });

  if (reviewForm) {
    reviewForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      const comment = sanitizeText(reviewTextarea ? reviewTextarea.value : '');
      const rating = reviewRatingInput ? Number(reviewRatingInput.value) : 5;

      if (!comment) {
        if (reviewTextarea) {
          reviewTextarea.focus();
        }
        return;
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
          if (emptyState) {
            emptyState.remove();
          }

          reviewsGrid.prepend(createReviewPost(payload.review));
        }

        reviewForm.reset();
        setReviewRating(5);
        closeReviewModal();
      } catch (error) {
        window.alert(error.message);
      }
    });
  }

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
              avatar: reader.result,
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
      reader.readAsDataURL(selectedFile);
    });
  }

  profileActionButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      if (button.dataset.profileAction === 'email') {
        const nextEmail = window.prompt('Escribe tu nuevo correo', profileEmail?.textContent || '');

        if (!nextEmail) {
          return;
        }

        try {
          const payload = await apiFetch('/api/profile/email', {
            method: 'PATCH',
            body: JSON.stringify({
              email: nextEmail,
            }),
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

      if (button.dataset.profileAction === 'password') {
        const nextPassword = window.prompt('Escribe tu nueva contraseña');

        if (!nextPassword) {
          return;
        }

        try {
          await apiFetch('/api/profile/password', {
            method: 'PATCH',
            body: JSON.stringify({
              password: nextPassword,
            }),
          });

          window.alert('Tu contraseña se actualizó correctamente.');
        } catch (error) {
          window.alert(error.message);
        }
      }
    });
  });

  const init = async () => {
    await loadSession();

    if (profilePage) {
      await loadProfile();
    }

    if (reviewsGrid) {
      await loadGameReviews();
    }
  };

  init();
});
