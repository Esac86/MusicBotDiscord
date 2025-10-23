# MusicBotDiscord

Bot de Discord para reproducir música de YouTube en canales de voz usando comandos slash.

---

## Características

- Reproducción de música desde YouTube
- Comandos slash (/)
- Sistema de cola de reproducción
- Controles completos (play, pause, skip, stop)
- Desconexión automática cuando queda solo
- Servidor web integrado para deployment

---

## Configuración

Crea un archivo `.env` en la raíz del proyecto con el siguiente contenido:
```env
DISCORD_TOKEN=tu-token
CLIENT_ID=tu-client-id
```

Obtén tu token y CLIENT_ID en el [Portal de Desarrolladores de Discord](https://discord.com/developers/applications).

**Importante:** Necesitas tener **FFmpeg** instalado en tu sistema.

---

## Comandos

- `/play <canción>` - Reproduce música
- `/skip` - Salta la canción actual
- `/stop` - Detiene y desconecta
- `/queue` - Muestra la cola
- `/pause` - Pausa la música
- `/resume` - Reanuda la música
- `/help` - Muestra los comandos

---

## Permisos Necesarios

- Conectar y hablar en voz
- Leer mensajes
- Usar comandos de aplicación

---

## Licencia

MIT License - Consulta el archivo [LICENSE](LICENSE) para más detalles.

---

**Repositorio:** https://github.com/Esac86/MusicBotDiscord