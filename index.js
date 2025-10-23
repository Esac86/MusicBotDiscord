import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js'
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType
} from '@discordjs/voice'
import ytdl from '@distube/ytdl-core'
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

const commands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Reproduce una canción de YouTube')
    .addStringOption(option =>
      option.setName('cancion')
        .setDescription('Nombre o URL de la canción')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Salta la canción actual'),
  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Detiene la música y desconecta el bot'),
  new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Muestra la cola de reproducción'),
  new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pausa la música'),
  new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Reanuda la música'),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Muestra los comandos disponibles')
].map(command => command.toJSON())

async function registerCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN)
    console.log('Registrando comandos slash en el servidor...')

    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    )

    console.log('Comandos slash registrados correctamente en tu servidor')
  } catch (error) {
    console.error('Error registrando comandos:', error)
  }
}


async function searchYouTube(query) {
  try {
    const searchResults = await ytsr(query, { limit: 1 })
    return searchResults.items.find(item => item.type === 'video')
  } catch (error) {
    console.error('Error buscando en YouTube:', error)
    return null
  }
}

async function playMusic(voiceChannel, url, interaction) {
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

    channelData = {
      connection: connection,
      player: player,
      queue: [],
      currentSong: null
    }

    voiceChannels.set(voiceChannel.id, channelData)

    connection.on(VoiceConnectionStatus.Disconnected, () => {
      voiceChannels.delete(voiceChannel.id)
    })

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 5000)
    } catch (error) {
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

    player.on('error', error => {
      console.error('Error en el reproductor:', error)
      if (channelData.queue.length > 0) {
        const nextSong = channelData.queue.shift()
        playSong(channelData, nextSong)
      }
    })
  }

  return channelData
}

function playSong(channelData, song) {
  try {
    const stream = ytdl(song.url, {
      filter: 'audioonly',
      quality: 'highestaudio',
      highWaterMark: 1 << 25
    })

    stream.on('error', error => {
      console.error('Error en el stream:', error)
      if (channelData.queue.length > 0) {
        const nextSong = channelData.queue.shift()
        playSong(channelData, nextSong)
      }
    })

    const audioResource = createAudioResource(stream, {
      inputType: StreamType.Arbitrary
    })

    channelData.currentSong = song
    channelData.player.play(audioResource)
  } catch (error) {
    console.error('Error reproduciendo canción:', error)
  }
}

client.once('ready', async () => {
  console.log(`Bot conectado como ${client.user.tag}`)
  await registerCommands()
})

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return

  const voiceChannel = interaction.member?.voice?.channel
  const { commandName } = interaction

  if (commandName === 'play') {
    if (!voiceChannel) {
      await interaction.reply({ content: 'Debes estar en un canal de voz', ephemeral: true })
      return
    }

    const query = interaction.options.getString('cancion')
    await interaction.reply('🔍 Buscando...')

    let video
    if (ytdl.validateURL(query)) {
      try {
        const info = await ytdl.getInfo(query)
        video = {
          url: query,
          title: info.videoDetails.title,
          duration: info.videoDetails.lengthSeconds
        }
      } catch (error) {
        await interaction.followUp('No pude obtener información de ese video')
        return
      }
    } else {
      video = await searchYouTube(query)
      if (!video) {
        await interaction.followUp('No encontré resultados para esa búsqueda')
        return
      }
    }

    const channelData = await playMusic(voiceChannel, video.url, interaction)
    if (!channelData) return

    if (channelData.player.state.status === AudioPlayerStatus.Idle && channelData.queue.length === 0) {
      playSong(channelData, video)
      await interaction.followUp(`▶️ Reproduciendo: **${video.title}**`)
    } else {
      channelData.queue.push(video)
      await interaction.followUp(`➕ Agregado a la cola: **${video.title}** (Posición ${channelData.queue.length})`)
    }
  }

  if (commandName === 'skip') {
    if (!voiceChannel) {
      await interaction.reply({ content: 'Debes estar en un canal de voz', ephemeral: true })
      return
    }

    const channelData = voiceChannels.get(voiceChannel.id)
    if (!channelData) {
      await interaction.reply({ content: 'No hay música reproduciéndose', ephemeral: true })
      return
    }

    if (channelData.queue.length === 0) {
      await interaction.reply('⏭️ No hay más canciones en la cola')
      channelData.player.stop()
    } else {
      await interaction.reply('⏭️ Canción saltada')
      channelData.player.stop()
    }
  }

  if (commandName === 'stop') {
    if (!voiceChannel) {
      await interaction.reply({ content: 'Debes estar en un canal de voz', ephemeral: true })
      return
    }

    const channelData = voiceChannels.get(voiceChannel.id)
    if (!channelData) {
      await interaction.reply({ content: 'No hay música reproduciéndose', ephemeral: true })
      return
    }

    channelData.queue = []
    channelData.player.stop()
    channelData.connection.destroy()
    voiceChannels.delete(voiceChannel.id)
    await interaction.reply('⏹️ Música detenida y bot desconectado')
  }

  if (commandName === 'queue') {
    const channelData = voiceChannels.get(voiceChannel?.id)
    if (!channelData || (!channelData.currentSong && channelData.queue.length === 0)) {
      await interaction.reply({ content: 'La cola está vacía', ephemeral: true })
      return
    }

    let queueText = '🎵 **Cola de reproducción:**\n\n'

    if (channelData.currentSong) {
      queueText += `▶️ **Reproduciendo ahora:** ${channelData.currentSong.title}\n\n`
    }

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
    if (!channelData) {
      await interaction.reply({ content: 'No hay música reproduciéndose', ephemeral: true })
      return
    }

    if (channelData.player.state.status === AudioPlayerStatus.Playing) {
      channelData.player.pause()
      await interaction.reply('⏸️ Música pausada')
    } else {
      await interaction.reply({ content: 'La música ya está pausada', ephemeral: true })
    }
  }

  if (commandName === 'resume') {
    const channelData = voiceChannels.get(voiceChannel?.id)
    if (!channelData) {
      await interaction.reply({ content: 'No hay música reproduciéndose', ephemeral: true })
      return
    }

    if (channelData.player.state.status === AudioPlayerStatus.Paused) {
      channelData.player.unpause()
      await interaction.reply('▶️ Música reanudada')
    } else {
      await interaction.reply({ content: 'La música no está pausada', ephemeral: true })
    }
  }

  if (commandName === 'help') {
    const helpText = `
🎵 **Comandos del Bot de Música:**

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

const app = express()
const PORT = process.env.PORT || 3000

app.head('/', (req, res) => {
  res.sendStatus(200)
})

app.get('/', (req, res) => {
  res.send('Bot de música en funcionamiento')
})

app.listen(PORT, () => {
  console.log(`Servidor web escuchando en el puerto ${PORT}`)
})

client.login(process.env.DISCORD_TOKEN)