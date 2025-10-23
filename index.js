import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js'
import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState, StreamType } from '@discordjs/voice'
import play from 'play-dl'
import ytsr from 'ytsr'
import express from 'express'
import dotenv from 'dotenv'

dotenv.config()

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages
  ]
})

const voiceChannels = new Map()

// Comandos slash
const commands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Reproduce una canción de YouTube')
    .addStringOption(option => option.setName('cancion').setDescription('Nombre o URL de la canción').setRequired(true)),
  new SlashCommandBuilder().setName('skip').setDescription('Salta la canción actual'),
  new SlashCommandBuilder().setName('stop').setDescription('Detiene la música y desconecta el bot'),
  new SlashCommandBuilder().setName('queue').setDescription('Muestra la cola de reproducción'),
  new SlashCommandBuilder().setName('pause').setDescription('Pausa la música'),
  new SlashCommandBuilder().setName('resume').setDescription('Reanuda la música'),
  new SlashCommandBuilder().setName('help').setDescription('Muestra los comandos disponibles')
].map(c => c.toJSON())

// Registrar comandos solo en tu servidor
async function registerCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN)
    console.log('Registrando comandos slash en el servidor...')
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    )
    console.log('Comandos slash registrados correctamente')
  } catch (err) {
    console.error('Error registrando comandos:', err)
  }
}

// Buscar video en YouTube
async function searchYouTube(query) {
  try {
    const results = await ytsr(query, { limit: 5 })
    if (!results.items) return null
    return results.items.find(item => item.type === 'video')
  } catch (err) {
    console.error('Error buscando en YouTube:', err)
    return null
  }
}

// Conectar al canal y crear reproductor
async function playMusic(voiceChannel, interaction) {
  const permissions = voiceChannel.permissionsFor(client.user)
  if (!permissions.has(['Connect', 'Speak'])) {
    await interaction.followUp('No tengo permisos para conectarme o hablar en ese canal')
    return null
  }

  let channelData = voiceChannels.get(voiceChannel.id)

  if (!channelData) {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator
    })

    const player = createAudioPlayer()
    connection.subscribe(player)

    channelData = { connection, player, queue: [], currentSong: null }
    voiceChannels.set(voiceChannel.id, channelData)

    connection.on(VoiceConnectionStatus.Disconnected, () => {
      voiceChannels.delete(voiceChannel.id)
    })

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 5000)
    } catch (err) {
      connection.destroy()
      await interaction.followUp('No pude conectarme al canal de voz')
      return null
    }

    player.on(AudioPlayerStatus.Idle, () => {
      channelData.currentSong = null
      if (channelData.queue.length > 0) {
        const nextSong = channelData.queue.shift()
        playSong(channelData, nextSong)
      }
    })

    player.on('error', err => {
      console.error('Error en el reproductor:', err)
      if (channelData.queue.length > 0) {
        const nextSong = channelData.queue.shift()
        playSong(channelData, nextSong)
      }
    })
  }

  return channelData
}

// Reproducir canción
async function playSong(channelData, song) {
  try {
    const stream = await play.stream(song.url)
    const resource = createAudioResource(stream.stream, { inputType: stream.type })
    channelData.currentSong = song
    channelData.player.play(resource)
  } catch (err) {
    console.error('Error reproduciendo canción:', err)
    if (channelData.queue.length > 0) {
      const nextSong = channelData.queue.shift()
      playSong(channelData, nextSong)
    }
  }
}

// Ready
client.once('ready', async () => {
  console.log(`Bot conectado como ${client.user.tag}`)
  await registerCommands()
})

