# The Critic

Proyecto escolar de resenas y noticias de videojuegos.

## Estado actual

El proyecto ya incluye una primera base de backend con:

- Registro de usuario
- Inicio y cierre de sesion
- Perfil de usuario
- Publicacion de resenas
- Persistencia con SQLite

## Tecnologias

- HTML
- CSS
- JavaScript
- Node.js
- SQLite nativa de Node 22

## Requisitos

- Node.js 22 o superior

## Como ejecutar

1. Abre una terminal en la carpeta del proyecto.
2. Ejecuta:

```bash
npm start
```

3. Abre en el navegador:

```text
http://localhost:3000
```

## Base de datos

La base de datos se crea automaticamente al iniciar el servidor.

Archivo generado localmente:

```text
data/the-critic.db
```

Ese archivo no se sube al repositorio porque esta ignorado en `.gitignore`.

## Funcionalidades hasta el momento

- Crear una cuenta nueva
- Iniciar sesion
- Ver el perfil del usuario
- Publicar una resena en la pagina del juego
- Ver la resena en el perfil

## Archivos principales

- `server.js`: servidor HTTP y API
- `js/main.js`: logica del frontend conectada al backend
- `data/the-critic.db`: base SQLite local generada automaticamente

## Nota

Este proyecto representa el avance actual de la aplicación web. Por ahora ya cuenta con funciones básicas como registro, inicio de sesión, perfil de usuario y publicación de reseñas. Algunas secciones todavía siguen estáticas, pero la idea es irlas conectando al backend en las siguientes etapas del desarrollo.