// Interacciones
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return
  const voiceChannel = interaction.member?.voice?.channel
  const { commandName } = interaction

  if (commandName === 'play') {
    if (!voiceChannel) return interaction.reply({ content: 'Debes estar en un canal de voz', ephemeral: true })
    const query = interaction.options.getString('cancion')
    await interaction.deferReply()

    let video
    if (play.yt_validate(query) === 'video') {
      const info = await play.video_info(query)
      video = { url: query, title: info.video_details.title, duration: info.video_details.durationInSec }
    } else {
      video = await searchYouTube(query)
      if (!video) return interaction.editReply('No encontré resultados para esa búsqueda')
    }

    const channelData = await playMusic(voiceChannel, interaction)
    if (!channelData) return

    if (channelData.player.state.status === AudioPlayerStatus.Idle && channelData.queue.length === 0) {
      playSong(channelData, video)
      await interaction.editReply(`▶️ Reproduciendo: **${video.title}**`)
    } else {
      channelData.queue.push(video)
      await interaction.editReply(`➕ Agregado a la cola: **${video.title}** (Posición ${channelData.queue.length})`)
    }
  }

  if (commandName === 'skip') {
    if (!voiceChannel) return interaction.reply({ content: 'Debes estar en un canal de voz', ephemeral: true })
    const channelData = voiceChannels.get(voiceChannel.id)
    if (!channelData) return interaction.reply({ content: 'No hay música reproduciéndose', ephemeral: true })
    channelData.player.stop()
    await interaction.reply('⏭️ Canción saltada')
  }

  if (commandName === 'stop') {
    if (!voiceChannel) return interaction.reply({ content: 'Debes estar en un canal de voz', ephemeral: true })
    const channelData = voiceChannels.get(voiceChannel.id)
    if (!channelData) return interaction.reply({ content: 'No hay música reproduciéndose', ephemeral: true })
    channelData.queue = []
    channelData.player.stop()
    channelData.connection.destroy()
    voiceChannels.delete(voiceChannel.id)
    await interaction.reply('⏹️ Música detenida y bot desconectado')
  }

  if (commandName === 'queue') {
    const channelData = voiceChannels.get(voiceChannel?.id)
    if (!channelData || (!channelData.currentSong && channelData.queue.length === 0))
      return interaction.reply({ content: 'La cola está vacía', ephemeral: true })

    let queueText = '🎵 **Cola de reproducción:**\n\n'
    if (channelData.currentSong) queueText += `▶️ **Reproduciendo ahora:** ${channelData.currentSong.title}\n\n`
    if (channelData.queue.length > 0) {
      queueText += '**Próximas canciones:**\n'
      channelData.queue.forEach((song, index) => {
        queueText += `${index + 1}. ${song.title}\n`
      })
    }
    await interaction.reply(queueText)
  }

  if (commandName === 'pause') {
    const channelData = voiceChannels.get(voiceChannel?.id)
    if (!channelData) return interaction.reply({ content: 'No hay música reproduciéndose', ephemeral: true })
    if (channelData.player.state.status === AudioPlayerStatus.Playing) {
      channelData.player.pause()
      await interaction.reply('⏸️ Música pausada')
    } else {
      await interaction.reply({ content: 'La música ya está pausada', ephemeral: true })
    }
  }

  if (commandName === 'resume') {
    const channelData = voiceChannels.get(voiceChannel?.id)
    if (!channelData) return interaction.reply({ content: 'No hay música reproduciéndose', ephemeral: true })
    if (channelData.player.state.status === AudioPlayerStatus.Paused) {
      channelData.player.unpause()
      await interaction.reply('▶️ Música reanudada')
    } else {
      await interaction.reply({ content: 'La música no está pausada', ephemeral: true })
    }
  }

  if (commandName === 'help') {
    const helpText = `
🎵 **Comandos disponibles:**

\`/play <canción>\` - Reproduce una canción de YouTube
\`/skip\` - Salta la canción actual
\`/stop\` - Detiene la música y desconecta el bot
\`/queue\` - Muestra la cola de reproducción
\`/pause\` - Pausa la música
\`/resume\` - Reanuda la música
\`/help\` - Muestra este mensaje
    `
    await interaction.reply(helpText)
  }
})

// Desconectar si queda solo en el canal
client.on('voiceStateUpdate', (oldState, newState) => {
  if (oldState.channelId === newState.channelId) return
  const voiceChannel = oldState.channel || newState.channel
  if (!voiceChannel) return
  const botInChannel = voiceChannel.members.get(client.user.id)
  if (botInChannel && voiceChannel.members.size === 1) {
    setTimeout(() => {
      if (voiceChannel.members.size === 1) {
        const channelData = voiceChannels.get(voiceChannel.id)
        if (channelData) {
          channelData.queue = []
          channelData.player.stop()
          channelData.connection.destroy()
          voiceChannels.delete(voiceChannel.id)
          console.log(`Bot desconectado de ${voiceChannel.name} (solo en el canal)`)
        }
      }
    }, 5000)
  }
})

// Servidor web para KeepAlive en Render
const app = express()
const PORT = process.env.PORT || 3000
app.head('/', (req, res) => res.sendStatus(200))
app.get('/', (req, res) => res.send('Bot de música en funcionamiento'))
app.listen(PORT, () => console.log(`Servidor escuchando en puerto ${PORT}`))

client.login(process.env.DISCORD_TOKEN)
